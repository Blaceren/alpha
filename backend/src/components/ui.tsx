import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

type WithChildren = {
  children: ReactNode;
  className?: string;
};

export function Card({ children, className = "" }: WithChildren) {
  return <div className={`app-card p-5 ${className}`}>{children}</div>;
}

export function Badge({ children, className = "" }: WithChildren) {
  return <span className={`badge ${className}`}>{children}</span>;
}

export function StatusPill({ children, className = "" }: WithChildren) {
  return <span className={`status-pill ${className}`}>{children}</span>;
}

export function PageHeader({
  kicker,
  title,
  description,
  action,
}: {
  kicker?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="dashboard-primary mb-7 flex flex-col gap-4 rounded-[var(--radius)] border border-[var(--border)] p-5 shadow-[var(--shadow-sm)] md:flex-row md:items-end md:justify-between md:p-6">
      <div className="min-w-0">
        {kicker ? <p className="page-kicker">{kicker}</p> : null}
        <h1 className="mt-2 text-3xl font-black leading-tight tracking-[-0.03em] text-[var(--text-primary)] md:text-5xl">{title}</h1>
        {description ? <p className="mt-3 max-w-4xl text-base leading-7 text-[var(--text-secondary)]">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="section-title">{title}</h2>
      {description ? <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p> : null}
    </div>
  );
}

export function LoadingState({ label = "Загрузка..." }: { label?: string }) {
  return <div className="app-card-flat flex items-center gap-3 p-4 text-sm text-[var(--text-secondary)]"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--primary)]" />{label}</div>;
}

export function ErrorState({ label = "Ошибка загрузки" }: { label?: string }) {
  return <div role="alert" className="rounded-lg border border-[color-mix(in_srgb,var(--danger)_32%,var(--border))] bg-[var(--danger-soft)] p-4 text-sm font-semibold text-[var(--danger)]">{label}</div>;
}

export function EmptyState({ label = "Данных пока нет" }: { label?: string }) {
  return <div className="empty-state app-card-flat p-8 text-center text-sm text-[var(--text-secondary)]"><span className="empty-state-mark mb-3" aria-hidden="true">+</span>{label}</div>;
}

export function Alert({ children, className = "" }: WithChildren) {
  return <div className={`rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-4 text-sm text-[var(--text-secondary)] ${className}`}>{children}</div>;
}

export function ProgressBar({ value }: { value: number }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${safeValue}%` }} />
    </div>
  );
}

export function FormField({ label, children }: WithChildren & { label: string }) {
  return (
    <label className="block text-sm font-semibold text-[var(--text-secondary)]">
      {label}
      <div className="mt-2">{children}</div>
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`form-input ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`form-input min-h-28 ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`form-input ${props.className ?? ""}`} />;
}

export function Checkbox(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} type="checkbox" className={`h-4 w-4 rounded border-[var(--border)] ${props.className ?? ""}`} />;
}

export function Table({ children, className = "" }: WithChildren) {
  return (
    <div className={`overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)] ${className}`}>
      <table className="w-full min-w-[720px] text-left text-sm">{children}</table>
    </div>
  );
}

export function Pagination({ children, className = "" }: WithChildren) {
  return <div className={`flex flex-wrap items-center justify-end gap-2 ${className}`}>{children}</div>;
}

export function Tabs({ children, className = "" }: WithChildren) {
  return <div className={`inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-1 shadow-[var(--shadow-sm)] ${className}`}>{children}</div>;
}

export function FilterBar({ children, className = "" }: WithChildren) {
  return <div className={`app-card-flat flex flex-wrap items-end gap-3 p-4 ${className}`}>{children}</div>;
}
