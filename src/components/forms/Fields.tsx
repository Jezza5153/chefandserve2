/**
 * Shared form layer — UX foundation (Phase 4). One source of truth for the input +
 * button styling that was copy-pasted as inline `const INPUT`/`const BTN` across ~35
 * pages. The class strings (`fieldClass`/`btnClass`/`btnSecondaryClass`) are exported
 * verbatim from what those pages already used, so adoption is a drop-in with ZERO
 * visual change; the wrapper components (FormField/Input/Select/Textarea/Checkbox)
 * are the richer option for new forms.
 *
 * No "use client": these are prop-spreading shared components — they render in whatever
 * context imports them (a server-action form OR a client component with onChange).
 */
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/** The canonical text-field class (border + burgundy focus ring). */
export const fieldClass =
  "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy";
/** Primary action button (burgundy pill). */
export const btnClass =
  "rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900 disabled:opacity-50";
/** Secondary action button (outline pill). */
export const btnSecondaryClass =
  "rounded-full border border-ink-200 bg-white px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-700 hover:bg-bg-gray disabled:opacity-50";

/** Label + optional hint/error wrapper around any field control. */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block font-ui text-[11px] font-medium text-ink-700">
        {label}
        {required ? <span className="text-burgundy"> *</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-[11px] text-ink-500">{hint}</p> : null}
      {error ? <p className="mt-1 text-[11px] text-red-600">{error}</p> : null}
    </div>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldClass} ${className}`} />;
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${fieldClass} ${className}`}>
      {children}
    </select>
  );
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${fieldClass} ${className}`} />;
}

export function Checkbox({
  label,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink-700">
      <input
        type="checkbox"
        {...props}
        className={`h-4 w-4 rounded border-ink-300 text-burgundy focus:ring-burgundy ${className}`}
      />
      {label}
    </label>
  );
}
