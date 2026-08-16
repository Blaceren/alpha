"use client";

/**
 * A space (/community/[spaceCode]) — its discussions, and the way to add one.
 *
 * ART DIRECTION: Direction A «Открытый вопрос». The list is questions at
 * reading size with their coordinates beneath — author, module, answer count,
 * time. Not rows in a table and not cards in a grid.
 *
 * WRITE ACCESS COMES FROM THE SERVER. `canWrite` is rendered, never computed:
 * a learner who may read this space and not post in it sees why, in modules,
 * and does not see a composer that would fail.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createDiscussion,
  fetchCommunitySpace,
  type CommunitySpaceView,
} from "@/lib/community/community-client";
import { AuthorChip, CommunitySkeleton, ErrorNote, errorText, formatWhen } from "./community-atoms";
import { pluralAnswers } from "./community-home";

const TITLE_MAX = 140;
const BODY_MAX = 4000;

function Composer({
  spaceCode,
  onCreated,
}: {
  spaceCode: string;
  onCreated: (discussionId: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<{ title?: string; body?: string }>({});
  const titleRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <div className="cm-actions">
        <button type="button" className="cm-btn cm-btn--primary" onClick={() => setOpen(true)}>
          Задать вопрос
        </button>
      </div>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    // Client-side validation exists to give a fast, field-anchored message.
    // It is NOT the boundary — the server validates the same bounds and its
    // refusal is what decides.
    const nextFieldError: { title?: string; body?: string } = {};
    if (title.trim().length < 3) nextFieldError.title = "Сформулируйте вопрос хотя бы в трёх символах.";
    if (title.trim().length > TITLE_MAX) nextFieldError.title = `Не длиннее ${TITLE_MAX} символов.`;
    if (body.trim().length === 0) nextFieldError.body = "Опишите, что именно не получается.";
    if (body.trim().length > BODY_MAX) nextFieldError.body = `Не длиннее ${BODY_MAX} символов.`;
    setFieldError(nextFieldError);
    if (Object.keys(nextFieldError).length > 0) return;

    setBusy(true);
    setError(null);
    const result = await createDiscussion(spaceCode, { title, body });
    setBusy(false);
    if (!result.ok) {
      // A refused write never renders as success. The draft is kept so the
      // learner does not retype it.
      setError(errorText(result.error, "Не удалось опубликовать вопрос. Текст сохранён — попробуйте ещё раз."));
      return;
    }
    onCreated(result.data.id);
  };

  return (
    <form className="cm-composer" onSubmit={submit} noValidate>
      <label className="cm-composer__label" htmlFor="cm-title">
        Вопрос
      </label>
      <input
        id="cm-title"
        ref={titleRef}
        className="cm-field"
        value={title}
        maxLength={TITLE_MAX + 20}
        onChange={(e) => setTitle(e.target.value)}
        aria-invalid={fieldError.title ? true : undefined}
        aria-describedby={fieldError.title ? "cm-title-err" : "cm-title-hint"}
      />
      {fieldError.title ? (
        <p className="cm-note cm-note--error" id="cm-title-err" role="alert">
          {fieldError.title}
        </p>
      ) : (
        <p className="cm-hint" id="cm-title-hint">
          {title.trim().length}/{TITLE_MAX}
        </p>
      )}

      <label className="cm-composer__label" htmlFor="cm-body">
        Что уже пробовали
      </label>
      <textarea
        id="cm-body"
        className="cm-field"
        value={body}
        maxLength={BODY_MAX + 100}
        onChange={(e) => setBody(e.target.value)}
        aria-invalid={fieldError.body ? true : undefined}
        aria-describedby={fieldError.body ? "cm-body-err" : "cm-body-hint"}
      />
      {fieldError.body ? (
        <p className="cm-note cm-note--error" id="cm-body-err" role="alert">
          {fieldError.body}
        </p>
      ) : (
        <p className="cm-hint" id="cm-body-hint">
          {body.trim().length}/{BODY_MAX} · обычный текст, разметка не применяется
        </p>
      )}

      {error ? <ErrorNote text={error} /> : null}

      <div className="cm-actions">
        <button type="submit" className="cm-btn cm-btn--primary" disabled={busy}>
          {busy ? "Публикуем…" : "Опубликовать"}
        </button>
        <button type="button" className="cm-btn" onClick={() => setOpen(false)} disabled={busy}>
          Отмена
        </button>
      </div>
    </form>
  );
}

export function CommunitySpace({ spaceCode }: { spaceCode: string }) {
  const router = useRouter();
  const [state, setState] = React.useState<
    { kind: "loading" } | { kind: "error"; text: string } | { kind: "ready"; data: CommunitySpaceView }
  >({ kind: "loading" });

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
    void fetchCommunitySpace(spaceCode).then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { kind: "ready", data: result.data }
          : { kind: "error", text: errorText(result.error, "Это пространство пока недоступно.") },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [spaceCode]);

  if (state.kind === "loading") return <CommunitySkeleton heading="Сообщество" plates={0} lines={4} />;

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

  const { space, discussions } = state.data;

  return (
    <div className="cm">
      <nav className="cm-breadcrumb" aria-label="Хлебные крошки">
        <Link href="/community">Сообщество</Link>
        <span aria-hidden="true">/</span>
        <span>{space.title}</span>
      </nav>

      <div className="cm__head">
        <h1>{space.title}</h1>
      </div>
      <p className="cm__lede">{space.purpose}</p>

      {space.canWrite ? (
        <Composer spaceCode={space.code} onCreated={(id) => router.push(`/community/d/${id}`)} />
      ) : (
        <p className="cm-note cm-note--muted">
          {space.requiredModuleNumber !== null
            ? `Задавать вопросы здесь можно после завершения модуля ${space.requiredModuleNumber}. Читать — уже сейчас.`
            : "Задавать вопросы здесь можно по мере прохождения программы. Читать — уже сейчас."}
        </p>
      )}

      {discussions.length === 0 ? (
        <p className="cm-empty-invite">
          {space.canWrite
            ? "Пока пусто. Первый вопрос обычно оказывается общим — задайте его."
            : "Пока здесь нет обсуждений."}
        </p>
      ) : (
        <ul className="cm-list">
          {discussions.map((discussion) => (
            <li className="cm-list__item" key={discussion.id}>
              <Link className="cm-list__link" href={`/community/d/${discussion.id}`}>
                <p
                  className={
                    discussion.isRemoved ? "cm-list__title cm-list__title--removed" : "cm-list__title"
                  }
                >
                  {discussion.title}
                </p>
                <span className="cm-preview__meta">
                  <AuthorChip author={discussion.author} />
                  <span>
                    ·{" "}
                    {discussion.replyCount === 0
                      ? "пока без ответов"
                      : `${discussion.replyCount} ${pluralAnswers(discussion.replyCount)}`}
                  </span>
                  <span>· {formatWhen(discussion.lastActivityAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
