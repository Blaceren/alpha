"use client";

/**
 * Trading Journal (L10) — the working tool.
 *
 * THE LEARNER'S OWN RECORD, KEPT BY THE BACKEND. Two things arrive here: every
 * Trade Card saved after the journal opened (the Backend writes the entry in
 * the same step as the card), and trades the learner records by hand. Neither
 * is copied from Pocket; ATA never sees the account.
 *
 *   the list      → counts · filter · the trades, day by day, newest first
 *   an entry      → ПЛАН · ИСПОЛНЕНИЕ · ВЫВОД, the rules broken, and
 *                   «Разобрать сделку» / «Изменить разбор» · «Изменить запись»
 *                   · «Удалить»
 *   the review    → plan followed or broken, which rules, how it went, the
 *                   conclusion                                  «Сохранить разбор»
 *   «Новая запись» → a trade opened without a card, and its review
 *                                                              «Сохранить запись»
 *   «Изменить запись» → the same form over any entry, every field of it
 *                                                           «Сохранить изменения»
 *   «Удалить»     → asked in place, then gone                  «Удалить запись»
 *
 * THE RECORD IS THE LEARNER'S TO CORRECT AND TO DELETE (owner, 2026-10-01;
 * until then an entry from a card kept the card's trade and nothing was
 * deleted). Every entry opens in the form whole, whichever source it came
 * from, and every entry can be deleted. Neither reaches the Trade Card: the
 * card stays what it was when it was saved, the form says so, and a corrected
 * entry is marked «изменена в журнале». A delete is asked about first, because
 * it cannot be undone and takes the trade out of Personal Stats with it.
 *
 * NO MONEY TOTALS (DD-303/DD-304). Each line shows its own stake and result;
 * nothing adds them up. The counts are of entries, never of dollars.
 *
 * FROM A SAVED CARD. «Разобрать в журнале» on the Trade Card arrives with the
 * card's id, and that card's entry opens straight into its review.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import type { NormalizedError } from "@/lib/api/errors";
import type { ToolFailure } from "../tools-client-core";
import { changeJournalEntry, createJournalEntry, deleteJournalEntry, fetchJournalPage } from "./journal-client";
import {
  adjustSummary,
  draftResultMoney,
  emptyManualDraft,
  fieldMessage,
  fieldOfServerDetail,
  groupByDay,
  isReviewed,
  localDate,
  manualDraftOf,
  matchesFilter,
  neighbourOf,
  placeEntry,
  removeEntry,
  reviewDraftOf,
  summaryWithEntry,
  validateManual,
  validateReview,
  yearInViewOf,
  type DraftErrors,
  type JournalEntry,
  type JournalFilter,
  type JournalPage,
  type JournalReference,
  type JournalSummary,
  type ManualDraft,
  type ManualField,
  type PlanMark,
  type ReviewDraft,
} from "./journal-model";
import {
  JournalCounts,
  JournalDayHead,
  JournalDeleteConfirm,
  JournalFilterBar,
  JournalNote,
  JournalNotes,
  JournalRow,
  ManualOutcome,
  ManualPlanField,
  ManualTradeFields,
  ReviewFields,
  entryFacts,
} from "./journal-parts";

type Phase =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "locked" }
  | { kind: "ready"; reference: JournalReference };

/** The list's own traffic: a new filter's first page, or the next page. */
type ListStatus = "idle" | "loading" | "more" | "failed";

type Mode = { kind: "list" } | { kind: "create" } | { kind: "edit"; entry: JournalEntry };

const NEW_ENTRY_BUTTON_ID = "jr-new";
const FORM_TITLE_ID = "jr-form-title";
/** The prefix of the new-entry form's field ids, and of an entry's review's. */
const FORM_FIELDS = "jr-new";
const reviewFields = (entryId: string) => `jr-${entryId}`;
const rowId = (entryId: string) => `jr-row-${entryId}`;
const detailId = (entryId: string) => `jr-entry-${entryId}`;
/** «Удалить» on an open entry, and the «Отмена» of the question it asks. */
const deleteButtonId = (entryId: string) => `${reviewFields(entryId)}-delete`;
const deleteKeepId = (entryId: string) => `${reviewFields(entryId)}-delete-keep`;

