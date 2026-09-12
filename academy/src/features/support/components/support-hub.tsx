"use client";

/**
 * Поддержка (/support) — the learner's own support surface.
 *
 * WHAT A LEARNER SEES, AND WHAT THEY DELIBERATELY DO NOT.
 *
 * They see their own requests, the conversation on each, and a form to open a
 * new one. They do not see a queue, a priority, an assignee, an SLA clock, a
 * reason code or an internal note — none of those are learner information, and
 * the Backend does not send them to this surface at all. There is nothing here
 * to hide, because there is nothing here to receive.
 *
 * THE STATUS WORDS ARE OPERATIONAL, NOT EDUCATIONAL. "Ждём вашего ответа" is a
 * fact about a conversation. It is never dressed up in progression language,
 * because a learner reading "на проверке" on a support thread would reasonably
 * think their level was being reviewed.
 *
 * EVERY STATE IS COVERED: loading, empty, error, the closed-thread case, and
 * the flood-control refusal. A support surface that only renders when things go
 * well is a support surface that fails the person who needed it.
 */
import * as React from "react";
import {
  getSupportCase,
  listSupportCases,
  openSupportCase,
  replyToSupportCase,
  type SupportCaseDetail,
  type SupportCaseSummary,
} from "@/lib/support/support-client";
import type { NormalizedError } from "@/lib/api/errors";

/**
 * The learner-facing meaning of each operational status.
 *
 * An unmapped code renders as itself rather than as an invented phrase — this
 * repository has shipped a raw enum to a learner once already, and the fix was
 * to add the label, not to add a fallback that hides the gap.
 */
const STATUS_TEXT: Record<string, string> = {
  new: "Получено",
  open: "Получено",
  in_progress: "В работе",
  waiting_learner: "Ждём вашего ответа",
  waiting_internal: "Уточняем внутри команды",
  waiting_external: "Ждём ответа провайдера",
  escalated: "Передано специалисту",
  resolved: "Решено",
  closed: "Закрыто",
};

const CLOSED_STATUSES = new Set(["resolved", "closed"]);

function statusText(status: string): string {
  return STATUS_TEXT[status] ?? status;
}

