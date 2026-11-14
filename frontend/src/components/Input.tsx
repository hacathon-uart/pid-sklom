import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

const BASE =
  "w-full rounded-control border border-line bg-surface px-4 text-base placeholder:text-text-secondary focus:border-accent focus:outline-none";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${BASE} h-[52px] ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${BASE} h-32 resize-none py-3 ${className}`} {...props} />;
}

/** Section label above inputs: «ПІДПИС», «ОПИС ЗОБРАЖЕННЯ». */
export function Label({ children, htmlFor }: { children: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="t-label mb-3 block">
      {children}
    </label>
  );
}
