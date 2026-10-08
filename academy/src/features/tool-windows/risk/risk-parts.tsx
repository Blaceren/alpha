"use client";

/**
 * The Risk Calculator's presentational parts: the four numbers, the plan's
 * arithmetic, the losing streak, the plan's two rules and its earlier versions.
 * No state and no effects; the workspace owns both.
 *
 * A CLIENT MODULE ON PURPOSE, as the other tools' parts are: the forms wire
 * their own change handlers.
 */
import type { ReactNode } from "react";
import { ChevronDown, Info } from "lucide-react";
import { PayoutField } from "../components/payout-field";
import { digitsOnly, moneyOnly } from "../model/numeric-input";
import { FieldError } from "../trade-card/trade-card-parts";
import {
  RISK_LIMITS,
  capitalWords,
  gainMoney,
  losingTradesWords,
  lossMoney,
  money,
  moneyMinor,
  percent,
  stepsWords,
  type RiskDraft,
  type RiskErrors,
  type RiskField,
  type RiskNumbers,
  type RiskPlan,
} from "./risk-model";

export const riskFieldId = (field: RiskField) => `rk-${field}`;
const errorId = (field: RiskField) => `rk-${field}-error`;

/* ------------------------------------------------------------ the numbers */

/**
 * `status` sits in the section's head, as «Зафиксировано» does on the Trade
 * Card: whether these numbers are the plan in force, seen before anything else.
 */
