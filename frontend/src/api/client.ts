import type {
  ArtistDetail,
  ArtistSummary,
  ArtworkDetail,
  ArtworkPage,
  ArtworkSummary,
  CaptionsResult,
  Genre,
  MatchResult,
  Meme,
  MemeStyle,
} from "./types";
import { pending, read, RESUME, remove, route, write, type PendingAction } from "../auth/workflow";
import { authEnabled } from "../auth/supabase";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/** Error with a user-facing Ukrainian message from the backend's `detail`. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

let authToken: string | null = null;
/** Called by AuthContext whenever the session changes. */
export function setAuthToken(token: string | null) {
  authToken = token;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    // Render free tier sleeps ~30–60 s after idle; first request may fail or be slow.
    throw new ApiError(0, "Сервер прокидається, спробуйте ще раз за хвилину");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    throw new ApiError(
      res.status, typeof detail === "string" ? detail : detail?.message ?? "Щось пішло не так", detail?.code,
    );
  }
  let allowanceChanged = false;
  for (const [header, key] of [
    ["X-Guest-Remaining", "remaining"], ["X-Guest-Exports-Remaining", "exports_remaining"],
  ] as const) {
    const remaining = res.headers.get(header);
    if (remaining !== null && guestState) {
      guestState[key] = Number(remaining);
      allowanceChanged = true;
    }
  }
  if (allowanceChanged) {
    window.dispatchEvent(new CustomEvent("pidsklom:allowance", { detail: { ...guestState } }));
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export interface Guest {
  enabled: boolean;
  token: string | null;
  remaining: number | null;
  exports_remaining?: number | null;
}

export type ExportAuthorization =
  | { enabled: false; remaining: null }
  | { enabled: true; fingerprint: string; lease: string | null; remaining: number };

let guestRequest: Promise<Guest> | null = null;
let guestState: Guest | null = null;
export function getGuest(): Promise<Guest> {
  if (!guestRequest) {
    const initialize = async () => {
      const token = localStorage.getItem("pidsklom.guest");
      const guest = await request<Guest>("/api/guest", {
        method: "POST", headers: token ? { "X-Guest-Token": token } : {},
      });
      if (guest.token) localStorage.setItem("pidsklom.guest", guest.token);
      guestState = guest;
      return guest;
    };
    guestRequest = (
      navigator.locks ? navigator.locks.request("pidsklom-guest", initialize) : initialize()
    ).catch((error: unknown) => { guestRequest = null; throw error; });
  }
  return guestRequest;
}

const running = new Map<string, Promise<unknown>>();

async function waitForOperation<T>(action: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "operation_pending" || attempt >= 120) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function exportRequest<T>(path: string, body: unknown): Promise<T> {
  const guest = authToken ? null : await getGuest();
  const headers: Record<string, string> = {};
  if (guest?.token) headers["X-Guest-Token"] = guest.token;
  return waitForOperation(() => request<T>(path, { ...post(body), headers }));
}

async function generation<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!authEnabled) return request<T>(path, post(body));
  const resume = pending(RESUME);
  const continuation = resume?.kind === "generation" && resume.route === route() && resume.path === path ? resume : null;
  const actualBody = continuation?.body ?? body;
  const key = `generation:${route()}:${path}:${JSON.stringify(actualBody)}`;
  const stored = read<{ id: string; result?: T }>(key);
  if (stored?.result) return stored.result;
  const id = continuation?.id ?? stored?.id ?? crypto.randomUUID();
  write(key, { id });
  const inflight = running.get(id);
  if (inflight) return inflight as Promise<T>;
  const run = async () => {
    const guest = authToken ? null : await getGuest();
    const headers: Record<string, string> = { "Idempotency-Key": id };
    if (guest?.token) headers["X-Guest-Token"] = guest.token;
    try {
      const result = await waitForOperation(() => request<T>(path, { ...post(actualBody), headers }));
      write(key, { id, result });
      if (continuation) remove(RESUME);
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.code === "guest_limit_exceeded") {
        const action: PendingAction = { kind: "generation", id, route: route(), path, body: actualBody };
        window.dispatchEvent(new CustomEvent("pidsklom:login-needed", { detail: action }));
      }
      throw error;
    }
  };
  const promise = run().finally(() => running.delete(id));
  running.set(id, promise);
  return promise;
}

export const api = {
  health: () => request<Record<string, unknown>>("/api/health"),

  // content
  artists: () => request<ArtistSummary[]>("/api/artists"),
  artist: (slug: string) => request<ArtistDetail>(`/api/artists/${slug}`),
  artworks: (p: { q?: string; genre?: Genre | null; artist?: string; limit?: number; offset?: number } = {}) =>
    request<ArtworkPage>(`/api/artworks${qs(p)}`),
  artwork: (id: number) => request<ArtworkDetail>(`/api/artworks/${id}`),
  randomArtwork: async () => (await request<{ items: ArtworkSummary[] }>("/api/artworks?random=true&limit=1")).items[0],

  // AI flows
  match: (phrase: string, description?: string) => generation<MatchResult>("/api/matches", { phrase, description }),
  captions: (artworkId: number, exclude: string[] = []) =>
    generation<CaptionsResult>(`/api/artworks/${artworkId}/captions`, { exclude }),

  authorizeExport: (artworkId: number, imageDataUrl: string) =>
    exportRequest<ExportAuthorization>("/api/exports", { artwork_id: artworkId, image_data_url: imageDataUrl }),
  finishExport: (fingerprint: string, lease: string, success: boolean) =>
    exportRequest<{ remaining: number | null }>("/api/exports/finish", { fingerprint, lease, success }),

  // memes (login required)
  memes: (favorite?: boolean) => request<Meme[]>(`/api/memes${qs({ favorite })}`),
  meme: (id: string) => request<Meme>(`/api/memes/${id}`),
  createMeme: (artworkId: number, style: MemeStyle, imageDataUrl?: string, intent: string = crypto.randomUUID()) =>
    request<Meme>("/api/memes", {
      ...post({ artwork_id: artworkId, style, image_data_url: imageDataUrl }), headers: { "Idempotency-Key": intent },
    }),
  updateMeme: (id: string, patch: { style?: MemeStyle; image_data_url?: string; is_favorite?: boolean }) =>
    request<Meme>(`/api/memes/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteMeme: (id: string) => request<void>(`/api/memes/${id}`, { method: "DELETE" }),
};
