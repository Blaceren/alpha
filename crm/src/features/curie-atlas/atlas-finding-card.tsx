"use client";

/**
 * AFD-5D2 — one Curie Atlas finding, and its evidence.
 *
 * THE MESSAGE IS DISPLAYED, NEVER PARSED. `finding.message` is the sentence the
 * backend rendered from its own catalog template. This component prints it and
 * takes every presentation decision — glyph, severity label, evidence table,
 * scope label — from the machine-readable fields beside it. Nothing here reads
 * the Russian text to recover meaning, and nothing generates new prose that
 * could change what the finding asserts.
 *
 * THE CODE IS NOT THE HEADLINE. §9 requires that a finding code never be the
 * primary user-facing text. It appears once, inside the technical details
 * disclosure, where an operator pasting it into a ticket can find it.
 *
 * EVIDENCE IS SHOWN EXACTLY AS RETURNED. This component computes no delta, no
 * percentage, no ratio and no total. §10 is explicit: when evidence is
 * incomplete, show only what the backend returned. A baseline, an absolute
 * delta, a percentage-point delta, a numerator or a denominator appears here if
 * and only if the backend published an operand for it — this release's backend
 * publishes `key`, `value`, `source` and an optional `dimensionId`, and that is
 * what is rendered.
 *
 * KEYBOARD AND SCREEN READER FIRST. The disclosure is a native
 * `<details>/<summary>`, so it opens with Enter or Space, is announced with its
 * expanded state, and needs no pointer. §17 requires evidence to remain usable
 * without pointer interaction, and the simplest way to guarantee that is to use
 * the element the platform already made accessible.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import type { AtlasEvidence, AtlasFinding } from "@/data/contracts/api/curie-atlas";
import {
  COMPARISON_FIELD_LABEL,
  COMPARISON_KIND_LABEL,
  EVIDENCE_DISCLOSURE,
  EVIDENCE_SOURCE_LABEL,
  SEVERITY_GLYPH,
  SEVERITY_LABEL,
  TECHNICAL_DETAILS,
  supportTierLabel,
} from "./atlas-labels";

/** Resolves a dimension member id to an authorised human label, or null. */
export type DimensionLabelResolver = (dimensionId: number) => string | null;

/* ------------------------------------------------------------------ evidence */

/**
 * The evidence table for one finding.
 *
 * A TABLE, not a definition list, because the operands form rows with the same
 * three columns and a screen reader announcing "column: source" for each cell is
 * how the association survives on a narrow viewport. §18 requires values to stay
 * associated with their labels when the screen is small; the existing responsive
 * strategy is a horizontally scrollable wrapper, used here unchanged.
 */