/** The fields in reading order: the first one in error takes the focus. */
const FIELD_ORDER: readonly ManualField[] = [
  "tradeDate",
  "entryTime",
  "asset",
  "direction",
  "amount",
  "payoutPercent",
  "expiry",
  "result",
  "plan",
  "planMark",
  "violations",
  "execution",
  "conclusion",
];

/** Where a field in error takes the focus: the control, or a toggle's first option. */
function fieldSelector(prefix: string, field: ManualField): string {
  switch (field) {
    case "direction":
    case "result":
      return `[aria-labelledby="${prefix}-${field}"] button`;
    case "planMark":
      return `#${prefix}-mark-first`;
    case "violations":
      return `[aria-describedby="${prefix}-violations-error"] input`;
    default:
      return `#${prefix}-${field}`;
  }
}

function firstInvalid(prefix: string, errors: DraftErrors): string | null {
  const field = FIELD_ORDER.find((candidate) => errors[candidate] !== undefined);
  return field ? fieldSelector(prefix, field) : null;
}

/** The entry a saved Trade Card became, if it is on this page. */
function entryOfCard(entries: readonly JournalEntry[], cardId: string | null): JournalEntry | null {
  return cardId ? (entries.find((entry) => entry.tradeCardId === cardId) ?? null) : null;
}

function messageFor(error: NormalizedError): string {
  switch (error.category) {
    case "NETWORK_ERROR":
    case "BACKEND_UNAVAILABLE":
      return "Нет связи с ATA. Проверьте интернет и попробуйте ещё раз.";
    case "RATE_LIMITED":
      return "Слишком много действий подряд. Подождите минуту и попробуйте снова.";
    case "UNAUTHENTICATED":
      return "Сессия закончилась. Войдите снова — сохранённые записи останутся в журнале.";
    default:
      return "Не получилось. Попробуйте ещё раз.";
  }
}

const EMPTY_SUMMARY: JournalSummary = {
  total: 0,
  onPlan: 0,
  violated: 0,
  unmarked: 0,
  withoutConclusion: 0,
};
const EMPTY_REVIEW: ReviewDraft = {
  planMark: "",
  violations: [],
  execution: "",
  conclusion: "",
};

/**
 * `initialPage` is the server's first read of the journal. With it, the tool
 * arrives already drawn; without it (the read failed, or fixture mode), the
 * journal reads from the browser.
 *
 * `reviewCardId` is the saved Trade Card the learner came from: its entry
 * opens for review, focused on the first question.
 */
