"use client";

/**
 * «Время входа» — the tools' time field.
 *
 * TWO WAYS IN, ONE VALUE. The field is typed into — four digits make a time,
 * the colon is ours (`time-input.ts`) — and it opens a panel for a hand that
 * would rather point: «Сейчас», the hour, then the minute. Both write the same
 * «ЧЧ:ММ» the tools have always kept; the form that holds it does not change.
 *
 * WHY NOT THE BROWSER'S OWN (owner, 2026-10-02: «удобно и красиво, подходить
 * под наш стиль»). `<input type="time">` draws itself in the browser's locale
 * and opens the operating system's list — grey columns on the product's field.
 *
 * THE MINUTE IS PICKED IN TWO STEPS: the ten, then the minute inside it. Sixty
 * cells would be a wall and a list would be a scroll; six tens and ten minutes
 * are two glances, and any minute is exactly two presses away.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Clock } from "lucide-react";
import { formatTime, parseTime, settleTime, stepTime, typeTime } from "../model/time-input";
import { moveInGrid, usePickerPanel } from "./picker-panel";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const TENS = [0, 10, 20, 30, 40, 50];
const two = (value: number) => String(value).padStart(2, "0");

export type TimeFieldProps = {
  /** The id the field's `<label htmlFor>` points at. */
  id: string;
  /** «ЧЧ:ММ», or whatever of it has been typed so far. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Which edge of the field the panel hangs from; «end» for a field in the right half of a form. */
  align?: "start" | "end";
};

