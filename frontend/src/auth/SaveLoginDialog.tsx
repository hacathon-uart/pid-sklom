import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "../components/Button";

export function SaveLoginDialog({
  error, onContinue, onCancel,
}: {
  error: string | null;
  onContinue: () => Promise<void>;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [submitting, setSubmitting] = useState(false);

  useLayoutEffect(() => {
    const dialog = ref.current!;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  const proceed = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onContinue();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="save-login-title"
      aria-describedby="save-login-description save-login-disclosure"
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting) onCancel();
      }}
      className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-story border border-line bg-surface p-6 text-text shadow-xl backdrop:bg-black/50"
    >
      <h2 id="save-login-title" className="t-h3">Увійдіть, щоб зберегти мем</h2>
      <p id="save-login-description" className="t-body mt-3">
        Продовжте через Google. Ми збережемо чернетку й автоматично додамо мем до вашої колекції після входу.
      </p>
      <p id="save-login-disclosure" className="t-small mt-3 text-text-secondary">
        Збережений мем і PNG будуть доступні всім, хто має посилання.
      </p>
      {error && <p role="alert" className="t-small mt-3 text-accent">{error}</p>}
      <div className="mt-6 flex flex-col gap-3">
        <Button onClick={proceed} disabled={submitting}>
          {submitting ? "Переходимо до Google…" : "Увійти через Google і зберегти"}
        </Button>
        <Button variant="soft" onClick={onCancel} disabled={submitting}>Продовжити редагування</Button>
      </div>
    </dialog>
  );
}
