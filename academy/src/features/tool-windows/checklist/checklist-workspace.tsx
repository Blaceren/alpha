"use client";

/**
 * Entry Checklist (L20) — the working tool.
 *
 * ENTER OR SKIP, BEFORE THE BUTTON IS PRESSED. The learner picks the asset,
 * ticks the nine fixed items they can confirm, and the verdict follows each
 * tick: a stop factor left open says «не входить» whatever else holds; any
 * other open item says so too; all nine allow the entry by plan. «Записать
 * проверку» keeps the check as it was — a declined trade included, because
 * declining is a full decision (L08) — and clears the ticks for the next one.
 *
 * NOTHING IS TICKED FOR THE LEARNER. No item is read from Pocket, a news feed or
 * another tool; the checklist opens with every item open.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { NormalizedError } from "@/lib/api/errors";
import type { ToolFailure } from "../tools-client-core";
import { fetchChecklistState, saveEntryCheck } from "./checklist-client";
import {
  checkTime,
  checklistFieldMessage,
  checklistFieldOfServerDetail,
  checklistVerdict,
  confirmedCount,
  emptyAnswers,
  emptyChecklistDraft,
  itemLabel,
  parseMinPayout,
  validateChecklistDraft,
  type ChecklistDraft,
  type ChecklistErrors,
  type ChecklistField,
  type ChecklistState,
  type EntryCheck,
} from "./checklist-model";
import {
  ChecklistGroups,
  ChecklistProgress,
  ChecklistRecent,
  ChecklistSubject,
  ChecklistVerdictPanel,
  checklistFieldId,
} from "./checklist-parts";

type Phase =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "locked" }
  | { kind: "ready"; state: ChecklistState };

function messageFor(error: NormalizedError): string {
  switch (error.category) {
    case "NETWORK_ERROR":
    case "BACKEND_UNAVAILABLE":
      return "Нет связи с ATA. Проверьте интернет и попробуйте ещё раз.";
    case "RATE_LIMITED":
      return "Слишком много действий подряд. Подождите минуту и попробуйте снова.";
    case "UNAUTHENTICATED":
      return "Сессия закончилась. Войдите снова — записанные проверки останутся.";
    default:
      return "Не получилось. Попробуйте ещё раз.";
  }
}

/* False during the server's render and hydration, true in the browser after it:
   a check's time is the learner's own clock, which the server does not have. */
