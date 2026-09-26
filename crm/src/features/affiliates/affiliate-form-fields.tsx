"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * AFD-5A — labelled form primitives for the affiliate workspace.
 *
 * Every control gets a real `<label for>`, and an error is wired to its input
 * through `aria-describedby` + `aria-invalid` so assistive technology announces
 * the problem WITH the field rather than as a detached banner.
 */

export interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: (aria: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode;
}

export function Field({ id, label, hint, error, required, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-text-primary">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (обязательное поле)</span> : null}
      </label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-2xs text-text-secondary">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-2xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const controlClass =
  "w-full rounded-sm border border-border bg-surface px-2 py-1.5 text-sm text-text-primary " +
  "placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger";

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...props }, ref) {
    return <input ref={ref} className={cn(controlClass, className)} {...props} />;
  },
);

export const TextArea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ className, ...props }, ref) {
  return <textarea ref={ref} rows={3} className={cn(controlClass, className)} {...props} />;
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cn(controlClass, className)} {...props} />;
});

/**
 * The form-level error banner. `role="alert"` so a submission failure is
 * announced immediately, and the support reference is shown when the backend
 * supplied one.
 */
export function FormError({ message, requestId }: { message: string | null; requestId?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-sm border border-danger/40 bg-danger/10 px-2 py-1.5 text-xs text-text-primary"
    >
      {message}
      {requestId ? (
        <span className="mt-0.5 block text-2xs text-text-secondary">
          Код обращения: <code className="font-mono">{requestId}</code>
        </span>
      ) : null}
    </div>
  );
}
