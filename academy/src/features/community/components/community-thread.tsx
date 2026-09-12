"use client";

/**
 * A thread (/community/d/[discussionId]) — the question and its answers.
 *
 * ART DIRECTION: Direction A «Открытый вопрос». The question is the largest
 * thing on the page, its coordinates sit under it in mono, and the answers
 * follow in a lighter material with a signal tick on the leading edge.
 *
 * REPLIES ARE FLAT. There is no nesting control here because there is no
 * `parentReplyId` in the model — a depth that becomes unreadable at 390px
 * cannot be introduced by a later UI change alone.
 *
 * OWNERSHIP IS THE SERVER'S ANSWER. `canRemove` and `canReport` arrive per
 * item. Hiding a control is a convenience; the write routes re-check ownership
 * and refuse regardless of what this component rendered.
 */
import * as React from "react";
import Link from "next/link";
import {
  createReply,
  fetchCommunityThread,
  removeOwnContent,
  reportContent,
  type CommunityThreadView,
  type ReportReason,
} from "@/lib/community/community-client";
import { AuthorChip, Body, CommunitySkeleton, ErrorNote, OkNote, errorText, formatWhen } from "./community-atoms";

const REPLY_MAX = 4000;

const REASON_LABEL: Record<ReportReason, string> = {
  spam: "Спам или реклама",
  off_topic: "Не по теме пространства",
  abuse: "Оскорбления или травля",
  other: "Другое",
};

/**
 * The report dialog.
 *
 * Four reasons and an optional note — bounded on purpose. The reporter is never
 * shown to anyone, there is no public report count, and the confirmation says
 * only that it was received.
 */
