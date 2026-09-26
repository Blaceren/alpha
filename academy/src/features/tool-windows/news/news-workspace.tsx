"use client";

/**
 * News Calendar (L30) — the working tool.
 *
 * THE LEARNER'S DAY, THEIR PLAN OVER IT. The day's releases in the learner's
 * own time zone, the windows their plan closes, and where they stand right
 * now: «Вход закрыт по вашему плану до 14:45». Lessons L26–L29.
 *
 * THE PLAN IS THE LEARNER'S. Nothing is chosen for them but their clock's
 * zone; until they save a plan there is no window, only the calendar. The
 * windows are always the SAVED plan's: a change on the form is a draft until
 * «Сохранить план». The zone on the form is what the page is shown in at once
 * («Всё время на странице показано в выбранном поясе»).
 *
 * THE CLOCK. Everything that depends on "now" — the status line, «сейчас» on
 * the timeline, «прошло / скоро» — is drawn in the browser and redrawn every
 * half minute. The server draws the day its first read allows.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { NormalizedError } from "@/lib/api/errors";
import { fetchNewsCalendar, saveNewsPlan } from "./news-client";
import {
  addDays,
  browserTimeZone,
  closedWindows,
  dayBounds,
  dayIn,
  draftMatchesPlan,
  draftOfNewsPlan,
  emptyNewsPlanDraft,
  newsNow,
  planSummary,
  validateNewsPlanDraft,
  type NewsCalendarState,
  type NewsEvent,
  type NewsPlan,
  type NewsPlanDraft,
  type NewsPlanErrors,
  type NewsReference,
} from "./news-model";
import { NewsDayNav, NewsEvents, NewsNowLine, NewsPlanForm, NewsTimeline, newsFieldId } from "./news-parts";

/** How far the day stepper goes: a week back to read the facts, two weeks ahead to plan. */
const DAYS_BACK = 7;
const DAYS_AHEAD = 14;
const TICK_MS = 30_000;

type Phase = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "locked" } | { kind: "ready" };
type Loaded = { readonly from: number; readonly to: number; readonly events: readonly NewsEvent[] };

function messageFor(error: NormalizedError): string {
  switch (error.category) {
    case "NETWORK_ERROR":
    case "BACKEND_UNAVAILABLE":
      return "Нет связи с ATA. Проверьте интернет и попробуйте ещё раз.";
    case "RATE_LIMITED":
      return "Слишком много действий подряд. Подождите минуту и попробуйте снова.";
    case "UNAUTHENTICATED":
      return "Сессия закончилась. Войдите снова.";
    default:
      return "Не получилось. Попробуйте ещё раз.";
  }
}

const subscribeNever = () => () => {};
/** The browser's own zone once the page is in the browser; null on the server and in the first render. */
function useBrowserZone(): string | null {
  return useSyncExternalStore(subscribeNever, browserTimeZone, () => null);
}

/* The browser's clock in half-minute steps; null on the server and in the first render. */
function subscribeClock(onChange: () => void): () => void {
  const timer = setInterval(onChange, TICK_MS);
  return () => clearInterval(timer);
}
const clockSnapshot = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const noClock = () => null;

function useClock(): number | null {
  return useSyncExternalStore(subscribeClock, clockSnapshot, noClock);
}

/**
 * `initialState` is the server's first read (now ± 36 h); `initialDay` is the
 * learner's today in their saved plan's zone, worked out by the server, so the
 * first render in the browser matches the server's. Without a plan the server
 * cannot know the day, and the browser draws it.
 */
