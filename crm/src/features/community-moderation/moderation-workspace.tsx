"use client";

/**
 * COMMUNITY-V1 — the Community moderation workspace.
 *
 * WHAT A MODERATOR NEEDS AND NOTHING ELSE: the reports learners filed, the
 * content behind them, and the two actions that resolve a report. There is no
 * learner file, no financial column and no case here — a moderator decides
 * whether a POST belongs, which needs the post, not the person.
 *
 * FOUR STATES, ALWAYS. Loading, empty, error and permission-denied are the
 * ordinary way this renders, matching the Learner Operations surfaces.
 */
import * as React from "react";
import {
  applyModerationCommand,
  fetchModerationQueue,
  type ModerationCommand,
  type Outcome,
} from "@/application/api/community-moderation-client";
import type {
  CommunityModerationQueue,
  CommunityReport,
} from "@/data/contracts/api/community-moderation";
import { EmptyBlock, ErrorBlock, LoadingBlock, Section } from "@/features/learner-ops/primitives";

const REASON_LABEL: Record<CommunityReport["reason"], string> = {
  spam: "Спам",
  off_topic: "Не по теме",
  abuse: "Оскорбления",
  other: "Другое",
};

const STATUS_LABEL: Record<string, string> = {
  visible: "Опубликовано",
  removed_by_author: "Удалено автором",
  removed_by_moderator: "Скрыто модератором",
};

const ACTION_LABEL: Record<string, string> = {
  "discussion.remove": "скрыл обсуждение",
  "discussion.restore": "восстановил обсуждение",
  "reply.remove": "скрыл ответ",
  "reply.restore": "восстановил ответ",
  "report.actioned": "принял жалобу",
  "report.dismissed": "отклонил жалобу",
};

function errorText(outcome: Outcome<unknown>): string {
  switch (outcome.status) {
    case "forbidden":
      return "У вашей роли нет прав на модерацию сообщества.";
    case "unauthenticated":
      return "Сессия истекла. Войдите заново.";
    case "unavailable":
      return "Сервис недоступен. Повторите попытку.";
    case "malformed_response":
      return "Некорректный ответ сервиса. Данные не показаны, чтобы не ввести в заблуждение.";
    case "invalid_input":
      return "Запрос отклонён.";
    case "conflict":
      return "Состояние изменилось. Обновите очередь.";
    default:
      return "Не удалось выполнить действие.";
  }
}

/** Learner-authored text. Rendered as TEXT — never as HTML, never as markdown. */
function Body({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{text}</p>
  );
}

