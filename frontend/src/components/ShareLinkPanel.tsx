/** A selectable public URL remains available when clipboard access is denied. */
export function publicMemeUrl(id: string): string {
  return `${window.location.origin}/m/${id}`;
}

export async function copyPublicMemeUrl(id: string): Promise<{ url: string; copied: boolean }> {
  const url = publicMemeUrl(id);
  return { url, copied: await copyShareUrl(url) };
}

export async function copyShareUrl(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

export function ShareLinkPanel({ url, copied, onCopy, onClose }: { url: string; copied: boolean; onCopy: () => void; onClose: () => void }) {
  return (
    <div className="mt-3 max-w-md rounded-card border border-line bg-surface p-4 shadow-sm" role="status" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <p className="t-strong">{copied ? "Посилання скопійовано" : "Посилання готове"}</p>
        <button type="button" aria-label="Закрити посилання" onClick={onClose} className="t-small min-h-11 rounded-control px-2 text-accent focus-visible:outline-2 focus-visible:outline-accent">Закрити</button>
      </div>
      <p className="t-small mt-1 text-text-secondary">Мем додано до «Улюблених». Посилання доступне всім, хто його має.</p>
      <a href={url} className="t-small mt-3 block break-all text-accent underline underline-offset-4" target="_blank" rel="noopener noreferrer">{url}</a>
      <button type="button" onClick={onCopy} className="t-strong mt-3 min-h-11 rounded-control border border-line px-3 text-accent focus-visible:outline-2 focus-visible:outline-accent">Копіювати посилання</button>
      {!copied && <p className="t-small mt-2 text-text-secondary">Браузер не дозволив копіювання. Виділіть посилання вище.</p>}
    </div>
  );
}
