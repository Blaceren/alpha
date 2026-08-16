"use client";

/**
 * LEARNER-OPERATIONS-V1 — one work item, everything an operator needs.
 *
 * THE REPLY BOX AND THE NOTE BOX ARE PHYSICALLY DIFFERENT CONTROLS, in
 * different panels, with different colours, different verbs and different
 * endpoints. There is no "visibility" toggle anywhere on this screen, because a
 * toggle is one mis-click away from sending an internal remark to a learner.
 * The panel headings say who will see the text before the operator types it.
 *
 * EVERY MUTATION CARRIES THE VERSION THIS SCREEN WAS SHOWING. A stale screen
 * gets a 409 and a "refresh and retry" message rather than silently overwriting
 * a colleague's transition. That is the same optimistic-concurrency contract the
 * backend enforces, surfaced rather than hidden.
 *
 * THE CANONICAL ANCHOR IS READ-ONLY AND LABELLED WITH ITS OWNER. A report's
 * status and a progression row's status are shown as facts belonging to the
 * curriculum owner. There is no control here that changes them: approving a
 * report or a mentor review happens in the review workspaces, through the
 * canonical commands, and resolving THIS case completes no level.
 */
import * as React from "react";
import Link from "next/link";
import { grants } from "@/domain/identity/access";
import { useSession } from "@/components/crm-shell/session-context";
import {
  addNote,
  assignCase,
  changePriority,
  fetchCase,
  fetchEscalations,
  fetchEvents,
  fetchLearner360,
  fetchMessages,
  fetchNotes,
  fetchConfig,
  raiseEscalation,
  recordQa,
  resolveEscalation,
  sendMessage,
  transitionCase,
  type Outcome,
} from "@/application/api/learner-ops-client";
import type {
  CaseDetail,
  Escalations,
  EventsPage,
  Learner360,
  LearnerOpsConfig,
  MessagesPage,
  NotesPage,
} from "@/data/contracts/api/learner-ops";
import {
  dateTime,
  ESCALATION_CLASS_LABEL,
  EVENT_LABEL,
  FIRST_DEPOSIT_EVIDENCE_LABEL,
  label,
  outcomeNote,
  PRIORITY_LABEL,
  since,
  SLA_ORIGIN_LABEL,
  SLA_STATE_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
} from "./labels";
import {
  EmptyBlock,
  ErrorBlock,
  ForbiddenBlock,
  LoadingBlock,
  PriorityChip,
  Section,
  Sourced,
  StatusChip,
  TypeChip,
} from "./primitives";
import { LEARNER_OPS_PATH } from "./inbox-workspace";

/**
 * The preferred ORDER in which to offer transitions. It is a presentation
 * concern only — WHICH transitions exist comes from the server.
 *
 * LO-UI-TRANSITION-CHOICES-1. This used to BE the list, so a resolved case
 * offered `in_progress`, `waiting_learner` and the rest and the server answered
 * 400 ILLEGAL_TRANSITION to every one of them. The domain's own table is now
 * projected onto the case as `allowedTransitions`, and this array only decides
 * the sequence they appear in; anything the server allows that is missing here
 * is still offered, appended at the end, so a new transition can never become
 * invisible because a UI constant was not updated.
 */
const TRANSITION_ORDER = [
  "in_progress",
  "waiting_learner",
  "waiting_internal",
  "waiting_external",
  "resolved",
  "closed",
  "open",
] as const;

function orderTransitions(allowed: readonly string[]): readonly string[] {
  const preferred = TRANSITION_ORDER.filter((s) => allowed.includes(s));
  const rest = allowed.filter((s) => !TRANSITION_ORDER.includes(s as never));
  return [...preferred, ...rest];
}

type Banner = { tone: "ok" | "bad"; text: string } | null;

