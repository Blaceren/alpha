"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  DIRECTION_LABEL,
  isoToDateInput,
  isoToTimeInput,
  type JournalDirection,
  type JournalEntry,
  type JournalEntryInput,
  type JournalFieldErrors,
} from "@/features/tools/model/journal-entry";
import type { JournalMutationResult } from "@/features/tools/hooks/use-trading-journal";

const DIRECTIONS: JournalDirection[] = ["buy", "sell", "observation"];

function emptyInput(): JournalEntryInput {
  return {
    date: "",
    time: "",
    instrument: "",
    direction: "",
    setup: "",
    plan: "",
    execution: "",
    lesson: "",
    manualResult: "",
  };
}

function inputFromEntry(entry: JournalEntry): JournalEntryInput {
  return {
    date: isoToDateInput(entry.occurredAt),
    time: isoToTimeInput(entry.occurredAt),
    instrument: entry.instrument,
    direction: entry.direction,
    setup: entry.setup,
    plan: entry.plan,
    execution: entry.execution,
    lesson: entry.lesson,
    manualResult: entry.manualResult === null ? "" : String(entry.manualResult),
  };
}

/**
 * The create / edit form (Phase D4-B). Embedded in the spine flow — not an
 * administrative record form. The three structural zones ПЛАН → ИСПОЛНЕНИЕ →
 * УРОК carry the weight; the manual result is an optional, secondary field.
 *
 * A semantic <form> with real labels, a fieldset/legend for direction, error
 * associations + aria-invalid, aria-busy while pending, and Escape to cancel
 * without saving.
 */
