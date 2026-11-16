import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Icon } from "./Icon";

const BASE =
  "w-full rounded-control border border-line bg-surface px-4 text-base placeholder:text-text-secondary focus:border-accent focus:outline-none";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${BASE} h-[52px] ${className}`} {...props} />;
}

/** Input with a leading magnifier icon; pass a placeholder without the «Пошук:» prefix. */
export function SearchInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`relative w-full ${className}`}>
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary">
        <Icon name="search" size={20} />
      </span>
      <input type="search" aria-label="Пошук" className={`${BASE} h-[52px] pl-12`} {...props} />
    </div>
  );
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${BASE} h-32 resize-none py-3 ${className}`} {...props} />;
}

/** Section label above inputs: «ПІДПИС *», «ОПИС ЗОБРАЖЕННЯ · допомагає…». `required` adds a star; `hint` follows on the same line. */
export function Label({ children, htmlFor, required, hint }: { children: string; htmlFor?: string; required?: boolean; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-3 flex flex-wrap items-baseline gap-x-3">
      <span className="t-label">
        {children}
        {required && (
          <span className="ml-1" aria-hidden title="Обов'язкове поле">
            *
          </span>
        )}
      </span>
      {hint && <span className="t-small text-text-secondary">{hint}</span>}
    </label>
  );
}