function EvidenceTable({
  evidence,
  resolveDimensionLabel,
}: {
  evidence: readonly AtlasEvidence[];
  resolveDimensionLabel?: DimensionLabelResolver;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] border-collapse text-xs">
        <caption className="sr-only">Данные, на которых основан вывод</caption>
        <thead>
          <tr className="border-b border-border text-left text-text-secondary">
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Показатель
            </th>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Значение
            </th>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Источник
            </th>
          </tr>
        </thead>
        <tbody>
          {evidence.map((item, index) => {
            const label =
              item.dimensionId === undefined
                ? null
                : (resolveDimensionLabel?.(item.dimensionId) ?? null);
            return (
              <tr
                key={`${item.key}-${item.source}-${index}`}
                className="border-b border-border/60 last:border-b-0"
              >
                <th scope="row" className="py-1.5 pr-3 font-normal text-text-secondary">
                  {item.key}
                  {label ? (
                    <span className="block text-[11px] text-text-muted">{label}</span>
                  ) : null}
                </th>
                {/* `tabular-nums` keeps digits aligned; the value is the
                    backend's exact string and is never reformatted. */}
                <td className="py-1.5 pr-3 tabular-nums text-text-primary">{item.value}</td>
                <td className="py-1.5 pr-3 text-text-secondary">
                  {EVIDENCE_SOURCE_LABEL[item.source]}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------- finding card */

export function AtlasFindingCard({
  finding,
  resolveDimensionLabel,
}: {
  finding: AtlasFinding;
  resolveDimensionLabel?: DimensionLabelResolver;
}) {
  const hasEvidence = finding.evidence.length > 0 || finding.comparison !== null;
  const scopeLabel =
    finding.dimensionId === null
      ? null
      : (resolveDimensionLabel?.(finding.dimensionId) ?? null);

  return (
    <li
      className={cn(
        "rounded-md border bg-surface p-3",
        // Severity is carried by the border AND by the text label below.
        // Colour alone would fail §17.
        finding.severity === "attention" ? "border-warning/50" : "border-border",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            finding.severity === "attention"
              ? "bg-warning/20 text-text-primary"
              : "bg-elevated text-text-secondary",
          )}
        >
          {SEVERITY_GLYPH[finding.severity]}
        </span>

        <div className="min-w-0 flex-1 space-y-1.5">
          {/* The backend's sentence, verbatim. */}
          <p className="break-words text-sm leading-relaxed text-text-primary">
            {finding.message}
          </p>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-secondary">
            <span>{SEVERITY_LABEL[finding.severity]}</span>
            <span aria-hidden="true">·</span>
            {/* AFD-5D2A — rendered, never computed. There is no denominator
                inspection anywhere in this feature. */}
            <span data-testid="atlas-support-tier" data-tier={finding.supportTier}>
              {supportTierLabel(finding.supportTier)}
            </span>
            {scopeLabel ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{scopeLabel}</span>
              </>
            ) : null}
            {hasEvidence ? (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {finding.evidence.length === 1
                    ? "1 показатель"
                    : `${finding.evidence.length} показателя(ей)`}
                </span>
              </>
            ) : (
              <>
                <span aria-hidden="true">·</span>
                <span>Без операндов</span>
              </>
            )}
          </p>

          {hasEvidence ? (
            <details className="group">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-xs text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <span aria-hidden="true" className="transition-transform group-open:rotate-90">
                  ›
                </span>
                {EVIDENCE_DISCLOSURE}
              </summary>
              <div className="mt-2 space-y-2 rounded-md border border-border bg-elevated p-2">
                {/* AFD-5D2A — the BACKEND's comparison. Every number here was
                    computed server-side; this component subtracts nothing and
                    divides nothing. Fields that do not apply arrive as null and
                    are omitted rather than shown as a zero nobody measured. */}
                {finding.comparison ? (
                  <div data-testid="atlas-comparison" data-kind={finding.comparison.kind}>
                    <p className="text-[11px] font-medium text-text-secondary">
                      {COMPARISON_KIND_LABEL[finding.comparison.kind] ?? finding.comparison.kind}
                    </p>
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
                      {(
                        [
                          "baselineValue",
                          "currentValue",
                          "absoluteDelta",
                          "percentagePointDelta",
                          "relativeDelta",
                        ] as const
                      ).map((field) => {
                        const value = finding.comparison?.[field] ?? null;
                        if (value === null) return null;
                        return (
                          <React.Fragment key={field}>
                            <dt className="text-text-secondary">{COMPARISON_FIELD_LABEL[field]}</dt>
                            <dd className="tabular-nums text-text-primary">{value}</dd>
                          </React.Fragment>
                        );
                      })}
                    </dl>
                  </div>
                ) : null}

                <EvidenceTable
                  evidence={finding.evidence}
                  resolveDimensionLabel={resolveDimensionLabel}
                />
              </div>
            </details>
          ) : null}

          {/* The stable code lives here and only here. */}
          <details>
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-[11px] text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              {TECHNICAL_DETAILS}
            </summary>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-text-secondary">
              <dt>Код</dt>
              <dd className="break-all font-mono text-text-primary">{finding.code}</dd>
              <dt>Раздел</dt>
              <dd className="font-mono">{finding.section}</dd>
              <dt>Уровень</dt>
              <dd className="font-mono">{finding.severity}</dd>
              <dt>Опора</dt>
              <dd className="font-mono">{finding.supportTier}</dd>
              {finding.dimensionId === null ? null : (
                <>
                  <dt>Идентификатор элемента</dt>
                  <dd className="font-mono">{finding.dimensionId}</dd>
                </>
              )}
            </dl>
          </details>
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ section */

export function AtlasFindingSection({
  id,
  heading,
  emptyText,
  findings,
  resolveDimensionLabel,
}: {
  id: string;
  heading: string;
  emptyText: string;
  findings: readonly AtlasFinding[];
  resolveDimensionLabel?: DimensionLabelResolver;
}) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h2 id={id} className="text-sm font-semibold text-text-primary">
        {heading}{" "}
        <span className="font-normal text-text-muted">({findings.length})</span>
      </h2>
      {findings.length === 0 ? (
        <p className="rounded-md border border-border bg-surface p-3 text-xs text-text-secondary">
          {emptyText}
        </p>
      ) : (
        <ul className="space-y-2">
          {findings.map((finding, index) => (
            <AtlasFindingCard
              key={`${finding.code}-${finding.dimensionId ?? "global"}-${index}`}
              finding={finding}
              resolveDimensionLabel={resolveDimensionLabel}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
