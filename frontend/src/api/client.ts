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

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/** Error with a user-facing Ukrainian message from the backend's `detail`. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let authToken: string | null = null;
/** Called by AuthContext whenever the session changes. */
export function setAuthToken(token: string | null) {
  authToken = token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    const detail = typeof body?.detail === "string" ? body.detail : "Щось пішло не так";
    throw new ApiError(res.status, detail);
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

export const api = {
  health: () => request<Record<string, unknown>>("/api/health"),

  // content
  artists: () => request<ArtistSummary[]>("/api/artists"),
  artist: (slug: string) => request<ArtistDetail>(`/api/artists/${slug}`),
  artworks: (p: { q?: string; genre?: Genre | null; artist?: string; limit?: number; offset?: number } = {}) =>
    request<ArtworkPage>(`/api/artworks${qs(p)}`),
  artwork: (id: number) => request<ArtworkDetail>(`/api/artworks/${id}`),
  randomArtwork: () => request<ArtworkSummary>("/api/artworks/random"),

  // AI flows
  match: (phrase: string, description?: string) => request<MatchResult>("/api/match", post({ phrase, description })),
  captions: (artworkId: number, exclude: string[] = []) =>
    request<CaptionsResult>("/api/captions", post({ artwork_id: artworkId, exclude })),

  // memes (login required)
  memes: (favorite?: boolean) => request<Meme[]>(`/api/memes${qs({ favorite })}`),
  meme: (id: string) => request<Meme>(`/api/memes/${id}`),
  createMeme: (artworkId: number, style: MemeStyle, imageDataUrl?: string) =>
    request<Meme>("/api/memes", post({ artwork_id: artworkId, style, image_data_url: imageDataUrl })),
  updateMeme: (id: string, patch: { style?: MemeStyle; image_data_url?: string; is_favorite?: boolean }) =>
    request<Meme>(`/api/memes/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteMeme: (id: string) => request<void>(`/api/memes/${id}`, { method: "DELETE" }),
};
