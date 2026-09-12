"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import {
  calculateRisk,
  MAX_INPUT_LENGTH,
  type RiskCalculationResult,
  type RiskFieldError,
  type RiskInput,
} from "@/features/tools/model/risk-calculation";
import { formatNumber, formatPercent, PRECISION } from "@/features/tools/model/risk-format";

/**
 * Risk Calculator workspace (Phase D4-C) — Direction A «Price Rail» dominant,
 * with Direction B contributing ONLY a compact mobile result strip.
 *
 * Desktop/tablet: manual inputs (left) → measured entry/stop Price Rail (centre,
 * the signature object) → output ledger (right). Mobile: the rail becomes a
 * horizontal measured bar, inputs stay in normal flow, and ONLY the valid state
 * gets a compact sticky result strip above the bottom nav. Never a ticket,
 * receipt or broker order confirmation.
 *
 * Pure and side-effect-free: no storage, no fetch, no environment, no XP /
 * progression write. Every calculation is a `useMemo` over the four controlled
 * strings via the pure `calculateRisk` model. Refreshing the route resets
 * everything (nothing is persisted). No currency symbol is ever shown — no
 * account or asset currency is selected (DD-303).
 */

const EMPTY: RiskInput = { capital: "", riskPercent: "", entryPrice: "", stopPrice: "" };

const DIRECTION_LABEL = { long: "Лонг", short: "Шорт" } as const;

const DISCLAIMER =
  "Ручной учебный расчёт. Данные не синхронизируются со счётом или брокером и не являются инвестиционной рекомендацией.";

const FIELD_MESSAGE: Record<Exclude<RiskFieldError, "empty">, string> = {
  format: "Введите число: цифры и одна запятая или точка.",
  nonPositive: "Значение должно быть больше нуля.",
  over100: "Риск не может превышать 100%.",
  equal: "Цена входа и стоп-цена должны отличаться.",
};

const DASH = "—";

