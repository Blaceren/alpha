"use client";

/**
 * AFD-5C2 — the lead filter strip.
 *
 * EVERY CONTROL IS A NATIVE ELEMENT. `<select>` and `<input type="date">` are
 * keyboard-operable, screen-reader-announced and mobile-native without any of it
 * being re-implemented — and a bespoke combobox that gets `aria-activedescendant`
 * subtly wrong is worse than the plain one it replaced.
 *
 * NO BOUNDARY IS COMPUTED HERE. The date inputs collect `YYYY-MM-DD` strings and
 * hand them to the backend verbatim. There is no `new Date(value)` and no
 * `toISOString()` in this file: parsing a date-only string in the browser
 * reinterprets it in the BROWSER's timezone, which is how an operator in
 * Kaliningrad and one in Vladivostok get different Mondays out of the same URL.
 * Europe/Moscow, Monday weeks and `[start, end)` are the backend's contract, and
 * the resolved period it returns is DISPLAYED rather than recomputed.
 *
 * THE TWO PERIODS NEVER MERGE. Registration and acquisition are separate
 * fieldsets with separate legends, separate presets and separately displayed
 * resolutions. Silently reinterpreting one as the other is the single most
 * damaging mistake this screen could make — an operator would believe they were
 * looking at July registrations and be looking at July clicks.
 *
 * THERE IS NO IDENTITY SEARCH BOX. The accepted backend contract has no
 * permission-safe search owner for an email or a name, so the CRM offers none:
 * an input that searched by address would be a way to confirm whether a
 * particular person is a learner, without a reveal and without an audit row.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import type { AnalyticsFilterOptions } from "@/data/contracts/api/affiliate-analytics";
import type {
  LeadAttributionState,
  LeadDatePreset,
  LeadDepositState,
  LeadJourneyStage,
  LeadResolvedPeriod,
  LeadSort,
} from "@/data/contracts/api/affiliate-leads";
import {
  ACQUISITION_PERIOD_HINT,
  ACQUISITION_PERIOD_LABEL,
  ATTRIBUTION_STATE_LABEL,
  BOTH_PERIODS_NOTE,
  DEPOSIT_STATE_LABEL,
  intervalConventionLabel,
  JOURNEY_STAGE_LABEL,
  NO_PERIOD_LABEL,
  PERIOD_CONTRACT_NOTE,
  PRESET_LABEL,
  PRESET_ORDER,
  REGISTRATION_PERIOD_HINT,
  REGISTRATION_PERIOD_LABEL,
  RESET_FILTERS_LABEL,
  SORT_LABEL,
} from "./leads-labels";
import {
  isValidDateOnly,
  LEAD_SORTS,
  type LeadPeriodState,
  type LeadsUrlState,
} from "./leads-url-state";

/**
 * `min-w-0` is load-bearing, not decoration.
 *
 * A native `<select>` takes its intrinsic minimum width from its WIDEST option
 * ("Регистрация в Академии — сначала старые"), and `w-full` does not override
 * that floor. At a 160px viewport (320px at 200% zoom) the floor is wider than
 * the column, so the control would push the document into horizontal scroll.
 * `min-w-0` lets it shrink and ellipsize instead, which is what a native control
 * does gracefully.
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
      {hint ? (
        <p className="mt-1 break-words text-[11px] leading-snug text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- dimensions */

/**
 * Affiliate → campaign → tracking link.
 *
 * ARCHIVED ENTITIES REMAIN SELECTABLE and are labelled as archived. A lead
 * acquired last quarter must stay findable after somebody tidied up the
 * configuration; hiding archived rows would make history unreachable.
 *
 * The child lists are FILTERED BY THE CHOSEN PARENT, and choosing a different
 * parent clears them (`applyLeadsChange`). Leaving a stale child would produce a
 * hierarchy mismatch the backend answers with a 400 the operator did not make.
 */
