import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "soft";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white hover:brightness-110",
  secondary: "border border-accent text-accent hover:bg-muted",
  soft: "bg-muted text-text hover:brightness-95",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`rounded-control px-6 py-3 text-[15px] font-semibold leading-[1.2] transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

/** 44 px icon button: like, download, share, refresh. */
export function IconButton({
  icon,
  label,
  active = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 items-center justify-center rounded-control border border-line bg-surface transition hover:bg-muted disabled:opacity-40 disabled:hover:bg-surface ${active ? "text-accent" : "text-text"} ${className}`}
      {...props}
    >
      <Icon name={icon} filled={active} size={20} />
    </button>
  );
}
