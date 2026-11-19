import { ARTWORK_PAGE_SIZE } from "../api/useArtworkCatalogue";

export function ArtworkPagination({ page, total, onPageChange }: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.ceil(total / ARTWORK_PAGE_SIZE);
  if (pages <= 1) return null;
  const first = (page - 1) * ARTWORK_PAGE_SIZE + 1;
  const last = Math.min(page * ARTWORK_PAGE_SIZE, total);
  return (
    <nav aria-label="Сторінки картин" className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
      <p role="status" className="t-small w-full text-text-secondary sm:w-auto">
        Картини {first}–{last} із {total} · Сторінка {page} з {pages}
      </p>
      <div className="flex w-full gap-2 sm:w-auto">
        <button type="button" disabled={page === 1} onClick={() => onPageChange(page - 1)} className="t-strong min-h-11 flex-1 rounded-control border border-line bg-surface px-4 py-2 text-accent transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none">← Попередня</button>
        <button type="button" disabled={page >= pages} onClick={() => onPageChange(page + 1)} className="t-strong min-h-11 flex-1 rounded-control border border-line bg-surface px-4 py-2 text-accent transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none">Наступна →</button>
      </div>
    </nav>
  );
}
