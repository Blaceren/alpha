"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { useMentorQueue } from "./use-mentor-queue";
import { approveMentorReview } from "@/application/api/mentor-review-client";
import type { MentorQueueItem } from "@/data/contracts/api/mentor-review";

/**
 * G3 — the mentor review workspace.
 *
 * WHY THERE IS NO DETAIL VIEW
 * A mentor-review level has no report, no rubric, no attachment and no submitted
 * text — the canonical lifecycle's learner half is a state transition and
 * nothing else. There is therefore nothing to open: the queue row already
 * carries everything the platform knows about the submission. Rendering a detail
 * pane would be a page that shows a level title and an empty space where an
 * artifact would be if one existed.
 *
 * WHY THERE IS NO REJECT BUTTON
 * The canonical lifecycle has exactly two transitions and approval is the only
 * exit from `pending_review`. A reject control would be a button that cannot
 * work. If mentors need to return work, that is a product decision and a domain
 * change first — see the phase report; this workspace follows the domain rather
 * than anticipating it.
 *
 * WHY THERE IS NO CLAIM
 * Same reason: no claim, lease or assignment exists in the domain. Two reviewers
 * approving the same row is already safe — the second replays or gets a bounded
 * conflict, and the level completes exactly once either way.
 *
 * WHAT IS SHOWN. The level, the learner, how long it has waited, and what
 * approval grants. No email, no financial field, no Pocket identity — the
 * Backend queue does not send them and the strict contract would reject them.
 */
export const MENTOR_REVIEW_PATH = "/mentor";

/** Whole days/hours since submission. Coarse on purpose — triage, not SLA. */
export function waitingLabel(requestedAt: string | null, now: Date = new Date()): string {
  if (requestedAt === null) return "—";
  const then = new Date(requestedAt);
  if (Number.isNaN(then.getTime())) return "—";
  const minutes = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  return `${Math.floor(hours / 24)} дн`;
}

type RowState =
  | { kind: "idle" }
  | { kind: "approving" }
  | { kind: "approved"; xpAwarded: number }
  | { kind: "failed"; note: string };

const CONFLICT_NOTE: Record<string, string> = {
  MENTOR_REVIEW_CONFLICT: "Состояние изменилось. Обновите очередь.",
  MENTOR_REVIEW_NOT_PENDING: "Работа больше не ждёт проверки. Обновите очередь.",
  MENTOR_REVIEW_LEVEL_WRONG_OWNER: "Этот уровень проверяется иначе.",
  MENTOR_REVIEW_LEVEL_NOT_FOUND: "Заявка не найдена. Обновите очередь.",
  MENTOR_REVIEW_SELF_REVIEW_FORBIDDEN: "Нельзя принять собственную работу.",
  MENTOR_REVIEW_STATE_CORRUPT: "Состояние требует проверки. Обратитесь к администратору.",
};

function noteForFailure(status: string, code?: string): string {
  if (status === "conflict" && code) return CONFLICT_NOTE[code] ?? "Состояние изменилось. Обновите очередь.";
  if (status === "forbidden") return "Ваша учётная запись не может принимать работы.";
  if (status === "unauthenticated") return "Сессия истекла. Войдите заново.";
  if (status === "rate_limited") return "Слишком много действий. Подождите немного.";
  if (status === "not_found") return "Заявка не найдена. Обновите очередь.";
  return "Не удалось принять работу. Попробуйте ещё раз.";
}

