"use client";

/**
 * Risk Calculator (L15) — the working tool.
 *
 * THE LEARNER'S RISK PLAN, KEPT BY THE BACKEND IN VERSIONS. The learner types
 * four numbers — capital, payout, the share of risk per trade, the daily loss
 * limit — and sees the plan's arithmetic as they type: one trade's amount and
 * outcomes, the daily limit in losing trades, the break-even win rate, and
 * what five losses in a row cost at a fixed amount and when doubling. The
 * scenario and the cancel condition, written in advance, complete the plan.
 *
 *   no plan yet      → an empty form                 «Сохранить Risk Plan»
 *   a plan in force  → the form holds it; any change can be saved as the next
 *                      version, or put back          «Вернуть план в силе»
 *
 * Earlier versions stay under the plan, newest first. Nothing is deleted.
 *
 * NO STOP, NO BALANCE. Binary options risk the whole amount of a trade. The
 * capital is the learner's own number for the plan; ATA never reads Pocket.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { NormalizedError } from "@/lib/api/errors";
import type { ToolFailure } from "../tools-client-core";
import { fetchRiskState, saveRiskPlan } from "./risk-client";
import {
  draftInputs,
  draftMatchesPlan,
  draftOfPlan,
  emptyRiskDraft,
  numbersOfPlan,
  riskFieldMessage,
  riskFieldOfServerDetail,
  riskNumbers,
  validateRiskDraft,
  versionTime,
  type RiskDraft,
  type RiskErrors,
  type RiskField,
  type RiskPlan,
  type RiskReference,
  type RiskState,
} from "./risk-model";
import { RiskParams, RiskResults, RiskRules, RiskStreak, RiskVersions, riskFieldId } from "./risk-parts";

type Phase =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "locked" }
  | { kind: "ready"; reference: RiskReference };

/** The fields in reading order: the first one in error takes the focus. */
const FIELD_ORDER: readonly RiskField[] = [
  "capital",
  "payoutPercent",
  "dailyLimitPercent",
  "riskPercent",
  "scenario",
  "cancelCondition",
];

function fieldSelector(field: RiskField): string {
  return field === "riskPercent" ? `[aria-labelledby="${riskFieldId(field)}"] button` : `#${riskFieldId(field)}`;
}

function messageFor(error: NormalizedError): string {
  switch (error.category) {
    case "NETWORK_ERROR":
    case "BACKEND_UNAVAILABLE":
      return "Нет связи с Академией. Проверьте интернет и попробуйте ещё раз.";
    case "RATE_LIMITED":
      return "Слишком много действий подряд. Подождите минуту и попробуйте снова.";
    case "UNAUTHENTICATED":
      return "Сессия закончилась. Войдите снова — сохранённый план останется в силе.";
    default:
      return "Не получилось. Попробуйте ещё раз.";
  }
}

/* False during the server's render and hydration, true in the browser after it:
   a version's time is the learner's own clock, which the server does not have. */
