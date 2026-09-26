"use client";

/**
 * The Trading Journal's presentational parts: the counts, the filter, one day of
 * entries, an entry opened, the review fields and the hand-recorded trade. No
 * state and no effects; the workspace owns both.
 *
 * A CLIENT MODULE ON PURPOSE, as the Trade Card's parts are: the forms wire
 * their own change handlers, and a server component may not hand an element an
 * event handler.
 */
import { Check, ChevronDown } from "lucide-react";
import { AssetOptions, DirectionToggle, ExpiryOptions, FieldError } from "../trade-card/trade-card-parts";
import { directionLabel } from "../trade-card/trade-card-model";
import {
  JOURNAL_FILTERS,
  JOURNAL_LIMITS,
  dayHeading,
  planMarkLabel,
  resultMoney,
  type DraftErrors,
  type JournalEntry,
  type JournalFilter,
  type JournalReference,
  type JournalSummary,
  type ManualDraft,
  type ManualField,
  type PlanMark,
  type ReviewDraft,
} from "./journal-model";

/* ----------------------------------------------------------------- counts */

/** «Записей 12 · По плану 9 из 12 · Без вывода 1» — counts only, never money (DD-303). */
export function JournalCounts({ summary }: { summary: JournalSummary }) {
  return (
    <dl className="jr-counts">
      <div className="jr-counts__cell">
        <dt className="jr-counts__label">Записей</dt>
        <dd className="jr-counts__value">{summary.total}</dd>
      </div>
      <div className="jr-counts__cell">
        <dt className="jr-counts__label">По плану</dt>
        <dd className="jr-counts__value">
          {summary.onPlan}
          <span className="jr-counts__of"> из {summary.total}</span>
        </dd>
      </div>
      <div className="jr-counts__cell">
        <dt className="jr-counts__label">Без вывода</dt>
        <dd className="jr-counts__value">{summary.withoutConclusion}</dd>
      </div>
    </dl>
  );
}

/* ----------------------------------------------------------------- filter */

/**
 * Never disabled while a page loads: a control that disables itself under the
 * focus drops the focus. A newer choice simply wins over an older read.
 */
