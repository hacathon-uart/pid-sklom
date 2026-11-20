import { useId, useLayoutEffect, useRef, type RefObject } from "react";
import { Button, IconButton } from "./Button";

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

export function ShareLinkPanel({ url, copied, showFavoriteNotice, triggerRef, onCopy, onClose }: {
  url: string;
  copied: boolean;
  showFavoriteNotice: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onCopy: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const previousFocus = triggerRef.current ?? document.activeElement;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      root.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [triggerRef]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-story border border-line bg-surface p-5 text-text shadow-xl backdrop:bg-black/50 sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={titleId} className="t-h3">Поділитися мемом</h2>
        <IconButton type="button" icon="close" label="Закрити посилання" onClick={onClose} />
      </div>
      <p id={descriptionId} className="t-small mt-3 text-text-secondary">
        {showFavoriteNotice && <>Мем додано до «Улюблених». </>}
        Посилання доступне всім, хто його має.
      </p>
      <a href={url} className="t-small mt-3 block break-all text-accent underline underline-offset-4" target="_blank" rel="noopener noreferrer">{url}</a>
      <Button type="button" variant="secondary" onClick={onCopy} className="mt-4 w-full">Копіювати посилання</Button>
      <p role="status" aria-live="polite" className="t-small mt-3 text-text-secondary">
        {copied ? "Посилання скопійовано" : "Браузер не дозволив копіювання. Виділіть посилання вище."}
      </p>
    </dialog>
  );
}
