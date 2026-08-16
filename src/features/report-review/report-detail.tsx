"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { ReportFields } from "./report-fields";
import { RubricForm, emptyRubricValues, toReviewScores, validateRubric, type RubricValues } from "./rubric-form";
import {
  approveSubmission,
  claimSubmission,
  fetchReviewDetail,
  requestRevision,
  type ApprovalOutcome,
  type CommandOutcome,
  type DetailOutcome,
} from "@/application/api/report-review-client";
import type { ApprovalResult, ReviewDetail } from "@/data/contracts/api/report-review";

/**
 * The report review detail workspace.
 *
 * ## The claim step is contract, not choice
 *
 * The Backend releases the report payload **only** to the holder of the active
 * claim: before claiming, detail answers `access: "summary"` with `payload: null`.
 * So the flow is queue → detail(summary) → claim → detail(full). The summary tier
 * is what supplies the three CAS versions the claim command needs.
 *
 * ## Idempotency keys are minted once per decision attempt
 *
 * Each key is generated when the reviewer opens a confirmation dialog and reused
 * for every retry of *that* decision. A key generated per request would make each
 * retry a new command — exactly the duplicate the contract prevents. Rapid double
 * clicks are additionally guarded by an in-flight ref, because a disabled button
 * is an affordance, not a guarantee.
 *
 * ## Server authority
 *
 * CRM issues no completion write and computes no unlock. `L3 completed` and
 * `L4 available` are read from the Backend's approval receipt.
 */

export type DecisionKind = "approve" | "revision";

export type DetailState =
  | { kind: "loading" }
  | { kind: "ready"; detail: ReviewDetail }
  | { kind: "claiming" }
  | { kind: "submitting"; decision: DecisionKind }
  | { kind: "approved"; result: ApprovalResult }
  | { kind: "revision_requested" }
  | { kind: "stale"; code: string }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "flag_disabled" }
  | { kind: "not_found" }
  | { kind: "error"; retryable: boolean };

function failureToState(outcome: { status: string; code?: string }): DetailState {
  switch (outcome.status) {
    case "unauthenticated":
      return { kind: "unauthorized" };
    case "forbidden":
      return { kind: "forbidden" };
    case "flag_disabled":
      return { kind: "flag_disabled" };
    case "not_found":
      return { kind: "not_found" };
    case "conflict":
      return { kind: "stale", code: outcome.code ?? "REPORT_CONFLICT" };
    case "upstream_unavailable":
    case "rate_limited":
      return { kind: "error", retryable: true };
    default:
      return { kind: "error", retryable: false };
  }
}

/** A key that is stable for one decision attempt and valid per the backend pattern. */
function mintIdempotencyKey(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `crm-${prefix}-${Date.now().toString(36)}-${random}`;
}

function Panel({
  title,
  description,
  role = "status",
  children,
}: {
  title: string;
  description: string;
  role?: "status" | "alert";
  children?: React.ReactNode;
}) {
  return (
    <div role={role} className="rounded-lg border border-border bg-surface p-6">
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      <p className="mt-2 max-w-prose text-sm text-text-secondary">{description}</p>
      {children}
    </div>
  );
}

export interface ReportDetailProps {
  submissionRef: string;
  onBack: () => void;
  /** Injection seams for tests. */
  fetchDetailImpl?: typeof fetchReviewDetail;
  claimImpl?: typeof claimSubmission;
  approveImpl?: typeof approveSubmission;
  requestRevisionImpl?: typeof requestRevision;
}

