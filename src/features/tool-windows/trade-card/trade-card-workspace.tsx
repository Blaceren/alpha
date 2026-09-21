"use client";

/**
 * Trade Card (L5) — the working window.
 *
 * ONE CARD AT A TIME, KEPT BY THE BACKEND. The learner fixes a plan, opens the
 * trade in Pocket themselves, and comes back to record the result. The open
 * card lives on the server, so closing the tab, reloading, or opening it on
 * another device resumes the same card. There is no local copy to lose.
 *
 *   no open card  → the plan form               «Зафиксировать план»
 *   fixed         → the plan, read-only, then
 *                   the result and observation  «Сохранить карточку»
 *                                               «Изменить план» · «Сделку не открывал»
 *   just saved    → the saved notice            «Новая карточка»
 *
 * ATA OPENS NO TRADE. Nothing here talks to Pocket, and the copy says so at the
 * one moment the learner might wonder: under the fix button.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { NormalizedError } from "@/lib/api/errors";
import {
  changeTradeCard,
  fetchTradeCardState,
  fixTradePlan,
  type TradeCardFailure,
} from "./trade-card-client";
import {
  draftFromCard,
  draftOutcomes,
  emptyDraft,
  fieldOfServerDetail,
  fieldMessage,
  hhmm,
  hhmmss,
  savedSummary,
  tradeCardStep,
  tradeWindow,
  validateDraft,
  TRADE_CARD_LIMITS,
  type DraftErrors,
  type DraftField,
  type TradeCard,
  type TradeCardDraft,
  type TradeCardReference,
  type TradeResult,
} from "./trade-card-model";
import {
  TradeCardOutcomes,
  TradeCardPlanForm,
  TradeCardSavedNotice,
  TradeCardStepper,
} from "./trade-card-parts";

type Phase =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "locked" }
  | { kind: "ready"; reference: TradeCardReference };

type View =
  /** Writing a new plan, or re-writing the fixed one («Изменить план»). */
  | { kind: "form"; editing: TradeCard | null }
  | { kind: "fixed"; card: TradeCard }
  | { kind: "saved"; card: TradeCard };

function messageFor(error: NormalizedError): string {
  switch (error.category) {
    case "NETWORK_ERROR":
    case "BACKEND_UNAVAILABLE":
      return "Нет связи с ATA. Проверьте интернет и попробуйте ещё раз.";
    case "RATE_LIMITED":
      return "Слишком много действий подряд. Подождите минуту и попробуйте снова.";
    case "UNAUTHENTICATED":
      return "Сессия закончилась. Войдите снова — план сохранится, если он уже зафиксирован.";
    default:
      return "Не получилось. Попробуйте ещё раз.";
  }
}

