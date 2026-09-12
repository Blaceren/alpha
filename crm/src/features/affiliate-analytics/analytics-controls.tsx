"use client";

/**
 * AFD-5C1 — the control strip: mode, period, cutoff, grouping and filters.
 *
 * EVERY CONTROL IS A NATIVE ELEMENT. `<select>`, `<input type="date">` and
 * radio inputs are keyboard-operable, screen-reader-announced and mobile-native
 * without any of it being re-implemented — and a bespoke combobox that gets
 * `aria-activedescendant` subtly wrong is worse than the plain one it replaced.
 *
 * NO BOUNDARY IS COMPUTED HERE. The date inputs collect `YYYY-MM-DD` strings and
 * hand them to the backend verbatim. There is no `new Date(value)` and no
 * `toISOString()` anywhere in this file: parsing a date-only string in the
 * browser reinterprets it in the BROWSER's timezone, which is how an operator in
 * Kaliningrad and one in Vladivostok get different Mondays out of the same URL.
 * Europe/Moscow, Monday weeks and `[start, end)` are the backend's contract, and
 * the resolved period it returns is displayed rather than recomputed.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import type {
  AnalyticsFilterOptions,
  BucketGroup,
  DatePreset,
  ReportCutoff,
  ResolvedPeriod,
} from "@/data/contracts/api/affiliate-analytics";
import {
  COVERAGE_DESCRIPTION,
  COVERAGE_LABEL,
  GROUP_LABEL,
  MODE_DESCRIPTION,
  MODE_LABEL,
  intervalConventionLabel,
  PRESET_LABEL,
  PRESET_ORDER,
} from "./analytics-labels";
import {
  isValidDateOnly,
  type AnalyticsMode,
  type AnalyticsUrlState,
  type CoverageView,
} from "./analytics-url-state";

/**
 * `min-w-0` is load-bearing, not decoration.
 *
 * A native `<select>` takes its intrinsic minimum width from its WIDEST option
 * ("Последние 30 дней"), and `w-full` does not override that floor. At a 160px
 * viewport (320px at 200% zoom) the floor is wider than the column, so the
 * control pushes the document into horizontal scroll. `min-w-0` lets it shrink
 * and ellipsize instead, which is what a native control does gracefully.
 */
const CONTROL_CLASS =
  "h-9 w-full min-w-0 rounded-md border border-border bg-surface px-2.5 text-sm text-text-primary " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** A labelled control. The label is a real `<label>`, always, never a title. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-text-secondary">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 break-words text-[11px] leading-snug text-text-muted">{hint}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------- mode */

/**
 * The mode selector.
 *
 * A radiogroup rather than a dropdown: the two modes answer DIFFERENT questions
 * (§16) and each option carries a one-line description of what it counts, which
 * a `<select>` cannot show. The change is announced, because switching mode
 * changes the meaning of every number below it.
 */
