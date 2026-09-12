import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card, EmptyState, FilterBar, Input, Select, StatusPill, Table, Textarea } from "@/components/ui";

type WithChildren = {
  children: ReactNode;
  className?: string;
};

export type AdminCrumb = {
  href?: string;
  label: string;
};

export function AdminBreadcrumbs({ items }: { items: AdminCrumb[] }) {
  return (
    <nav aria-label="Breadcrumbs" className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-2">
          {index > 0 ? <span aria-hidden="true" className="text-[var(--border-strong)]">/</span> : null}
          {item.href ? (
            <Link className="hover:text-[var(--text-primary)]" href={item.href}>
              {item.label}
            </Link>
          ) : (
            <span className="text-[var(--text-secondary)]">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function AdminPageHeader({
  title,
  description,
  breadcrumbs,
  action,
  backHref,
}: {
  title: string;
  description?: string;
  breadcrumbs?: AdminCrumb[];
  action?: ReactNode;
  backHref?: string;
}) {
  return (
    <header className="dashboard-primary space-y-3 rounded-[var(--radius)] border border-[var(--border)] p-5 shadow-[var(--shadow-sm)] md:p-6">
      {breadcrumbs ? <AdminBreadcrumbs items={breadcrumbs} /> : null}
      {backHref ? (
        <Link className="inline-flex text-sm font-semibold text-[var(--primary)] hover:text-[var(--primary-hover)]" href={backHref}>
          Вернуться к списку
        </Link>
      ) : null}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="page-kicker">Панель команды</p>
          <h1 className="mt-1 text-2xl font-black text-[var(--text-primary)] md:text-3xl">{title}</h1>
          {description ? <p className="mt-2 max-w-3xl text-sm text-[var(--text-secondary)]">{description}</p> : null}
        </div>
        {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
      </div>
    </header>
  );
}

export function AdminShell({ children, className = "" }: WithChildren) {
  return <section className={`space-y-5 ${className}`}>{children}</section>;
}

export function AdminSection({ children, className = "" }: WithChildren) {
  return <Card className={`p-4 shadow-[var(--shadow-sm)] md:p-5 ${className}`}>{children}</Card>;
}

export function AdminFilters({ children, className = "" }: WithChildren) {
  return <FilterBar className={`gap-3 ${className}`}>{children}</FilterBar>;
}

export function AdminTable({ children, className = "" }: WithChildren) {
  return <Table className={`admin-table ${className}`}>{children}</Table>;
}

export function AdminStatCard({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <Card className="metric-tile p-4 pl-5">
      <p className="text-xs font-bold uppercase text-[var(--text-muted)]">{label}</p>
      <div className="mt-2 text-2xl font-black text-[var(--text-primary)]">{value}</div>
      {detail ? <p className="mt-1 text-sm text-[var(--text-secondary)]">{detail}</p> : null}
    </Card>
  );
}

export function AdminActionBar({ children, className = "" }: WithChildren) {
  return <div className={`flex flex-wrap items-center gap-2 ${className}`}>{children}</div>;
}

export function AdminDetailGrid({ children, className = "" }: WithChildren) {
  return <div className={`grid gap-3 md:grid-cols-2 ${className}`}>{children}</div>;
}

export function MetadataPanel({ children, className = "" }: WithChildren) {
  return <div className={`rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-4 text-sm leading-6 text-[var(--text-secondary)] shadow-[var(--shadow-sm)] ${className}`}>{children}</div>;
}

export function JsonPreview({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-xs text-[var(--text-secondary)]">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

export function StatusBadge({ value }: { value: string | boolean | null | undefined }) {
  const text = String(value ?? "-");
  const lower = text.toLowerCase();
  const tone =
    lower.includes("approved") || lower.includes("active") || lower.includes("published") || lower.includes("connected") || lower.includes("актив") || lower === "true"
      ? "admin-pill-success"
      : lower.includes("rejected") || lower.includes("blocked") || lower.includes("error") || lower === "false"
        ? "admin-pill-danger"
        : lower.includes("pending") || lower.includes("draft") || lower.includes("triaged")
          ? "admin-pill-warning"
          : "";

  return <StatusPill className={tone}>{text}</StatusPill>;
}

export function RoleBadge({ value }: { value: string | null | undefined }) {
  return <Badge>{value ?? "-"}</Badge>;
}

export function AdminEmpty({ label = "Записей пока нет." }: { label?: string }) {
  return <EmptyState label={label} />;
}

export { Input as AdminInput, Select as AdminSelect, Textarea as AdminTextarea };
