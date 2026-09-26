"use client";

/**
 * Schema-driven single field renderer. The field DEFINITION is authoritative
 * (type, label, help, required, choices, bounds all come from the Backend DTO).
 * An unknown type renders a visible, safe error instead of disappearing.
 *
 * Accessibility: every control has an explicit label, help text and error are
 * associated via `aria-describedby`, required state is announced with
 * `aria-required`, and an invalid field sets `aria-invalid`. Boolean and choice
 * fields never convey meaning by colour alone.
 */
import { isReportFieldType, type ReportFieldDefinition } from "@/lib/report/types";

export type ReportFieldProps = {
  field: ReportFieldDefinition;
  value: unknown;
  error: string | null;
  disabled: boolean;
  effectivelyRequired: boolean;
  onChange: (stableKey: string, value: unknown) => void;
};

function ids(stableKey: string) {
  return {
    control: `rf-${stableKey}`,
    help: `rf-${stableKey}-help`,
    error: `rf-${stableKey}-error`,
  };
}

export function ReportField({ field, value, error, disabled, effectivelyRequired, onChange }: ReportFieldProps) {
  const id = ids(field.stableKey);
  const describedBy = [field.helpText ? id.help : null, error ? id.error : null].filter(Boolean).join(" ") || undefined;

  if (!isReportFieldType(field.type)) {
    // Fail visibly and safely (never silently drop a field).
    return (
      <div className="rf rf--unknown rpt-f" data-field={field.stableKey} role="alert">
        <p className="rf__label rpt-f__label">{field.label || field.stableKey}</p>
        <p className="rf__unknown-note">Это поле пока не поддерживается в интерфейсе. Обратитесь в поддержку.</p>
      </div>
    );
  }

  const req = effectivelyRequired ? (
    <span className="rf__req" aria-hidden="true"> *</span>
  ) : null;

  const common = {
    id: id.control,
    "aria-describedby": describedBy,
    "aria-required": effectivelyRequired,
    "aria-invalid": error ? true : undefined,
    disabled,
  } as const;

  return (
    <div
      className={`rf rpt-f${error ? " rpt-f--err" : ""}`}
      data-field={field.stableKey}
      data-type={field.type}
      data-invalid={error ? "true" : undefined}
    >
      {renderControl(field, value, common, onChange)}

      {field.helpText ? (
        <p className="rf__help" id={id.help}>{field.helpText}</p>
      ) : null}
      {error ? (
        <p className="rf__error rpt-f__err" id={id.error} role="alert">{error}</p>
      ) : null}

      {/* screen-reader required announcement mirror (not colour/asterisk only) */}
      {effectivelyRequired ? <span className="sr-only">Обязательное поле.</span> : null}
      {req}
    </div>
  );
}

type ControlCommon = {
  id: string;
  "aria-describedby": string | undefined;
  "aria-required": boolean;
  "aria-invalid": true | undefined;
  disabled: boolean;
};

function labelFor(field: ReportFieldDefinition, controlId: string, required: boolean) {
  return (
    <label className="rf__label rpt-f__label" htmlFor={controlId}>
      {field.label}
      {required ? <span className="rf__req" aria-hidden="true"> *</span> : null}
    </label>
  );
}

