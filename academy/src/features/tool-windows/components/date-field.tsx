"use client";

/**
 * «Дата» — the tools' date field.
 *
 * THE FIELD SAYS THE DAY THE WAY THE LEARNER WOULD: «Сегодня», «Вчера», «29
 * сентября» — and opens a month in the product's own hand. The two days a
 * journal is nearly always written for are one press each; the rest of the
 * month is one more.
 *
 * WHY NOT THE BROWSER'S OWN (owner, 2026-10-02). `<input type="date">` writes
 * «10/02/2026» in a Russian interface and opens the operating system's
 * calendar. The value is unchanged — "YYYY-MM-DD", the learner's calendar day —
 * so the form and the Backend see what they always saw.
 *
 * WHAT CAN BE CHOSEN is the caller's: `min` and `max` are days, inclusive; a day
 * outside them is drawn and cannot be pressed. For the journal `max` is the
 * learner's today — a journal records trades that already happened.
 *
 * THE MONTH IS SHOWN IN WHOLE WEEKS: its first and last week are completed with
 * the neighbouring months' days, a shade back, and they are pressed like any
 * other. In the first days of a month the days a journal is written for are
 * the month before's, and they stand in the same row instead of a page away.
 *
 * KEYS, in the month: the arrows move a day or a week, PageUp and PageDown a
 * month, Home and End to the ends of the week, Enter or Space choose, Escape
 * closes and returns to the field.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  WEEKDAYS_SHORT,
  addDays,
  addMonths,
  addMonthsToDate,
  clampDate,
  compareMonths,
  daysInMonth,
  describeDate,
  fullDateLabel,
  isoDate,
  monthGrid,
  monthOf,
  monthTitle,
  parseIsoDate,
  weekdayIndex,
  type MonthOfYear,
} from "../model/calendar";
import { usePickerPanel } from "./picker-panel";

export type DateFieldProps = {
  /** The id of the field's button; the first field in error takes the focus by it. */
  id: string;
  /** The id of the visible label («Дата»), which names the field; its text is the value. */
  labelId: string;
  /** "YYYY-MM-DD", or "" while nothing is chosen. */
  value: string;
  /** The first and the last day that can be chosen, inclusive. `max` is also the learner's today. */
  min: string;
  max: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Which edge of the field the panel hangs from; «end» for a field in the right half of a form. */
  align?: "start" | "end";
};