const subscribeNever = () => () => {};
function useInBrowser(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/**
 * `initialState` is the server's first read of the plan. With it, the tool
 * arrives already drawn; without it (the read failed, or fixture mode), the
 * tool reads from the browser.
 */
export function RiskWorkspace({ initialState = null }: { initialState?: RiskState | null }) {
  const [phase, setPhase] = useState<Phase>(() =>
    initialState ? { kind: "ready", reference: initialState.reference } : { kind: "loading" },
  );
  const [plan, setPlan] = useState<RiskPlan | null>(initialState?.plan ?? null);
  const [history, setHistory] = useState<readonly RiskPlan[]>(initialState?.history ?? []);
  const [draft, setDraft] = useState<RiskDraft>(() =>
    initialState?.plan ? draftOfPlan(initialState.plan) : emptyRiskDraft(),
  );
  const [errors, setErrors] = useState<RiskErrors>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const inBrowser = useInBrowser();

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  /* The first field in error takes the focus once it is on screen. */
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    document.querySelector<HTMLElement>(target)?.focus();
  });

  const applyState = useCallback((response: Awaited<ReturnType<typeof fetchRiskState>>) => {
    if (!response.ok) {
      if (response.error.code === "TOOL_LOCKED") setPhase({ kind: "locked" });
      else setPhase({ kind: "failed", message: messageFor(response.error) });
      return;
    }
    const state = response.data;
    setPhase({ kind: "ready", reference: state.reference });
    setPlan(state.plan);
    setHistory(state.history);
    setDraft(state.plan ? draftOfPlan(state.plan) : emptyRiskDraft());
    setErrors({});
  }, []);

  /* The first read, when the server could not make it. */
  const serverRead = initialState !== null;
  useEffect(() => {
    if (serverRead) return;
    let cancelled = false;
    void fetchRiskState().then((response) => {
      if (!cancelled) applyState(response);
    });
    return () => {
      cancelled = true;
    };
  }, [applyState, serverRead]);

  const reload = useCallback(async () => {
    setPhase({ kind: "loading" });
    applyState(await fetchRiskState());
  }, [applyState]);

  const handleFailure = useCallback((failure: ToolFailure) => {
    if (failure.error.code === "TOOL_LOCKED") {
      setPhase({ kind: "locked" });
      return;
    }
    const field = riskFieldOfServerDetail(failure.detail);
    if (field) {
      setErrors((current) => ({ ...current, [field]: riskFieldMessage(field) }));
      pendingFocus.current = fieldSelector(field);
      return;
    }
    setActionError(messageFor(failure.error));
  }, []);

  if (phase.kind === "loading") {
    return (
      <div className="tw-quiet" role="status">
        <p className="tw-quiet__line">Загружаю Risk Plan…</p>
      </div>
    );
  }
  if (phase.kind === "locked") {
    return (
      <div className="tw-quiet">
        <h2 className="tw-quiet__title">Инструмент закрыт</h2>
        <p className="tw-quiet__line">Risk Calculator пока закрыт: он откроется по ходу пути, после уровня, указанного на странице «Инструменты».</p>
        <Link className="tw-button" data-variant="outline" href="/path">
          Продолжить путь
        </Link>
      </div>
    );
  }
  if (phase.kind === "failed") {
    return (
      <div className="tw-quiet" role="alert">
        <p className="tw-quiet__line">{phase.message}</p>
        <button type="button" className="tw-button" data-variant="outline" onClick={() => void reload()}>
          Повторить
        </button>
      </div>
    );
  }

  const shares = phase.reference.riskShares;
  const inputs = draftInputs(draft, shares);
  const unchanged = plan !== null && draftMatchesPlan(draft, plan, shares);
  /* The plan in force shows the Backend's own figures; a changed form, its own. */
  const numbers = unchanged && plan ? numbersOfPlan(plan) : inputs ? riskNumbers(inputs) : null;

  const onField = (field: RiskField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setActionError(null);
  };

  const save = async () => {
    if (busy) return;
    const checked = validateRiskDraft(draft, shares);
    if (!checked.ok) {
      setErrors(checked.errors);
      const first = FIELD_ORDER.find((field) => checked.errors[field] !== undefined);
      if (first) pendingFocus.current = fieldSelector(first);
      return;
    }
    setBusy(true);
    setActionError(null);
    const response = await saveRiskPlan(checked.plan);
    setBusy(false);
    if (!response.ok) {
      handleFailure(response);
      return;
    }
    const saved = response.data;
    const grew = saved.plan !== null && saved.plan.version !== plan?.version;
    setPlan(saved.plan);
    setHistory(saved.history);
    if (saved.plan) setDraft(draftOfPlan(saved.plan));
    setErrors({});
    showToast(grew && saved.plan ? `Risk Plan сохранён · версия ${saved.plan.version}` : "План не изменился");
  };

  const putBack = () => {
    if (!plan) return;
    setDraft(draftOfPlan(plan));
    setErrors({});
    setActionError(null);
  };

  const since = plan && inBrowser ? versionTime(plan.createdAt, new Date()) : null;

  return (
    <div className="rk">
      {/* A phone reads the numbers, their arithmetic, the rules, then the save;
          from 900px the numbers and the rules stand on the left and the
          arithmetic beside them. */}
      <div className="rk-layout">
        <div className="rk-col" data-col="inputs">
          <RiskParams
            draft={draft}
            shares={shares}
            errors={errors}
            disabled={busy}
            onChange={onField}
            status={
              plan ? (
                <p className="rk-in-force">
                  {/* Lime only while the form shows the plan in force. */}
                  {unchanged ? (
                    <span className="tc-status">В силе · версия {plan.version}</span>
                  ) : (
                    <span className="rk-in-force__changed">Версия {plan.version} · изменения не сохранены</span>
                  )}
                  {unchanged && since ? <span className="rk-in-force__since">с {since}</span> : null}
                </p>
              ) : null
            }
          />
          <RiskRules draft={draft} errors={errors} disabled={busy} onChange={onField} />
        </div>
        <div className="rk-col" data-col="results">
          <RiskResults
            numbers={numbers}
            capitalMinor={inputs?.capitalMinor ?? null}
            riskPercent={inputs?.riskPercent ?? null}
          />
          <RiskStreak numbers={numbers} capitalMinor={inputs?.capitalMinor ?? null} />
          <section className="tc-section tc-actions rk-actions" aria-label="Сохранение Risk Plan">
            <div className="tc-actions__row">
              <button
                type="button"
                className="tw-button"
                data-variant="primary"
                onClick={() => void save()}
                disabled={busy || unchanged}
              >
                {busy ? "Сохраняю…" : "Сохранить Risk Plan"}
              </button>
              {plan && !unchanged ? (
                <button type="button" className="tw-button" data-variant="ghost" onClick={putBack} disabled={busy}>
                  Вернуть план в силе
                </button>
              ) : null}
            </div>
            <p className="tc-caption">
              {plan
                ? unchanged
                  ? "Это план в силе. Измените параметры или правила — и сохраните новую версию."
                  : "Изменения не сохранены. Новая версия станет планом в силе, прежняя останется в истории."
                : "План хранится в ATA и открывается на любом устройстве."}
            </p>
            {actionError ? (
              <p className="tc-error" role="alert">
                {actionError}
              </p>
            ) : null}
          </section>
        </div>
      </div>

      <RiskVersions
        history={history}
        open={historyOpen}
        onToggle={() => setHistoryOpen((open) => !open)}
        timeOf={(iso) => (inBrowser ? versionTime(iso, new Date()) : null)}
      />

      <div className="tc-toast" role="status" aria-live="polite">
        {toast ? <span className="tc-toast__body">{toast}</span> : null}
      </div>
    </div>
  );
}
