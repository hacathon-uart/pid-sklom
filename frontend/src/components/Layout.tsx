import { Suspense, type ReactNode } from "react";
import { Outlet, ScrollRestoration } from "react-router";
import { Sidebar } from "./Sidebar";
import { GuestAllowance } from "../auth/GuestAllowance";

export function Layout() {
  return (
    <div className="min-h-screen pl-[var(--app-side-offset)] pb-[var(--app-bottom-clearance)]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-control focus:bg-surface focus:px-4 focus:py-3 focus:outline-2 focus:outline-accent">До вмісту</a>
      {/* New pages open at the top (back/forward restore the old position). */}
      <ScrollRestoration />
      <Sidebar />
      <Suspense fallback={<main id="main-content" tabIndex={-1} className="mx-auto max-w-[1280px] px-[var(--page-gutter)] py-7"><Loading text="Завантажуємо сторінку…" /></main>}>
        <Outlet />
      </Suspense>
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
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1280px] min-w-0 px-[var(--page-gutter)] py-7 md:py-10 xl:py-12">
      {back && <div className="mb-4">{back}</div>}
      <header className="mb-8 flex min-w-0 flex-col items-start justify-between gap-5 lg:mb-10 lg:flex-row lg:gap-6">
        <div className="w-full min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <h1 className="t-h1">{title}</h1>
            <GuestAllowance />
          </div>
          {subtitle && <p className="t-body mt-3 text-text-secondary">{subtitle}</p>}
        </div>
        {actions && <div className="flex w-full min-w-0 flex-wrap items-center gap-3 lg:w-auto">{actions}</div>}
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