export function NewsWorkspace({
  initialState = null,
  initialDay = null,
}: {
  initialState?: NewsCalendarState | null;
  initialDay?: string | null;
}) {
  const [phase, setPhase] = useState<Phase>(() => (initialState ? { kind: "ready" } : { kind: "loading" }));
  const [plan, setPlan] = useState<NewsPlan | null>(initialState?.plan ?? null);
  const [reference, setReference] = useState<NewsReference | null>(initialState?.reference ?? null);
  const [loaded, setLoaded] = useState<readonly Loaded[]>(() =>
    initialState
      ? [{ from: Date.parse(initialState.window.from), to: Date.parse(initialState.window.to), events: initialState.events }]
      : [],
  );
  /* Without a saved plan the zone is not chosen yet (""): the page reads in the browser's own. */
  const [draft, setDraft] = useState<NewsPlanDraft>(() =>
    initialState?.plan ? draftOfNewsPlan(initialState.plan) : emptyNewsPlanDraft(""),
  );
  const [errors, setErrors] = useState<NewsPlanErrors>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [offset, setOffset] = useState(0);
  const [dayFailure, setDayFailure] = useState<{ readonly key: string; readonly message: string } | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const now = useClock();
  const browserZone = useBrowserZone();

  /** One short line at the bottom, announced once; gone by itself. */
  const say = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  /* The first read, when the server could not make it. */
  const serverRead = initialState !== null;
  useEffect(() => {
    if (serverRead) return;
    let cancelled = false;
    void fetchNewsCalendar(null).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        setPhase(response.error.code === "TOOL_LOCKED" ? { kind: "locked" } : { kind: "failed", message: messageFor(response.error) });
        return;
      }
      const state = response.data;
      setPlan(state.plan);
      setReference(state.reference);
      setLoaded([{ from: Date.parse(state.window.from), to: Date.parse(state.window.to), events: state.events }]);
      setDraft(state.plan ? draftOfNewsPlan(state.plan) : emptyNewsPlanDraft(""));
      setPhase({ kind: "ready" });
    });
    return () => {
      cancelled = true;
    };
  }, [serverRead]);

  useEffect(() => {
    if (!pendingFocus.current) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });

  /* The page is shown in the zone on the form — the browser's own until one is chosen — and the day follows it. */
  const zone = draft.timeZone || browserZone || "UTC";
  const today = now !== null ? dayIn(now, zone) : initialDay && plan && plan.timeZone === zone ? initialDay : null;
  const day = today ? addDays(today, offset) : null;
  const bounds = useMemo(() => (day ? dayBounds(day, zone) : null), [day, zone]);

  const dayEvents = useMemo(() => {
    if (!bounds) return null;
    const range = loaded.find((candidate) => candidate.from <= bounds.from && candidate.to >= bounds.to);
    if (!range) return null;
    return range.events.filter((event) => {
      const at = Date.parse(event.releaseAt);
      return at >= bounds.from && at < bounds.to;
    });
  }, [bounds, loaded]);

  /* A day the reads so far do not cover is read on its own. */
  const dayKey = bounds ? `${bounds.from}-${bounds.to}` : null;
  useEffect(() => {
    if (phase.kind !== "ready" || !bounds || dayEvents !== null || !dayKey) return;
    let cancelled = false;
    void fetchNewsCalendar(bounds).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        setDayFailure({ key: dayKey, message: messageFor(response.error) });
        return;
      }
      setLoaded((current) => [...current, { from: bounds.from, to: bounds.to, events: response.data.events }]);
    });
    return () => {
      cancelled = true;
    };
  }, [phase.kind, bounds, dayEvents, dayKey]);

  const dayFailed = dayFailure && dayFailure.key === dayKey ? dayFailure.message : null;

  const windows = useMemo(() => {
    const everything = loaded.flatMap((range) => range.events);
    const unique = [...new Map(everything.map((event) => [event.slug, event])).values()];
    return closedWindows(unique, plan);
  }, [loaded, plan]);

  const save = useCallback(async () => {
    if (!reference) return;
    const checked = validateNewsPlanDraft({ ...draft, timeZone: zone }, reference);
    if (!checked.ok) {
      setErrors(checked.errors);
      const first = (["timeZone", "minImportance", "minutesBefore", "minutesAfter", "currencies"] as const).find(
        (field) => checked.errors[field],
      );
      if (first) pendingFocus.current = newsFieldId(first);
      return;
    }
    setErrors({});
    setSaving(true);
    const response = await saveNewsPlan(checked.plan);
    setSaving(false);
    if (!response.ok) {
      if (response.error.code === "TOOL_LOCKED") setPhase({ kind: "locked" });
      else say(messageFor(response.error));
      return;
    }
    const saved = response.data.plan;
    say(saved && plan && saved.version === plan.version ? "Этот план уже в силе" : "План сохранён");
    setPlan(saved);
    if (saved) setDraft(draftOfNewsPlan(saved));
  }, [draft, plan, reference, say, zone]);

  if (phase.kind === "loading") {
    return (
      <div className="tw-quiet" role="status">
        <p className="tw-quiet__line">Загружаю календарь…</p>
      </div>
    );
  }
  if (phase.kind === "locked") {
    return (
      <div className="tw-quiet">
        <h2 className="tw-quiet__title">Инструмент закрыт</h2>
        <p className="tw-quiet__line">News Calendar открывается после контрольной точки уровня 30.</p>
      </div>
    );
  }
  if (phase.kind === "failed" || !reference) {
    return (
      <div className="tw-quiet" role="alert">
        <p className="tw-quiet__line">{phase.kind === "failed" ? phase.message : "Не получилось. Попробуйте ещё раз."}</p>
        <button type="button" className="tw-button" data-variant="outline" onClick={() => window.location.reload()}>
          Повторить
        </button>
      </div>
    );
  }

  const inForce = plan !== null && draftMatchesPlan({ ...draft, timeZone: zone }, plan);
  const status = plan ? (
    inForce ? (
      <span className="tc-status">План в силе · версия {plan.version}</span>
    ) : (
      <span className="nc-draft">Изменения не сохранены</span>
    )
  ) : (
    <span className="nc-draft">Не сохранён</span>
  );

  return (
    <div className="nc">
      <div className="nc-layout">
        <div className="nc-main">
          {now !== null && day === today && bounds ? (
            <NewsNowLine now={newsNow(windows, plan, now, bounds.to)} zone={zone} at={now} />
          ) : null}

          <section className="tc-section nc-day" aria-labelledby="nc-day-title">
            {day ? (
              <>
                <NewsDayNav
                  day={day}
                  today={today}
                  canBack={offset > -DAYS_BACK}
                  canForward={offset < DAYS_AHEAD}
                  onDay={(step) => setOffset((current) => (step === 0 ? 0 : current + step))}
                />
                {plan ? <p className="tc-caption nc-day__plan">По плану: {planSummary(plan)}</p> : null}
                {bounds && dayEvents !== null ? (
                  <>
                    <NewsTimeline day={day} bounds={bounds} zone={zone} windows={windows} events={dayEvents} plan={plan} now={now} />
                    <NewsEvents events={dayEvents} windows={windows} plan={plan} zone={zone} now={now} isToday={day === today} />
                  </>
                ) : dayFailed ? (
                  <p className="tc-error" role="alert">
                    {dayFailed}
                  </p>
                ) : (
                  <p className="tc-caption" role="status">
                    Загружаю этот день…
                  </p>
                )}
              </>
            ) : (
              <p className="tc-caption" role="status" id="nc-day-title">
                Определяю ваш день…
              </p>
            )}
          </section>
        </div>

        <aside className="nc-aside">
          <NewsPlanForm
            draft={{ ...draft, timeZone: zone }}
            reference={reference}
            savedZone={plan?.timeZone ?? null}
            errors={errors}
            status={status}
            saving={saving}
            canRestore={plan !== null && !inForce}
            now={now ?? Date.parse(initialState?.window.from ?? "2026-01-01T00:00:00.000Z")}
            onZone={(timeZone) => setDraft((current) => ({ ...current, timeZone }))}
            onImportance={(minImportance) => setDraft((current) => ({ ...current, minImportance }))}
            onMinutes={(field, value) => setDraft((current) => ({ ...current, [field]: value }))}
            onCurrency={(code) =>
              setDraft((current) => ({
                ...current,
                currencies: current.currencies.includes(code)
                  ? current.currencies.filter((candidate) => candidate !== code)
                  : [...current.currencies, code],
              }))
            }
            onSave={() => void save()}
            onRestore={() => {
              if (plan) setDraft(draftOfNewsPlan(plan));
              setErrors({});
            }}
          />
        </aside>
      </div>
      <div className="tc-toast" role="status" aria-live="polite">
        {toast ? <span className="tc-toast__body">{toast}</span> : null}
      </div>
    </div>
  );
}
