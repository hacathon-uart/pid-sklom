import type { ButtonHTMLAttributes } from "react";

/** Pill for filters and example phrases. Active = filled accent. */
export function Tag({
  active,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      aria-pressed={active}
      className={`min-h-11 rounded-full px-3.5 py-2 text-[13px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${active ? "bg-accent text-white" : "bg-muted text-text hover:brightness-95"} ${className}`}
      {...props}
    />
  );
}