export function JournalFilterBar({
  filter,
  summary,
  onChange,
}: {
  filter: JournalFilter;
  summary: JournalSummary;
  onChange: (filter: JournalFilter) => void;
}) {
  const countOf = (value: JournalFilter) =>
    value === "violated" ? summary.violated : value === "no_conclusion" ? summary.withoutConclusion : null;
  return (
    <div className="jr-filters" role="group" aria-label="Показать записи">
      {JOURNAL_FILTERS.map((option) => {
        const count = countOf(option.value);
        return (
          <button
            key={option.value}
            type="button"
            className="jr-filter"
            aria-pressed={filter === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {count !== null ? <span className="jr-filter__count"> {count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------- day */

export function JournalDayHead({ tradeDate, yearInView }: { tradeDate: string; yearInView: number | null }) {
  const { date, weekday } = dayHeading(tradeDate, yearInView);
  return (
    <h2 className="jr-day__head" id={`jr-day-${tradeDate}`}>
      <span className="jr-day__date">{date}</span>
      {weekday ? <span className="jr-day__weekday">{weekday}</span> : null}
    </h2>
  );
}

/* -------------------------------------------------------------------- row */

export function PlanMarkBadge({ planFollowed }: { planFollowed: boolean | null }) {
  const mark = planFollowed === true ? "followed" : planFollowed === false ? "broken" : "unmarked";
  return (
    <span className="jr-mark" data-mark={mark}>
      {planMarkLabel(planFollowed)}
    </span>
  );
}

/**
 * One trade as a line of the journal. The whole line opens the entry, so it is
 * one button with the entry's details under it (a disclosure).
 */
export function JournalRow({
  id,
  entry,
  open,
  controls,
  onToggle,
}: {
  id: string;
  entry: JournalEntry;
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const money = resultMoney(entry);
  return (
    <button id={id} type="button" className="jr-row" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      <span className="jr-row__time">{entry.entryTime}</span>
      <span className="jr-row__asset">{entry.asset.label}</span>
      <span className="jr-row__dir" data-direction={entry.direction}>
        <span aria-hidden="true">{entry.direction === "up" ? "▲" : "▼"}</span>
        <span className="jr-row__dir-word"> {directionLabel(entry.direction)}</span>
      </span>
      <span className="jr-row__stake">${entry.amount}</span>
      <span className="jr-row__result" data-kind={money.kind}>
        {money.text}
      </span>
      <span className="jr-row__mark">
        <PlanMarkBadge planFollowed={entry.planFollowed} />
      </span>
      <ChevronDown className="jr-row__chevron" aria-hidden="true" size={16} strokeWidth={2} />
    </button>
  );
}

/* ------------------------------------------------------------ entry notes */

/** ПЛАН · ИСПОЛНЕНИЕ · ВЫВОД, and the rules broken, as the presentation lays them out. */
export function JournalNotes({ entry, reference }: { entry: JournalEntry; reference: JournalReference }) {
  const rules = entry.violations.map(
    (code) => reference.violations.find((violation) => violation.code === code)?.label ?? code,
  );
  return (
    <dl className="jr-notes">
      <JournalNote term="План" text={entry.plan} empty="Причина входа не записана" />
      <JournalNote term="Исполнение" text={entry.execution} empty="Не записано" />
      <JournalNote term="Вывод" text={entry.conclusion} empty="Вывода пока нет" />
      {rules.length > 0 ? (
        <div className="jr-note">
          <dt className="jr-note__term">Нарушения</dt>
          <dd className="jr-note__text">
            <ul className="jr-rules-list">
              {rules.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

export function JournalNote({ term, text, empty }: { term: string; text: string | null; empty: string }) {
  return (
    <div className="jr-note">
      <dt className="jr-note__term">{term}</dt>
      <dd className="jr-note__text">{text ?? <span className="jr-note__none">{empty}</span>}</dd>
    </div>
  );
}

/** «Payout 90% · Экспирация 3 мин · Из Trade Card» — what the line above leaves out. */
export function entryFacts(entry: JournalEntry): string {
  const source = entry.source === "trade_card" ? "Из Trade Card" : "Записано вручную";
  return `Payout ${entry.payoutPercent}% · Экспирация ${entry.expiry.label} · ${source}`;
}

/* ----------------------------------------------------------------- review */

type ReviewProps = {
  /** Keeps ids unique when the review of an entry and the new-entry form could both exist. */
  idPrefix: string;
  draft: ReviewDraft;
  reference: JournalReference;
  errors: DraftErrors;
  disabled: boolean;
  onMark: (mark: PlanMark) => void;
  onRule: (code: string, checked: boolean) => void;
  onText: (field: "execution" | "conclusion", value: string) => void;
};

/**
 * The learner's review: was the plan followed, which rules broke, how the trade
 * really went, and what to take into the next one. Rules are offered only for a
 * broken plan, which is the Backend's rule too.
 */
export function ReviewFields({ idPrefix, draft, reference, errors, disabled, onMark, onRule, onText }: ReviewProps) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const described = (field: ManualField) => (errors[field] ? id(`${field}-error`) : undefined);
  return (
    <div className="jr-review">
      <div className="tc-field">
        <span className="tc-label" id={id("mark")}>
          План соблюдён?
        </span>
        <div className="tc-segmented" role="radiogroup" aria-labelledby={id("mark")}>
          {(
            [
              { value: "followed", label: "По плану" },
              { value: "broken", label: "Нарушен" },
            ] as const
          ).map((option, index) => (
            <button
              key={option.value}
              id={index === 0 ? id("mark-first") : undefined}
              type="button"
              role="radio"
              aria-checked={draft.planMark === option.value}
              className="tc-segmented__option"
              data-selected={draft.planMark === option.value || undefined}
              disabled={disabled}
              onClick={() => onMark(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {draft.planMark === "broken" ? (
        <fieldset className="jr-rules" aria-describedby={described("violations")}>
          <legend className="tc-label">Что нарушено — отметьте всё, что было</legend>
          <div className="jr-chips">
            {reference.violations.map((rule) => {
              const checked = draft.violations.includes(rule.code);
              return (
                <label key={rule.code} className="jr-chip" data-checked={checked || undefined}>
                  <input
                    type="checkbox"
                    className="jr-chip__input"
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) => onRule(rule.code, event.target.checked)}
                  />
                  <span className="jr-chip__box" aria-hidden="true">
                    {checked ? <Check size={11} strokeWidth={3} /> : null}
                  </span>
                  {rule.label}
                </label>
              );
            })}
          </div>
          <FieldError id={id("violations-error")} message={errors.violations} />
        </fieldset>
      ) : null}

      <div className="tc-field">
        <label className="tc-label" htmlFor={id("execution")}>
          Исполнение
        </label>
        <textarea
          id={id("execution")}
          className="tc-input tc-textarea"
          rows={3}
          maxLength={JOURNAL_LIMITS.maxExecutionLength}
          placeholder="Как сделка прошла на самом деле: вход, сумма, время"
          value={draft.execution}
          disabled={disabled}
          onChange={(event) => onText("execution", event.target.value)}
          aria-invalid={errors.execution ? true : undefined}
          aria-describedby={described("execution")}
        />
        <FieldError id={id("execution-error")} message={errors.execution} />
      </div>

      <div className="tc-field">
        <label className="tc-label" htmlFor={id("conclusion")}>
          Вывод
        </label>
        <textarea
          id={id("conclusion")}
          className="tc-input tc-textarea"
          rows={3}
          maxLength={JOURNAL_LIMITS.maxConclusionLength}
          placeholder="Что возьмёте в следующую сделку"
          value={draft.conclusion}
          disabled={disabled}
          onChange={(event) => onText("conclusion", event.target.value)}
          aria-invalid={errors.conclusion ? true : undefined}
          aria-describedby={described("conclusion")}
        />
        <FieldError id={id("conclusion-error")} message={errors.conclusion} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------ hand-recorded trade */

type TradeField = Exclude<ManualField, keyof ReviewDraft | "plan">;

/**
 * A trade the learner opened without a card, written down afterwards: the same
 * fields as the Trade Card, plus the day and the result, and the plan only if
 * there was one.
 */
export function ManualTradeFields({
  draft,
  reference,
  errors,
  disabled,
  maxDate,
  onChange,
}: {
  draft: ManualDraft;
  reference: JournalReference;
  errors: DraftErrors;
  disabled: boolean;
  /** The learner's today: a journal records trades that already happened. */
  maxDate: string;
  onChange: (field: TradeField, value: string) => void;
}) {
  const id = (field: TradeField) => `jr-new-${field}`;
  const errorId = (field: TradeField) => `jr-new-${field}-error`;
  const described = (field: TradeField) => (errors[field] ? errorId(field) : undefined);
  const invalid = (field: TradeField) => (errors[field] ? true : undefined);
  const change = (field: TradeField) => (event: { target: { value: string } }) => onChange(field, event.target.value);

  return (
    <div className="tc-fields">
      <div className="tc-field">
        <label className="tc-label" htmlFor={id("tradeDate")}>
          Дата
        </label>
        <input
          id={id("tradeDate")}
          className="tc-input"
          type="date"
          min={JOURNAL_LIMITS.minTradeDate}
          max={maxDate}
          value={draft.tradeDate}
          onChange={change("tradeDate")}
          disabled={disabled}
          aria-invalid={invalid("tradeDate")}
          aria-describedby={described("tradeDate")}
        />
        <FieldError id={errorId("tradeDate")} message={errors.tradeDate} />
      </div>

      <div className="tc-field">
        <label className="tc-label" htmlFor={id("entryTime")}>
          Время входа
        </label>
        <input
          id={id("entryTime")}
          className="tc-input"
          type="time"
          value={draft.entryTime}
          onChange={change("entryTime")}
          disabled={disabled}
          aria-invalid={invalid("entryTime")}
          aria-describedby={described("entryTime")}
        />
        <FieldError id={errorId("entryTime")} message={errors.entryTime} />
      </div>

      <div className="tc-field">
        <label className="tc-label" htmlFor={id("asset")}>
          Актив
        </label>
        <select
          id={id("asset")}
          className="tc-input tc-select"
          value={draft.asset}
          onChange={change("asset")}
          disabled={disabled}
          aria-invalid={invalid("asset")}
          aria-describedby={described("asset")}
        >
          <AssetOptions reference={reference} />
        </select>
        <FieldError id={errorId("asset")} message={errors.asset} />
      </div>

      <div className="tc-field">
        <span className="tc-label" id={id("direction")}>
          Направление
        </span>
        <DirectionToggle
          value={draft.direction}
          labelledBy={id("direction")}
          describedBy={described("direction")}
          disabled={disabled}
          onChange={(value) => onChange("direction", value)}
        />
        <FieldError id={errorId("direction")} message={errors.direction} />
      </div>

      <div className="tc-field">
        <label className="tc-label" htmlFor={id("amount")}>
          Сумма
        </label>
        <span className="tc-affix" data-side="start">
          <span className="tc-affix__mark" aria-hidden="true">
            $
          </span>
          <input
            id={id("amount")}
            className="tc-input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={draft.amount}
            onChange={change("amount")}
            disabled={disabled}
            aria-invalid={invalid("amount")}
            aria-describedby={described("amount")}
          />
        </span>
        <FieldError id={errorId("amount")} message={errors.amount} />
      </div>

      <div className="tc-field">
        <label className="tc-label" htmlFor={id("payoutPercent")}>
          Payout
        </label>
        <span className="tc-affix" data-side="end">
          <input
            id={id("payoutPercent")}
            className="tc-input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={draft.payoutPercent}
            onChange={change("payoutPercent")}
            disabled={disabled}
            aria-invalid={invalid("payoutPercent")}
            aria-describedby={described("payoutPercent")}
          />
          <span className="tc-affix__mark" aria-hidden="true">
            %
          </span>
        </span>
        <FieldError id={errorId("payoutPercent")} message={errors.payoutPercent} />
      </div>

      <div className="tc-field">
        <label className="tc-label" htmlFor={id("expiry")}>
          Экспирация
        </label>
        <select
          id={id("expiry")}
          className="tc-input tc-select"
          value={draft.expiry}
          onChange={change("expiry")}
          disabled={disabled}
          aria-invalid={invalid("expiry")}
          aria-describedby={described("expiry")}
        >
          <ExpiryOptions reference={reference} />
        </select>
        <FieldError id={errorId("expiry")} message={errors.expiry} />
      </div>

      <div className="tc-field">
        <span className="tc-label" id={id("result")}>
          Результат
        </span>
        <div
          className="tc-segmented"
          role="radiogroup"
          aria-labelledby={id("result")}
          aria-describedby={described("result")}
          data-disabled={disabled || undefined}
        >
          {(["profit", "loss"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={draft.result === value}
              className="tc-segmented__option"
              data-selected={draft.result === value || undefined}
              disabled={disabled}
              onClick={() => onChange("result", value)}
            >
              {value === "profit" ? "Прибыль" : "Убыток"}
            </button>
          ))}
        </div>
        <FieldError id={errorId("result")} message={errors.result} />
      </div>
    </div>
  );
}

/** The plan, only if there was one: a trade opened without a plan is recorded as it was. */
export function ManualPlanField({
  value,
  error,
  disabled,
  onChange,
}: {
  value: string;
  error?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="tc-field">
      <label className="tc-label" htmlFor="jr-new-plan">
        План до входа
      </label>
      <textarea
        id="jr-new-plan"
        className="tc-input tc-textarea"
        rows={3}
        maxLength={JOURNAL_LIMITS.maxPlanLength}
        placeholder="Если причина входа была записана до сделки — перенесите её сюда"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "jr-new-plan-error" : undefined}
      />
      <FieldError id="jr-new-plan-error" message={error} />
    </div>
  );
}

/** «Итог сделки +$7.20», live under the hand-recorded trade. */
export function ManualOutcome({ money }: { money: { kind: "gain" | "loss"; text: string } | null }) {
  return (
    <div className="jr-outcome">
      <span className="jr-outcome__label">Итог сделки</span>
      <span className="jr-outcome__value" data-kind={money?.kind}>
        {money ? money.text : "—"}
      </span>
    </div>
  );
}