export function DateField({
  id,
  labelId,
  value,
  min,
  max,
  onChange,
  disabled = false,
  invalid = false,
  describedBy,
  align = "start",
}: DateFieldProps) {
  const { open: isOpen, rootRef, panelRef, panelId, show, hide } = usePickerPanel();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const chosen = parseIsoDate(value) ? value : null;
  /** The day the arrows stand on: one cell of the month is in the tab order, and it is this one. */
  const [cursor, setCursor] = useState(() => clampDate(chosen ?? max, min, max));
  const [view, setView] = useState<MonthOfYear>(() => monthOf(cursor) ?? { year: 2020, month: 1 });
  /** Set when a key moved the cursor: the focus follows it once the month is drawn. */
  const followCursor = useRef(false);

  const words = chosen ? describeDate(chosen, max) : null;
  const minMonth = monthOf(min);
  const maxMonth = monthOf(max);
  const canGoBack = minMonth !== null && compareMonths(view, minMonth) > 0;
  const canGoForward = maxMonth !== null && compareMonths(view, maxMonth) < 0;

  const open = () => {
    const start = clampDate(chosen ?? max, min, max);
    setCursor(start);
    setView(monthOf(start) ?? view);
    followCursor.current = true;
    show();
  };

  const choose = (iso: string) => {
    onChange(iso);
    hide(triggerRef.current);
  };

  /** Move the cursor to `iso`, kept inside the limits, and bring its month on show. */
  const moveTo = (iso: string) => {
    const next = clampDate(iso, min, max);
    followCursor.current = true;
    setCursor(next);
    const month = monthOf(next);
    if (month) setView(month);
  };

  /**
   * Turn the page: the month changes and the cursor goes with it, keeping its
   * day where that month has it and staying inside the limits — so the month
   * on show always holds the one cell Tab can reach.
   */
  const turn = (delta: number) => {
    const month = addMonths(view, delta);
    const day = Math.min(parseIsoDate(cursor)?.day ?? 1, daysInMonth(month.year, month.month));
    setView(month);
    setCursor(clampDate(isoDate(month.year, month.month, day), min, max));
  };

  useEffect(() => {
    if (!isOpen || !followCursor.current) return;
    followCursor.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`button[data-iso="${cursor}"]`)?.focus();
  });

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, () => string> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      Home: () => addDays(cursor, -weekdayIndex(cursor)),
      End: () => addDays(cursor, 6 - weekdayIndex(cursor)),
      PageUp: () => addMonthsToDate(cursor, -1),
      PageDown: () => addMonthsToDate(cursor, 1),
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    moveTo(step());
  };

  const quick = [
    { label: "Сегодня", iso: max },
    { label: "Вчера", iso: addDays(max, -1) },
    { label: "Позавчера", iso: addDays(max, -2) },
  ].filter((day) => day.iso >= min);

  return (
    <div
      className="tp-field"
      ref={rootRef}
      data-open={isOpen || undefined}
      data-align={align}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !isOpen) return;
        event.stopPropagation();
        hide(triggerRef.current);
      }}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="tc-input tp-trigger"
        // A field whose value is chosen from a panel: a select-only combobox.
        // As one, it can be named by its label, read out with its value, and
        // marked invalid — which a plain button cannot be.
        role="combobox"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        data-empty={chosen ? undefined : ""}
        disabled={disabled}
        onClick={() => (isOpen ? hide() : open())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !isOpen) {
            event.preventDefault();
            open();
          }
        }}
      >
        <span className="tp-trigger__value">
          {words ? (
            <>
              <span className="tp-trigger__main">{words.main}</span>
              <span className="tp-trigger__note">{words.note}</span>
            </>
          ) : (
            <span className="tp-trigger__main">Выберите дату</span>
          )}
        </span>
        <CalendarDays className="tp-trigger__icon" aria-hidden="true" size={17} strokeWidth={1.75} />
      </button>

      {isOpen ? (
        <div
          ref={panelRef}
          id={panelId}
          className="tp-panel"
          role="dialog"
          aria-label="Выбор даты"
          tabIndex={-1}
        >
          <div className="tp-head">
            {quick.map((day) => (
              <button
                key={day.label}
                type="button"
                className="tp-chip"
                aria-pressed={chosen === day.iso}
                data-selected={chosen === day.iso || undefined}
                onClick={() => choose(day.iso)}
              >
                {day.label}
              </button>
            ))}
          </div>

          <div className="tp-month">
            <button
              type="button"
              className="tp-turn"
              aria-label="Предыдущий месяц"
              disabled={!canGoBack}
              onClick={() => turn(-1)}
            >
              <ChevronLeft aria-hidden="true" size={18} strokeWidth={1.75} />
            </button>
            <p className="tp-month__title" aria-live="polite">
              {monthTitle(view)}
            </p>
            <button
              type="button"
              className="tp-turn"
              aria-label="Следующий месяц"
              disabled={!canGoForward}
              onClick={() => turn(1)}
            >
              <ChevronRight aria-hidden="true" size={18} strokeWidth={1.75} />
            </button>
          </div>

          <div className="tp-days" ref={gridRef} role="grid" aria-label={monthTitle(view)} onKeyDown={onGridKeyDown}>
            <div className="tp-days__row" role="row">
              {WEEKDAYS_SHORT.map((weekday) => (
                <span key={weekday} className="tp-days__weekday" role="columnheader">
                  {weekday}
                </span>
              ))}
            </div>
            {monthGrid(view.year, view.month).map((row, index) => (
              <div key={index} className="tp-days__row" role="row">
                {row.map(({ iso, outside }) => (
                  <span key={iso} role="gridcell">
                    <button
                      type="button"
                      className="tp-cell tp-day"
                      data-iso={iso}
                      // A neighbouring month's day, completing the week: it can
                      // be pressed like any other, and stands a shade back.
                      data-outside={outside || undefined}
                      data-selected={chosen === iso || undefined}
                      data-today={iso === max || undefined}
                      aria-pressed={chosen === iso}
                      aria-label={fullDateLabel(iso)}
                      aria-current={iso === max ? "date" : undefined}
                      tabIndex={iso === cursor ? 0 : -1}
                      disabled={iso < min || iso > max}
                      onClick={() => choose(iso)}
                    >
                      {Number(iso.slice(8))}
                    </button>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