export function CaseDetailWorkspace({ caseId }: { caseId: string }) {
  const { session } = useSession();
  const canHandle = grants(session.effectivePermissions, "learner_ops_handle");
  const canEscalate = grants(session.effectivePermissions, "learner_ops_escalate");
  // Two controls, two permissions. A support operator raises and never sees a
  // resolve form; a mentor answers and never sees an escalate form. Hiding is
  // presentation only — the server refuses either way (403).
  const canResolveEscalation = grants(
    session.effectivePermissions,
    "learner_ops_escalation_resolve",
  );
  const canQa = grants(session.effectivePermissions, "learner_ops_qa");
  const canManageQueues = grants(session.effectivePermissions, "learner_ops_manage_queues");

  const [nonce, setNonce] = React.useState(0);
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);
  const [banner, setBanner] = React.useState<Banner>(null);

  const [detail, setDetail] = React.useState<Outcome<CaseDetail> | null>(null);
  const [messages, setMessages] = React.useState<MessagesPage | null>(null);
  const [notes, setNotes] = React.useState<NotesPage | null>(null);
  const [events, setEvents] = React.useState<EventsPage | null>(null);
  const [escalations, setEscalations] = React.useState<Escalations | null>(null);
  const [learner, setLearner] = React.useState<Learner360 | null>(null);
  const [config, setConfig] = React.useState<LearnerOpsConfig | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setDetail(null);
    void (async () => {
      const caseOutcome = await fetchCase(caseId);
      if (cancelled) return;
      setDetail(caseOutcome);
      if (caseOutcome.status !== "success") return;

      const [m, n, e, esc, cfg] = await Promise.all([
        fetchMessages(caseId),
        fetchNotes(caseId),
        fetchEvents(caseId),
        fetchEscalations(caseId),
        fetchConfig(),
      ]);
      if (cancelled) return;
      if (m.status === "success") setMessages(m.data);
      if (n.status === "success") setNotes(n.data);
      if (e.status === "success") setEvents(e.data);
      if (esc.status === "success") setEscalations(esc.data);
      if (cfg.status === "success") setConfig(cfg.data);

      const l360 = await fetchLearner360(caseOutcome.data.learner.id);
      if (!cancelled && l360.status === "success") setLearner(l360.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId, nonce]);

  /** Every mutation funnels through here: one place to map outcomes to words. */
  const run = React.useCallback(
    async (action: () => Promise<Outcome<unknown>>, okText: string) => {
      const outcome = await action();
      if (outcome.status === "success") {
        setBanner({ tone: "ok", text: okText });
        reload();
        return true;
      }
      setBanner({
        tone: "bad",
        text: outcomeNote(outcome.status, "detail" in outcome ? outcome.detail : undefined),
      });
      return false;
    },
    [reload],
  );

  if (detail === null) return <LoadingBlock />;
  if (detail.status === "forbidden") {
    return (
      <div className="p-6">
        <ForbiddenBlock what="Просмотр обращения требует прав Learner Operations." />
      </div>
    );
  }
  if (detail.status !== "success") {
    return (
      <div className="p-6">
        <ErrorBlock
          text={outcomeNote(detail.status, "detail" in detail ? detail.detail : undefined)}
          onRetry={reload}
        />
      </div>
    );
  }

  const c = detail.data;

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={LEARNER_OPS_PATH} className="text-sm text-sky-700 underline">
            ← К очереди
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">
            {c.reference} · {c.subject}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TypeChip type={c.type} />
            <StatusChip status={c.status} />
            <PriorityChip priority={c.priority} />
            <span className="text-xs text-slate-500">
              очередь: {c.queueName} · открыто {since(c.openedAt)} назад
            </span>
            {c.reopenCount > 0 ? (
              <span className="text-xs text-amber-700">переоткрыто {c.reopenCount}×</span>
            ) : null}
          </div>
        </div>
        <button type="button" onClick={reload} className="text-sm text-slate-600 underline">
          Обновить
        </button>
      </header>

      {banner ? (
        <p
          role="status"
          className={`rounded border p-2 text-sm ${
            banner.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {banner.text}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* ---------------------------------------------- learner-visible */}
          <Section title="Переписка с учеником — ВИДНО УЧЕНИКУ">
            <p className="mb-3 rounded border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900">
              Всё, что отправлено здесь, ученик увидит в Академии.
            </p>
            {messages === null ? (
              <LoadingBlock />
            ) : messages.items.length === 0 ? (
              <EmptyBlock text="Сообщений пока нет." />
            ) : (
              <ul className="space-y-2">
                {messages.items.map((message) => (
                  <li
                    key={message.id}
                    className={`rounded border p-2 text-sm ${
                      message.authorKind === "staff"
                        ? "border-sky-200 bg-sky-50"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="mb-1 flex justify-between text-xs text-slate-500">
                      <span>
                        {message.authorName}
                        {message.authorKind === "staff" ? " (сотрудник)" : " (ученик)"}
                      </span>
                      <span>{dateTime(message.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-slate-800">{message.body}</p>
                  </li>
                ))}
              </ul>
            )}

            {canHandle ? (
              <ReplyForm
                onSubmit={(text) =>
                  run(() => sendMessage(caseId, text), "Ответ отправлен ученику.")
                }
              />
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                У вашей роли нет права отвечать ученику.
              </p>
            )}
          </Section>

          {/* ------------------------------------------------ internal only */}
          <Section title="Внутренние заметки — НЕ ВИДНО УЧЕНИКУ">
            <p className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              Служебная информация. Ученику не показывается никогда и хранится отдельно от
              переписки.
            </p>
            {notes === null ? (
              <LoadingBlock />
            ) : notes.items.length === 0 ? (
              <EmptyBlock text="Заметок нет." />
            ) : (
              <ul className="space-y-2">
                {notes.items.map((note) => (
                  <li key={note.id} className="rounded border border-amber-200 bg-amber-50 p-2 text-sm">
                    <div className="mb-1 flex justify-between text-xs text-amber-800">
                      <span>{note.authorName}</span>
                      <span>{dateTime(note.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-slate-800">{note.body}</p>
                  </li>
                ))}
              </ul>
            )}

            {canHandle ? (
              <NoteForm
                onSubmit={(text) => run(() => addNote(caseId, text), "Внутренняя заметка добавлена.")}
              />
            ) : null}
          </Section>

          {/* -------------------------------------------------- escalations */}
          <Section title="Эскалации">
            {escalations === null ? (
              <LoadingBlock />
            ) : escalations.items.length === 0 ? (
              <EmptyBlock text="Эскалаций нет." />
            ) : (
              <ul className="space-y-2">
                {escalations.items.map((row) => (
                  <li key={row.id} className="rounded border border-slate-200 p-2 text-sm">
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>{label(ESCALATION_CLASS_LABEL, row.class)}</span>
                      <span>{dateTime(row.raisedAt)}</span>
                    </div>
                    <p className="mt-1 text-slate-800">{row.reason}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      от {row.raisedBy} →{" "}
                      {row.targetStaff ?? row.targetQueue?.name ?? "—"}
                    </p>
                    {row.resolvedAt ? (
                      <p className="mt-1 rounded bg-emerald-50 p-1 text-xs text-emerald-800">
                        Решено {dateTime(row.resolvedAt)} ({row.resolvedBy}): {row.resolution}
                        {row.returnedToOwnerAt ? " · возвращено владельцу" : ""}
                      </p>
                    ) : canResolveEscalation ? (
                      <ResolveEscalationForm
                        onSubmit={(text, back) =>
                          run(
                            () => resolveEscalation(row.id, { resolution: text, returnToOwner: back }),
                            "Эскалация закрыта.",
                          )
                        }
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {canEscalate ? (
              <EscalateForm
                onSubmit={(cls, reason) =>
                  run(
                    () =>
                      raiseEscalation(caseId, {
                        class: cls,
                        reason,
                        targetQueueKey: "escalation",
                      }),
                    "Эскалация создана. Владелец обращения не изменился.",
                  )
                }
              />
            ) : null}
          </Section>

          {/* ----------------------------------------------------- timeline */}
          <Section title="История">
            {events === null ? (
              <LoadingBlock />
            ) : events.items.length === 0 ? (
              <EmptyBlock text="Событий нет." />
            ) : (
              <ol className="space-y-1 text-sm">
                {events.items.map((event) => (
                  <li key={event.id} className="border-b border-slate-100 py-1">
                    <span className="text-slate-800">{label(EVENT_LABEL, event.eventType)}</span>
                    {event.previousStatus && event.nextStatus ? (
                      <span className="text-slate-500">
                        {" "}
                        · {label(STATUS_LABEL, event.previousStatus)} →{" "}
                        {label(STATUS_LABEL, event.nextStatus)}
                      </span>
                    ) : null}
                    {event.nextAssignee || event.previousAssignee ? (
                      <span className="text-slate-500">
                        {" "}
                        · {event.previousAssignee ?? "—"} → {event.nextAssignee ?? "—"}
                      </span>
                    ) : null}
                    <span className="text-xs text-slate-400">
                      {" "}
                      · {event.actorName ?? "система"} · {dateTime(event.createdAt)}
                    </span>
                    {event.reason ? (
                      <div className="text-xs text-slate-500">причина: {event.reason}</div>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>

        {/* ------------------------------------------------------- sidebar */}
        <div className="space-y-4">
          <Section title="Действия">
            {!canHandle ? (
              <ForbiddenBlock what="Для действий над обращением нужно право learner_ops_handle." />
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-xs text-slate-500">Исполнитель</p>
                  <p className="text-sm">
                    {c.assignedTo?.displayName ?? <span className="text-slate-400">не назначен</span>}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2 py-1 text-sm"
                      onClick={() =>
                        run(
                          () =>
                            assignCase(caseId, {
                              expectedAssignmentVersion: c.assignmentVersion,
                              targetStaffId: session.employeeId,
                            }),
                          "Обращение назначено на вас.",
                        )
                      }
                    >
                      Взять себе
                    </button>
                    {c.assignedTo ? (
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-2 py-1 text-sm"
                        onClick={() =>
                          run(
                            () =>
                              assignCase(caseId, {
                                expectedAssignmentVersion: c.assignmentVersion,
                                targetStaffId: null,
                              }),
                            "Назначение снято.",
                          )
                        }
                      >
                        Освободить
                      </button>
                    ) : null}
                  </div>
                  {canManageQueues && config ? (
                    <label className="mt-2 block text-sm">
                      <span className="mr-2 text-slate-600">Назначить другому</span>
                      <select
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                        defaultValue=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          void run(
                            () =>
                              assignCase(caseId, {
                                expectedAssignmentVersion: c.assignmentVersion,
                                targetStaffId: e.target.value,
                              }),
                            "Обращение переназначено.",
                          );
                        }}
                      >
                        <option value="">— выбрать —</option>
                        {config.assignableStaff.map((staff) => (
                          <option key={staff.staffId} value={staff.staffId}>
                            {staff.displayName} ({staff.role})
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>

                <label className="block text-sm">
                  <span className="text-slate-600">Статус</span>
                  <select
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                    defaultValue=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      void run(
                        () =>
                          transitionCase(caseId, {
                            expectedVersion: c.version,
                            nextStatus: e.target.value,
                          }),
                        "Статус изменён.",
                      );
                    }}
                  >
                    <option value="">— выбрать —</option>
                    {orderTransitions(c.allowedTransitions).map((status) => (
                      <option key={status} value={status}>
                        {label(STATUS_LABEL, status)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm">
                  <span className="text-slate-600">Приоритет</span>
                  <select
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                    value={c.priority}
                    onChange={(e) => {
                      void run(
                        () =>
                          changePriority(caseId, {
                            expectedVersion: c.version,
                            nextPriority: e.target.value,
                          }),
                        "Приоритет изменён.",
                      );
                    }}
                  >
                    {Object.entries(PRIORITY_LABEL).map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>

                {canQa && (c.status === "resolved" || c.status === "closed") ? (
                  <QaForm
                    onSubmit={(result, feedback, coaching) =>
                      run(
                        () =>
                          recordQa(caseId, {
                            result,
                            feedback: feedback || undefined,
                            coachingRequired: coaching,
                          }),
                        "Оценка качества записана.",
                      )
                    }
                  />
                ) : null}
              </div>
            )}
          </Section>

          <Section title="SLA">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Первый ответ</dt>
                <dd>{label(SLA_STATE_LABEL, c.sla.firstResponse.state)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Решение</dt>
                <dd>{label(SLA_STATE_LABEL, c.sla.resolution.state)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Срок решения</dt>
                <dd>{dateTime(c.sla.resolution.dueAt)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-slate-400">
              {c.sla.origin
                ? label(SLA_ORIGIN_LABEL, c.sla.origin)
                : "Политика SLA не назначена"}
            </p>
          </Section>

          {c.anchor ? (
            <Section title="Канонический объект">
              <Sourced title="Владелец" source={c.anchor.source}>
                {c.anchor.kind === "report_submission" ? (
                  <div className="space-y-1">
                    <div>Отчёт #{c.anchor.submissionId}</div>
                    <div>Уровень: {c.anchor.levelNumber ?? "—"}</div>
                    <div>Статус (по данным владельца): {c.anchor.status}</div>
                    <div className="text-xs text-slate-500">
                      Отправлен: {dateTime(c.anchor.submittedAt)}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div>Прогресс #{c.anchor.progressId}</div>
                    <div>Уровень: {c.anchor.levelNumber ?? "—"}</div>
                    <div>Статус (по данным владельца): {c.anchor.status}</div>
                  </div>
                )}
              </Sourced>
              <p className="mt-2 text-xs text-slate-500">
                Решение по учебному объекту принимается в разделе проверки через канонические
                команды. Закрытие обращения не завершает уровень.
              </p>
            </Section>
          ) : null}

          {learner ? <Learner360Panel learner={learner} /> : null}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- learner 360 */

function Learner360Panel({ learner }: { learner: Learner360 }) {
  return (
    <Section title="Ученик 360">
      <div className="space-y-2">
        <Sourced title="Личность" source={learner.identity.email.source}>
          <div>{learner.identity.name}</div>
          <div className="text-xs text-slate-500">
            {learner.identity.email.value}
            {learner.identity.emailMasked ? " (скрыт)" : ""}
          </div>
          <div className="text-xs text-slate-500">
            статус: {learner.identity.status.value}
          </div>
        </Sourced>

        <Sourced title="Прогресс" source={learner.progression.source}>
          <div>
            {learner.progression.value.completedLevels} из {learner.progression.value.totalLevels}{" "}
            уровней
          </div>
          {/* Started is shown separately so "0 из 100" never has to double as
              "has not begun" — they are different facts and an operator needs
              both. */}
          <div className="text-xs text-slate-500">
            начато: {learner.progression.value.startedLevels}
          </div>
          {learner.progression.value.currentLevel ? (
            <div className="text-xs text-slate-500">
              текущий: L{learner.progression.value.currentLevel.levelNumber}{" "}
              {learner.progression.value.currentLevel.title}
            </div>
          ) : null}
          {learner.progression.value.pendingReview.length > 0 ? (
            <div className="mt-1 text-xs text-amber-700">
              ждёт проверки:{" "}
              {learner.progression.value.pendingReview
                .map((row) => `L${row.levelNumber}`)
                .join(", ")}
            </div>
          ) : null}
        </Sourced>

        <Sourced title="Pocket" source={learner.external.pocketIdentity.source}>
          {learner.external.pocketIdentity.value.state === "linked" ? (
            <div>
              привязан · {learner.external.pocketIdentity.value.playerId}
              <div className="text-xs text-slate-500">
                источник: {learner.external.pocketIdentity.value.source}
              </div>
            </div>
          ) : (
            <div>
              ожидается колбэк регистрации
              <div className="text-xs text-slate-500">
                Это каноническое состояние. Подтвердить регистрацию вручную нельзя.
              </div>
            </div>
          )}
        </Sourced>

        {learner.external.financial ? (
          <Sourced title="Финансовые события" source={learner.external.financial.source}>
            <div>
              первый депозит:{" "}
              {learner.external.financial.value.firstDepositConfirmed ? "подтверждён" : "нет"}
            </div>
            <div className="text-xs text-slate-500">
              основание:{" "}
              {label(
                FIRST_DEPOSIT_EVIDENCE_LABEL,
                learner.external.financial.value.firstDepositEvidence,
              )}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Баланс и суммы платформе неизвестны и здесь не показываются.
            </p>
          </Sourced>
        ) : (
          <div className="rounded border border-slate-200 p-3 text-xs text-slate-500">
            Финансовый раздел скрыт: нет права view_exact_financials.
          </div>
        )}

        <Sourced title="Обращения" source={learner.operations.source}>
          {learner.operations.value.length === 0 ? (
            <span className="text-slate-500">нет</span>
          ) : (
            <ul className="space-y-0.5 text-xs">
              {learner.operations.value.slice(0, 6).map((row) => (
                <li key={row.id}>
                  <Link href={`${LEARNER_OPS_PATH}/${row.id}`} className="text-sky-700 underline">
                    {row.reference}
                  </Link>{" "}
                  · {label(TYPE_LABEL, row.type)} · {label(STATUS_LABEL, row.status)}
                </li>
              ))}
            </ul>
          )}
        </Sourced>
      </div>
    </Section>
  );
}

/* --------------------------------------------------------------- forms */

function ReplyForm({ onSubmit }: { onSubmit: (text: string) => Promise<boolean> }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <form
      className="mt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim() || busy) return;
        setBusy(true);
        const ok = await onSubmit(text.trim());
        setBusy(false);
        if (ok) setText("");
      }}
    >
      <label className="block text-sm font-medium text-sky-900" htmlFor="lo-reply">
        Ответ ученику (будет виден ученику)
      </label>
      <textarea
        id="lo-reply"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="mt-1 w-full rounded border border-sky-300 p-2 text-sm"
        placeholder="Текст, который увидит ученик"
      />
      <button
        type="submit"
        disabled={busy || !text.trim()}
        className="mt-2 rounded bg-sky-700 px-3 py-1 text-sm text-white disabled:opacity-50"
      >
        {busy ? "Отправка…" : "Отправить ученику"}
      </button>
    </form>
  );
}

function NoteForm({ onSubmit }: { onSubmit: (text: string) => Promise<boolean> }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <form
      className="mt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim() || busy) return;
        setBusy(true);
        const ok = await onSubmit(text.trim());
        setBusy(false);
        if (ok) setText("");
      }}
    >
      <label className="block text-sm font-medium text-amber-900" htmlFor="lo-note">
        Внутренняя заметка (ученик НЕ увидит)
      </label>
      <textarea
        id="lo-note"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        className="mt-1 w-full rounded border border-amber-300 p-2 text-sm"
        placeholder="Служебная информация для коллег"
      />
      <button
        type="submit"
        disabled={busy || !text.trim()}
        className="mt-2 rounded bg-amber-700 px-3 py-1 text-sm text-white disabled:opacity-50"
      >
        {busy ? "Сохранение…" : "Добавить заметку"}
      </button>
    </form>
  );
}

function EscalateForm({
  onSubmit,
}: {
  onSubmit: (cls: string, reason: string) => Promise<boolean>;
}) {
  const [cls, setCls] = React.useState("educational_methodology");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <form
      className="mt-3 border-t border-slate-200 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!reason.trim() || busy) return;
        setBusy(true);
        const ok = await onSubmit(cls, reason.trim());
        setBusy(false);
        if (ok) setReason("");
      }}
    >
      <p className="mb-2 text-xs text-slate-500">
        Эскалация не забирает обращение у исполнителя и не теряется в истории.
      </p>
      <select
        value={cls}
        onChange={(e) => setCls(e.target.value)}
        className="rounded border border-slate-300 px-2 py-1 text-sm"
      >
        {Object.entries(ESCALATION_CLASS_LABEL).map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Почему нужна эскалация"
        className="mt-2 w-full rounded border border-slate-300 p-2 text-sm"
      />
      <button
        type="submit"
        disabled={busy || !reason.trim()}
        className="mt-2 rounded border border-rose-300 px-3 py-1 text-sm text-rose-800 disabled:opacity-50"
      >
        {busy ? "Отправка…" : "Эскалировать"}
      </button>
    </form>
  );
}

function ResolveEscalationForm({
  onSubmit,
}: {
  onSubmit: (text: string, back: boolean) => Promise<boolean>;
}) {
  const [text, setText] = React.useState("");
  const [back, setBack] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  return (
    <form
      className="mt-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim() || busy) return;
        setBusy(true);
        await onSubmit(text.trim(), back);
        setBusy(false);
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Итог эскалации"
        className="w-full rounded border border-slate-300 p-2 text-sm"
      />
      <label className="mt-1 flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={back} onChange={(e) => setBack(e.target.checked)} />
        вернуть обращение владельцу
      </label>
      <button
        type="submit"
        disabled={busy || !text.trim()}
        className="mt-1 rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
      >
        Закрыть эскалацию
      </button>
    </form>
  );
}

function QaForm({
  onSubmit,
}: {
  onSubmit: (result: string, feedback: string, coaching: boolean) => Promise<boolean>;
}) {
  const [result, setResult] = React.useState("meets");
  const [feedback, setFeedback] = React.useState("");
  const [coaching, setCoaching] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  return (
    <form
      className="border-t border-slate-200 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        const ok = await onSubmit(result, feedback.trim(), coaching);
        setBusy(false);
        if (ok) setFeedback("");
      }}
    >
      <p className="mb-1 text-xs text-slate-500">
        Оценка качества не изменяет переписку и не переоткрывает обращение.
      </p>
      <select
        value={result}
        onChange={(e) => setResult(e.target.value)}
        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
      >
        <option value="meets">Соответствует</option>
        <option value="needs_improvement">Требует улучшения</option>
        <option value="does_not_meet">Не соответствует</option>
      </select>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        rows={2}
        placeholder="Комментарий (необязательно)"
        className="mt-2 w-full rounded border border-slate-300 p-2 text-sm"
      />
      <label className="mt-1 flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={coaching} onChange={(e) => setCoaching(e.target.checked)} />
        нужен коучинг
      </label>
      <button
        type="submit"
        disabled={busy}
        className="mt-2 rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-50"
      >
        {busy ? "Сохранение…" : "Записать оценку"}
      </button>
    </form>
  );
}