export function TradeCardWorkspace() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [view, setView] = useState<View>({ kind: "form", editing: null });
  const [draft, setDraft] = useState<TradeCardDraft>(() => emptyDraft(new Date()));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [result, setResult] = useState<TradeResult | null>(null);
  const [observation, setObservation] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  /* The steps follow the learner's own clock, so it has to tick. */
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(timer);
  }, []);

  /** Put a read's answer on screen. */
  const applyState = useCallback((response: Awaited<ReturnType<typeof fetchTradeCardState>>) => {
    if (!response.ok) {
      setPhase(response.error.code === "TOOL_LOCKED" ? { kind: "locked" } : { kind: "failed", message: messageFor(response.error) });
      return;
    }
    const { card, reference } = response.data;
    setPhase({ kind: "ready", reference });
    if (card) {
      setView({ kind: "fixed", card });
      setResult(null);
      setObservation("");
    } else {
      setView({ kind: "form", editing: null });
      setDraft(emptyDraft(new Date()));
    }
  }, []);

  /* The first read. One that finishes after the window unmounted is dropped
     by the `cancelled` flag, the same guard the other learner surfaces use. */
  useEffect(() => {
    let cancelled = false;
    void fetchTradeCardState().then((response) => {
      if (!cancelled) applyState(response);
    });
    return () => {
      cancelled = true;
    };
  }, [applyState]);

  /** «Повторить», and the re-read after another tab moved the card on. */
  const reload = useCallback(async () => {
    setPhase({ kind: "loading" });
    applyState(await fetchTradeCardState());
  }, [applyState]);

  /** A refused write: a field error goes under its field, a stale card reloads. */
  const handleFailure = useCallback(
    (failure: TradeCardFailure) => {
      const code = failure.error.code;
      if (code === "TOOL_LOCKED") {
        setPhase({ kind: "locked" });
        return;
      }
      if (code === "TRADE_CARD_OPEN_EXISTS" || code === "TRADE_CARD_STATE_CONFLICT" || code === "TRADE_CARD_NOT_FOUND") {
        // Another tab or device moved the card on. Show what is true now.
        void reload();
        showToast("Карточка изменилась в другой вкладке — показываю актуальную.");
        return;
      }
      const field = fieldOfServerDetail(failure.detail);
      if (field) {
        setErrors((current) => ({ ...current, [field]: fieldMessage(field) }));
        return;
      }
      setActionError(messageFor(failure.error));
    },
    [reload, showToast],
  );

  if (phase.kind === "loading") {
    return (
      <div className="tw-state" role="status">
        <p className="tw-state__line">Загружаю карточку…</p>
      </div>
    );
  }
  if (phase.kind === "locked") {
    return (
      <div className="tw-state">
        <p className="tw-state__title">Инструмент закрыт</p>
        <p className="tw-state__line">Trade Card открывается после урока L5. Вернитесь к пути, чтобы продолжить.</p>
      </div>
    );
  }
  if (phase.kind === "failed") {
    return (
      <div className="tw-state" role="alert">
        <p className="tw-state__line">{phase.message}</p>
        <button type="button" className="tw-button" data-variant="outline" onClick={() => void reload()}>
          Повторить
        </button>
      </div>
    );
  }

  const { reference } = phase;

  const onField = (field: DraftField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setActionError(null);
  };

  const submitPlan = async () => {
    if (busy) return;
    const checked = validateDraft(draft, reference);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setBusy(true);
    setActionError(null);
    const editing = view.kind === "form" ? view.editing : null;
    const response = editing
      ? await changeTradeCard(editing.id, { action: "refix", plan: checked.plan })
      : await fixTradePlan(checked.plan);
    setBusy(false);
    if (!response.ok) {
      handleFailure(response);
      return;
    }
    setErrors({});
    setView({ kind: "fixed", card: response.data });
    setResult(null);
    setObservation("");
    showToast(editing ? "План изменён" : "План зафиксирован");
  };

  const saveCard = async (card: TradeCard) => {
    if (busy || result === null) return;
    setBusy(true);
    setActionError(null);
    const note = observation.trim();
    const response = await changeTradeCard(card.id, {
      action: "save",
      result,
      observation: note.length > 0 ? note : null,
    });
    setBusy(false);
    if (!response.ok) {
      handleFailure(response);
      return;
    }
    setView({ kind: "saved", card: response.data });
    showToast("Карточка сохранена");
  };

  const cancelCard = async (card: TradeCard) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    const response = await changeTradeCard(card.id, { action: "cancel" });
    setBusy(false);
    setConfirmCancel(false);
    if (!response.ok) {
      handleFailure(response);
      return;
    }
    startNewCard();
    showToast("Карточка закрыта без сделки");
  };

  const startNewCard = () => {
    setView({ kind: "form", editing: null });
    setDraft(emptyDraft(new Date()));
    setErrors({});
    setResult(null);
    setObservation("");
    setActionError(null);
  };

  const fixedCard = view.kind === "fixed" ? view.card : null;
  const step = view.kind === "saved" ? 5 : tradeCardStep(fixedCard, now, fixedCard ? result : null);
  const stepHint = fixedCard ? hintFor(fixedCard, now, result) : null;

  const shownDraft = view.kind === "form" ? draft : draftFromCard(view.card);
  const outcomes = view.kind === "form" ? draftOutcomes(draft) : view.card.outcomes;

  return (
    <div className="tw-card">
      <div className="tw-card__steps">
        <TradeCardStepper step={step} />
        {stepHint ? <p className="tw-card__hint">{stepHint}</p> : null}
      </div>

      <TradeCardPlanForm
        draft={shownDraft}
        reference={reference}
        errors={view.kind === "form" ? errors : {}}
        disabled={view.kind !== "form" || busy}
        onChange={onField}
        fixedAtLabel={view.kind === "form" ? null : hhmm(new Date(view.card.fixedAt))}
      />

      <TradeCardOutcomes outcomes={outcomes} />

      {view.kind === "form" ? (
        <section className="tw-section tw-actions" aria-label="Фиксация плана">
          <button type="button" className="tw-button" data-variant="primary" data-wide onClick={() => void submitPlan()} disabled={busy}>
            {busy ? "Фиксирую…" : view.editing ? "Зафиксировать новый план" : "Зафиксировать план"}
          </button>
          {view.editing ? (
            <button
              type="button"
              className="tw-button"
              data-variant="ghost"
              onClick={() => setView({ kind: "fixed", card: view.editing! })}
              disabled={busy}
            >
              Оставить прежний план
            </button>
          ) : null}
          <p className="tw-caption">Сделку вы открываете сами в Pocket — ATA сделки не открывает.</p>
          {actionError ? (
            <p className="tw-field__error" role="alert">
              {actionError}
            </p>
          ) : null}
        </section>
      ) : null}

      {view.kind === "fixed" ? (
        <>
          <section className="tw-section" aria-labelledby="tc-result-title">
            <h2 className="tw-label" id="tc-result-title">
              Результат после экспирации
            </h2>
            <div className="tw-segmented" role="radiogroup" aria-labelledby="tc-result-title">
              {(["profit", "loss"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={result === value}
                  className="tw-segmented__option"
                  data-selected={result === value || undefined}
                  onClick={() => setResult(value)}
                  disabled={busy}
                >
                  {value === "profit" ? "Прибыль" : "Убыток"}
                </button>
              ))}
            </div>

            <label className="tw-label" htmlFor="tc-observation">
              Наблюдение после сделки
            </label>
            <textarea
              id="tc-observation"
              className="tw-input tw-textarea"
              rows={3}
              maxLength={TRADE_CARD_LIMITS.observationMax}
              placeholder="Что произошло и что это значит для следующего решения"
              value={observation}
              onChange={(event) => setObservation(event.target.value)}
              disabled={busy}
            />
          </section>

          <section className="tw-section tw-actions" aria-label="Действия с карточкой">
            <div className="tw-actions__row">
              <button
                type="button"
                className="tw-button"
                data-variant="primary"
                onClick={() => void saveCard(view.card)}
                disabled={busy || result === null}
                aria-describedby={result === null ? "tc-save-hint" : undefined}
              >
                {busy ? "Сохраняю…" : "Сохранить карточку"}
              </button>
              <button
                type="button"
                className="tw-button"
                data-variant="outline"
                onClick={() => {
                  setDraft(draftFromCard(view.card));
                  setErrors({});
                  setView({ kind: "form", editing: view.card });
                }}
                disabled={busy}
              >
                Изменить план
              </button>
            </div>
            {result === null ? (
              <p className="tw-caption" id="tc-save-hint">
                Отметьте результат, чтобы сохранить карточку.
              </p>
            ) : null}

            {confirmCancel ? (
              <div className="tw-confirm" role="group" aria-label="Закрыть карточку без сделки">
                <p className="tw-caption">Карточка закроется без результата. План останется в истории.</p>
                <div className="tw-actions__row">
                  <button type="button" className="tw-button" data-variant="outline" onClick={() => void cancelCard(view.card)} disabled={busy}>
                    Да, сделку не открывал
                  </button>
                  <button type="button" className="tw-button" data-variant="ghost" onClick={() => setConfirmCancel(false)} disabled={busy}>
                    Назад
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="tw-link-button" onClick={() => setConfirmCancel(true)} disabled={busy}>
                Сделку не открывал
              </button>
            )}
            {actionError ? (
              <p className="tw-field__error" role="alert">
                {actionError}
              </p>
            ) : null}
          </section>
        </>
      ) : null}

      {view.kind === "saved" ? (
        <section className="tw-section tw-actions" aria-label="Карточка сохранена">
          <TradeCardSavedNotice summary={savedSummary(view.card)} />
          <div className="tw-actions__row">
            <button type="button" className="tw-button" data-variant="outline" onClick={startNewCard}>
              Новая карточка
            </button>
          </div>
        </section>
      ) : null}

      <div className="tw-toast" role="status" aria-live="polite">
        {toast ? <span className="tw-toast__body">{toast}</span> : null}
      </div>
    </div>
  );
}

/** One line under the steps that says what the learner does now. */
function hintFor(card: TradeCard, now: Date, result: TradeResult | null): string {
  if (result !== null) return "Запишите наблюдение и сохраните карточку.";
  const window = tradeWindow(card.plan.entryTime, card.plan.expiry.seconds, now);
  if (!window) return "Откройте сделку в Pocket по плану.";
  if (now < window.opensAt) return `Откройте сделку в Pocket в ${card.plan.entryTime} по плану.`;
  if (now < window.expiresAt) return `Экспирация в ${hhmmss(window.expiresAt)}. Результат отметите после неё.`;
  return "Экспирация прошла — отметьте результат.";
}
