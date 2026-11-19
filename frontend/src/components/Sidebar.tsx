import { Link, useLocation } from "react-router";
import { authEnabled } from "../auth/supabase";
import { Icon, type IconName } from "./Icon";
import { LogoMark } from "./Museum";

type Destination = { to: string; icon: IconName; label: string; active: (path: string) => boolean };

const DESTINATIONS: Destination[] = [
  { to: "/", icon: "home", label: "Головна", active: (path) => path === "/" },
  { to: "/create", icon: "pencil", label: "Створити", active: (path) => path.startsWith("/create") },
  { to: "/gallery", icon: "image", label: "Галерея", active: (path) => path.startsWith("/gallery") || path.startsWith("/artists") },
  { to: "/quiz", icon: "quiz", label: "Вікторина", active: (path) => path.startsWith("/quiz") },
  { to: "/me", icon: "user", label: "Профіль", active: (path) => path.startsWith("/me") },
];

function NavItem({ item, compact, path }: { item: Destination; compact: boolean; path: string }) {
  const selected = item.active(path);
  return (
    <Link
      to={item.to}
      aria-current={selected ? "page" : undefined}
      className={`flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-control text-center text-[0.6875rem] leading-tight transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${compact ? "flex-[1_0_auto] px-1 py-1" : "w-16 py-2.5"} ${selected ? "bg-accent-soft text-text" : "hover:bg-surface"}`}
    >
      <Icon name={item.icon} size={compact ? 20 : 22} />
      <span className="whitespace-nowrap">{item.label}</span>
    </Link>
  );
}

/** Shared destinations, placed in a rail on desktop and a safe-area bar on phones. */
export function Sidebar() {
  const path = useLocation().pathname;
  const items = authEnabled ? DESTINATIONS : DESTINATIONS.slice(0, -1);
  return (
    <>
      <nav aria-label="Основна навігація" className="fixed inset-y-0 left-0 z-30 hidden w-[var(--sidebar-width)] flex-col items-center gap-2 bg-muted py-6 md:flex">
        <Link to="/" className="mb-4 rounded-control text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" aria-label="Під склом — головна">
          <LogoMark size={40} />
        </Link>
        {items.map((item) => <div key={item.to} className={item.to === "/me" ? "mt-auto" : ""}><NavItem item={item} compact={false} path={path} /></div>)}
      </nav>
      <nav aria-label="Основна навігація" className="fixed inset-x-0 bottom-0 z-30 flex min-h-[4.25rem] items-start gap-0.5 overflow-x-auto border-t border-line bg-muted px-2 pt-2 pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-4px_18px_rgba(46,38,32,0.08)] md:hidden">
        {items.map((item) => <NavItem key={item.to} item={item} compact path={path} />)}
      </nav>
    </>
  );
}