export function RiskParams({
  draft,
  shares,
  errors,
  disabled,
  status = null,
  onChange,
}: {
  draft: RiskDraft;
  shares: readonly number[];
  errors: RiskErrors;
  disabled: boolean;
  status?: ReactNode;
  onChange: (field: RiskField, value: string) => void;
}) {
  const described = (field: RiskField) => (errors[field] ? errorId(field) : undefined);
  const invalid = (field: RiskField) => (errors[field] ? true : undefined);
  return (
    <section className="tc-section rk-params" aria-labelledby="rk-params-title">
      <div className="tc-section__head">
        <h2 className="tc-section__title" id="rk-params-title">
          Параметры
        </h2>
        {status}
      </div>
      <div className="rk-fields">
        <div className="tc-field" data-field="capital">
          <label className="tc-label" htmlFor={riskFieldId("capital")}>
            Торговый капитал
          </label>
          <span className="tc-affix" data-side="start">
            <span className="tc-affix__mark" aria-hidden="true">
              $
            </span>
            <input
              id={riskFieldId("capital")}
              className="tc-input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={draft.capital}
              onChange={(event) => onChange("capital", moneyOnly(event.target.value))}
              disabled={disabled}
              aria-invalid={invalid("capital")}
              aria-describedby={[described("capital"), "rk-capital-note"].filter(Boolean).join(" ")}
            />
          </span>
          <FieldError id={errorId("capital")} message={errors.capital} />
          <p className="tc-note" id="rk-capital-note">
            <Info aria-hidden="true" size={14} strokeWidth={1.75} />
            <span>Капитал для плана вы задаёте сами. ATA не видит ваш счёт в Pocket.</span>
          </p>
        </div>

        <PayoutField
          id={riskFieldId("payoutPercent")}
          errorId={errorId("payoutPercent")}
          value={draft.payoutPercent}
          onChange={(value) => onChange("payoutPercent", value)}
          disabled={disabled}
          error={errors.payoutPercent}
        />

        <div className="tc-field">
          <label className="tc-label" htmlFor={riskFieldId("dailyLimitPercent")}>
            Дневной лимит потерь
          </label>
          <span className="tc-affix" data-side="end">
            <input
              id={riskFieldId("dailyLimitPercent")}
              className="tc-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={draft.dailyLimitPercent}
              onChange={(event) => onChange("dailyLimitPercent", digitsOnly(event.target.value, 3))}
              disabled={disabled}
              aria-invalid={invalid("dailyLimitPercent")}
              aria-describedby={described("dailyLimitPercent")}
            />
            <span className="tc-affix__mark" aria-hidden="true">
              %
            </span>
          </span>
          <FieldError id={errorId("dailyLimitPercent")} message={errors.dailyLimitPercent} />
        </div>

        <div className="tc-field" data-field="share">
          <span className="tc-label" id={riskFieldId("riskPercent")}>
            Доля риска на сделку
          </span>
          <div
            className="tc-segmented"
            role="radiogroup"
            aria-labelledby={riskFieldId("riskPercent")}
            aria-describedby={described("riskPercent")}
            data-disabled={disabled || undefined}
          >
            {shares.map((share) => {
              const selected = draft.riskPercent === String(share);
              return (
                <button
                  key={share}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className="tc-segmented__option"
                  data-selected={selected || undefined}
                  disabled={disabled}
                  onClick={() => onChange("riskPercent", String(share))}
                >
                  {share}%
                </button>
              );
            })}
          </div>
          <FieldError id={errorId("riskPercent")} message={errors.riskPercent} />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------- the arithmetic */

/**
 * One trade, its two outcomes, the daily limit and the break-even win rate.
 * `numbers` is null until all four inputs are valid: then every figure says «—».
 */
export function RiskResults({
  numbers,
  capitalMinor,
  riskPercent,
}: {
  numbers: RiskNumbers | null;
  capitalMinor: number | null;
  riskPercent: number | null;
}) {
  const overLimit = numbers !== null && numbers.lossesToStop === 0;
  return (
    <section className="tc-section rk-results" aria-labelledby="rk-results-title">
      <h2 className="tc-section__title" id="rk-results-title">
        Расчёт
      </h2>
      <div className="rk-amount">
        <span className="rk-amount__label">Сумма сделки</span>
        <span className="rk-amount__value">{numbers ? money(numbers.tradeAmountMinor) : "—"}</span>
        <span className="rk-amount__basis">
          {numbers && capitalMinor !== null && riskPercent !== null
            ? `${riskPercent}% от ${capitalWords(capitalMinor)}`
            : "Заполните параметры — расчёт появится здесь."}
        </span>
      </div>

      <dl className="tc-outcomes">
        <div className="tc-outcome" data-kind="gain">
          <dt className="tc-outcome__label">Прогноз верен</dt>
          <dd className="tc-outcome__value">{numbers ? gainMoney(numbers.ifRightMinor) : "—"}</dd>
        </div>
        <div className="tc-outcome" data-kind="loss">
          <dt className="tc-outcome__label">Прогноз неверен</dt>
          <dd className="tc-outcome__value">{numbers ? lossMoney(numbers.ifWrongMinor) : "—"}</dd>
        </div>
      </dl>

      <dl className="rk-facts">
        <div className="rk-fact" data-warn={overLimit || undefined}>
          <dt className="rk-fact__term">Дневной лимит</dt>
          <dd className="rk-fact__value">
            {numbers
              ? overLimit
                ? `${money(numbers.dailyLimitMinor)} · меньше одной сделки`
                : `${money(numbers.dailyLimitMinor)} · ${losingTradesWords(numbers.lossesToStop)} → стоп`
              : "—"}
            {overLimit ? (
              <span className="rk-fact__note">Одна сделка больше дневного лимита: он закончится на первом же убытке.</span>
            ) : null}
          </dd>
        </div>
        <div className="rk-fact">
          <dt className="rk-fact__term">Безубыточный win rate</dt>
          <dd className="rk-fact__value">
            {numbers ? percent(numbers.breakEvenBasisPoints) : "—"}
            <span className="rk-fact__note">Ниже этой доли прибыльных сделок план теряет деньги.</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}

/* ------------------------------------------------------------ the streak */

/**
 * Five losses in a row, two ways. Each bar is the capital; its fill is the share
 * of it the streak takes. The words carry every value; the bars repeat them.
 */
export function RiskStreak({ numbers, capitalMinor }: { numbers: RiskNumbers | null; capitalMinor: number | null }) {
  const length = numbers?.streak.length ?? RISK_LIMITS.streakLength;
  const fill = (basisPoints: number) => `${Math.min(100, basisPoints / 100)}%`;
  const doublingShort = numbers !== null && numbers.streak.doublingTradesCovered < length;
  return (
    <section className="tc-section rk-streak" aria-labelledby="rk-streak-title">
      <div className="tc-section__head">
        <h2 className="tc-section__title" id="rk-streak-title">
          Серия из {length} убытков подряд
        </h2>
        {numbers && capitalMinor !== null ? (
          <span className="rk-streak__of">доля от {capitalWords(capitalMinor)}</span>
        ) : null}
      </div>

      <div className="rk-series" data-kind="fixed">
        <div className="rk-series__head">
          <span className="rk-series__name">Фиксированная сумма</span>
          <span className="rk-series__value" data-empty={numbers ? undefined : true}>
            {numbers ? `${lossMoney(numbers.streak.fixedLossMinor)} · ${percent(numbers.streak.fixedShareBasisPoints)}` : "—"}
          </span>
        </div>
        <span className="rk-bar" aria-hidden="true">
          <span className="rk-bar__fill" style={{ width: numbers ? fill(numbers.streak.fixedShareBasisPoints) : "0%" }} />
        </span>
        <span className="rk-series__how">
          {numbers ? `${money(numbers.tradeAmountMinor)} × ${length}` : "Одна и та же сумма каждый раз"}
        </span>
      </div>

      <div className="rk-series" data-kind="doubling" data-short={doublingShort || undefined}>
        <div className="rk-series__head">
          <span className="rk-series__name">Удвоение после убытка</span>
          <span className="rk-series__value" data-empty={numbers ? undefined : true}>
            {numbers
              ? doublingShort
                ? `${lossMoney(numbers.streak.doublingLossMinor)} · больше капитала`
                : `${lossMoney(numbers.streak.doublingLossMinor)} · ${percent(numbers.streak.doublingShareBasisPoints)}`
              : "—"}
          </span>
        </div>
        <span className="rk-bar" aria-hidden="true">
          <span
            className="rk-bar__fill"
            style={{ width: numbers ? fill(numbers.streak.doublingShareBasisPoints) : "0%" }}
          />
        </span>
        <span className="rk-series__how">
          {numbers
            ? doublingShort
              ? `${stepsWords(numbers.streak.doublingStepsMinor)} — капитала хватит на ${numbers.streak.doublingTradesCovered} из ${length}`
              : stepsWords(numbers.streak.doublingStepsMinor)
            : "Сумма удваивается после каждого убытка"}
        </span>
      </div>

      <p className="tc-note">
        <Info aria-hidden="true" size={14} strokeWidth={1.75} />
        <span>Серия возможна даже при рабочем плане. Сумма после убытка не меняется.</span>
      </p>
    </section>
  );
}

/* ------------------------------------------------------------- the rules */

export function RiskRules({
  draft,
  errors,
  disabled,
  onChange,
}: {
  draft: RiskDraft;
  errors: RiskErrors;
  disabled: boolean;
  onChange: (field: "scenario" | "cancelCondition", value: string) => void;
}) {
  const field = (name: "scenario" | "cancelCondition", label: string, placeholder: string) => (
    <div className="tc-field">
      <label className="tc-label" htmlFor={riskFieldId(name)}>
        {label} <span className="rk-ahead">· задаётся заранее</span>
      </label>
      <textarea
        id={riskFieldId(name)}
        className="tc-input tc-textarea"
        rows={3}
        maxLength={RISK_LIMITS.maxTextLength}
        placeholder={placeholder}
        value={draft[name]}
        onChange={(event) => onChange(name, event.target.value)}
        disabled={disabled}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? errorId(name) : undefined}
      />
      <FieldError id={errorId(name)} message={errors[name]} />
    </div>
  );
  return (
    <section className="tc-section rk-rules" aria-labelledby="rk-rules-title">
      <h2 className="tc-section__title" id="rk-rules-title">
        Правила плана
      </h2>
      {field("scenario", "Сценарий", "Какие сделки ваш план разрешает")}
      {field("cancelCondition", "Условие отмены", "Когда план запрещает входить")}
    </section>
  );
}

/* ---------------------------------------------------------- the versions */

export function RiskVersions({
  history,
  open,
  onToggle,
  timeOf,
}: {
  history: readonly RiskPlan[];
  open: boolean;
  onToggle: () => void;
  /** «20 сентября, 14:10» on the learner's clock, or null before the browser has one. */
  timeOf: (iso: string) => string | null;
}) {
  if (history.length === 0) return null;
  return (
    <section className="rk-versions" aria-label="Предыдущие версии плана">
      <button
        type="button"
        className="rk-versions__toggle"
        aria-expanded={open}
        aria-controls="rk-versions-list"
        onClick={onToggle}
      >
        Предыдущие версии · {history.length}
        <ChevronDown className="rk-versions__chevron" aria-hidden="true" size={16} strokeWidth={2} />
      </button>
      <ol className="rk-versions__list" id="rk-versions-list" hidden={!open}>
        {history.map((plan) => {
          const when = timeOf(plan.createdAt);
          return (
            <li className="rk-version" key={plan.id}>
              <p className="rk-version__head">
                <span className="rk-version__no">Версия {plan.version}</span>
                {when ? <span className="rk-version__when">{when}</span> : null}
              </p>
              <p className="rk-version__numbers">
                {capitalWords(moneyMinor(plan.capital))} · {plan.riskPercent}% на сделку · payout {plan.payoutPercent}% ·
                лимит {plan.dailyLimitPercent}% → сделка {money(moneyMinor(plan.numbers.tradeAmount))}
              </p>
              <dl className="jr-notes">
                <div className="jr-note">
                  <dt className="jr-note__term">Сценарий</dt>
                  <dd className="jr-note__text">{plan.scenario}</dd>
                </div>
                <div className="jr-note">
                  <dt className="jr-note__term">Условие отмены</dt>
                  <dd className="jr-note__text">{plan.cancelCondition}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