const subscribeNever = () => () => {};
function useInBrowser(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/**
 * `initialState` is the server's first read. With it, the tool arrives already
 * drawn; without it (the read failed, or fixture mode), the tool reads from the
 * browser.
 */
export function ChecklistWorkspace({ initialState = null }: { initialState?: ChecklistState | null }) {
  const [phase, setPhase] = useState<Phase>(() =>
    initialState ? { kind: "ready", state: initialState } : { kind: "loading" },
  );
  const [recent, setRecent] = useState<readonly EntryCheck[]>(initialState?.recent ?? []);
  const [draft, setDraft] = useState<ChecklistDraft>(() =>
    initialState ? emptyChecklistDraft(initialState) : { asset: "", minPayoutPercent: "", answers: {} },
  );
  const [errors, setErrors] = useState<ChecklistErrors>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
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

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    document.getElementById(target)?.focus();
  });

  const applyState = useCallback((response: Awaited<ReturnType<typeof fetchChecklistState>>) => {
    if (!response.ok) {
      if (response.error.code === "TOOL_LOCKED") setPhase({ kind: "locked" });
      else setPhase({ kind: "failed", message: messageFor(response.error) });
      return;
    }
    setPhase({ kind: "ready", state: response.data });
    setRecent(response.data.recent);
    setDraft(emptyChecklistDraft(response.data));
    setErrors({});
  }, []);

  /* The first read, when the server could not make it. */
  const serverRead = initialState !== null;
  useEffect(() => {
    if (serverRead) return;
    let cancelled = false;
    void fetchChecklistState().then((response) => {
      if (!cancelled) applyState(response);
    });
    return () => {
      cancelled = true;
    };
  }, [applyState, serverRead]);

  const reload = useCallback(async () => {
    setPhase({ kind: "loading" });
    applyState(await fetchChecklistState());
  }, [applyState]);

  const handleFailure = useCallback((failure: ToolFailure) => {
    if (failure.error.code === "TOOL_LOCKED") {
      setPhase({ kind: "locked" });
      return;
    }
    const field = checklistFieldOfServerDetail(failure.detail);
    if (field) {
      setErrors((current) => ({ ...current, [field]: checklistFieldMessage(field) }));
      pendingFocus.current = checklistFieldId(field);
      return;
    }
    setActionError(messageFor(failure.error));
  }, []);

  if (phase.kind === "loading") {
    return (
      <div className="tw-quiet" role="status">
        <p className="tw-quiet__line">Загружаю чек-лист…</p>
      </div>
    );
  }
  if (phase.kind === "locked") {
    return (
      <div className="tw-quiet">
        <h2 className="tw-quiet__title">Инструмент закрыт</h2>
        <p className="tw-quiet__line">Entry Checklist открывается после контрольной точки уровня 20.</p>
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

  const { state } = phase;
  const { items, groups } = state.checklist;
  const minimum = parseMinPayout(draft.minPayoutPercent) ?? null;
  const { verdict, missingItem } = checklistVerdict(items, draft.answers);
  const asset = state.reference.assets.find((candidate) => candidate.code === draft.asset) ?? null;
  const anyTicked = confirmedCount(items, draft.answers) > 0;

  const onField = (field: ChecklistField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setActionError(null);
  };

  const onToggle = (code: string, on: boolean) => {
    setDraft((current) => ({ ...current, answers: { ...current.answers, [code]: on } }));
    setActionError(null);
  };

  const clearTicks = () => setDraft((current) => ({ ...current, answers: emptyAnswers(items) }));

  const save = async () => {
    if (busy) return;
    const checked = validateChecklistDraft(draft, state);
    if (!checked.ok) {
      setErrors(checked.errors);
      const first = (["asset", "minPayoutPercent"] as const).find((field) => checked.errors[field] !== undefined);
      if (first) pendingFocus.current = checklistFieldId(first);
      return;
    }
    setBusy(true);
    setActionError(null);
    const response = await saveEntryCheck(checked.check);
    setBusy(false);
    if (!response.ok) {
      handleFailure(response);
      return;
    }
    setRecent(response.data.recent);
    // The next trade starts with every item open again; the asset and the
    // minimum stay, as most learners check the same pair again.
    clearTicks();
    showToast(response.data.check.verdict === "enter" ? "Проверка записана · вход допустим" : "Проверка записана · не входить");
  };

  return (
    <div className="ck">
      <div className="ck-layout">
        <div className="ck-col" data-col="items">
          <ChecklistSubject
            draft={draft}
            reference={state.reference}
            errors={errors}
            disabled={busy}
            onChange={onField}
          />
          <ChecklistProgress items={items} answers={draft.answers} assetLabel={asset?.label ?? null} />
          <ChecklistGroups
            groups={groups}
            items={items}
            answers={draft.answers}
            minPayoutPercent={minimum}
            disabled={busy}
            onToggle={onToggle}
          />
        </div>
        <div className="ck-col" data-col="verdict">
          <ChecklistVerdictPanel
            verdict={anyTicked ? verdict : null}
            missingLabel={missingItem ? itemLabel(missingItem, minimum) : null}
          />
          <div className="tc-actions ck-actions">
            <div className="tc-actions__row">
              <button
                type="button"
                className="tw-button"
                data-variant="primary"
                onClick={() => void save()}
                disabled={busy}
              >
                {busy ? "Записываю…" : "Записать проверку"}
              </button>
              {anyTicked ? (
                <button type="button" className="tw-button" data-variant="ghost" onClick={clearTicks} disabled={busy}>
                  Снять отметки
                </button>
              ) : null}
            </div>
            <p className="tc-caption">
              Проверка записывается как есть — и «не входить» тоже: отказ от сделки остаётся в истории.
            </p>
            {actionError ? (
              <p className="tc-error" role="alert">
                {actionError}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <ChecklistRecent
        recent={recent}
        items={items}
        timeOf={(iso) => (inBrowser ? checkTime(iso, new Date()) : null)}
      />

      <div className="tc-toast" role="status" aria-live="polite">
        {toast ? <span className="tc-toast__body">{toast}</span> : null}
      </div>
    </div>
  );
}