export function TimeField({ id, value, onChange, disabled = false, invalid = false, describedBy, align = "start" }: TimeFieldProps) {
  const { open: isOpen, rootRef, panelRef, panelId, show, hide } = usePickerPanel();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const time = parseTime(value);
  /** The ten whose minutes are on show; follows the value until the learner picks another. */
  const [pickedTen, setPickedTen] = useState<number | null>(null);
  const valueTen = time ? Math.floor(time.minutes / 10) * 10 : null;
  const ten = pickedTen ?? valueTen ?? 0;
  /** The one minute cell in the tab order: the chosen minute when it is on show, else the first. */
  const minuteStop = time && valueTen === ten ? time.minutes : ten;

  /** The hour a minute is set against when none has been chosen: the learner's current one. */
  const hourInHand = () => time?.hours ?? new Date().getHours();

  /** Set when the panel is opened: the focus goes to the hour in hand once the panel is drawn. */
  const focusPanel = useRef(false);
  const open = () => {
    setPickedTen(null);
    focusPanel.current = true;
    show();
  };
  useEffect(() => {
    if (!isOpen || !focusPanel.current) return;
    focusPanel.current = false;
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>('[data-cell][tabindex="0"]') ?? panel)?.focus();
  });

  /* A pointer that brings the focus selects the whole time, as Tab does, so the
     next four digits replace it. The browser puts its caret down AFTER the
     focus event, so the selection is made on the click that follows; a second
     click, in a field that already has the focus, places the caret as usual. */
  const focusedByPointer = useRef(false);

  /* The arrows turn one part and keep it selected, so the next press turns the
     same part: the value is rewritten whole, and without this the caret would
     land at the end — on the minutes — after every step of the hours. */
  const keepSelected = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    const range = keepSelected.current;
    keepSelected.current = null;
    const input = inputRef.current;
    if (range && input && document.activeElement === input) input.setSelectionRange(range[0], range[1]);
  });

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      if (event.altKey && event.key === "ArrowDown") {
        open();
        return;
      }
      // The caret says which wheel turns: before the colon the hours, anywhere else the minutes.
      const start = event.currentTarget.selectionStart ?? value.length;
      const end = event.currentTarget.selectionEnd ?? start;
      const part = start <= 2 && end <= 2 ? "hours" : "minutes";
      keepSelected.current = part === "hours" ? [0, 2] : [3, 5];
      onChange(stepTime(value, part, event.key === "ArrowUp" ? 1 : -1));
    }
  };

  return (
    <div
      className="tp-field"
      ref={rootRef}
      data-open={isOpen || undefined}
      data-align={align}
      // Escape, from the field, its button or anywhere in the panel: close, and
      // leave the focus on the control the learner was at.
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !isOpen) return;
        event.stopPropagation();
        hide(document.activeElement === inputRef.current ? inputRef.current : toggleRef.current);
      }}
    >
      <div className="tp-control">
        <input
          ref={inputRef}
          id={id}
          className="tc-input tp-input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="ЧЧ:ММ"
          value={value}
          onChange={(event) => onChange(typeTime(event.target.value, value))}
          onBlur={() => {
            focusedByPointer.current = false;
            const settled = settleTime(value);
            if (settled !== value) onChange(settled);
          }}
          onPointerDown={(event) => {
            focusedByPointer.current = document.activeElement !== event.currentTarget;
          }}
          onClick={(event) => {
            if (!focusedByPointer.current) return;
            focusedByPointer.current = false;
            event.currentTarget.select();
          }}
          onKeyDown={onKeyDown}
          disabled={disabled}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
        />
        <button
          ref={toggleRef}
          type="button"
          className="tp-toggle"
          aria-label="Выбрать время"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-controls={isOpen ? panelId : undefined}
          onClick={() => (isOpen ? hide() : open())}
          disabled={disabled}
        >
          <Clock aria-hidden="true" size={17} strokeWidth={1.75} />
        </button>
      </div>

      {isOpen ? (
        <div
          ref={panelRef}
          id={panelId}
          className="tp-panel"
          role="dialog"
          aria-label="Выбор времени"
          tabIndex={-1}
        >
          <div className="tp-head">
            <button
              type="button"
              className="tp-chip"
              onClick={() => {
                const now = new Date();
                onChange(formatTime(now.getHours(), now.getMinutes()));
                hide(inputRef.current);
              }}
            >
              Сейчас
            </button>
            <button type="button" className="tp-done" onClick={() => hide(inputRef.current)}>
              Готово
            </button>
          </div>

          <p className="tp-label" id={`${panelId}-hours`}>
            Часы
          </p>
          <div
            className="tp-grid"
            data-columns="6"
            role="group"
            aria-labelledby={`${panelId}-hours`}
            onKeyDown={(event) => moveInGrid(event, 6)}
          >
            {HOURS.map((hour) => {
              const selected = time?.hours === hour;
              return (
                <button
                  key={hour}
                  type="button"
                  className="tp-cell"
                  data-cell
                  data-selected={selected || undefined}
                  aria-pressed={selected}
                  // One stop for Tab: the chosen hour, or the first while none is.
                  tabIndex={selected || (!time && hour === 0) ? 0 : -1}
                  onClick={() => onChange(formatTime(hour, time?.minutes ?? 0))}
                >
                  {two(hour)}
                </button>
              );
            })}
          </div>

          <p className="tp-label" id={`${panelId}-minutes`}>
            Минуты
          </p>
          {/* The ten, and under it — in its own tray — the ten minutes it holds. */}
          <div
            className="tp-grid"
            data-columns="6"
            role="group"
            aria-label="Десяток минут"
            onKeyDown={(event) => moveInGrid(event, 6)}
          >
            {TENS.map((start) => {
              const current = ten === start;
              return (
                <button
                  key={start}
                  type="button"
                  className="tp-cell"
                  data-cell
                  data-current={current || undefined}
                  aria-pressed={current}
                  tabIndex={current ? 0 : -1}
                  onClick={() => {
                    setPickedTen(start);
                    onChange(formatTime(hourInHand(), start));
                  }}
                >
                  {two(start)}
                </button>
              );
            })}
          </div>
          <div
            className="tp-grid tp-grid--tray"
            data-columns="5"
            role="group"
            aria-labelledby={`${panelId}-minutes`}
            onKeyDown={(event) => moveInGrid(event, 5)}
          >
            {Array.from({ length: 10 }, (_, index) => ten + index).map((minute) => {
              const selected = time?.minutes === minute;
              return (
                <button
                  key={minute}
                  type="button"
                  className="tp-cell"
                  data-cell
                  data-selected={selected || undefined}
                  aria-pressed={selected}
                  tabIndex={minute === minuteStop ? 0 : -1}
                  // The minute is the last thing a time needs: choosing it is finishing.
                  onClick={() => {
                    onChange(formatTime(hourInHand(), minute));
                    hide(inputRef.current);
                  }}
                >
                  {two(minute)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