function renderControl(
  field: ReportFieldDefinition,
  value: unknown,
  common: ControlCommon,
  onChange: (stableKey: string, value: unknown) => void,
) {
  const required = common["aria-required"];

  switch (field.type) {
    case "boolean": {
      // Yes/No radio group (not a checkbox: a checkbox conflates "false" and "unset").
      const groupName = common.id;
      return (
        <fieldset className="rf__group" aria-describedby={common["aria-describedby"]} aria-invalid={common["aria-invalid"]}>
          <legend className="rf__label rpt-f__label">
            {field.label}
            {required ? <span className="rf__req" aria-hidden="true"> *</span> : null}
          </legend>
          {[
            { code: "true", label: "Да", val: true },
            { code: "false", label: "Нет", val: false },
          ].map((opt) => (
            <div className="rf__option eng-opt" key={opt.code}>
              <input
                type="radio"
                id={`${common.id}-${opt.code}`}
                name={groupName}
                value={opt.code}
                checked={value === opt.val}
                disabled={common.disabled}
                onChange={() => onChange(field.stableKey, opt.val)}
              />
              <label htmlFor={`${common.id}-${opt.code}`}>{opt.label}</label>
            </div>
          ))}
        </fieldset>
      );
    }

    case "single_choice":
      return (
        <fieldset className="rf__group" aria-describedby={common["aria-describedby"]} aria-invalid={common["aria-invalid"]}>
          <legend className="rf__label rpt-f__label">
            {field.label}
            {required ? <span className="rf__req" aria-hidden="true"> *</span> : null}
          </legend>
          {field.choices.map((choice) => (
            <div className="rf__option eng-opt" key={choice.code}>
              <input
                type="radio"
                id={`${common.id}-${choice.code}`}
                name={common.id}
                value={choice.code}
                checked={value === choice.code}
                disabled={common.disabled}
                onChange={() => onChange(field.stableKey, choice.code)}
              />
              {/* Fall back to the stable code when the definition ships no label,
                  so a choice is never an unlabelled control. */}
              <label htmlFor={`${common.id}-${choice.code}`}>{choice.label || choice.code}</label>
            </div>
          ))}
        </fieldset>
      );

    case "multi_choice": {
      const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
      return (
        <fieldset className="rf__group" aria-describedby={common["aria-describedby"]} aria-invalid={common["aria-invalid"]}>
          <legend className="rf__label rpt-f__label">
            {field.label}
            {required ? <span className="rf__req" aria-hidden="true"> *</span> : null}
          </legend>
          {field.choices.map((choice) => (
            <div className="rf__option eng-opt" key={choice.code}>
              <input
                type="checkbox"
                id={`${common.id}-${choice.code}`}
                checked={selected.has(choice.code)}
                disabled={common.disabled}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(choice.code);
                  else next.delete(choice.code);
                  onChange(field.stableKey, [...next]);
                }}
              />
              <label htmlFor={`${common.id}-${choice.code}`}>{choice.label || choice.code}</label>
            </div>
          ))}
        </fieldset>
      );
    }

    case "long_text":
      return (
        <>
          {labelFor(field, common.id, required)}
          <textarea
            {...common}
            className="rf__input rf__textarea rpt-f__in"
            rows={4}
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder || undefined}
            maxLength={field.validation?.maxLength}
            onChange={(event) => onChange(field.stableKey, event.target.value)}
          />
        </>
      );

    case "integer":
      return (
        <>
          {labelFor(field, common.id, required)}
          <input
            {...common}
            className="rf__input rpt-f__in"
            type="number"
            inputMode="numeric"
            step={1}
            min={field.validation?.minValue}
            max={field.validation?.maxValue}
            value={typeof value === "number" ? value : ""}
            placeholder={field.placeholder || undefined}
            onChange={(event) => {
              const raw = event.target.value;
              if (raw.trim() === "") onChange(field.stableKey, undefined);
              else {
                const n = Number(raw);
                onChange(field.stableKey, Number.isFinite(n) ? n : raw);
              }
            }}
          />
        </>
      );

    case "url":
      return (
        <>
          {labelFor(field, common.id, required)}
          <input
            {...common}
            className="rf__input rpt-f__in"
            type="url"
            inputMode="url"
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder || "https://…"}
            onChange={(event) => onChange(field.stableKey, event.target.value)}
          />
        </>
      );

    case "short_text":
    default:
      return (
        <>
          {labelFor(field, common.id, required)}
          <input
            {...common}
            className="rf__input rpt-f__in"
            type="text"
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder || undefined}
            maxLength={field.validation?.maxLength}
            onChange={(event) => onChange(field.stableKey, event.target.value)}
          />
        </>
      );
  }
}
