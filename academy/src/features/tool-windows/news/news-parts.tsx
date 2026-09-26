"use client";

/**
 * News Calendar's presentational parts: the status line, the day and its
 * timeline, the day's releases, and the learner's plan. No state and no
 * effects; the workspace owns both.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FieldError } from "../trade-card/trade-card-parts";
import {
  IMPORTANCE_WORDS,
  agoWords,
  dayWords,
  importanceDots,
  inWords,
  planCovers,
  timeIn,
  timelineRange,
  windowOf,
  zoneOptions,
  zoneWords,
  type ClosedWindow,
  type NewsEvent,
  type NewsNow,
  type NewsPlan,
  type NewsPlanDraft,
  type NewsPlanErrors,
  type NewsPlanField,
  type NewsReference,
} from "./news-model";

export const newsFieldId = (field: NewsPlanField) => `nc-${field}`;
const errorId = (field: NewsPlanField) => `nc-${field}-error`;

/* ------------------------------------------------------------ the status */

/** The presentation's line: where the learner's plan stands right now. */
export function NewsNowLine({ now, zone, at: clock }: { now: NewsNow; zone: string; at: number }) {
  if (now.kind === "no_plan") {
    return (
      <div className="nc-now" data-tone="quiet">
        <p className="nc-now__title">Плана по новостям пока нет</p>
        <p className="nc-now__line">Составьте его ниже — и здесь будет видно, когда ваш план закрывает вход.</p>
      </div>
    );
  }
  if (now.kind === "closed") {
    const at = Date.parse(now.event.releaseAt);
    return (
      <div className="nc-now" data-tone="closed">
        <p className="nc-now__title">Вход закрыт по вашему плану до {timeIn(now.until, zone)}</p>
        <p className="nc-now__line">
          {now.upcoming ? capitalize(inWords(at - clock)) : capitalize(agoWords(clock - at))}:{" "}
          <span className="nc-now__currency">{now.event.currency}</span> · {now.event.title}.
        </p>
        <p className="nc-now__rule">Первое движение после публикации — только наблюдение.</p>
      </div>
    );
  }
  if (now.kind === "open_next") {
    return (
      <div className="nc-now" data-tone="open">
        <p className="nc-now__title">Вход открыт. По плану закроется в {timeIn(now.closesAt, zone)}</p>
        <p className="nc-now__line">
          <span className="nc-now__currency">{now.event.currency}</span> · {now.event.title} — в{" "}
          {timeIn(Date.parse(now.event.releaseAt), zone)}.
        </p>
      </div>
    );
  }
  return (
    <div className="nc-now" data-tone="open">
      <p className="nc-now__title">Вход открыт</p>
      <p className="nc-now__line">Сегодня новостей по вашему плану больше нет.</p>
    </div>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ---------------------------------------------------------------- the day */

export function NewsDayNav({
  day,
  today,
  canBack,
  canForward,
  onDay,
}: {
  day: string;
  today: string | null;
  canBack: boolean;
  canForward: boolean;
  onDay: (step: -1 | 1 | 0) => void;
}) {
  return (
    <div className="nc-daynav">
      <button type="button" className="nc-daynav__step" aria-label="Предыдущий день" disabled={!canBack} onClick={() => onDay(-1)}>
        <ChevronLeft aria-hidden="true" size={18} strokeWidth={1.75} />
      </button>
      <h2 className="nc-daynav__day" id="nc-day-title">
        {day === today ? "Сегодня, " : ""}
        {dayWords(day)}
      </h2>
      <button type="button" className="nc-daynav__step" aria-label="Следующий день" disabled={!canForward} onClick={() => onDay(1)}>
        <ChevronRight aria-hidden="true" size={18} strokeWidth={1.75} />
      </button>
      {today !== null && day !== today ? (
        <button type="button" className="nc-daynav__today" onClick={() => onDay(0)}>
          Сегодня
        </button>
      ) : null}
    </div>
  );
}

/**
 * THE SIGNATURE: the learner's day, midnight to midnight in their zone, with
 * every window their plan closes hatched, the releases as marks by importance,
 * and «сейчас» on today. The words under it carry every window for a reader
 * who cannot see the drawing.
 */
export function NewsTimeline({
  day,
  bounds,
  zone,
  windows,
  events,
  plan,
  now,
}: {
  day: string;
  bounds: { from: number; to: number };
  zone: string;
  windows: readonly ClosedWindow[];
  events: readonly NewsEvent[];
  plan: NewsPlan | null;
  now: number | null;
}) {
  const visible = windows.filter((window) => window.end > bounds.from && window.start < bounds.to);
  const showNow = now !== null && now >= bounds.from && now < bounds.to;
  const range = timelineRange(day, zone, [
    ...events.map((event) => Date.parse(event.releaseAt)),
    ...visible.flatMap((window) => [window.start, window.end]),
    ...(showNow ? [now] : []),
  ]);
  const span = range.to - range.from;
  const at = (instant: number) => `${(Math.min(Math.max(instant - range.from, 0), span) / span) * 100}%`;
  // Every hour on a short stretch, every second or third on a long one; phones show half of them.
  const step = range.hours.length <= 13 ? 1 : 3;
  const ticks = range.hours.filter((tick) => tick.hour % step === 0);
  return (
    <div className="nc-timeline">
      <div className="nc-track" aria-hidden="true">
        {visible.map((window) => (
          <span
            key={window.start}
            className="nc-track__window"
            style={{ left: at(window.start), width: `calc(${at(window.end)} - ${at(window.start)})` }}
          />
        ))}
        {events.map((event) => (
          <span
            key={event.slug}
            className="nc-track__mark"
            data-importance={event.importance}
            data-covered={(plan !== null && planCovers(event, plan)) || undefined}
            style={{ left: at(Date.parse(event.releaseAt)) }}
          />
        ))}
        {showNow ? (
          <span className="nc-track__now" style={{ left: at(now) }}>
            <span className="nc-track__now-label">сейчас {timeIn(now, zone)}</span>
          </span>
        ) : null}
      </div>
      <div className="nc-hours" aria-hidden="true">
        {ticks.map((tick) => (
          <span
            key={tick.hour}
            className="nc-hours__tick"
            data-major={tick.hour % (step * 2) === 0 || undefined}
            style={{ left: at(tick.instant) }}
          >
            {String(tick.hour % 24).padStart(2, "0")}
          </span>
        ))}
      </div>
      <p className="nc-timeline__words">
        {plan === null
          ? "Окна закрытого входа появятся на шкале, когда вы сохраните план."
          : visible.length === 0
            ? "В этот день ваш план вход не закрывает."
            : `Вход закрыт по плану: ${visible.map((window) => `${timeIn(window.start, zone)}–${timeIn(window.end, zone)}`).join(", ")}.`}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------ the releases */

export function NewsEvents({
  events,
  windows,
  plan,
  zone,
  now,
  isToday,
}: {
  events: readonly NewsEvent[];
  windows: readonly ClosedWindow[];
  plan: NewsPlan | null;
  zone: string;
  now: number | null;
  isToday: boolean;
}) {
  if (events.length === 0) {
    return <p className="tc-caption nc-events__none">В этот день в календаре нет новостей.</p>;
  }
  return (
    <ol className="nc-events">
      {events.map((event) => {
        const at = Date.parse(event.releaseAt);
        const window = windowOf(event, windows);
        const covered = plan !== null && planCovers(event, plan);
        const state = now === null ? null : at <= now ? "past" : isToday && at - now <= 60 * 60_000 ? "soon" : null;
        return (
          <li key={event.slug} className="nc-event" data-covered={covered || undefined} data-state={state ?? undefined}>
            <time className="nc-event__time" dateTime={event.releaseAt}>
              {timeIn(at, zone)}
            </time>
            <span className="nc-cur" title={event.countryLabel}>
              {event.currency}
            </span>
            <div className="nc-event__main">
              <Link className="nc-event__title" href={`/news/${event.slug}`}>
                {event.title}
              </Link>
              <span className="nc-event__meta">
                {event.countryLabel}
                <span className="nc-event__imp" data-importance={event.importance}>
                  <span aria-hidden="true">{importanceDots(event.importance)}</span>
                  <span className="tw-sr-only">{IMPORTANCE_WORDS[event.importance]}</span>
                </span>
                <span className="nc-event__values">
                  прогноз {event.forecast ?? "—"} · факт {event.actual ?? "—"}
                </span>
              </span>
              {window ? (
                <span className="nc-event__closes">
                  Вход закрыт {timeIn(window.start, zone)}–{timeIn(window.end, zone)}
                </span>
              ) : plan !== null ? (
                <span className="nc-event__outside">Вне вашего плана</span>
              ) : null}
            </div>
            {state ? <span className="nc-event__state">{state === "past" ? "Прошло" : "Скоро"}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------------------------------------------- the plan */

function Segmented({
  field,
  label,
  options,
  value,
  disabled,
  errors,
  onPick,
}: {
  field: NewsPlanField;
  label: string;
  options: readonly { value: number; label: string }[];
  value: number | null;
  disabled: boolean;
  errors: NewsPlanErrors;
  onPick: (value: number) => void;
}) {
  return (
    <div className="tc-field" data-span="full">
      <span className="tc-label" id={newsFieldId(field)}>
        {label}
      </span>
      <div
        className="tc-segmented"
        role="radiogroup"
        aria-labelledby={newsFieldId(field)}
        aria-describedby={errors[field] ? errorId(field) : undefined}
        data-disabled={disabled || undefined}
      >
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className="tc-segmented__option"
              data-selected={selected || undefined}
              disabled={disabled}
              onClick={() => onPick(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <FieldError id={errorId(field)} message={errors[field]} />
    </div>
  );
}

/**
 * «Мой план по новостям» (L29): which releases close entry, for how long
 * before and after, for which currencies, and the zone the day is read in.
 * `status` sits in the head, as on the Risk Plan: whether the form shows the
 * plan in force, seen before anything else.
 */
export function NewsPlanForm({
  draft,
  reference,
  savedZone,
  errors,
  status,
  saving,
  canRestore,
  now,
  onZone,
  onImportance,
  onMinutes,
  onCurrency,
  onSave,
  onRestore,
}: {
  draft: NewsPlanDraft;
  reference: NewsReference;
  savedZone: string | null;
  errors: NewsPlanErrors;
  status: ReactNode;
  saving: boolean;
  canRestore: boolean;
  now: number;
  onZone: (zone: string) => void;
  onImportance: (value: number) => void;
  onMinutes: (field: "minutesBefore" | "minutesAfter", value: number) => void;
  onCurrency: (code: string) => void;
  onSave: () => void;
  onRestore: () => void;
}) {
  const minutes = reference.minutes.map((value) => ({ value, label: `${value} мин` }));
  const importance = reference.planImportance.map((value) => ({
    value,
    label: value >= 3 ? "Только высокая" : "Средняя и высокая",
  }));
  return (
    <section className="tc-section nc-plan" aria-labelledby="nc-plan-title">
      <div className="tc-section__head">
        <h2 className="tc-section__title" id="nc-plan-title">
          Мой план по новостям
        </h2>
        {status}
      </div>
      <p className="tc-caption">Решение о торговле на новости принимается до её выхода. План говорит, когда вы не входите.</p>

      <div className="tc-fields nc-plan__fields">
        <div className="tc-field" data-span="full">
          <label className="tc-label" htmlFor={newsFieldId("timeZone")}>
            Часовой пояс
          </label>
          <select
            id={newsFieldId("timeZone")}
            className="tc-input nc-select"
            value={draft.timeZone}
            disabled={saving}
            aria-invalid={errors.timeZone ? true : undefined}
            aria-describedby={[errors.timeZone ? errorId("timeZone") : null, "nc-zone-note"].filter(Boolean).join(" ")}
            onChange={(event) => onZone(event.target.value)}
          >
            {zoneOptions(draft.timeZone, savedZone).map((option) => (
              <option key={option.zone} value={option.zone}>
                {zoneWords(option.zone, now)}
              </option>
            ))}
          </select>
          <p className="tc-note" id="nc-zone-note">
            Всё время на странице показано в выбранном поясе.
          </p>
          <FieldError id={errorId("timeZone")} message={errors.timeZone} />
        </div>

        <Segmented
          field="minImportance"
          label="Какие новости закрывают вход"
          options={importance}
          value={draft.minImportance}
          disabled={saving}
          errors={errors}
          onPick={onImportance}
        />
        <Segmented
          field="minutesBefore"
          label="Не входить до выхода"
          options={minutes}
          value={draft.minutesBefore}
          disabled={saving}
          errors={errors}
          onPick={(value) => onMinutes("minutesBefore", value)}
        />
        <Segmented
          field="minutesAfter"
          label="Только наблюдать после выхода"
          options={minutes}
          value={draft.minutesAfter}
          disabled={saving}
          errors={errors}
          onPick={(value) => onMinutes("minutesAfter", value)}
        />

        <div className="tc-field" data-span="full">
          <span className="tc-label" id={newsFieldId("currencies")}>
            Валюты моих активов
          </span>
          <div
            className="nc-chips"
            role="group"
            aria-labelledby={newsFieldId("currencies")}
            aria-describedby={errors.currencies ? errorId("currencies") : undefined}
          >
            {reference.currencies.map((code) => {
              const on = draft.currencies.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  className="nc-chip"
                  aria-pressed={on}
                  data-on={on || undefined}
                  disabled={saving}
                  onClick={() => onCurrency(code)}
                >
                  {code}
                </button>
              );
            })}
          </div>
          <FieldError id={errorId("currencies")} message={errors.currencies} />
        </div>
      </div>

      <div className="tc-actions__row nc-plan__actions">
        <button type="button" className="tw-button" data-variant="primary" disabled={saving} onClick={onSave}>
          {saving ? "Сохраняю…" : "Сохранить план"}
        </button>
        {canRestore ? (
          <button type="button" className="tw-button" data-variant="ghost" disabled={saving} onClick={onRestore}>
            Вернуть план в силе
          </button>
        ) : null}
      </div>
    </section>
  );
}