export function CommunityModerationWorkspace() {
  const [queue, setQueue] = React.useState<CommunityModerationQueue | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const outcome = await fetchModerationQueue();
    if (outcome.status === "success") setQueue(outcome.data);
    else setError(errorText(outcome));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const run = React.useCallback(
    async (command: ModerationCommand) => {
      setBusyId(command.id);
      setActionError(null);
      const outcome = await applyModerationCommand(command);
      setBusyId(null);
      if (outcome.status !== "success") {
        // A refused write never renders as success.
        setActionError(errorText(outcome));
        return;
      }
      await load();
    },
    [load],
  );

  if (loading) return <LoadingBlock label="Загрузка очереди модерации…" />;
  if (error) return <ErrorBlock text={error} onRetry={() => void load()} />;
  if (!queue) return <ErrorBlock text="Очередь недоступна." onRetry={() => void load()} />;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-900">Модерация сообщества</h1>

      {actionError ? <ErrorBlock text={actionError} /> : null}

      <Section title={`Жалобы (${queue.reports.length})`}>
        {queue.reports.length === 0 ? (
          <EmptyBlock text="Открытых жалоб нет." />
        ) : (
          <ul className="space-y-3">
            {queue.reports.map((report) => {
              const target = report.discussion ?? report.reply;
              if (!target) return null;
              const isDiscussion = report.discussion !== null;
              const spaceTitle = report.discussion
                ? report.discussion.space.title
                : report.reply!.discussion.space.title;
              const threadTitle = report.discussion
                ? report.discussion.title
                : report.reply!.discussion.title;
              return (
                <li key={report.id} className="rounded-md border border-slate-200 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
                      {REASON_LABEL[report.reason]}
                    </span>
                    <span>{spaceTitle}</span>
                    <span>·</span>
                    <span>{threadTitle}</span>
                    <span>·</span>
                    <span>{new Date(report.createdAt).toLocaleString("ru-RU")}</span>
                    <span>·</span>
                    {/* Staff-only: the reporter is never shown to any learner. */}
                    <span>жалоба от {report.reporter.name}</span>
                  </div>

                  <p className="mb-1 text-xs text-slate-500">
                    Автор: {target.author.name} · {STATUS_LABEL[target.status] ?? target.status}
                  </p>
                  <Body text={isDiscussion ? report.discussion!.body : report.reply!.body} />
                  {report.note ? (
                    <p className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-600">
                      Комментарий: {report.note}
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {target.status === "visible" ? (
                      <button
                        type="button"
                        disabled={busyId === target.id}
                        onClick={() =>
                          void run({
                            action: isDiscussion ? "discussion.remove" : "reply.remove",
                            id: target.id,
                            reason: REASON_LABEL[report.reason],
                          })
                        }
                        className="rounded border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-800 disabled:opacity-50"
                      >
                        Скрыть
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === target.id}
                        onClick={() =>
                          void run({
                            action: isDiscussion ? "discussion.restore" : "reply.restore",
                            id: target.id,
                          })
                        }
                        className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
                      >
                        Восстановить
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === report.id}
                      onClick={() => void run({ action: "report.dismissed", id: report.id })}
                      className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
                    >
                      Отклонить жалобу
                    </button>
                    <button
                      type="button"
                      disabled={busyId === report.id}
                      onClick={() => void run({ action: "report.actioned", id: report.id })}
                      className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
                    >
                      Закрыть как принятую
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title={`Недавние обсуждения (${queue.recentDiscussions.length})`}>
        {queue.recentDiscussions.length === 0 ? (
          <EmptyBlock text="Обсуждений пока нет." />
        ) : (
          <ul className="space-y-2">
            {queue.recentDiscussions.map((discussion) => (
              <li key={discussion.id} className="rounded-md border border-slate-200 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{discussion.space.title}</span>
                  <span>·</span>
                  <span>{discussion.author.name}</span>
                  <span>·</span>
                  <span>{new Date(discussion.createdAt).toLocaleString("ru-RU")}</span>
                  <span>·</span>
                  <span>{STATUS_LABEL[discussion.status] ?? discussion.status}</span>
                </div>
                <p className="text-sm font-medium text-slate-900">{discussion.title}</p>
                <Body text={discussion.body} />
                <div className="mt-2">
                  {discussion.status === "visible" ? (
                    <button
                      type="button"
                      disabled={busyId === discussion.id}
                      onClick={() => void run({ action: "discussion.remove", id: discussion.id })}
                      className="rounded border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-800 disabled:opacity-50"
                    >
                      Скрыть
                    </button>
                  ) : discussion.status === "removed_by_moderator" ? (
                    <button
                      type="button"
                      disabled={busyId === discussion.id}
                      onClick={() => void run({ action: "discussion.restore", id: discussion.id })}
                      className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
                    >
                      Восстановить
                    </button>
                  ) : (
                    // A learner's own withdrawal is theirs to keep. There is no
                    // staff control that undoes it.
                    <span className="text-xs text-slate-500">Удалено автором</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Недавние ответы (${queue.recentReplies.length})`}>
        {queue.recentReplies.length === 0 ? (
          <EmptyBlock text="Ответов пока нет." />
        ) : (
          <ul className="space-y-2">
            {queue.recentReplies.map((reply) => (
              <li key={reply.id} className="rounded-md border border-slate-200 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{reply.discussion.title}</span>
                  <span>·</span>
                  <span>{reply.author.name}</span>
                  <span>·</span>
                  <span>{new Date(reply.createdAt).toLocaleString("ru-RU")}</span>
                  <span>·</span>
                  <span>{STATUS_LABEL[reply.status] ?? reply.status}</span>
                </div>
                <Body text={reply.body} />
                <div className="mt-2">
                  {reply.status === "visible" ? (
                    <button
                      type="button"
                      disabled={busyId === reply.id}
                      onClick={() => void run({ action: "reply.remove", id: reply.id })}
                      className="rounded border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-800 disabled:opacity-50"
                    >
                      Скрыть
                    </button>
                  ) : reply.status === "removed_by_moderator" ? (
                    <button
                      type="button"
                      disabled={busyId === reply.id}
                      onClick={() => void run({ action: "reply.restore", id: reply.id })}
                      className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
                    >
                      Восстановить
                    </button>
                  ) : (
                    <span className="text-xs text-slate-500">Удалено автором</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="История модерации">
        {queue.actions.length === 0 ? (
          <EmptyBlock text="Действий модерации пока не было." />
        ) : (
          <ul className="space-y-1">
            {queue.actions.map((action) => (
              <li key={action.id} className="text-sm text-slate-700">
                <span className="text-slate-500">
                  {new Date(action.createdAt).toLocaleString("ru-RU")}
                </span>{" "}
                — {action.staff.displayName} {ACTION_LABEL[action.action] ?? action.action}
                {action.reason ? ` (${action.reason})` : ""}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
