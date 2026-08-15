"use client";

/**
 * LEARNER-OPERATIONS-V1 — shared presentation primitives.
 *
 * §29 requires every operational surface to cover loading, empty, error and
 * permission-denied. These exist so a surface cannot ship only the happy path
 * by omission: the state components are the ordinary way to render, not an
 * afterthought bolted on later.
 */
import * as React from "react";
import {
  label,
  PRIORITY_LABEL,
  SLA_ORIGIN_LABEL,
  SLA_STATE_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
} from "./labels";
import type { SlaView } from "@/data/contracts/api/learner-ops";

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function LoadingBlock({ label: text = "Загрузка…" }: { label?: string }) {
  return (
    <p className="py-6 text-center text-sm text-slate-500" role="status">
      {text}
    </p>
  );
}

export function EmptyBlock({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-slate-500">{text}</p>;
}

export function ErrorBlock({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3" role="alert">
      <p className="text-sm text-red-800">{text}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-sm font-medium text-red-900 underline"
        >
          Повторить
        </button>
      ) : null}
    </div>
  );
}

/**
 * The permission-denied state, and it is DELIBERATELY NOT an error.
 *
 * A 403 is the system working correctly. Rendering it in red as a failure
 * teaches operators that the product is broken when in fact their role simply
 * does not include this capability — and it also invites them to ask for a
 * permission they do not need.
 */
export function ForbiddenBlock({ what }: { what: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-medium text-slate-800">Недоступно для вашей роли</p>
      <p className="mt-1 text-sm text-slate-600">{what}</p>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  new: "bg-sky-100 text-sky-800",
  open: "bg-sky-100 text-sky-800",
  in_progress: "bg-indigo-100 text-indigo-800",
  waiting_learner: "bg-amber-100 text-amber-800",
  waiting_internal: "bg-amber-100 text-amber-800",
  waiting_external: "bg-orange-100 text-orange-800",
  escalated: "bg-rose-100 text-rose-800",
  resolved: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-200 text-slate-700",
};

const PRIORITY_TONE: Record<string, string> = {
  urgent: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  normal: "bg-slate-100 text-slate-700",
  low: "bg-slate-100 text-slate-500",
};

export function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status] ?? "bg-slate-100 text-slate-700"}`}
    >
      {label(STATUS_LABEL, status)}
    </span>
  );
}

export function PriorityChip({ priority }: { priority: string }) {
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${PRIORITY_TONE[priority] ?? "bg-slate-100 text-slate-700"}`}
    >
      {label(PRIORITY_LABEL, priority)}
    </span>
  );
}

export function TypeChip({ type }: { type: string }) {
  return (
    <span className="inline-flex rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700">
      {label(TYPE_LABEL, type)}
    </span>
  );
}

/**
 * The SLA cell, and the provenance is not optional.
 *
 * Every target is rendered with where its number CAME FROM. All of them are
 * currently PREPROD acceptance fixtures, and the operator is told so in words
 * rather than being shown a deadline that looks like a promise ATA made.
 */
export function SlaCell({ sla }: { sla: SlaView }) {
  const tone =
    sla.firstResponse.state === "breached" || sla.resolution.state === "breached"
      ? "text-red-700"
      : "text-slate-600";
  return (
    <div className={`text-xs ${tone}`}>
      <div>
        Первый ответ: {label(SLA_STATE_LABEL, sla.firstResponse.state)}
      </div>
      <div>Решение: {label(SLA_STATE_LABEL, sla.resolution.state)}</div>
      {sla.origin ? (
        <div className="mt-0.5 text-[11px] text-slate-400">
          {label(SLA_ORIGIN_LABEL, sla.origin)}
        </div>
      ) : (
        <div className="mt-0.5 text-[11px] text-slate-400">Политика SLA не назначена</div>
      )}
    </div>
  );
}

/**
 * A value beside the canonical owner that answered for it.
 *
 * This is how Learner 360 stays a projection rather than becoming shadow truth:
 * the operator can always see WHICH system said a thing.
 */
export function Sourced({
  title,
  source,
  children,
}: {
  title: string;
  source: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-slate-200 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</span>
        <span className="text-[11px] text-slate-400" title="Канонический источник">
          {source}
        </span>
      </div>
      <div className="mt-1 text-sm text-slate-800">{children}</div>
    </div>
  );
}
