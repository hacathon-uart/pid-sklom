import type { ButtonHTMLAttributes } from "react";

/** Pill for filters and example phrases. Active = filled accent. */
export function Tag({
  active = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${active ? "bg-accent text-white" : "bg-muted text-text hover:brightness-95"} ${className}`}
      {...props}
    />
  );
}