export function DimensionFilters({
  options,
  state,
  onChange,
  disabled,
}: {
  options: AnalyticsFilterOptions | null;
  state: LeadsUrlState;
  onChange: (change: Partial<LeadsUrlState>) => void;
  disabled?: boolean;
}) {
  const partners = options?.affiliatePartners ?? [];

  const campaigns = (options?.affiliateCampaigns ?? []).filter(
    (campaign) =>
      state.affiliatePartnerId === null ||
      campaign.affiliatePartnerId === state.affiliatePartnerId,
  );

  const links = (options?.affiliateTrackingLinks ?? []).filter((link) => {
    if (
      state.affiliatePartnerId !== null &&
      link.affiliatePartnerId !== state.affiliatePartnerId
    ) {
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
    archived
      ? " — в архиве"
      : status === "paused"
        ? " — на паузе"
        : status === "draft"
          ? " — черновик"
          : "";

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Field label="Аффилейт" htmlFor="leads-partner">
        <select
          id="leads-partner"
          className={CONTROL_CLASS}
          value={state.affiliatePartnerId ?? ""}
          disabled={disabled || options === null}
          onChange={(event) =>
            onChange({
              affiliatePartnerId: event.target.value === "" ? null : event.target.value,
            })
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

      <Field label="Кампания" htmlFor="leads-campaign">
        <select
          id="leads-campaign"
          className={CONTROL_CLASS}
          value={state.affiliateCampaignId ?? ""}
          disabled={disabled || options === null}
          onChange={(event) =>
            onChange({
              affiliateCampaignId: event.target.value === "" ? null : event.target.value,
            })
          }
        >
          <option value="">Все кампании</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.displayName} ({campaign.code})
              {suffix(campaign.archived, campaign.status)}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Ссылка" htmlFor="leads-link">
        <select
          id="leads-link"
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

/* ------------------------------------------------------------------ states */

/**
 * Attribution, journey stage and deposit state.
 *
 * THREE SEPARATE SELECTS, NEVER ONE "STATUS". Journey stage and deposit state
 * are independent factual dimensions — a lead can be at `first_deposit_confirmed`
 * AND in `conflict` — and one merged control would make that combination
 * unaskable.
 */
export function StateFilters({
  state,
  onChange,
  disabled,
}: {
  state: LeadsUrlState;
  onChange: (change: Partial<LeadsUrlState>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Field label="Привлечение" htmlFor="leads-attribution">
        <select
          id="leads-attribution"
          className={CONTROL_CLASS}
          value={state.attributionState ?? ""}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              attributionState:
                event.target.value === ""
                  ? null
                  : (event.target.value as LeadAttributionState),
            })
          }
        >
          <option value="">Все лиды</option>
          <option value="attributed">{ATTRIBUTION_STATE_LABEL.attributed}</option>
          <option value="unattributed">{ATTRIBUTION_STATE_LABEL.unattributed}</option>
        </select>
      </Field>

      <Field label="Этап пути" htmlFor="leads-stage">
        <select
          id="leads-stage"
          className={CONTROL_CLASS}
          value={state.journeyStage ?? ""}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              journeyStage:
                event.target.value === "" ? null : (event.target.value as LeadJourneyStage),
            })
          }
        >
          <option value="">Любой этап</option>
          {(
            [
              "academy_registered",
              "pocket_registered",
              "first_deposit_confirmed",
            ] as const
          ).map((stage) => (
            <option key={stage} value={stage}>
              {JOURNEY_STAGE_LABEL[stage]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Состояние депозита" htmlFor="leads-deposit">
        <select
          id="leads-deposit"
          className={CONTROL_CLASS}
          value={state.depositState ?? ""}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              depositState:
                event.target.value === "" ? null : (event.target.value as LeadDepositState),
            })
          }
        >
          <option value="">Любое состояние</option>
          {(["none", "pending_identity", "conflict", "confirmed"] as const).map((value) => (
            <option key={value} value={value}>
              {DEPOSIT_STATE_LABEL[value]}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

/* ----------------------------------------------------------------- periods */

/**
 * One named period.
 *
 * THE CUSTOM RANGE IS APPLIED, NOT LIVE. Typing into a date field produces
 * intermediate values (`2026-0`, `2026-02-3`) that are not periods, and firing a
 * request for each would be both a request storm and a stream of validation
 * errors. The values are held locally and committed by "Применить"; a rejected
 * range KEEPS WHAT THE OPERATOR TYPED so they can correct it rather than retype
 * it.
 *
 * The only local validation is "is this a real calendar date" — `2026-02-31` is
 * not a period boundary at all. Ordering, length and every other rule stay the
 * backend's, and the resolution it returns is displayed underneath.
 */
export function PeriodFilter({
  idPrefix,
  legend,
  hint,
  period,
  resolved,
  onChange,
  disabled,
  disabledReason,
}: {
  idPrefix: string;
  legend: string;
  hint: string;
  period: LeadPeriodState;
  resolved: LeadResolvedPeriod | null;
  onChange: (next: LeadPeriodState) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [draftStart, setDraftStart] = React.useState(period.startDate ?? "");
  const [draftEnd, setDraftEnd] = React.useState(period.endDate ?? "");
  const [localError, setLocalError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraftStart(period.startDate ?? "");
    setDraftEnd(period.endDate ?? "");
  }, [period.startDate, period.endDate]);

  const applyCustom = () => {
    if (!isValidDateOnly(draftStart) || !isValidDateOnly(draftEnd)) {
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
    // `p-2.5` and a tighter stack: each fieldset holds ONE select in its resting
    // state, and the generous padding made two of them as tall as six filter
    // controls put together.
    <fieldset className="min-w-0 space-y-1.5 rounded-md border border-border p-2.5">
      <legend className="px-1 text-xs font-medium text-text-secondary">{legend}</legend>
      <p className="break-words text-[11px] leading-snug text-text-muted">{hint}</p>

      <Field label="Период" htmlFor={`${idPrefix}-preset`}>
        <select
          id={`${idPrefix}-preset`}
          className={CONTROL_CLASS}
          value={period.preset ?? ""}
          disabled={disabled}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === "") {
              setLocalError(null);
              onChange({ preset: null, startDate: null, endDate: null });
              return;
            }
            const next = raw as LeadDatePreset;
            if (next === "custom") {
              onChange({
                preset: "custom",
                startDate: isValidDateOnly(draftStart) ? draftStart : null,
                endDate: isValidDateOnly(draftEnd) ? draftEnd : null,
              });
            } else {
              setLocalError(null);
              onChange({ preset: next, startDate: null, endDate: null });
            }
          }}
        >
          {/* The default is ABSENT, not a window. A lead list that silently hid
              older registrations would be an operator being told a learner they
              can see elsewhere in the CRM does not exist. */}
          <option value="">{NO_PERIOD_LABEL}</option>
          {PRESET_ORDER.map((option) => (
            <option key={option} value={option}>
              {PRESET_LABEL[option]}
            </option>
          ))}
        </select>
      </Field>

      {period.preset === "custom" ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Начало (включительно)" htmlFor={`${idPrefix}-start`}>
            <input
              id={`${idPrefix}-start`}
              type="date"
              className={CONTROL_CLASS}
              value={draftStart}
              disabled={disabled}
              onChange={(event) => setDraftStart(event.target.value)}
            />
          </Field>
          <Field label="Конец (не включая)" htmlFor={`${idPrefix}-end`}>
            <input
              id={`${idPrefix}-end`}
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
        <p role="alert" className="break-words text-xs text-danger">
          {localError}
        </p>
      ) : null}

      {disabled && disabledReason ? (
        <p className="break-words text-[11px] leading-snug text-text-muted">{disabledReason}</p>
      ) : null}

      {/* What the BACKEND resolved. Displayed, never recomputed. */}
      {resolved ? (
        <p className="break-words text-[11px] leading-snug text-text-muted">
          Сервер применил:{" "}
          <span className="break-all tabular-nums">
            {resolved.startLocal ?? "с начала данных"} — {resolved.endLocal}
          </span>{" "}
          ({resolved.timezone}, неделя с понедельника,{" "}
          {intervalConventionLabel(resolved.intervalConvention)})
        </p>
      ) : null}
    </fieldset>
  );
}

/* -------------------------------------------------------------------- sort */

export function SortControl({
  sort,
  onChange,
  disabled,
}: {
  sort: LeadSort;
  onChange: (sort: LeadSort) => void;
  disabled?: boolean;
}) {
  return (
    <Field label="Сортировка" htmlFor="leads-sort">
      <select
        id="leads-sort"
        className={CONTROL_CLASS}
        value={sort}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as LeadSort)}
      >
        {LEAD_SORTS.map((option) => (
          <option key={option} value={option}>
            {SORT_LABEL[option]}
          </option>
        ))}
      </select>
    </Field>
  );
}

