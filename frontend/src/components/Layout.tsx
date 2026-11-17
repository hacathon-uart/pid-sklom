import type { ReactNode } from "react";
import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar";
import { GuestAllowance } from "../auth/GuestAllowance";

export function Layout() {
  return (
    <div className="min-h-screen pl-[var(--sidebar-width)]">
      <Sidebar />
      <GuestAllowance />
      <Outlet />
    </div>
  );
}

/** Standard page: title + subtitle on the left, actions on the right. */
export function Page({
  title,
  subtitle,
  actions,
  back,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-[1280px] px-16 py-12">
      {back && <div className="mb-4">{back}</div>}
      <header className="mb-10 flex items-start justify-between gap-6">
        <div>
          <h1 className="t-h1">{title}</h1>
          {subtitle && <p className="t-body mt-3 text-text-secondary">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </header>
      {children}
    </main>
  );
}

/** Loading / error / empty states are NOT designed yet — these are placeholders. */
export function Loading({ text = "Завантаження…" }: { text?: string }) {
  return <div className="t-body animate-pulse py-16 text-center text-text-secondary">{text}</div>;
}

export function ErrorMessage({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="rounded-card border border-line bg-surface p-6 text-center">
      <p className="t-body">{error}</p>
      {onRetry && (
        <button className="t-strong mt-3 text-accent" onClick={onRetry}>
          Спробувати ще раз
        </button>
      )}
    </div>
  );
}