function when(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "";
  return value.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The learner-facing sentence for a failure.
 *
 * IT USED TO SWITCH ON `error.code`, AND THAT IS THE WRONG FIELD. `code` is
 * whatever code the SERVER put in a response body; it is null for every
 * client-generated failure — a dropped connection, an unparseable reply — and
 * for most HTTP errors. What actually carries "NETWORK_ERROR",
 * "BACKEND_UNAVAILABLE" and "MALFORMED_RESPONSE" is `category`.
 *
 * So both specific sentences below were unreachable, and a learner whose
 * connection had failed was told "Что-то пошло не так" — the sentence reserved
 * for a failure we cannot name. The branches and their words are unchanged;
 * only the field they read is.
 */
function errorText(error: NormalizedError): string {
  switch (error.category) {
    case "NETWORK_ERROR":
    case "BACKEND_UNAVAILABLE":
      return "Не удалось связаться с поддержкой. Попробуйте позже.";
    case "MALFORMED_RESPONSE":
      return "Ответ сервера не распознан. Попробуйте обновить страницу.";
    default:
      return "Что-то пошло не так. Попробуйте ещё раз.";
  }
}

export function SupportHub() {
  /**
   * One state atom per fetch, written ONLY from inside the async callback.
   *
   * Nothing calls setState synchronously in an effect body: a "clear it first,
   * then load" shape causes a cascading render, and React's own guidance (and
   * this repository's lint rule) is to derive the in-flight state instead. Each
   * atom therefore carries the key it was loaded for, and the render decides
   * whether that key is still the one on screen.
   */
  const [listState, setListState] = React.useState<
    { items: SupportCaseSummary[] } | { error: string } | null
  >(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [detailState, setDetailState] = React.useState<
    { caseId: string; data: SupportCaseDetail } | { caseId: string; error: string } | null
  >(null);
  const [nonce, setNonce] = React.useState(0);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    void listSupportCases().then((result) => {
      if (cancelled) return;
      setListState(result.ok ? { items: result.data } : { error: errorText(result.error) });
    });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  React.useEffect(() => {
    if (openId === null) return;
    let cancelled = false;
    const requested = openId;
    void getSupportCase(requested).then((result) => {
      if (cancelled) return;
      setDetailState(
        result.ok
          ? { caseId: requested, data: result.data }
          : { caseId: requested, error: errorText(result.error) },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [openId, nonce]);

  // Derived, so a stale atom from a previously opened case can never render
  // under the case now on screen.
  const cases = listState === null ? null : "items" in listState ? listState.items : [];
  const listError = listState !== null && "error" in listState ? listState.error : null;
  const current = detailState !== null && detailState.caseId === openId ? detailState : null;
  const detail = current !== null && "data" in current ? current.data : null;
  const detailError = current !== null && "error" in current ? current.error : null;

  return (
    <div className="support-hub" data-testid="support-hub">
      <header className="support-hub__header">
        <h1>Поддержка</h1>
        <p>
          Задайте вопрос команде — по урокам, доступу, отчётам или техническим проблемам. Мы
          ответим здесь, и вы получите уведомление.
        </p>
      </header>

      {openId === null ? (
        <>
          <NewRequestForm
            onCreated={(id) => {
              reload();
              setOpenId(id);
            }}
          />

          <section className="support-hub__list" aria-label="Мои обращения">
            <h2>Мои обращения</h2>
            {cases === null ? (
              <p className="support-hub__muted" role="status">
                Загрузка…
              </p>
            ) : listError ? (
              <div className="support-hub__error" role="alert">
                <p>{listError}</p>
                <button type="button" onClick={reload}>
                  Повторить
                </button>
              </div>
            ) : cases.length === 0 ? (
              <p className="support-hub__muted">
                Обращений пока нет. Опишите вопрос в форме выше — мы ответим.
              </p>
            ) : (
              <ul>
                {cases.map((row) => (
                  <li key={row.id}>
                    <button type="button" onClick={() => setOpenId(row.id)}>
                      <span className="support-hub__subject">{row.subject}</span>
                      <span className="support-hub__meta">
                        {row.reference} · {statusText(row.status)} · {when(row.lastActivityAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <CaseThread
          detail={detail}
          error={detailError}
          onBack={() => setOpenId(null)}
          onReplied={reload}
        />
      )}
    </div>
  );
}

function NewRequestForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [subject, setSubject] = React.useState("");
  const [details, setDetails] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <section className="support-hub__new" aria-label="Новое обращение">
      <h2>Новое обращение</h2>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !subject.trim() || !details.trim()) return;
          setBusy(true);
          setError(null);
          const result = await openSupportCase({
            subject: subject.trim(),
            details: details.trim(),
          });
          setBusy(false);
          if (result.ok) {
            setSubject("");
            setDetails("");
            onCreated(result.data.id);
            return;
          }
          // The flood control is a 409 and deserves its own sentence: it is not
          // a failure, it is "we already have your open requests".
          setError(
            result.error.status === 409
              ? "У вас уже есть открытые обращения — дождитесь ответа по ним."
              : errorText(result.error),
          );
        }}
      >
        <label htmlFor="support-subject">Тема</label>
        <input
          id="support-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          maxLength={200}
          placeholder="Коротко: в чём вопрос"
          required
        />

        <label htmlFor="support-details">Опишите подробнее</label>
        <textarea
          id="support-details"
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          rows={5}
          maxLength={8000}
          placeholder="Что произошло, на каком уроке, что вы уже пробовали"
          required
        />

        {error ? (
          <p className="support-hub__error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={busy || !subject.trim() || !details.trim()}>
          {busy ? "Отправка…" : "Отправить обращение"}
        </button>
      </form>
    </section>
  );
}

function CaseThread({
  detail,
  error,
  onBack,
  onReplied,
}: {
  detail: SupportCaseDetail | null;
  error: string | null;
  onBack: () => void;
  onReplied: () => void;
}) {
  const [reply, setReply] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [replyError, setReplyError] = React.useState<string | null>(null);

  return (
    <section className="support-hub__thread" aria-label="Обращение">
      <button type="button" className="support-hub__back" onClick={onBack}>
        ← Ко всем обращениям
      </button>

      {error ? (
        <p className="support-hub__error" role="alert">
          {error}
        </p>
      ) : detail === null ? (
        <p className="support-hub__muted" role="status">
          Загрузка…
        </p>
      ) : (
        <>
          <header>
            <h2>{detail.subject}</h2>
            <p className="support-hub__meta">
              {detail.reference} · {statusText(detail.status)}
            </p>
          </header>

          <p className="support-hub__original">{detail.details}</p>

          <ol className="support-hub__messages">
            {detail.messages.map((message) => (
              <li
                key={message.id}
                className={
                  message.authorKind === "staff"
                    ? "support-hub__message support-hub__message--staff"
                    : "support-hub__message support-hub__message--mine"
                }
              >
                <span className="support-hub__meta">
                  {message.authorKind === "staff" ? message.authorName : "Вы"} ·{" "}
                  {when(message.createdAt)}
                </span>
                <p>{message.body}</p>
              </li>
            ))}
          </ol>

          {CLOSED_STATUSES.has(detail.status) ? (
            // A closed thread is not an error state, and it says what to do
            // next rather than leaving a disabled box with no explanation.
            <p className="support-hub__muted">
              Обращение закрыто. Если вопрос остался — создайте новое обращение.
            </p>
          ) : (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy || !reply.trim()) return;
                setBusy(true);
                setReplyError(null);
                const result = await replyToSupportCase(detail.id, reply.trim());
                setBusy(false);
                if (result.ok) {
                  setReply("");
                  onReplied();
                  return;
                }
                setReplyError(errorText(result.error));
              }}
            >
              <label htmlFor="support-reply">Ваш ответ</label>
              <textarea
                id="support-reply"
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                rows={4}
                maxLength={8000}
                placeholder="Добавьте подробности или ответьте команде"
              />
              {replyError ? (
                <p className="support-hub__error" role="alert">
                  {replyError}
                </p>
              ) : null}
              <button type="submit" disabled={busy || !reply.trim()}>
                {busy ? "Отправка…" : "Отправить"}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