export function JournalEntryForm({
  mode,
  initial,
  onSubmit,
  onCancel,
  pending,
  storageError,
}: {
  mode: "create" | "edit";
  initial?: JournalEntry;
  onSubmit: (input: JournalEntryInput) => JournalMutationResult;
  onCancel: () => void;
  pending: boolean;
  storageError: boolean;
}) {
  const [values, setValues] = useState<JournalEntryInput>(
    initial ? inputFromEntry(initial) : emptyInput(),
  );
  const [errors, setErrors] = useState<JournalFieldErrors>({});
  const uid = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Move focus into the form when it opens — the first field for a new note,
    // so the keyboard user lands where the work begins.
    firstFieldRef.current?.focus();
  }, []);

  const set = useCallback(
    <K extends keyof JournalEntryInput>(key: K, value: JournalEntryInput[K]) => {
      setValues((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (pending) return; // double-submit guard at the UI edge
      const result = onSubmit(values);
      if (!result.ok && result.errors) {
        setErrors(result.errors);
        // Focus the first field in error for the keyboard user.
        const firstKey = Object.keys(result.errors)[0];
        if (firstKey) {
          const el = document.getElementById(`${uid}-${firstKey}`);
          if (el instanceof HTMLElement) el.focus();
        }
      } else if (result.ok) {
        setErrors({});
      }
    },
    [onSubmit, pending, values, uid],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    },
    [onCancel],
  );

  const fieldId = (key: string) => `${uid}-${key}`;
  const errId = (key: string) => `${uid}-${key}-err`;
  const describedBy = (key: keyof JournalFieldErrors) =>
    errors[key] ? errId(key) : undefined;
  const invalid = (key: keyof JournalFieldErrors) => (errors[key] ? true : undefined);

  return (
    <form className="je-form" onSubmit={handleSubmit} onKeyDown={onKeyDown} aria-busy={pending} noValidate>
      <p className="je-form-h">{mode === "create" ? "Новая запись" : "Редактирование записи"}</p>

      {/* Identity row: date · time · instrument. Date and time are explicit,
          locale-independent fields — never a native datetime-local (DD-311). */}
      <div className="je-identity">
        <div className="je-field je-date">
          <label htmlFor={fieldId("date")}>Дата</label>
          <input
            ref={firstFieldRef}
            id={fieldId("date")}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="ДД.ММ.ГГГГ"
            value={values.date}
            onChange={(e) => set("date", e.target.value)}
            aria-invalid={invalid("date")}
            aria-describedby={describedBy("date")}
            required
          />
          {errors.date && (
            <span className="je-err" id={errId("date")} role="alert">
              {errors.date}
            </span>
          )}
        </div>

        <div className="je-field je-time">
          <label htmlFor={fieldId("time")}>Время</label>
          <input
            id={fieldId("time")}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="ЧЧ:ММ"
            value={values.time}
            onChange={(e) => set("time", e.target.value)}
            aria-invalid={invalid("time")}
            aria-describedby={describedBy("time")}
            required
          />
          {errors.time && (
            <span className="je-err" id={errId("time")} role="alert">
              {errors.time}
            </span>
          )}
        </div>

        <div className="je-field je-instr">
          <label htmlFor={fieldId("instrument")}>Инструмент</label>
          <input
            id={fieldId("instrument")}
            type="text"
            inputMode="text"
            placeholder="напр. XAU/USD"
            value={values.instrument}
            onChange={(e) => set("instrument", e.target.value)}
            aria-invalid={invalid("instrument")}
            aria-describedby={describedBy("instrument")}
            required
          />
          {errors.instrument && (
            <span className="je-err" id={errId("instrument")} role="alert">
              {errors.instrument}
            </span>
          )}
        </div>
      </div>

      <fieldset className="je-dir" aria-describedby={describedBy("direction")}>
        <legend>Направление</legend>
        <div className="je-dir-opts">
          {DIRECTIONS.map((dir) => (
            <label key={dir} className="je-radio">
              <input
                type="radio"
                name={`${uid}-direction`}
                value={dir}
                checked={values.direction === dir}
                onChange={() => set("direction", dir)}
              />
              <span>{DIRECTION_LABEL[dir]}</span>
            </label>
          ))}
        </div>
        {errors.direction && (
          <span className="je-err" id={errId("direction")} role="alert">
            {errors.direction}
          </span>
        )}
      </fieldset>

      <div className="je-field">
        <label htmlFor={fieldId("setup")}>
          Сетап / идея <span className="je-opt">— необязательно</span>
        </label>
        <input
          id={fieldId("setup")}
          type="text"
          placeholder="на чём основано решение"
          value={values.setup}
          onChange={(e) => set("setup", e.target.value)}
        />
      </div>

      {/* The triptych, in order — the structural spine of the entry. */}
      <div className="je-triptych">
        <div className="je-field je-phase">
          <label htmlFor={fieldId("plan")}>
            <span className="je-phase-k mono">План</span>
          </label>
          <textarea
            id={fieldId("plan")}
            rows={3}
            placeholder="намерение до сделки"
            value={values.plan}
            onChange={(e) => set("plan", e.target.value)}
            aria-invalid={invalid("plan")}
            aria-describedby={describedBy("plan")}
            required
          />
          {errors.plan && (
            <span className="je-err" id={errId("plan")} role="alert">
              {errors.plan}
            </span>
          )}
        </div>

        <div className="je-field je-phase">
          <label htmlFor={fieldId("execution")}>
            <span className="je-phase-k mono">Исполнение</span>
          </label>
          <textarea
            id={fieldId("execution")}
            rows={3}
            placeholder="что сделали на самом деле"
            value={values.execution}
            onChange={(e) => set("execution", e.target.value)}
            aria-invalid={invalid("execution")}
            aria-describedby={describedBy("execution")}
            required
          />
          {errors.execution && (
            <span className="je-err" id={errId("execution")} role="alert">
              {errors.execution}
            </span>
          )}
        </div>

        <div className="je-field je-phase je-lesson">
          <label htmlFor={fieldId("lesson")}>
            <span className="je-phase-k mono is-lesson">Урок</span>
            <span className="je-lesson-hint">главное в записи</span>
          </label>
          <textarea
            id={fieldId("lesson")}
            rows={3}
            placeholder="ключевой вывод"
            value={values.lesson}
            onChange={(e) => set("lesson", e.target.value)}
            aria-invalid={invalid("lesson")}
            aria-describedby={describedBy("lesson")}
            required
          />
          {errors.lesson && (
            <span className="je-err" id={errId("lesson")} role="alert">
              {errors.lesson}
            </span>
          )}
        </div>
      </div>

      <div className="je-field je-result">
        <label htmlFor={fieldId("manualResult")}>
          Ручной результат <span className="je-opt">— необязательно</span>
        </label>
        <input
          id={fieldId("manualResult")}
          type="text"
          inputMode="text"
          placeholder="напр. 18 или −7"
          value={values.manualResult ?? ""}
          onChange={(e) => set("manualResult", e.target.value)}
          aria-invalid={invalid("manualResult")}
          aria-describedby={
            errors.manualResult ? errId("manualResult") : `${uid}-result-note`
          }
        />
        <span className="je-result-note" id={`${uid}-result-note`}>
          Не баланс и не итог — только пометка по этой сделке. Можно оставить пустым.
        </span>
        {errors.manualResult && (
          <span className="je-err" id={errId("manualResult")} role="alert">
            {errors.manualResult}
          </span>
        )}
      </div>

      {storageError && (
        <p className="je-storage-err" role="alert">
          Не удалось сохранить в этом браузере — запись пока не сохранена. Проверьте, что браузер
          разрешает локальное хранение, и попробуйте снова.
        </p>
      )}

      <div className="je-actions">
        <button type="submit" className="je-submit" disabled={pending}>
          {mode === "create" ? "Добавить запись" : "Сохранить изменения"}
        </button>
        <button type="button" className="je-cancel" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}
