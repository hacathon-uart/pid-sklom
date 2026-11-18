import { NavLink } from "react-router";
import { authEnabled } from "../auth/supabase";
import { Icon, type IconName } from "./Icon";
import { LogoMark } from "./Museum";

export function NavItem({ to, icon, label, end }: { to: string; icon: IconName; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex w-16 flex-col items-center gap-1 rounded-card py-2.5 text-[11px] transition ${isActive ? "bg-accent-soft" : "hover:bg-muted"}`
      }
    >
      <Icon name={icon} size={22} />
      {label}
    </NavLink>
  );
}

/** 88 px left rail on every screen. TODO(B, US-11): bottom tab bar on mobile. */
export function Sidebar() {
  return (
    <nav className="fixed inset-y-0 left-0 flex w-[var(--sidebar-width)] flex-col items-center gap-2 bg-muted py-6">
      <NavLink to="/" className="mb-4 text-accent" aria-label="Під склом">
        <LogoMark size={40} />
      </NavLink>
      <NavItem to="/" icon="home" label="Головна" end />
      <NavItem to="/create" icon="pencil" label="Створити" />
      <NavItem to="/gallery" icon="image" label="Галерея" />
      <NavItem to="/quiz" icon="quiz" label="Вікторина" />
      {authEnabled && <div className="mt-auto">
        <NavItem to="/me" icon="user" label="Профіль" />
      </div>}
    </nav>
  );
}