export function ModeSelector({
  mode,
  onChange,
}: {
  mode: AnalyticsMode;
  onChange: (mode: AnalyticsMode) => void;
}) {
  const modes: AnalyticsMode[] = ["event_date", "acquisition_cohort"];
  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-medium text-text-secondary">Режим отчёта</legend>
      <div role="radiogroup" aria-label="Режим отчёта" className="mt-1.5 grid gap-2 sm:grid-cols-2">
        {modes.map((option) => {
          const selected = option === mode;
          return (
            <label
              key={option}
              className={cn(
                // `min-w-0` + `break-words`: without both, the min-content width
                // of a long Russian word ("Зарегистрированные") is a hard floor
                // that widens the document at a 160px viewport (320px @ 200%).
                "flex min-w-0 cursor-pointer gap-2 rounded-md border p-2.5 text-sm",
                // Selection is carried by the radio, the border AND the weight —
                // never by colour alone.
                selected
                  ? "border-accent bg-accent/5 font-medium text-text-primary"
                  : "border-border bg-surface text-text-secondary hover:bg-elevated",
              )}
            >
              <input
                type="radio"
                name="analytics-mode"
                value={option}
                checked={selected}
                onChange={() => onChange(option)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--color-accent))]"
              />
              <span className="min-w-0">
                <span className="block break-words">{MODE_LABEL[option]}</span>
                <span className="mt-0.5 block break-words text-[11px] font-normal leading-snug text-text-muted">
                  {MODE_DESCRIPTION[option]}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------ period */

/**
 * Preset, custom range, and the resolved period the backend actually used.
 *
 * THE CUSTOM RANGE IS APPLIED, NOT LIVE. Typing into a date field produces
 * intermediate values (`2026-0`, `2026-02-3`) that are not periods, and firing a
 * request for each would be both a request storm and a stream of validation
 * errors. The values are held locally and committed by "Применить"; a rejected
 * range keeps what the operator typed so they can correct it rather than retype
 * it (§19).
 */
export function PeriodControls({
  preset,
  startDate,
  endDate,
  resolvedPeriod,
  onChange,
  disabled,
}: {
  preset: DatePreset;
  startDate: string | null;
  endDate: string | null;
  resolvedPeriod: ResolvedPeriod | null;
  onChange: (change: { preset: DatePreset; startDate: string | null; endDate: string | null }) => void;
  disabled?: boolean;
}) {
  const [draftStart, setDraftStart] = React.useState(startDate ?? "");
  const [draftEnd, setDraftEnd] = React.useState(endDate ?? "");
  const [localError, setLocalError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraftStart(startDate ?? "");
    setDraftEnd(endDate ?? "");
  }, [startDate, endDate]);

  const applyCustom = () => {
    if (!isValidDateOnly(draftStart) || !isValidDateOnly(draftEnd)) {
      // Caught here only because an impossible date (2026-02-31) is not a period
      // at all. Ordering, length and every other rule stay the backend's.
      setLocalError("Укажите корректные даты начала и конца");
      return;
    }
    if (draftStart >= draftEnd) {
      setLocalError("Начало периода должно быть раньше его конца");
      return;
    }
    setLocalError(null);
    onChange({ preset: "custom", startDate: draftStart, endDate: draftEnd });
  };

  return (
    // `min-w-0`: as a grid item this box's automatic minimum size is its
    // min-content width, which the preset <select> sets from its widest option.
    // Without this the column cannot shrink below ~145px and the document
    // scrolls sideways at a 160px viewport.
    <div className="min-w-0 space-y-2">
      <Field label="Период" htmlFor="analytics-preset">
        <select
          id="analytics-preset"
          className={CONTROL_CLASS}
          value={preset}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value as DatePreset;
            if (next === "custom") {
              onChange({
                preset: "custom",
                startDate: isValidDateOnly(draftStart) ? draftStart : null,
                endDate: isValidDateOnly(draftEnd) ? draftEnd : null,
              });
            } else {
              onChange({ preset: next, startDate: null, endDate: null });
            }
          }}
        >
          {PRESET_ORDER.map((option) => (
            <option key={option} value={option}>
              {PRESET_LABEL[option]}
            </option>
          ))}
        </select>
      </Field>

      {preset === "custom" ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Начало (включительно)" htmlFor="analytics-start">
            <input
              id="analytics-start"
              type="date"
              className={CONTROL_CLASS}
              value={draftStart}
              disabled={disabled}
              onChange={(event) => setDraftStart(event.target.value)}
            />
          </Field>
          <Field label="Конец (не включая)" htmlFor="analytics-end">
            <input
              id="analytics-end"
              type="date"
              className={CONTROL_CLASS}
              value={draftEnd}
              disabled={disabled}
              onChange={(event) => setDraftEnd(event.target.value)}
            />
          </Field>
          <button
            type="button"
            onClick={applyCustom}
            disabled={disabled}
            className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            Применить
          </button>
        </div>
      ) : null}

      {localError ? (
        <p role="alert" className="text-xs text-danger">
          {localError}
        </p>
      ) : null}

      {/* What the BACKEND resolved. Displayed, never recomputed. */}
      {resolvedPeriod ? (
        <p className="break-words text-[11px] leading-snug text-text-muted">
          Период:{" "}
          <span className="break-all tabular-nums">
            {resolvedPeriod.startLocal ?? "с начала данных"} — {resolvedPeriod.endLocal}
          </span>{" "}
          ({resolvedPeriod.timezone}, неделя с понедельника,{" "}
          {intervalConventionLabel(resolvedPeriod.intervalConvention)})
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ cutoff */

/**
 * The cohort observation cutoff.
 *
 * A SEPARATE CONTROL FROM THE COHORT PERIOD, and §20 requires it to stay that
 * way: the period selects WHO is in the cohort, the cutoff decides HOW LONG they
 * were watched. Merging them would make it impossible to ask "the January
 * cohort, as it looked in March".
 *
 * The default is the report clock. `clampedToReportClock` is surfaced verbatim,
 * because it is the difference between a report that reproduces and one that
 * will have grown by tomorrow.
 */
export function CutoffControl({
  cutoffDate,
  reportCutoff,
  onChange,
  disabled,
}: {
  cutoffDate: string | null;
  reportCutoff: ReportCutoff | null;
  onChange: (cutoffDate: string | null) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = React.useState(cutoffDate ?? "");

  React.useEffect(() => {
    setDraft(cutoffDate ?? "");
  }, [cutoffDate]);

  return (
    <div className="min-w-0 space-y-2">
      <Field
        label="Отсечка наблюдения"
        htmlFor="analytics-cutoff"
        hint="По умолчанию — момент построения отчёта. События после отсечки не учитываются."
      >
        <div className="flex gap-2">
          <input
            id="analytics-cutoff"
            type="date"
            className={CONTROL_CLASS}
            value={draft}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(isValidDateOnly(draft) ? draft : null)}
            className="h-9 shrink-0 rounded-md border border-border bg-surface px-3 text-sm text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            Применить
          </button>
          {cutoffDate !== null ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setDraft("");
                onChange(null);
              }}
              className="h-9 shrink-0 rounded-md border border-border bg-surface px-3 text-sm text-text-secondary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              Сбросить
            </button>
          ) : null}
        </div>
      </Field>

      {reportCutoff ? (
        <div className="break-words text-[11px] leading-snug text-text-muted">
          <p>
            Действующая отсечка: <span className="break-all tabular-nums">{reportCutoff.cutoffLocal}</span>{" "}
            (
            {reportCutoff.source === "report_clock"
              ? "момент построения отчёта"
              : "указанная дата"}
            , граница не включается)
          </p>
          {reportCutoff.clampedToReportClock ? (
            <p className="mt-0.5 text-warning">
              Указанная дата ещё не завершилась, поэтому отсечка ограничена моментом построения
              отчёта. Позже этот отчёт даст другие числа.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------- grouping */

export function GroupSelector({
  group,
  onChange,
  disabled,
}: {
  group: BucketGroup;
  onChange: (group: BucketGroup) => void;
  disabled?: boolean;
}) {
  return (
    <Field label="Группировка" htmlFor="analytics-group">
      <select
        id="analytics-group"
        className={CONTROL_CLASS}
        value={group}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as BucketGroup)}
      >
        {(["day", "week", "month"] as BucketGroup[]).map((option) => (
          <option key={option} value={option}>
            {GROUP_LABEL[option]}
          </option>
        ))}
      </select>
    </Field>
  );
}

/* ----------------------------------------------------------- filters */

/**
 * The three hierarchical dimension filters.
 *
 * OPTIONS COME FROM THE BACKEND'S FILTER ENDPOINT, which already scopes children
 * to the selected parent — so the campaign list under "Все аффилейты" is the
 * capped global list, and under a chosen affiliate it is that affiliate's. The
 * component additionally filters client-side by parent id so a stale option from
 * an in-flight response can never be offered under the wrong parent.
 *
 * ARCHIVED ENTITIES REMAIN SELECTABLE and are labelled as archived. A report
 * about last month must still be able to name the affiliate that ran it; hiding
 * archived rows would make history unreachable the moment somebody tidied up.
 */
export function FilterControls({
  options,
  state,
  onChange,
  disabled,
}: {
  options: AnalyticsFilterOptions | null;
  state: AnalyticsUrlState;
  onChange: (change: Partial<AnalyticsUrlState>) => void;
  disabled?: boolean;
}) {
  const partners = options?.affiliatePartners ?? [];

  const campaigns = (options?.affiliateCampaigns ?? []).filter(
    (campaign) =>
      state.affiliatePartnerId === null ||
      campaign.affiliatePartnerId === state.affiliatePartnerId,
  );

  const links = (options?.affiliateTrackingLinks ?? []).filter((link) => {
    if (state.affiliatePartnerId !== null && link.affiliatePartnerId !== state.affiliatePartnerId) {
      return false;
    }
    if (
      state.affiliateCampaignId !== null &&
      link.affiliateCampaignId !== state.affiliateCampaignId
    ) {
      return false;
    }
    return true;
  });

  const suffix = (archived: boolean, status: string) =>
    archived ? " — в архиве" : status === "paused" ? " — на паузе" : status === "draft" ? " — черновик" : "";

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Field label="Аффилейт" htmlFor="analytics-partner">
        <select
          id="analytics-partner"
          className={CONTROL_CLASS}
          value={state.affiliatePartnerId ?? ""}
          disabled={disabled || options === null}
          onChange={(event) =>
            onChange({ affiliatePartnerId: event.target.value === "" ? null : event.target.value })
          }
        >
          <option value="">Все аффилейты</option>
          {partners.map((partner) => (
            <option key={partner.id} value={partner.id}>
              {partner.displayName} ({partner.code}){suffix(partner.archived, partner.status)}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Кампания" htmlFor="analytics-campaign">
        <select
          id="analytics-campaign"
          className={CONTROL_CLASS}
          value={state.affiliateCampaignId ?? ""}
          disabled={disabled || options === null}
          onChange={(event) =>
            onChange({ affiliateCampaignId: event.target.value === "" ? null : event.target.value })
          }
        >
          <option value="">Все кампании</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.displayName} ({campaign.code}){suffix(campaign.archived, campaign.status)}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Ссылка" htmlFor="analytics-link">
        <select
          id="analytics-link"
          className={CONTROL_CLASS}
          value={state.affiliateTrackingLinkId ?? ""}
          disabled={disabled || options === null}
          onChange={(event) =>
            onChange({
              affiliateTrackingLinkId: event.target.value === "" ? null : event.target.value,
            })
          }
        >
          <option value="">Все ссылки</option>
          {links.map((link) => (
            <option key={link.id} value={link.id}>
              {link.displayName} ({link.publicCode}){suffix(link.archived, link.status)}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

/* ---------------------------------------------------------- coverage */

/**
 * Attributed / unattributed / total.
 *
 * DISABLED, NOT HIDDEN, WHEN A FILTER IS ACTIVE. The backend returns null for
 * the unattributed and total slices of a filtered request — events belonging to
 * nobody cannot belong to the affiliate that was asked about — and the
 * explanation says so rather than the control silently vanishing.
 */
export function CoverageSelector({
  coverage,
  filtered,
  onChange,
}: {
  coverage: CoverageView;
  filtered: boolean;
  onChange: (coverage: CoverageView) => void;
}) {
  const views: CoverageView[] = ["total", "attributed", "unattributed"];
  return (
    <div className="min-w-0">
      <div
        role="radiogroup"
        aria-label="Охват атрибуции"
        className="inline-flex flex-wrap gap-1 rounded-md border border-border bg-elevated p-1"
      >
        {views.map((view) => {
          const selected = view === coverage;
          const unavailable = filtered && view !== "attributed";
          return (
            <label
              key={view}
              className={cn(
                "cursor-pointer rounded px-2.5 py-1 text-xs",
                selected ? "bg-surface font-medium text-text-primary shadow-sm" : "text-text-secondary",
                unavailable && "cursor-not-allowed opacity-45",
              )}
            >
              <input
                type="radio"
                name="analytics-coverage"
                className="sr-only"
                value={view}
                checked={selected}
                disabled={unavailable}
                onChange={() => onChange(view)}
              />
              {COVERAGE_LABEL[view]}
            </label>
          );
        })}
      </div>
      <p className="mt-1 break-words text-[11px] leading-snug text-text-muted">
        {filtered
          ? "Фильтр активен: показаны только совпадающие записи с атрибуцией. Срезы «Всего» и «Без атрибуции» доступны без фильтров."
          : COVERAGE_DESCRIPTION[coverage]}
      </p>
    </div>
  );
}
