"use client";

/**
 * The Trade Card's presentational parts. No state and no effects: the live
 * workspace and the locked-page preview both render them, so the preview is
 * the real card with example values rather than a picture of one.
 *
 * A CLIENT MODULE ON PURPOSE. The form wires its own change handlers, and the
 * locked page renders the preview from the server: a server component may not
 * hand an element an event handler, so the handlers have to be created on this
 * side of the boundary. The server passes only plain values.
 */
import { Info } from "lucide-react";
import {
  TRADE_CARD_STEPS,
  gainLabel,
  lossLabel,
  type DraftErrors,
  type DraftField,
  type TradeCardDraft,
  type TradeCardReference,
  type TradeDirection,
} from "./trade-card-model";

/* ------------------------------------------------------------------ steps */

export function TradeCardStepper({ step }: { step: number }) {
  return (
    <ol className="tw-steps" aria-label="Этапы сделки">
      {TRADE_CARD_STEPS.map((label, index) => {
        const state = index < step ? "done" : index === step ? "current" : "upcoming";
        return (
          <li key={label} className="tw-step" data-state={state} aria-current={index === step ? "step" : undefined}>
            <span className="tw-step__bar" aria-hidden="true" />
            <span className="tw-step__label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------------------------------------------- outcomes */

export function TradeCardOutcomes({ outcomes }: { outcomes: { ifRight: string; ifWrong: string } | null }) {
  return (
    <section className="tw-section" aria-labelledby="tc-outcomes-title">
      <h2 className="tw-label" id="tc-outcomes-title">
        Возможные исходы
      </h2>
      <dl className="tw-outcomes">
        <div className="tw-outcome" data-kind="gain">
          <dt className="tw-label">Прогноз верен</dt>
          <dd className="tw-outcome__value">{outcomes ? gainLabel(outcomes.ifRight) : "—"}</dd>
        </div>
        <div className="tw-outcome" data-kind="loss">
          <dt className="tw-label">Прогноз неверен</dt>
          <dd className="tw-outcome__value">{outcomes ? lossLabel(outcomes.ifWrong) : "—"}</dd>
        </div>
      </dl>
      <p className="tw-note">
        <Info aria-hidden="true" size={14} strokeWidth={1.75} />
        <span>После открытия условия сделки не меняются, досрочного закрытия нет. Проверьте всё сейчас.</span>
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------- form */

const GROUP_LABELS: Record<string, string> = {
  currency_otc: "Валюты · OTC",
  currency: "Валюты",
  crypto_otc: "Криптовалюты · OTC",
  commodity_otc: "Металлы · OTC",
};

type FormProps = {
  draft: TradeCardDraft;
  reference: TradeCardReference;
  errors?: DraftErrors;
  /** Fixed plans and the preview show the plan without letting it change. */
  disabled?: boolean;
  onChange?: (field: DraftField, value: string) => void;
  /** «ЗАФИКСИРОВАНО 14:32», shown once the plan is fixed. */
  fixedAtLabel?: string | null;
  idPrefix?: string;
};

export function TradeCardPlanForm({
  draft,
  reference,
  errors = {},
  disabled = false,
  onChange,
  fixedAtLabel = null,
  idPrefix = "tc",
}: FormProps) {
  const id = (field: DraftField) => `${idPrefix}-${field}`;
  const errorId = (field: DraftField) => `${idPrefix}-${field}-error`;
  const change = (field: DraftField) => (event: { target: { value: string } }) => onChange?.(field, event.target.value);
  const described = (field: DraftField) => (errors[field] ? errorId(field) : undefined);
  const groups = [...new Set(reference.assets.map((asset) => asset.group))];

  return (
    <section className="tw-section" aria-labelledby={`${idPrefix}-plan-title`} data-disabled={disabled || undefined}>
      <div className="tw-section__head">
        <h2 className="tw-label" id={`${idPrefix}-plan-title`}>
          Параметры до входа
        </h2>
        {fixedAtLabel ? <span className="tw-pill">Зафиксировано {fixedAtLabel}</span> : null}
      </div>

      <div className="tw-grid">
        <div className="tw-field">
          <label className="tw-label" htmlFor={id("asset")}>
            Актив
          </label>
          <select
            id={id("asset")}
            className="tw-input tw-select"
            value={draft.asset}
            onChange={change("asset")}
            disabled={disabled}
            aria-invalid={errors.asset ? true : undefined}
            aria-describedby={described("asset")}
          >
            <option value="" disabled>
              Выберите актив
            </option>
            {groups.map((group) => (
              <optgroup key={group} label={GROUP_LABELS[group] ?? group}>
                {reference.assets
                  .filter((asset) => asset.group === group)
                  .map((asset) => (
                    <option key={asset.code} value={asset.code}>
                      {asset.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <FieldError id={errorId("asset")} message={errors.asset} />
        </div>

        <div className="tw-field">
          <span className="tw-label" id={id("direction")}>
            Направление
          </span>
          <DirectionToggle
            value={draft.direction}
            labelledBy={id("direction")}
            describedBy={described("direction")}
            disabled={disabled}
            onChange={(value) => onChange?.("direction", value)}
          />
          <FieldError id={errorId("direction")} message={errors.direction} />
        </div>

        <div className="tw-field">
          <label className="tw-label" htmlFor={id("amount")}>
            Сумма
          </label>
          <span className="tw-affix" data-side="start">
            <span className="tw-affix__mark" aria-hidden="true">
              $
            </span>
            <input
              id={id("amount")}
              className="tw-input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="8"
              value={draft.amount}
              onChange={change("amount")}
              disabled={disabled}
              aria-invalid={errors.amount ? true : undefined}
              aria-describedby={described("amount")}
            />
          </span>
          <FieldError id={errorId("amount")} message={errors.amount} />
        </div>

        <div className="tw-field">
          <label className="tw-label" htmlFor={id("payoutPercent")}>
            Payout
          </label>
          <span className="tw-affix" data-side="end">
            <input
              id={id("payoutPercent")}
              className="tw-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="90"
              value={draft.payoutPercent}
              onChange={change("payoutPercent")}
              disabled={disabled}
              aria-invalid={errors.payoutPercent ? true : undefined}
              aria-describedby={described("payoutPercent")}
            />
            <span className="tw-affix__mark" aria-hidden="true">
              %
            </span>
          </span>
          <FieldError id={errorId("payoutPercent")} message={errors.payoutPercent} />
        </div>

        <div className="tw-field">
          <label className="tw-label" htmlFor={id("expiry")}>
            Экспирация
          </label>
          <select
            id={id("expiry")}
            className="tw-input tw-select"
            value={draft.expiry}
            onChange={change("expiry")}
            disabled={disabled}
            aria-invalid={errors.expiry ? true : undefined}
            aria-describedby={described("expiry")}
          >
            <option value="" disabled>
              Выберите
            </option>
            {reference.expiries.map((expiry) => (
              <option key={expiry.code} value={expiry.code}>
                {expiry.label}
              </option>
            ))}
          </select>
          <FieldError id={errorId("expiry")} message={errors.expiry} />
        </div>

        <div className="tw-field">
          <label className="tw-label" htmlFor={id("entryTime")}>
            Время входа
          </label>
          <input
            id={id("entryTime")}
            className="tw-input"
            type="time"
            value={draft.entryTime}
            onChange={change("entryTime")}
            disabled={disabled}
            aria-invalid={errors.entryTime ? true : undefined}
            aria-describedby={described("entryTime")}
          />
          <FieldError id={errorId("entryTime")} message={errors.entryTime} />
        </div>

        <div className="tw-field" data-span="full">
          <label className="tw-label" htmlFor={id("reason")}>
            Причина входа до сделки
          </label>
          <textarea
            id={id("reason")}
            className="tw-input tw-textarea"
            rows={3}
            maxLength={1000}
            placeholder="Что вы видите на графике и почему входите именно сейчас"
            value={draft.reason}
            onChange={change("reason")}
            disabled={disabled}
            aria-invalid={errors.reason ? true : undefined}
            aria-describedby={described("reason")}
          />
          <FieldError id={errorId("reason")} message={errors.reason} />
        </div>
      </div>
    </section>
  );
}

function DirectionToggle({
  value,
  labelledBy,
  describedBy,
  disabled,
  onChange,
}: {
  value: TradeDirection | "";
  labelledBy: string;
  describedBy?: string;
  disabled: boolean;
  onChange: (value: TradeDirection) => void;
}) {
  const options: { value: TradeDirection; label: string; mark: string }[] = [
    { value: "up", label: "Выше", mark: "▲" },
    { value: "down", label: "Ниже", mark: "▼" },
  ];
  return (
    <div className="tw-segmented" role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className="tw-segmented__option"
          data-selected={value === option.value || undefined}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          <span aria-hidden="true">{option.mark}</span> {option.label}
        </button>
      ))}
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span className="tw-field__error" id={id}>
      {message}
    </span>
  );
}

/* ------------------------------------------------------------------ saved */

export function TradeCardSavedNotice({ summary }: { summary: string }) {
  return (
    <div className="tw-done" role="status">
      <p className="tw-done__title">Карточка сохранена</p>
      <p className="tw-done__body">{summary}. С уровня 10 карточки попадают в Trading Journal.</p>
    </div>
  );
}
