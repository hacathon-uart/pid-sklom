import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router";
import { api } from "./client";
import type { Genre } from "./types";
import { useApi } from "./useApi";

export const ARTWORK_PAGE_SIZE = 20;

const GENRES: Genre[] = ["portrait", "landscape", "everyday", "avantgarde"];

/** Shared URL-backed catalogue state for the gallery and painting picker. */
export function useArtworkCatalogue() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const rawGenre = params.get("genre");
  const genre = GENRES.find((value) => value === rawGenre) ?? null;
  const rawPage = Number(params.get("page") ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const result = useApi(
    () => api.artworks({ q: query, genre, limit: ARTWORK_PAGE_SIZE, offset: (page - 1) * ARTWORK_PAGE_SIZE }),
    [query, genre, page],
  );
  const totalPages = Math.max(1, Math.ceil((result.data?.total ?? 0) / ARTWORK_PAGE_SIZE));

  const update = useCallback((key: "q" | "genre" | "page", value: string | null, replace = false) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== "page") next.delete("page");
      return next;
    }, { replace, preventScrollReset: true });
  }, [setParams]);

  // The catalogue may shrink while a visitor is on a later page.
  useEffect(() => {
    if (!result.loading && result.data && page > totalPages) {
      update("page", totalPages === 1 ? null : String(totalPages), true);
    }
  }, [result.loading, result.data, page, totalPages, update]);

  return {
    query,
    genre,
    page,
    result,
    setQuery: (next: string) => update("q", next || null, true),
    setGenre: (next: Genre | null) => update("genre", next, true),
    setPage: (next: number) => update("page", next > 1 ? String(next) : null),
  };
}