export function RiskCalculatorWorkspace() {
  const [input, setInput] = useState<RiskInput>(EMPTY);
  const result = useMemo(() => calculateRisk(input), [input]);

  const ids = {
    capital: useId(),
    riskPercent: useId(),
    entryPrice: useId(),
    stopPrice: useId(),
  };

  const setField = (field: keyof RiskInput) => (value: string) =>
    setInput((prev) => ({ ...prev, [field]: value }));

  const fieldError = (field: keyof RiskInput): RiskFieldError | null =>
    result.status === "valid" ? null : result.fields[field];

  const isValid = result.status === "valid";
  const direction = isValid ? DIRECTION_LABEL[result.direction] : null;

  // Authoritative numbers — the ledger and rail readout render these strings.
  const values = isValid
    ? {
        riskAmount: formatNumber(result.riskAmount, PRECISION.amount),
        stopDistance: formatNumber(result.stopDistance, PRECISION.price),
        stopDistancePercent: formatPercent(result.stopDistancePercent),
        positionUnits: formatNumber(result.positionUnits, PRECISION.units),
        positionNotional: formatNumber(result.positionNotional, PRECISION.amount),
      }
    : null;

  // A single concise textual summary for assistive tech — polite so it does not
  // announce on every keystroke, and empty for incomplete/quiet states. Cheap to
  // derive each render, so no memo (avoids a derived-object dependency).
  const summary = buildSummary(result, values, direction);

  return (
    <div className="rc-page">
      <header className="rc-head">
        <Link className="rc-back" href="/tools">
          <span aria-hidden="true">←</span> Инструменты
        </Link>
        <div className="rc-id">
          <span className="rc-num mono" aria-hidden="true">
            15
          </span>
          <h1 className="rc-h1">Risk Calculator</h1>
        </div>
        <p className="rc-disclaimer" role="note">
          <span className="rc-disclaimer-i" aria-hidden="true">
            (i)
          </span>{" "}
          {DISCLAIMER}
        </p>
      </header>

      <div className="rc-shell">
        {/* LEFT — the four manual inputs */}
        <form
          className="rc-inputs"
          aria-label="Параметры расчёта"
          onSubmit={(e) => e.preventDefault()}
          noValidate
        >
          <Field
            id={ids.capital}
            label="Расчётный капитал"
            hint="Гипотетическая сумма для расчёта — не подключается к счёту и не сохраняется."
            value={input.capital}
            onChange={setField("capital")}
            error={fieldError("capital")}
          />
          <Field
            id={ids.riskPercent}
            label="Риск на сделку, %"
            hint="Доля капитала под риском в этой сделке."
            value={input.riskPercent}
            onChange={setField("riskPercent")}
            error={fieldError("riskPercent")}
          />
          <Field
            id={ids.entryPrice}
            label="Цена входа"
            value={input.entryPrice}
            onChange={setField("entryPrice")}
            error={fieldError("entryPrice")}
          />
          <Field
            id={ids.stopPrice}
            label="Стоп-цена"
            value={input.stopPrice}
            onChange={setField("stopPrice")}
            error={fieldError("stopPrice")}
          />
        </form>

        {/* CENTRE — the Price Rail signature object */}
        <section className="rc-rail" aria-label="Соотношение входа и стопа">
          <div className={`rc-rail-track ${isValid ? "is-active" : "is-quiet"}`} aria-hidden="true">
            <span className="rc-rail-node is-entry">
              <span className="rc-rail-node-k">Вход</span>
              <span className="rc-rail-node-v mono">{input.entryPrice.trim() || DASH}</span>
            </span>
            <span className="rc-rail-band">
              <span className="rc-rail-band-line" />
              <span className="rc-rail-band-dist mono">{values ? values.stopDistance : DASH}</span>
            </span>
            <span className="rc-rail-node is-stop">
              <span className="rc-rail-node-k">Стоп</span>
              <span className="rc-rail-node-v mono">{input.stopPrice.trim() || DASH}</span>
            </span>
          </div>

          <div className="rc-rail-facts">
            <p className={`rc-rail-dir ${isValid ? `is-${result.direction}` : "is-quiet"}`}>
              <span className="rc-rail-dir-mark" aria-hidden="true" />
              <span className="rc-rail-dir-k">Направление</span>
              <span className="rc-rail-dir-v">{direction ?? DASH}</span>
            </p>
            <p className="rc-rail-dist">
              <span className="rc-rail-dist-k">Дистанция до стопа</span>
              <span className="rc-rail-dist-v mono">
                {values ? `${values.stopDistance} · ${values.stopDistancePercent}` : DASH}
              </span>
            </p>
          </div>

          <p className="rc-note">Стоп определяет риск на единицу позиции.</p>
        </section>

        {/* RIGHT — the output ledger */}
        <section className="rc-ledger" aria-label="Итоги расчёта">
          <LedgerRow label="Сумма риска" value={values?.riskAmount ?? DASH} on={isValid} />
          <LedgerRow
            label="Дистанция до стопа"
            value={values ? `${values.stopDistance} · ${values.stopDistancePercent}` : DASH}
            on={isValid}
          />
          <LedgerRow label="Размер позиции" value={values?.positionUnits ?? DASH} on={isValid} />
          <LedgerRow label="Расчётный номинал" value={values?.positionNotional ?? DASH} on={isValid} />
        </section>
      </div>

      {/* Compact mobile result strip — Direction B, VALID state only. */}
      {isValid && values && direction && (
        <div className="rc-strip" role="group" aria-label="Итог расчёта">
          <span className={`rc-strip-dir is-${result.direction}`}>{direction}</span>
          <span className="rc-strip-cell">
            <span className="rc-strip-k">Размер позиции</span>
            <span className="rc-strip-v mono">{values.positionUnits}</span>
          </span>
          <span className="rc-strip-cell">
            <span className="rc-strip-k">Расчётный номинал</span>
            <span className="rc-strip-v mono">{values.positionNotional}</span>
          </span>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {summary}
      </p>
    </div>
  );
}

type FormattedValues = {
  riskAmount: string;
  stopDistance: string;
  stopDistancePercent: string;
  positionUnits: string;
  positionNotional: string;
} | null;

/** Concise textual summary for the polite live region — empty when quiet. */
function buildSummary(
  result: RiskCalculationResult,
  values: FormattedValues,
  direction: string | null,
): string {
  if (result.status === "valid" && values && direction) {
    return `Расчёт готов. Направление ${direction}. Сумма риска ${values.riskAmount}. Дистанция до стопа ${values.stopDistance}, ${values.stopDistancePercent}. Размер позиции ${values.positionUnits}. Расчётный номинал ${values.positionNotional}.`;
  }
  if (result.status === "invalid") {
    if (result.general === "range") return "Значения слишком большие для расчёта.";
    if (result.fields.stopPrice === "equal") return FIELD_MESSAGE.equal;
    return "Проверьте введённые значения.";
  }
  return "";
}

function Field({
  id,
  label,
  hint,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  error: RiskFieldError | null;
}) {
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const showError = error !== null && error !== "empty";
  const describedBy = [hint ? hintId : null, showError ? errId : null].filter(Boolean).join(" ");

  return (
    <div className="rc-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        maxLength={MAX_INPUT_LENGTH}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={showError || undefined}
        aria-describedby={describedBy || undefined}
      />
      {hint && (
        <p className="rc-field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {showError && (
        <p className="rc-field-err" id={errId}>
          {FIELD_MESSAGE[error]}
        </p>
      )}
    </div>
  );
}

function LedgerRow({ label, value, on }: { label: string; value: string; on: boolean }) {
  return (
    <p className={`rc-ledger-row ${on ? "is-on" : "is-quiet"}`}>
      <span className="rc-ledger-k">{label}</span>
      <span className="rc-ledger-v mono">{value}</span>
    </p>
  );
}