/* ------------------------------------------------------------- the strip */

export function LeadFilters({
  options,
  state,
  registrationResolved,
  acquisitionResolved,
  onChange,
  onReset,
  filtered,
  disabled,
}: {
  options: AnalyticsFilterOptions | null;
  state: LeadsUrlState;
  registrationResolved: LeadResolvedPeriod | null;
  acquisitionResolved: LeadResolvedPeriod | null;
  onChange: (change: Partial<LeadsUrlState>) => void;
  onReset: () => void;
  filtered: boolean;
  disabled?: boolean;
}) {
  // An acquisition window names a SELECTED CLICK, which only an attributed lead
  // has. Disabled — not hidden — beside the reason, so the operator learns why
  // rather than watching a control vanish.
  const acquisitionDisabled = state.attributionState === "unattributed";

  return (
    <section aria-labelledby="leads-filters-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="leads-filters-heading" className="text-sm font-semibold text-text-primary">
          Фильтры
        </h2>
        {filtered ? (
          <button
            type="button"
            onClick={onReset}
            className="min-h-[2.25rem] rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {RESET_FILTERS_LABEL}
          </button>
        ) : null}
      </div>

      <DimensionFilters
        options={options}
        state={state}
        onChange={onChange}
        disabled={disabled}
      />
      <StateFilters state={state} onChange={onChange} disabled={disabled} />

      {/*
        The sort sits in the SAME grid band as the state filters rather than
        alone on its own row. Measured on the real page: a lone select in a
        three-column grid left two thirds of a row empty and pushed the first
        lead ~60px further down a screen where the controls already occupied
        more vertical space than the data they filter.
      */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SortControl
          sort={state.sort}
          onChange={(sort) => onChange({ sort })}
          disabled={disabled}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <PeriodFilter
          idPrefix="leads-registration"
          legend={REGISTRATION_PERIOD_LABEL}
          hint={REGISTRATION_PERIOD_HINT}
          period={state.registration}
          resolved={registrationResolved}
          onChange={(registration) => onChange({ registration })}
          disabled={disabled}
        />
        <PeriodFilter
          idPrefix="leads-acquisition"
          legend={ACQUISITION_PERIOD_LABEL}
          hint={ACQUISITION_PERIOD_HINT}
          period={state.acquisition}
          resolved={acquisitionResolved}
          onChange={(acquisition) => onChange({ acquisition })}
          disabled={disabled || acquisitionDisabled}
          disabledReason={
            acquisitionDisabled
              ? "Недоступно при фильтре «Прямая регистрация»: у таких лидов нет атрибуционного клика."
              : undefined
          }
        />
      </div>

      <p className="break-words text-[11px] leading-snug text-text-muted">
        {BOTH_PERIODS_NOTE} {PERIOD_CONTRACT_NOTE}
      </p>
    </section>
  );
}