export function JournalWorkspace({
  initialPage = null,
  reviewCardId = null,
}: {
  initialPage?: JournalPage | null;
  reviewCardId?: string | null;
}) {
  const [cardEntry] = useState(() => (initialPage ? entryOfCard(initialPage.entries, reviewCardId) : null));
  const [phase, setPhase] = useState<Phase>(() =>
    initialPage ? { kind: "ready", reference: initialPage.reference } : { kind: "loading" },
  );
  const [summary, setSummary] = useState<JournalSummary>(initialPage?.summary ?? EMPTY_SUMMARY);
  const [filter, setFilter] = useState<JournalFilter>(initialPage?.filter ?? "all");
  const [entries, setEntries] = useState<readonly JournalEntry[]>(initialPage?.entries ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage?.nextCursor ?? null);
  const [listStatus, setListStatus] = useState<ListStatus>("idle");
  const [listError, setListError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set(cardEntry ? [cardEntry.id] : []));
  const [reviewId, setReviewId] = useState<string | null>(cardEntry?.id ?? null);
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft>(() =>
    cardEntry ? reviewDraftOf(cardEntry) : EMPTY_REVIEW,
  );
  /** The entry whose delete is being asked about; one question at a time. */
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [manualDraft, setManualDraft] = useState<ManualDraft | null>(null);
  const [today, setToday] = useState("");
  const [errors, setErrors] = useState<DraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Only the newest list request may land; an older one finishing later is dropped. */
  const listRequest = useRef(0);
  /** A selector for the element to focus once the next render is on screen. */
  const pendingFocus = useRef<string | null>(cardEntry ? `#${reviewFields(cardEntry.id)}-mark-first` : null);
  /** A card to review that the browser's first read still has to find. */
  const cardToReview = useRef<string | null>(initialPage ? null : reviewCardId);

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

  /* Focus follows the learner's action: into a form they opened, back to the
     line they were on when it closes, and to the first field in error. */
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    document.querySelector<HTMLElement>(target)?.focus();
  });

  /* The address has done its job once the entry is open: a reload shows the
     journal rather than that review again. */
  useEffect(() => {
    if (!reviewCardId) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("card")) return;
    url.searchParams.delete("card");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [reviewCardId]);

  /** Put a page read on screen as the list's new start. */
  const applyPage = useCallback((response: Awaited<ReturnType<typeof fetchJournalPage>>) => {
    if (!response.ok) {
      if (response.error.code === "TOOL_LOCKED") setPhase({ kind: "locked" });
      else setPhase({ kind: "failed", message: messageFor(response.error) });
      return;
    }
    const page = response.data;
    setPhase({ kind: "ready", reference: page.reference });
    setSummary(page.summary);
    setFilter(page.filter);
    setEntries(page.entries);
    setNextCursor(page.nextCursor);
    setListStatus("idle");
    setListError(null);
    const target = entryOfCard(page.entries, cardToReview.current);
    cardToReview.current = null;
    if (target) {
      setOpenIds(new Set([target.id]));
      setReviewId(target.id);
      setReviewDraft(reviewDraftOf(target));
      pendingFocus.current = `#${reviewFields(target.id)}-mark-first`;
    }
  }, []);

  /* The first read, when the server could not make it. */
  const serverRead = initialPage !== null;
  useEffect(() => {
    if (serverRead) return;
    let cancelled = false;
    const request = ++listRequest.current;
    void fetchJournalPage("all").then((response) => {
      if (!cancelled && request === listRequest.current) applyPage(response);
    });
    return () => {
      cancelled = true;
    };
  }, [applyPage, serverRead]);

  /** «Повторить» after a failed first read. */
  const reload = useCallback(async () => {
    setPhase({ kind: "loading" });
    const request = ++listRequest.current;
    const response = await fetchJournalPage("all");
    if (request === listRequest.current) applyPage(response);
  }, [applyPage]);

  /** A filter's first page. The counts stay on screen while it loads. */
  const loadFilter = useCallback(async (next: JournalFilter) => {
    const request = ++listRequest.current;
    setFilter(next);
    setListStatus("loading");
    setListError(null);
    setOpenIds(new Set());
    setReviewId(null);
    setDeleteId(null);
    const response = await fetchJournalPage(next);
    if (request !== listRequest.current) return;
    if (!response.ok) {
      if (response.error.code === "TOOL_LOCKED") {
        setPhase({ kind: "locked" });
        return;
      }
      setEntries([]);
      setNextCursor(null);
      setListStatus("failed");
      setListError(messageFor(response.error));
      return;
    }
    setSummary(response.data.summary);
    setEntries(response.data.entries);
    setNextCursor(response.data.nextCursor);
    setListStatus("idle");
  }, []);

  /** «Показать ещё»: the page after the last line on screen. */
  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    const request = ++listRequest.current;
    setListStatus("more");
    setListError(null);
    const response = await fetchJournalPage(filter, nextCursor);
    if (request !== listRequest.current) return;
    if (!response.ok) {
      if (response.error.code === "TOOL_LOCKED") {
        setPhase({ kind: "locked" });
        return;
      }
      // The line this page continues from was deleted somewhere else: there is
      // nothing to continue from, so the list is read again from its start.
      if (response.detail === "invalid_before") {
        void loadFilter(filter);
        showToast("Журнал изменился — показываю актуальный.");
        return;
      }
      setListStatus("failed");
      setListError(messageFor(response.error));
      return;
    }
    setSummary(response.data.summary);
    setEntries((current) => {
      const seen = new Set(current.map((entry) => entry.id));
      return [...current, ...response.data.entries.filter((entry) => !seen.has(entry.id))];
    });
    setNextCursor(response.data.nextCursor);
    setListStatus("idle");
  }, [filter, loadFilter, nextCursor, showToast]);

  /**
   * A refused write: a field error goes under its field; an entry that is no
   * longer there — deleted in another tab or on another device — reloads the list.
   */
  const handleFailure = useCallback(
    (failure: ToolFailure) => {
      const code = failure.error.code;
      if (code === "TOOL_LOCKED") {
        setPhase({ kind: "locked" });
        return;
      }
      if (code === "JOURNAL_ENTRY_NOT_FOUND") {
        setMode({ kind: "list" });
        setManualDraft(null);
        void loadFilter(filter);
        pendingFocus.current = `#${NEW_ENTRY_BUTTON_ID}`;
        showToast("Этой записи уже нет — показываю актуальный журнал.");
        return;
      }
      const field = fieldOfServerDetail(failure.detail);
      if (field) {
        setErrors((current) => ({ ...current, [field]: fieldMessage(field) }));
        const prefix = mode.kind !== "list" ? FORM_FIELDS : reviewId ? reviewFields(reviewId) : null;
        if (prefix) pendingFocus.current = fieldSelector(prefix, field);
        return;
      }
      setActionError(messageFor(failure.error));
    },
    [filter, loadFilter, mode.kind, reviewId, showToast],
  );

  if (phase.kind === "loading") {
    return (
      <div className="tw-quiet" role="status">
        <p className="tw-quiet__line">Загружаю журнал…</p>
      </div>
    );
  }
  if (phase.kind === "locked") {
    return (
      <div className="tw-quiet">
        <h2 className="tw-quiet__title">Инструмент закрыт</h2>
        <p className="tw-quiet__line">Trading Journal пока закрыт: он откроется по ходу пути, после уровня, указанного на странице «Инструменты».</p>
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

  const { reference } = phase;
  const hasMore = nextCursor !== null;

  const clearError = (field: keyof DraftErrors) =>
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });

  /* ------------------------------------------------------------ the list */

  const toggle = (entryId: string) => {
    // A question left open on an entry does not wait inside it once it is closed.
    if (deleteId === entryId && !busy) {
      setDeleteId(null);
      setActionError(null);
    }
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const startReview = (entry: JournalEntry) => {
    if (busy) return;
    setReviewId(entry.id);
    setReviewDraft(reviewDraftOf(entry));
    setDeleteId(null);
    setErrors({});
    setActionError(null);
    pendingFocus.current = `#${reviewFields(entry.id)}-mark-first`;
  };

  const closeReview = (entry: JournalEntry) => {
    setReviewId(null);
    setErrors({});
    setActionError(null);
    pendingFocus.current = `#${rowId(entry.id)}`;
  };

  const saveReview = async (entry: JournalEntry) => {
    if (busy) return;
    const checked = validateReview(reviewDraft);
    if (!checked.ok) {
      setErrors(checked.errors);
      pendingFocus.current = firstInvalid(reviewFields(entry.id), checked.errors);
      return;
    }
    setBusy(true);
    setActionError(null);
    const response = await changeJournalEntry(entry.id, {
      kind: "review",
      ...checked.review,
    });
    setBusy(false);
    if (!response.ok) {
      handleFailure(response);
      return;
    }
    const saved = response.data;
    setEntries((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    setSummary((current) => adjustSummary(current, entry, saved));
    closeReview(saved);
    showToast("Разбор сохранён");
  };

  /* ------------------------------------------------ the hand-recorded trade */

  const startCreate = () => {
    const now = new Date();
    setToday(localDate(now));
    setManualDraft(emptyManualDraft(now));
    setMode({ kind: "create" });
    setErrors({});
    setActionError(null);
    pendingFocus.current = `#${FORM_TITLE_ID}`;
  };

  const startEdit = (entry: JournalEntry) => {
    if (busy) return;
    setToday(localDate(new Date()));
    setManualDraft(manualDraftOf(entry));
    setMode({ kind: "edit", entry });
    setDeleteId(null);
    setErrors({});
    setActionError(null);
    pendingFocus.current = `#${FORM_TITLE_ID}`;
  };

  /** Back to the list, the focus on `focusId`. */
  const leaveForm = (focusId: string) => {
    setMode({ kind: "list" });
    setManualDraft(null);
    setErrors({});
    setActionError(null);
    pendingFocus.current = `#${focusId}`;
  };

  const submitManual = async () => {
    if (busy || !manualDraft) return;
    const checked = validateManual(manualDraft, reference, new Date());
    if (!checked.ok) {
      setErrors(checked.errors);
      pendingFocus.current = firstInvalid(FORM_FIELDS, checked.errors);
      return;
    }
    setBusy(true);
    setActionError(null);
    const editing = mode.kind === "edit" ? mode.entry : null;
    const response = editing
      ? await changeJournalEntry(editing.id, {
          kind: "entry",
          ...checked.entry,
        })
      : await createJournalEntry(checked.entry);
    setBusy(false);
    if (!response.ok) {
      handleFailure(response);
      return;
    }
    const saved = response.data;
    let shown = false;
    if (editing) {
      setSummary((current) => adjustSummary(current, editing, saved));
      const placed = placeEntry(entries, saved, hasMore);
      shown = placed.some((item) => item.id === saved.id);
      setEntries(placed);
    } else {
      setSummary((current) => summaryWithEntry(current, saved));
      if (matchesFilter(saved, filter)) {
        const placed = placeEntry(entries, saved, hasMore);
        shown = placed.some((item) => item.id === saved.id);
        setEntries(placed);
      }
    }
    if (shown) setOpenIds((current) => new Set(current).add(saved.id));
    leaveForm(shown ? rowId(saved.id) : NEW_ENTRY_BUTTON_ID);
    showToast(editing ? "Запись изменена" : "Запись добавлена");
  };

  /* ------------------------------------------------------------ the delete */

  /** «Удалить»: the question opens in the entry, the focus on the way out of it. */
  const askDelete = (entry: JournalEntry) => {
    if (busy) return;
    setDeleteId(entry.id);
    setActionError(null);
    pendingFocus.current = `#${deleteKeepId(entry.id)}`;
  };

  const cancelDelete = (entry: JournalEntry) => {
    setDeleteId(null);
    setActionError(null);
    pendingFocus.current = `#${deleteButtonId(entry.id)}`;
  };

  /**
   * «Удалить запись». The counts are the Backend's own, read in the step that
   * deleted; the line leaves the list, and the focus goes to the line that
   * takes its place.
   */
  const confirmDelete = async (entry: JournalEntry) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    const response = await deleteJournalEntry(entry.id);
    setBusy(false);
    if (!response.ok) {
      // The buttons were disabled while the request was out; the focus returns
      // to the question, on its safe side.
      pendingFocus.current = `#${deleteKeepId(entry.id)}`;
      handleFailure(response);
      return;
    }
    const left = removeEntry(entries, entry.id, nextCursor);
    const neighbour = neighbourOf(entries, entry.id);
    setSummary(response.data);
    setDeleteId(null);
    setOpenIds((current) => {
      if (!current.has(entry.id)) return current;
      const next = new Set(current);
      next.delete(entry.id);
      return next;
    });
    setEntries(left.entries);
    setNextCursor(left.nextCursor);
    // Nothing on screen while the journal still has entries: read the list again
    // rather than show an emptiness that is not there.
    const reread = left.reread || (left.entries.length === 0 && filter === "all" && response.data.total > 0);
    if (reread) void loadFilter(filter);
    pendingFocus.current = !reread && neighbour ? `#${rowId(neighbour.id)}` : `#${NEW_ENTRY_BUTTON_ID}`;
    showToast("Запись удалена");
  };

  const errorLine = actionError ? (
    <p className="tc-error" role="alert">
      {actionError}
    </p>
  ) : null;

  /* ------------------------------------------------------------- the form */

  let body: ReactNode;
  if (mode.kind !== "list" && manualDraft) {
    const editing = mode.kind === "edit" ? mode.entry : null;
    const onTrade = (field: Exclude<keyof ManualDraft, keyof ReviewDraft>, value: string) => {
      setManualDraft((current) => (current ? { ...current, [field]: value } : current));
      clearError(field);
      setActionError(null);
    };
    body = (
      <div className="jr-form">
        <div className="jr-form__head">
          <h2 className="jr-form__title" id={FORM_TITLE_ID} tabIndex={-1}>
            {editing ? "Изменить запись" : "Новая запись"}
          </h2>
          <p className="jr-form__lede">
            {editing
              ? editing.source === "trade_card"
                ? "Запись из Trade Card. Исправьте то, что записано неточно: изменения останутся в журнале, сама карточка не изменится."
                : "Запись сделки, сделанная вручную. Исправьте то, что было записано неточно."
              : "Сделка, которую вы открыли в Pocket без карточки, — так, как она прошла."}
          </p>
        </div>

        <div className="tc-layout">
          <div className="tc-main">
            <section className="tc-section" aria-labelledby="jr-trade-title">
              <h3 className="tc-section__title" id="jr-trade-title">
                Сделка
              </h3>
              <ManualTradeFields
                draft={manualDraft}
                reference={reference}
                errors={errors}
                disabled={busy}
                maxDate={today}
                onChange={onTrade}
              />
              <ManualOutcome money={draftResultMoney(manualDraft)} />
              <ManualPlanField
                value={manualDraft.plan}
                error={errors.plan}
                disabled={busy}
                onChange={(value) => onTrade("plan", value)}
              />
            </section>
          </div>

          <div className="tc-aside jr-form__aside">
            <section className="tc-section" aria-labelledby="jr-review-title">
              <h3 className="tc-section__title" id="jr-review-title">
                Разбор
              </h3>
              <ReviewFields
                idPrefix={FORM_FIELDS}
                draft={manualDraft}
                reference={reference}
                errors={errors}
                disabled={busy}
                onMark={(planMark: PlanMark) => {
                  setManualDraft((current) => (current ? { ...current, planMark } : current));
                  clearError("violations");
                }}
                onRule={(code, on) =>
                  setManualDraft((current) =>
                    current
                      ? {
                          ...current,
                          violations: on
                            ? [...current.violations, code]
                            : current.violations.filter((item) => item !== code),
                        }
                      : current,
                  )
                }
                onText={(field, value) => {
                  setManualDraft((current) => (current ? { ...current, [field]: value } : current));
                  clearError(field);
                }}
              />
            </section>

            <section className="tc-section tc-actions" aria-label="Сохранение записи">
              <div className="tc-actions__row">
                <button
                  type="button"
                  className="tw-button"
                  data-variant="primary"
                  onClick={() => void submitManual()}
                  disabled={busy}
                >
                  {busy ? "Сохраняю…" : editing ? "Сохранить изменения" : "Сохранить запись"}
                </button>
                <button
                  type="button"
                  className="tw-button"
                  data-variant="ghost"
                  onClick={() => leaveForm(editing ? rowId(editing.id) : NEW_ENTRY_BUTTON_ID)}
                  disabled={busy}
                >
                  Отмена
                </button>
              </div>
              {errorLine}
            </section>
          </div>
        </div>
      </div>
    );
  } else if (summary.total === 0) {
    /* ------------------------------------------------------- the empty list */
    body = (
      <div className="tw-quiet jr-empty">
        <h2 className="tw-quiet__title">Журнал пока пуст</h2>
        <p className="tw-quiet__line">
          {/* «Только новые» (the journal's own rule): a card saved before the journal
              opened never arrives, so the line no longer promises it does
              (2026-10-04, launch audit). */}
          Карточки Trade Card, сохранённые после открытия журнала, попадут сюда сами. Сделку без карточки — или из более
          ранней карточки — можно записать вручную.
        </p>
        <div className="tc-actions__row jr-empty__actions">
          <button
            id={NEW_ENTRY_BUTTON_ID}
            type="button"
            className="tw-button"
            data-variant="primary"
            onClick={startCreate}
          >
            Записать сделку
          </button>
          <Link className="tw-button" data-variant="outline" href="/tools/trade-card">
            Открыть Trade Card
          </Link>
        </div>
      </div>
    );
  } else {
    /* ------------------------------------------------------------ the list */
    body = <>{renderList()}</>;
  }

  return (
    <div className="jr">
      {body}
      <div className="tc-toast" role="status" aria-live="polite">
        {toast ? <span className="tc-toast__body">{toast}</span> : null}
      </div>
    </div>
  );

  function renderList() {
    const days = groupByDay(entries);
    const yearInView = yearInViewOf(entries);
    return (
      <>
        <div className="jr-top">
          <JournalCounts summary={summary} />
          <button
            id={NEW_ENTRY_BUTTON_ID}
            type="button"
            className="tw-button jr-top__new"
            data-variant="outline"
            onClick={startCreate}
          >
            <Plus aria-hidden="true" size={16} strokeWidth={2} />
            Новая запись
          </button>
        </div>

        <JournalFilterBar
          filter={filter}
          summary={summary}
          onChange={(next) => {
            if (next !== filter || listStatus === "failed") void loadFilter(next);
          }}
        />

        {/* While a filter's page loads, the lines already on screen stay, dimmed,
            so the territory does not collapse and spring back. */}
        <div
          className="jr-list"
          aria-busy={listStatus === "loading" || listStatus === "more"}
          data-stale={(listStatus === "loading" && entries.length > 0) || undefined}
        >
          {/* One status region, there before anything is said in it. */}
          <p className="tw-sr-only" role="status">
            {listStatus === "loading" ? "Загружаю записи…" : ""}
          </p>
          {listStatus === "loading" && entries.length === 0 ? (
            <p className="tw-quiet__line jr-list__note" aria-hidden="true">
              Загружаю записи…
            </p>
          ) : listStatus === "failed" && entries.length === 0 ? (
            <div className="jr-list__note" role="alert">
              <p className="tw-quiet__line">{listError}</p>
              <button type="button" className="tw-link-button" onClick={() => void loadFilter(filter)}>
                Повторить
              </button>
            </div>
          ) : entries.length === 0 ? (
            <div className="jr-list__note">
              <p className="tw-quiet__line">
                {filter === "violated" ? "Записей с нарушенным планом нет." : "Вывод записан у каждой сделки."}
              </p>
              <button type="button" className="tw-link-button" onClick={() => void loadFilter("all")}>
                Показать все записи
              </button>
            </div>
          ) : (
            days.map((day) => (
              <section className="jr-day" key={day.tradeDate} aria-labelledby={`jr-day-${day.tradeDate}`}>
                <JournalDayHead tradeDate={day.tradeDate} yearInView={yearInView} />
                <ul className="jr-entries">
                  {day.entries.map((entry) => {
                    const open = openIds.has(entry.id);
                    const reviewing = reviewId === entry.id;
                    const reviewed = isReviewed(entry);
                    const deleting = deleteId === entry.id;
                    return (
                      <li className="jr-entry" key={entry.id} data-open={open || undefined}>
                        <JournalRow
                          id={rowId(entry.id)}
                          entry={entry}
                          open={open}
                          controls={detailId(entry.id)}
                          onToggle={() => toggle(entry.id)}
                        />
                        <div className="jr-detail" id={detailId(entry.id)} hidden={!open}>
                          {reviewing ? (
                            <div className="jr-detail__review">
                              <dl className="jr-notes">
                                <JournalNote term="План" text={entry.plan} empty="Причина входа не записана" />
                              </dl>
                              <ReviewFields
                                idPrefix={reviewFields(entry.id)}
                                draft={reviewDraft}
                                reference={reference}
                                errors={errors}
                                disabled={busy}
                                onMark={(planMark) => {
                                  setReviewDraft((current) => ({
                                    ...current,
                                    planMark,
                                  }));
                                  clearError("violations");
                                }}
                                onRule={(code, on) =>
                                  setReviewDraft((current) => ({
                                    ...current,
                                    violations: on
                                      ? [...current.violations, code]
                                      : current.violations.filter((item) => item !== code),
                                  }))
                                }
                                onText={(field, value) => {
                                  setReviewDraft((current) => ({
                                    ...current,
                                    [field]: value,
                                  }));
                                  clearError(field);
                                }}
                              />
                              <div className="tc-actions__row jr-detail__actions">
                                <button
                                  type="button"
                                  className="tw-button"
                                  data-variant="primary"
                                  onClick={() => void saveReview(entry)}
                                  disabled={busy}
                                >
                                  {busy ? "Сохраняю…" : "Сохранить разбор"}
                                </button>
                                <button
                                  type="button"
                                  className="tw-button"
                                  data-variant="ghost"
                                  onClick={() => closeReview(entry)}
                                  disabled={busy}
                                >
                                  Отмена
                                </button>
                              </div>
                              {errorLine}
                            </div>
                          ) : (
                            <>
                              <JournalNotes entry={entry} reference={reference} />
                              <p className="jr-facts">{entryFacts(entry)}</p>
                              {deleting ? (
                                <JournalDeleteConfirm
                                  idPrefix={reviewFields(entry.id)}
                                  fromCard={entry.source === "trade_card"}
                                  busy={busy}
                                  error={errorLine}
                                  onConfirm={() => void confirmDelete(entry)}
                                  onCancel={() => cancelDelete(entry)}
                                />
                              ) : (
                                <div className="tc-actions__row jr-detail__actions jr-entry-actions">
                                  <button
                                    type="button"
                                    className="tw-button"
                                    data-variant={reviewed ? "outline" : "primary"}
                                    onClick={() => startReview(entry)}
                                  >
                                    {reviewed ? "Изменить разбор" : "Разобрать сделку"}
                                  </button>
                                  <button
                                    type="button"
                                    className="tw-button"
                                    data-variant="outline"
                                    onClick={() => startEdit(entry)}
                                  >
                                    Изменить запись
                                  </button>
                                  <button
                                    id={deleteButtonId(entry.id)}
                                    type="button"
                                    className="tw-button jr-detail__delete"
                                    data-variant="danger"
                                    onClick={() => askDelete(entry)}
                                  >
                                    <Trash2 aria-hidden="true" size={16} strokeWidth={2} />
                                    Удалить
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}

          {hasMore && listStatus !== "loading" && !(listStatus === "failed" && entries.length === 0) ? (
            <div className="jr-more">
              <button
                type="button"
                className="tw-button"
                data-variant="outline"
                onClick={() => void loadMore()}
                disabled={listStatus === "more"}
              >
                {listStatus === "more" ? "Загружаю…" : "Показать ещё"}
              </button>
              {listStatus === "failed" ? (
                <p className="tc-error" role="alert">
                  {listError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </>
    );
  }
}