function MentorQueueRow({
  item,
  onApproved,
  approveImpl,
}: {
  item: MentorQueueItem;
  onApproved: () => void;
  approveImpl: typeof approveMentorReview;
}) {
  const [state, setState] = React.useState<RowState>({ kind: "idle" });
  const inFlight = React.useRef(false);

  const approve = React.useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ kind: "approving" });
    const outcome = await approveImpl(item.progressId);
    inFlight.current = false;

    if (outcome.status === "success") {
      setState({ kind: "approved", xpAwarded: outcome.result.xpAwarded });
      onApproved();
      return;
    }
    setState({
      kind: "failed",
      note: noteForFailure(outcome.status, "code" in outcome ? outcome.code : undefined),
    });
  }, [approveImpl, item.progressId, onApproved]);

  return (
    <li className="mentor-queue__row" data-progress-id={item.progressId} data-state={state.kind}>
      <div className="mentor-queue__main">
        <p className="mentor-queue__level">
          Уровень {item.levelNumber} · {item.levelTitle}
        </p>
        <p className="mentor-queue__meta">
          {item.learnerName ?? `Ученик #${item.learnerUserId}`} · ждёт {waitingLabel(item.requestedAt)} ·{" "}
          {item.curriculumCode} v{item.curriculumVersionNumber}
        </p>
        {/* LO-REVIEW-WORKITEM-UNREACHABLE-1 §15 — the operational half. Same
            treatment the report-review surface already has, so both review
            families document the boundary identically instead of one of them
            looking like an independent truth set. */}
        {item.operationalWorkItem ? (
          <p className="mentor-queue__meta">
            <a href={`/cases/${item.operationalWorkItem.caseId}`}>
              {item.operationalWorkItem.reference}
            </a>
            {" · "}
            {item.operationalWorkItem.assignedStaffDisplayName
              ? `исполнитель: ${item.operationalWorkItem.assignedStaffDisplayName}`
              : "исполнитель не назначен"}
            {" · очередь и SLA — в «Операциях с учениками»"}
          </p>
        ) : null}
      </div>

      <div className="mentor-queue__action">
        {state.kind === "approved" ? (
          <p role="status">Принято{state.xpAwarded > 0 ? ` · +${state.xpAwarded} XP` : ""}</p>
        ) : (
          <>
            <Button
              type="button"
              onClick={approve}
              disabled={state.kind === "approving"}
              aria-busy={state.kind === "approving"}
            >
              {state.kind === "approving" ? "Принимаем…" : `Принять работу (+${item.xpReward} XP)`}
            </Button>
            {state.kind === "failed" ? (
              <p role="status" className="mentor-queue__error">
                {state.note}
              </p>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

export function MentorReviewWorkspace({
  approveImpl = approveMentorReview,
}: {
  approveImpl?: typeof approveMentorReview;
} = {}) {
  const { state, refresh } = useMentorQueue();

  return (
    <section className="mentor-queue" aria-labelledby="mentor-queue-title">
      <header className="mentor-queue__head">
        <h1 id="mentor-queue-title">Проверка практики ментором</h1>
        <p className="mentor-queue__intro">
          Работы, отправленные учениками на проверку. Приём работы засчитывает уровень и начисляет
          XP. Отправить на доработку нельзя — такого шага в программе нет.
        </p>
        <Button type="button" onClick={() => void refresh()} disabled={state.kind === "loading"}>
          Обновить
        </Button>
      </header>

      {state.kind === "loading" ? <p role="status">Загружаем очередь…</p> : null}

      {state.kind === "empty" ? (
        <p role="status">Сейчас нет работ, ожидающих проверки.</p>
      ) : null}

      {state.kind === "forbidden" ? (
        <p role="status">
          Ваша учётная запись не имеет прав наставника. Обратитесь к администратору.
        </p>
      ) : null}

      {state.kind === "flag_disabled" ? (
        <p role="status">Проверка практики сейчас отключена.</p>
      ) : null}

      {state.kind === "unauthorized" ? <p role="status">Сессия истекла. Войдите заново.</p> : null}

      {state.kind === "error" ? (
        <p role="status">
          Не удалось загрузить очередь.
          {state.retryable ? " Попробуйте обновить." : ""}
        </p>
      ) : null}

      {state.kind === "ready" ? (
        <ul className="mentor-queue__list">
          {state.page.items.map((item) => (
            <MentorQueueRow
              key={item.progressId}
              item={item}
              approveImpl={approveImpl}
              onApproved={() => void refresh()}
            />
          ))}
        </ul>
      ) : null}

      {state.kind === "ready" && state.page.nextCursor !== null ? (
        <p className="mentor-queue__more">
          Показаны первые работы очереди. Примите их, чтобы увидеть следующие.
        </p>
      ) : null}
    </section>
  );
}
