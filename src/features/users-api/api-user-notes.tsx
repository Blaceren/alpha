"use client";

import * as React from "react";
import type { CrmApiUserNote } from "@/data/contracts/api/user-notes";
import type { CrmUsersReadCapability } from "@/data/api/api-crm-data-provider";
import {
  countCodePoints,
  NOTE_BODY_MAX_CODE_POINTS,
  validateNoteBody,
} from "@/data/contracts/api/user-notes";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useApiUserNotes } from "./use-api-user-notes";

/**
 * Production Notes v1 — immutable, append-only.
 *
 * Deliberately NOT the mock `UserNotes` feature. The production contract
 * carries four fields; it has no visibility axis, no pinning, no per-note
 * capabilities and no edit or delete. Rendering the mock's controls here would
 * promise operations that no endpoint implements.
 *
 * Every affordance is decided by `effectivePermissions` handed down from the
 * validated session — never by role name.
 */

/**
 * Deterministic UTC timestamp. The Notes contract carries no staff timezone, so
 * inventing a local one would silently show two employees different times for
 * the same note. UTC is labelled explicitly rather than left ambiguous.
 */
export function formatNoteTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${date.getUTCFullYear()}, ${hh}:${mi} UTC`;
}

function NoteRow({ note }: { note: CrmApiUserNote }) {
  return (
    <li className="rounded-md border border-border px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-medium text-text-primary">{note.authorDisplayName}</span>
        <time dateTime={note.createdAt} className="text-2xs tabular-nums text-text-muted">
          {formatNoteTimestamp(note.createdAt)}
        </time>
      </div>
      {/*
        Plain text. React escapes it, so a body is never interpreted as markup —
        there is no dangerouslySetInnerHTML and no Markdown renderer anywhere in
        this feature. `whitespace-pre-wrap` preserves the author's line breaks;
        `break-words` keeps a long URL from forcing horizontal overflow.
      */}
      <p className="mt-1 whitespace-pre-wrap break-words text-xs text-text-primary">{note.body}</p>
    </li>
  );
}

function NoteComposer({
  onSubmit,
  pending,
  disabled,
  serverError,
  announce,
  draft,
  setDraft,
}: {
  onSubmit: (body: string) => void;
  pending: boolean;
  disabled: boolean;
  serverError: string | null;
  announce: string | null;
  draft: string;
  setDraft: (value: string) => void;
}) {
  const id = React.useId();
  const textareaId = `${id}-body`;
  const counterId = `${id}-counter`;
  const errorId = `${id}-error`;

  const validation = validateNoteBody(draft);
  const count = countCodePoints(draft);
  const overLimit = count > NOTE_BODY_MAX_CODE_POINTS;

  // Only surface a local complaint once the employee has typed something —
  // an empty composer is not an error state.
  const localError =
    draft.trim().length === 0
      ? null
      : !validation.ok
        ? validation.reason === "too_long"
          ? `Заметка длиннее ${NOTE_BODY_MAX_CODE_POINTS} символов.`
          : validation.reason === "control_char"
            ? "Заметка содержит недопустимые управляющие символы."
            : "Заметка не может быть пустой."
        : null;

  const shownError = serverError ?? localError;

  return (
    <form
      className="mt-4 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || disabled || !validation.ok) return;
        onSubmit(draft);
      }}
    >
      <label htmlFor={textareaId} className="block text-xs font-medium text-text-primary">
        Новая заметка
      </label>
      <textarea
        id={textareaId}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={3}
        disabled={disabled}
        aria-invalid={shownError !== null}
        aria-describedby={`${counterId}${shownError ? ` ${errorId}` : ""}`}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        placeholder="Текст заметки"
      />
      <p className="text-2xs text-text-muted">
        Внутренняя заметка CRM. Пользователь её не увидит. Только обычный текст — разметка не
        поддерживается.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Counter uses code points, so an emoji counts as one — matching the
            server bound rather than UTF-16 length. */}
        <span
          id={counterId}
          className={`text-2xs tabular-nums ${overLimit ? "text-danger" : "text-text-muted"}`}
        >
          {count} / {NOTE_BODY_MAX_CODE_POINTS}
        </span>
        <Button type="submit" disabled={pending || disabled || !validation.ok}>
          {pending ? "Добавляем…" : "Добавить заметку"}
        </Button>
      </div>
      {shownError ? (
        <p id={errorId} role="alert" className="text-2xs text-danger">
          {shownError}
        </p>
      ) : null}
      {/* Polite status so a success is announced even when the employee cannot
          list notes and therefore sees no new row. */}
      <p role="status" aria-live="polite" className="text-2xs text-text-secondary">
        {announce ?? ""}
      </p>
    </form>
  );
}

export function ApiUserNotesSection({
  userId,
  canList,
  canCreate,
  provider,
  onUnauthenticated,
  onNotFound,
}: {
  userId: string;
  canList: boolean;
  canCreate: boolean;
  provider?: CrmUsersReadCapability;
  onUnauthenticated: () => void;
  onNotFound: () => void;
}) {
  const notes = useApiUserNotes(userId, canList, canCreate, provider);
  const [draft, setDraft] = React.useState("");
  // Once the backend says the employee may not create, stop offering the
  // control for the rest of this session state rather than inviting a retry
  // that cannot succeed.
  const [createForbidden, setCreateForbidden] = React.useState(false);

  const { createState, listState } = notes;

  // A 401 or 404 from Notes is an account-level answer, not a section-level one.
  React.useEffect(() => {
    if (listState.kind === "unauthenticated" || createState.kind === "unauthenticated") {
      onUnauthenticated();
    }
  }, [listState.kind, createState.kind, onUnauthenticated]);

  React.useEffect(() => {
    if (listState.kind === "not_found" || createState.kind === "not_found") onNotFound();
  }, [listState.kind, createState.kind, onNotFound]);

  // Clear the draft ONLY after a validated 201.
  React.useEffect(() => {
    if (createState.kind === "created") setDraft("");
    if (createState.kind === "forbidden") setCreateForbidden(true);
  }, [createState.kind]);

  // The learner changed: drop the draft with the notes, so text written about
  // one learner can never be submitted against another.
  React.useEffect(() => {
    setDraft("");
    setCreateForbidden(false);
  }, [userId]);

  const createError =
    createState.kind === "forbidden"
      ? "Нет доступа к добавлению заметок"
      : createState.kind === "invalid_input"
        ? "Заметку не удалось проверить. Измените текст и попробуйте снова."
        : createState.kind === "upstream_unavailable"
          ? "Не удалось добавить заметку. Попробуйте ещё раз."
          : createState.kind === "malformed"
            ? "Ответ сервиса не прошёл проверку. Заметка могла не сохраниться — проверьте список."
            : null;

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-text-muted">
        Заметки
      </h2>

      {canList ? (
        <>
          {listState.kind === "loading" ? (
            <div role="status" aria-live="polite">
              <span className="sr-only">Загружаем заметки</span>
              <SkeletonRows rows={2} />
            </div>
          ) : null}

          {listState.kind === "ready" && notes.notes.length === 0 ? (
            <p className="text-xs text-text-secondary">Заметок пока нет</p>
          ) : null}

          {notes.notes.length > 0 ? (
            <ul className="space-y-2">
              {notes.notes.map((note) => (
                <NoteRow key={note.noteId} note={note} />
              ))}
            </ul>
          ) : null}

          {listState.kind === "ready" && notes.hasMore ? (
            <div className="mt-3">
              <Button variant="secondary" onClick={notes.loadMore} disabled={notes.loadingMore}>
                {notes.loadingMore ? "Загружаем…" : "Показать ещё"}
              </Button>
            </div>
          ) : null}

          {notes.loadMoreFailed ? (
            <p role="alert" className="mt-2 text-2xs text-danger">
              Не удалось загрузить следующую страницу заметок. Попробуйте ещё раз.
            </p>
          ) : null}

          {listState.kind === "forbidden" ? (
            <p className="text-xs text-text-secondary">Нет доступа к заметкам</p>
          ) : null}

          {listState.kind === "invalid_input" ? (
            <p role="alert" className="text-xs text-danger">
              Некорректный запрос заметок
            </p>
          ) : null}

          {listState.kind === "upstream_unavailable" || listState.kind === "malformed" ? (
            <div role="alert">
              <p className="text-xs text-danger">
                {listState.kind === "malformed"
                  ? "Ответ сервиса не прошёл проверку. Заметки не показаны."
                  : "Не удалось загрузить заметки."}
              </p>
              <Button variant="secondary" className="mt-2" onClick={notes.retryList}>
                Повторить
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {canCreate && !createForbidden ? (
        <NoteComposer
          draft={draft}
          setDraft={(value) => {
            setDraft(value);
            if (createState.kind !== "idle" && createState.kind !== "pending") {
              notes.resetCreateState();
            }
          }}
          pending={createState.kind === "pending"}
          disabled={false}
          serverError={createError}
          announce={createState.kind === "created" ? "Заметка добавлена" : null}
          onSubmit={notes.submit}
        />
      ) : null}

      {canCreate && createForbidden ? (
        <p role="alert" className="mt-3 text-xs text-danger">
          Нет доступа к добавлению заметок
        </p>
      ) : null}
    </section>
  );
}