function ReportDialog({
  target,
  onClose,
  onDone,
}: {
  target: { discussionId: string } | { replyId: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = React.useState<ReportReason>("spam");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const firstRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await reportContent(target, reason, note.trim() === "" ? undefined : note);
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result.error, "Не удалось отправить жалобу. Попробуйте ещё раз."));
      return;
    }
    onDone();
  };

  return (
    <div className="cm-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="cm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cm-report-title"
        ref={dialogRef}
      >
        <h2 id="cm-report-title">Пожаловаться на сообщение</h2>
        <form onSubmit={submit}>
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="cm-composer__label">Причина</legend>
            {(Object.keys(REASON_LABEL) as ReportReason[]).map((value, index) => (
              <label className="cm-radio" key={value}>
                <input
                  ref={index === 0 ? firstRef : undefined}
                  type="radio"
                  name="cm-report-reason"
                  value={value}
                  checked={reason === value}
                  onChange={() => setReason(value)}
                />
                {REASON_LABEL[value]}
              </label>
            ))}
          </fieldset>

          <label className="cm-composer__label" htmlFor="cm-report-note">
            Комментарий (необязательно)
          </label>
          <textarea
            id="cm-report-note"
            className="cm-field"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            style={{ minHeight: 72 }}
          />

          {error ? <ErrorNote text={error} /> : null}

          <div className="cm-actions" style={{ marginTop: 12 }}>
            <button type="submit" className="cm-btn cm-btn--primary" disabled={busy}>
              {busy ? "Отправляем…" : "Отправить"}
            </button>
            <button type="button" className="cm-btn" onClick={onClose} disabled={busy}>
              Отмена
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CommunityThread({ discussionId }: { discussionId: string }) {
  const [state, setState] = React.useState<
    { kind: "loading" } | { kind: "error"; text: string } | { kind: "ready"; data: CommunityThreadView }
  >({ kind: "loading" });
  const [replyBody, setReplyBody] = React.useState("");
  const [replyBusy, setReplyBusy] = React.useState(false);
  const [replyError, setReplyError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [reportTarget, setReportTarget] = React.useState<
    { discussionId: string } | { replyId: string } | null
  >(null);

  // Bumped after a successful write so the thread re-reads from the server
  // rather than being patched locally: the reply that comes back carries the
  // author projection and the ownership flags the server decided, and guessing
  // them here is how a client starts disagreeing with the record.
  const [nonce, setNonce] = React.useState(0);
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    // NO AbortController, and that is the fix rather than an omission.
    //
    // COMMUNITY-V1 aborted the in-flight read on cleanup. When React runs an
    // effect, cleans it up and settles — which the App Router does — the abort
    // lands on the read whose `.then` is then skipped because `cancelled` is
    // true, and the surface stays on its skeleton forever with no error and no
    // request in the network panel. Reproduced in a real browser at mobile
    // width: `/support`, which uses the pattern below, loaded its list in the
    // same tab seconds before `/community` failed to load its own.
    //
    // The stale-response guard is the `cancelled` flag alone, exactly as
    // `support-hub.tsx` does it. Aborting a short JSON GET saves nothing worth
    // a permanently stuck surface.
    let cancelled = false;
    void fetchCommunityThread(discussionId).then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { kind: "ready", data: result.data }
          : { kind: "error", text: errorText(result.error) },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [discussionId, nonce]);

  const submitReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (replyBody.trim().length === 0) {
      setReplyError("Напишите ответ.");
      return;
    }
    if (replyBody.trim().length > REPLY_MAX) {
      setReplyError(`Не длиннее ${REPLY_MAX} символов.`);
      return;
    }
    setReplyBusy(true);
    setReplyError(null);
    const result = await createReply(discussionId, replyBody);
    setReplyBusy(false);
    if (!result.ok) {
      setReplyError(errorText(result.error, "Не удалось отправить ответ. Текст сохранён."));
      return;
    }
    setReplyBody("");
    reload();
  };

  const remove = async (target: { discussionId: string } | { replyId: string }) => {
    const result = await removeOwnContent(target);
    if (!result.ok) {
      setNotice(null);
      setReplyError(errorText(result.error, "Не удалось удалить сообщение."));
      return;
    }
    setNotice("Сообщение удалено.");
    reload();
  };

  if (state.kind === "loading") return <CommunitySkeleton heading="Обсуждение" plates={0} lines={4} />;

  if (state.kind === "error") {
    return (
      <div className="cm">
        <nav className="cm-breadcrumb" aria-label="Хлебные крошки">
          <Link href="/community">Сообщество</Link>
        </nav>
        <ErrorNote text={state.text} />
        <div className="cm-actions">
          <Link className="cm-btn" href="/community">
            Вернуться в сообщество
          </Link>
        </div>
      </div>
    );
  }

  const { discussion, space, replies } = state.data;
  const visibleReplies = replies.length;

  return (
    <div className="cm">
      <nav className="cm-breadcrumb" aria-label="Хлебные крошки">
        <Link href="/community">Сообщество</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/community/${space.code}`}>{space.title}</Link>
      </nav>

      <article className="cm-question">
        <h1 className="cm-question__title">{discussion.title}</h1>
        <div className="cm-coords">
          <AuthorChip author={discussion.author} />
          <span>· {formatWhen(discussion.createdAt)}</span>
        </div>
        <Body body={discussion.body} />
        <div className="cm-inline-actions">
          {discussion.canRemove ? (
            <button
              type="button"
              className="cm-linkbtn"
              onClick={() => void remove({ discussionId: discussion.id })}
            >
              Удалить свой вопрос
            </button>
          ) : null}
          {discussion.canReport ? (
            <button
              type="button"
              className="cm-linkbtn"
              onClick={() => setReportTarget({ discussionId: discussion.id })}
            >
              Пожаловаться
            </button>
          ) : null}
        </div>
      </article>

      {notice ? <OkNote text={notice} /> : null}

      <section aria-labelledby="cm-answers-heading" className="cm-question">
        <h2 className="cm-answers__heading" id="cm-answers-heading">
          {visibleReplies === 0 ? "Ответов пока нет" : `Ответы (${visibleReplies})`}
        </h2>

        {visibleReplies === 0 ? (
          <p className="cm-empty-invite">
            Если вы проходили это — ответьте. Один разбор здесь экономит другому человеку неделю.
          </p>
        ) : (
          <ul className="cm-answers">
            {replies.map((reply) => (
              <li
                key={reply.id}
                className={
                  reply.author.roleLabel
                    ? "cm-answer cm-answer--staff"
                    : reply.author.isViewer
                      ? "cm-answer cm-answer--own"
                      : "cm-answer"
                }
              >
                <div className="cm-coords">
                  <AuthorChip author={reply.author} />
                  <span>· {formatWhen(reply.createdAt)}</span>
                </div>
                <Body body={reply.body} />
                <div className="cm-inline-actions">
                  {reply.canRemove ? (
                    <button
                      type="button"
                      className="cm-linkbtn"
                      onClick={() => void remove({ replyId: reply.id })}
                    >
                      Удалить
                    </button>
                  ) : null}
                  {reply.canReport ? (
                    <button
                      type="button"
                      className="cm-linkbtn"
                      onClick={() => setReportTarget({ replyId: reply.id })}
                    >
                      Пожаловаться
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {space.canWrite && discussion.body.kind === "visible" ? (
        <form className="cm-composer" onSubmit={submitReply} noValidate>
          <label className="cm-composer__label" htmlFor="cm-reply">
            Ваш ответ
          </label>
          <textarea
            id="cm-reply"
            className="cm-field"
            value={replyBody}
            maxLength={REPLY_MAX + 100}
            onChange={(e) => setReplyBody(e.target.value)}
            aria-invalid={replyError ? true : undefined}
            aria-describedby={replyError ? "cm-reply-err" : "cm-reply-hint"}
          />
          {replyError ? (
            <p className="cm-note cm-note--error" id="cm-reply-err" role="alert">
              {replyError}
            </p>
          ) : (
            <p className="cm-hint" id="cm-reply-hint">
              {replyBody.trim().length}/{REPLY_MAX} · обычный текст, разметка не применяется
            </p>
          )}
          <div className="cm-actions">
            <button type="submit" className="cm-btn cm-btn--primary" disabled={replyBusy}>
              {replyBusy ? "Отправляем…" : "Ответить"}
            </button>
          </div>
        </form>
      ) : discussion.body.kind !== "visible" ? (
        <p className="cm-note cm-note--muted">Это обсуждение закрыто для новых ответов.</p>
      ) : (
        <p className="cm-note cm-note--muted">
          Отвечать здесь можно после того, как это пространство откроется для сообщений.
        </p>
      )}

      {reportTarget ? (
        <ReportDialog
          target={reportTarget}
          onClose={() => setReportTarget(null)}
          onDone={() => {
            setReportTarget(null);
            setNotice("Жалоба отправлена. Модератор посмотрит это сообщение.");
          }}
        />
      ) : null}
    </div>
  );
}