export function ReportDetail({
  submissionRef,
  onBack,
  fetchDetailImpl = fetchReviewDetail,
  claimImpl = claimSubmission,
  approveImpl = approveSubmission,
  requestRevisionImpl = requestRevision,
}: ReportDetailProps) {
  const [state, setState] = React.useState<DetailState>({ kind: "loading" });
  const [rubric, setRubric] = React.useState<RubricValues>({});
  const [showErrors, setShowErrors] = React.useState(false);
  const [confirming, setConfirming] = React.useState<DecisionKind | null>(null);
  const [reasonCode, setReasonCode] = React.useState("");
  const [feedback, setFeedback] = React.useState("");
  const [correctiveAction, setCorrectiveAction] = React.useState("");

  const inFlight = React.useRef(false);
  /** Minted when a confirmation opens; reused for every retry of that decision. */
  const decisionKey = React.useRef<string | null>(null);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const restoreFocusTo = React.useRef<HTMLElement | null>(null);

  const load = React.useCallback(async () => {
    const outcome: DetailOutcome = await fetchDetailImpl(submissionRef);
    if (outcome.status !== "success") {
      setState(failureToState(outcome));
      return;
    }
    setState({ kind: "ready", detail: outcome.detail });
    if (outcome.detail.payload) {
      // Seed rubric slots for whatever criteria the backend published, without
      // discarding anything the reviewer has already typed.
      setRubric((current) =>
        Object.keys(current).length === 0 ? emptyRubricValues(outcome.detail.payload!.rubric) : current,
      );
    }
  }, [fetchDetailImpl, submissionRef]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const detail = state.kind === "ready" ? state.detail : null;
  const payload = detail?.payload ?? null;

  /**
   * The optimistic-concurrency tuple, memoized on the three values it is built
   * from. Without the memo a fresh object every render would invalidate the claim
   * and decision callbacks on every render — which is both wasteful and a real
   * hazard for a ref-guarded submit path.
   */
  const workflowVersion = detail?.workflowVersion;
  const claimVersion = detail?.claimVersion;
  const submittedRevision = detail?.submittedRevision;
  const cas = React.useMemo(
    () =>
      workflowVersion === undefined || claimVersion === undefined || submittedRevision === undefined
        ? null
        : {
            expectedWorkflowVersion: workflowVersion,
            expectedClaimVersion: claimVersion,
            expectedSubmittedRevision: submittedRevision,
          },
    [workflowVersion, claimVersion, submittedRevision],
  );

  /* ------------------------------------------------------------------ claim */

  const onClaim = React.useCallback(async () => {
    if (inFlight.current || !cas) return;
    inFlight.current = true;
    setState({ kind: "claiming" });
    try {
      const outcome: CommandOutcome = await claimImpl(submissionRef, cas, mintIdempotencyKey("claim"));
      if (outcome.status !== "success") {
        setState(failureToState(outcome));
        return;
      }
      // Refetch rather than patching local state: the canonical record is the
      // server's, and the claim just advanced two CAS versions.
      await load();
    } finally {
      inFlight.current = false;
    }
  }, [cas, claimImpl, load, submissionRef]);

  /* --------------------------------------------------------------- decision */

  const openConfirm = (kind: DecisionKind, trigger: HTMLElement | null) => {
    if (!payload) return;
    const validation = validateRubric(payload.rubric, rubric);
    // Approval requires a complete rubric. A revision request carries scores too
    // (the backend's reject command takes the same evidence), so the same gate
    // applies — the difference is the reason, comment and corrective action.
    if (!validation.complete) {
      setShowErrors(true);
      return;
    }
    if (kind === "revision" && (!reasonCode || !feedback.trim() || !correctiveAction.trim())) {
      setShowErrors(true);
      return;
    }
    restoreFocusTo.current = trigger;
    decisionKey.current = mintIdempotencyKey(kind === "approve" ? "approve" : "reject");
    setConfirming(kind);
  };

  const closeConfirm = React.useCallback(() => {
    setConfirming(null);
    // Return focus to whatever opened the dialog.
    restoreFocusTo.current?.focus();
  }, []);

  // Focus the dialog on open and support Escape to dismiss.
  React.useEffect(() => {
    if (!confirming) return;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeConfirm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming, closeConfirm]);

  const submitDecision = React.useCallback(
    async (kind: DecisionKind) => {
      if (inFlight.current || !cas || !payload) return;
      const key = decisionKey.current;
      if (!key) return;

      inFlight.current = true;
      setConfirming(null);
      setState({ kind: "submitting", decision: kind });

      try {
        const scores = toReviewScores(payload.rubric, rubric);
        if (kind === "approve") {
          const outcome: ApprovalOutcome = await approveImpl(submissionRef, { ...cas, scores }, key);
          if (outcome.status !== "success") {
            setState(failureToState(outcome));
            return;
          }
          setState({ kind: "approved", result: outcome.result });
        } else {
          const outcome: CommandOutcome = await requestRevisionImpl(
            submissionRef,
            {
              ...cas,
              scores,
              reasonCode,
              humanComment: feedback.trim(),
              correctiveAction: correctiveAction.trim(),
            },
            key,
          );
          if (outcome.status !== "success") {
            setState(failureToState(outcome));
            return;
          }
          setState({ kind: "revision_requested" });
        }
      } finally {
        inFlight.current = false;
      }
    },
    [approveImpl, cas, correctiveAction, feedback, payload, reasonCode, requestRevisionImpl, rubric, submissionRef],
  );

  /* ----------------------------------------------------------------- render */

  const backButton = (
    <Button variant="secondary" onClick={onBack}>
      ← К очереди
    </Button>
  );

  if (state.kind === "loading") {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <p className="text-sm text-text-secondary">Загружаем отчёт…</p>
        <div className="h-24 animate-pulse rounded bg-elevated" />
      </div>
    );
  }

  if (state.kind === "forbidden") {
    return (
      <Panel
        role="alert"
        title="Нет доступа к проверке отчётов"
        description="Ваша учётная запись сотрудника не имеет прав наставника-проверяющего. Проверка доступна ролям «наставник» и «администратор»."
      >
        <div className="mt-4">{backButton}</div>
      </Panel>
    );
  }

  if (state.kind === "flag_disabled") {
    return (
      <Panel
        role="alert"
        title="Проверка отчётов отключена"
        description="Функция отчётов сейчас выключена на сервере."
      >
        <div className="mt-4">{backButton}</div>
      </Panel>
    );
  }

  if (state.kind === "unauthorized") {
    return (
      <Panel
        role="alert"
        title="Требуется вход"
        description="Сессия сотрудника не подтверждена. Войдите снова, чтобы продолжить проверку."
      />
    );
  }

  if (state.kind === "not_found") {
    return (
      <Panel
        role="alert"
        title="Отчёт недоступен"
        description="Отчёт не найден или больше не находится на проверке. Возможно, его уже проверил другой наставник."
      >
        <div className="mt-4">{backButton}</div>
      </Panel>
    );
  }

  if (state.kind === "stale") {
    return (
      <Panel
        role="alert"
        title="Отчёт изменился"
        description="Пока вы работали, состояние отчёта изменилось — например, решение принял другой наставник или ученик отправил новую ревизию. Ваше решение не применено. Откройте отчёт заново, чтобы увидеть актуальное состояние."
      >
        <p className="mt-2 font-mono text-2xs text-text-muted">{state.code}</p>
        <div className="mt-4 flex gap-2">
          <Button
            onClick={() => {
              setState({ kind: "loading" });
              void load();
            }}
          >
            Загрузить актуальное состояние
          </Button>
          {backButton}
        </div>
      </Panel>
    );
  }

  if (state.kind === "error") {
    return (
      <Panel
        role="alert"
        title="Не удалось выполнить операцию"
        description="Сервис проверки отчётов не ответил. Решение не применено."
      >
        <div className="mt-4 flex gap-2">
          {state.retryable ? (
            <Button
              onClick={() => {
                setState({ kind: "loading" });
                void load();
              }}
            >
              Повторить
            </Button>
          ) : null}
          {backButton}
        </div>
      </Panel>
    );
  }

  if (state.kind === "approved") {
    const c = state.result.completion;
    return (
      <div className="space-y-4">
        <div role="status" aria-live="polite" className="rounded-lg border border-success/40 bg-success/10 p-6">
          <h2 className="text-base font-semibold text-text-primary">Отчёт принят</h2>
          <p className="mt-2 text-sm text-text-secondary">
            Уровень {c.levelNumber} завершён на сервере.{" "}
            {c.nextLevelNumber === null
              ? "Следующих уровней нет."
              : `Уровень ${c.nextLevelNumber} стал доступен ученику.`}
          </p>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4 border-t border-border pt-2">
              <dt className="text-text-muted">Начислено XP</dt>
              <dd className="font-medium text-text-primary">{c.xpAwarded}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-2">
              <dt className="text-text-muted">Транзакция XP</dt>
              <dd className="font-medium text-text-primary">
                {c.xpTransactionId === null ? "не создана" : `#${c.xpTransactionId}`}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-2">
              <dt className="text-text-muted">Ревизия</dt>
              <dd className="text-text-secondary">№{state.result.submittedRevision}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-2">
              <dt className="text-text-muted">Завершено</dt>
              <dd className="text-text-secondary">{new Date(c.completedAt).toLocaleString("ru-RU")}</dd>
            </div>
          </dl>
          <p className="mt-3 text-2xs text-text-muted">
            Решение зафиксировано сервером{state.result.retry ? " (повтор того же запроса)" : ""}. Проверка №
            {state.result.reviewId}.
          </p>
        </div>
        {backButton}
      </div>
    );
  }

  if (state.kind === "revision_requested") {
    return (
      <div className="space-y-4">
        <div role="status" aria-live="polite" className="rounded-lg border border-warning/40 bg-warning/10 p-6">
          <h2 className="text-base font-semibold text-text-primary">Отправлено на доработку</h2>
          <p className="mt-2 max-w-prose text-sm text-text-secondary">
            Ученик получил замечания и может отправить исправленную ревизию. Уровень не завершён,
            следующий уровень остаётся закрытым, XP не начислен.
          </p>
        </div>
        {backButton}
      </div>
    );
  }

  if (state.kind === "claiming" || state.kind === "submitting") {
    const label =
      state.kind === "claiming"
        ? "Берём отчёт в работу…"
        : state.decision === "approve"
          ? "Принимаем отчёт…"
          : "Отправляем на доработку…";
    return (
      <div role="status" aria-live="assertive" className="rounded-lg border border-border bg-surface p-6">
        <p className="text-sm text-text-secondary">{label}</p>
      </div>
    );
  }

  // state.kind === "ready"
  const d = state.detail;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">
            Проверка отчёта — {payload ? payload.owner.displayName : "ученик скрыт"}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {payload ? `${payload.level.title} · уровень ${payload.level.levelNumber} · ` : ""}
            ревизия №{d.submittedRevision} · отправлен {new Date(d.submittedAt).toLocaleString("ru-RU")}
          </p>
        </div>
        {backButton}
      </header>

      {/* LO-REVIEW-WORKITEM-UNREACHABLE-1 §15 — the operational half.
          The specialized review view and the unified Learner Operations queue
          are two views of ONE piece of work, so this names the case, shows who
          owns it operationally and links to it. It carries no decision control:
          the educational outcome is decided below, by the canonical commands. */}
      {d.operationalWorkItem ? (
        <section
          aria-labelledby="operational-work-item"
          className="rounded-lg border border-border bg-surface p-4"
        >
          <h2 id="operational-work-item" className="text-sm font-semibold text-text-primary">
            Операционная карточка
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            <a className="underline" href={`/cases/${d.operationalWorkItem.caseId}`}>
              {d.operationalWorkItem.reference}
            </a>
            {" · "}
            {d.operationalWorkItem.assignedStaffDisplayName
              ? `исполнитель: ${d.operationalWorkItem.assignedStaffDisplayName}`
              : "исполнитель не назначен"}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            Очередь и SLA ведутся в «Операциях с учениками». Учебное решение принимается здесь.
          </p>
        </section>
      ) : null}

      {/* Revision timeline. Honest about what the contract exposes: the current
          submitted revision number and its timestamps. The reviewer API does not
          expose prior revision CONTENT or earlier mentor feedback, so none is
          fabricated here. */}
      <section aria-labelledby="revision-timeline" className="rounded-lg border border-border bg-surface p-4">
        <h2 id="revision-timeline" className="text-sm font-semibold text-text-primary">
          История ревизий
        </h2>
        <ol className="mt-2 space-y-1 text-sm text-text-secondary">
          {d.submittedRevision > 1 ? (
            <li>
              Ревизии №1–№{d.submittedRevision - 1} — отправлялись ранее и были возвращены на доработку.
              Их содержимое не входит в контракт проверяющего и здесь не показывается.
            </li>
          ) : null}
          <li className="font-medium text-text-primary">
            Ревизия №{d.submittedRevision} — на проверке, отправлена{" "}
            {new Date(d.submittedAt).toLocaleString("ru-RU")}
          </li>
          {d.reviewStartedAt ? (
            <li>Проверка начата {new Date(d.reviewStartedAt).toLocaleString("ru-RU")}</li>
          ) : null}
        </ol>
      </section>

      {d.access === "summary" || !payload ? (
        <Panel
          title="Возьмите отчёт в работу"
          description="Содержимое отчёта открывается наставнику, который взял его в работу. Это исключает одновременную проверку одного отчёта двумя наставниками."
        >
          <p className="mt-2 text-sm text-text-secondary">
            Текущее состояние заявки:{" "}
            <span className="font-medium text-text-primary">
              {d.claim.state === "unclaimed"
                ? "свободен"
                : d.claim.state === "claimed"
                  ? "в работе у другого наставника"
                  : d.claim.state === "expired"
                    ? "заявка истекла"
                    : "у вас"}
            </span>
          </p>
          <Button className="mt-4" onClick={onClaim} disabled={d.claim.state === "claimed"}>
            Взять в работу
          </Button>
          {d.claim.state === "claimed" ? (
            <p className="mt-2 text-2xs text-text-muted">
              Дождитесь окончания срока заявки или выберите другой отчёт.
            </p>
          ) : null}
        </Panel>
      ) : (
        <>
          <ReportFields payload={payload} />

          <RubricForm
            rubric={payload.rubric}
            values={rubric}
            onChange={setRubric}
            showErrors={showErrors}
            disabled={false}
          />

          {/* ------------------------------------------------------- decision */}
          <section aria-labelledby="decision-heading" className="rounded-lg border border-border bg-surface p-4">
            <h2 id="decision-heading" className="text-base font-semibold text-text-primary">
              Решение
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Решение принимает сервер. CRM не завершает уровень и не начисляет XP самостоятельно.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="reason-code" className="block text-sm font-medium text-text-primary">
                  Причина доработки
                  <span className="ml-1 text-2xs font-normal text-text-muted">
                    (для отправки на доработку)
                  </span>
                </label>
                <select
                  id="reason-code"
                  value={reasonCode}
                  onChange={(event) => setReasonCode(event.target.value)}
                  className="mt-1 block h-9 w-full max-w-md rounded border border-border bg-background px-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">— выберите причину —</option>
                  {payload.rejectionReasons.map((reason) => (
                    <option key={reason.code} value={reason.code}>
                      {reason.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="learner-feedback" className="block text-sm font-medium text-text-primary">
                  Комментарий ученику
                </label>
                <textarea
                  id="learner-feedback"
                  rows={3}
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  className="mt-1 block w-full rounded border border-border bg-background px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="mt-1 text-2xs text-text-muted">Этот текст увидит ученик.</p>
              </div>

              <div>
                <label htmlFor="corrective-action" className="block text-sm font-medium text-text-primary">
                  Что именно исправить
                </label>
                <textarea
                  id="corrective-action"
                  rows={2}
                  value={correctiveAction}
                  onChange={(event) => setCorrectiveAction(event.target.value)}
                  className="mt-1 block w-full rounded border border-border bg-background px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            {showErrors && (!reasonCode || !feedback.trim() || !correctiveAction.trim()) ? (
              <div role="alert" className="mt-3 rounded border border-danger/40 bg-danger/10 p-3">
                <p className="text-sm font-semibold text-text-primary">
                  Для отправки на доработку заполните все поля
                </p>
                <p className="mt-1 text-sm text-text-secondary">
                  Нужны причина, комментарий ученику и описание исправлений.
                </p>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={(event) => openConfirm("approve", event.currentTarget)}>
                Принять отчёт
              </Button>
              <Button
                variant="secondary"
                onClick={(event) => openConfirm("revision", event.currentTarget)}
              >
                Отправить на доработку
              </Button>
            </div>
          </section>
        </>
      )}

      {/* ------------------------------------------------------- confirmation */}
      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-body"
            tabIndex={-1}
            className="w-full max-w-md rounded-lg border border-border bg-surface p-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <h2 id="confirm-title" className="text-base font-semibold text-text-primary">
              {confirming === "approve" ? "Принять отчёт?" : "Отправить на доработку?"}
            </h2>
            <p id="confirm-body" className="mt-2 text-sm text-text-secondary">
              {confirming === "approve"
                ? "Сервер завершит уровень и откроет следующий. Действие фиксируется как решение по ревизии №" +
                  d.submittedRevision +
                  "."
                : "Ученик получит замечания и сможет отправить новую ревизию. Уровень останется незавершённым."}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={closeConfirm}>
                Отмена
              </Button>
              <Button onClick={() => void submitDecision(confirming)}>
                {confirming === "approve" ? "Да, принять" : "Да, на доработку"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
