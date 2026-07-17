"use client";

import * as React from "react";
import type { CrmDataProvider, CrmNote, CrmNoteListItem } from "@/data/contracts/CrmDataProvider";
import type { CrmMutations } from "@/data/contracts/CrmMutations";
import type { Paginated, Result } from "@/data/contracts/result";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import {
  NOTES_LABEL,
  NOTE_EDIT_LABEL,
  NOTE_PIN_LABEL,
  NOTE_VISIBILITY_LABEL,
} from "@/config/labels";
import { canEditUserNotes } from "@/domain/identity/access";
import { NOTE_BODY_MAX_LENGTH, normalizeNoteBody } from "@/domain/notes/note";
import { useSession } from "@/components/crm-shell/session-context";
import { formatExactTime, formatRelativeTime } from "@/lib/format";
import { displayNowMs } from "@/features/users/lib/display-clock";
import { SectionCard } from "./section-card";
import { NoteComposer } from "./note-composer";
import { useUserNotes } from "../hooks/use-user-notes";
import { useSetNotePinned, type UseSetNotePinned } from "../hooks/use-set-note-pinned";
import { useUpdateNoteBody, type UseUpdateNoteBody } from "../hooks/use-update-note-body";
import { noteErrorMessage } from "../lib/note-error";
import { notePinErrorMessage } from "../lib/note-pin-error";
import { noteEditErrorMessage } from "../lib/note-edit-error";

/**
 * Notes on the User 360 (Phase 1B4-B; pinning added in 1B4-D, body editing in
 * 1B4-E) — the screen's second, independent read.
 *
 * What this component does NOT do is the point of it: it does not decide which
 * notes are visible, it does not order them, it does not decide which notes are
 * editable, and it never splices a created, re-pinned or edited note into the
 * list. `getUserNotesView` projects (D-55), resolves the effective pin from the
 * audit log (D-76), sorts (contract §7) and annotates each note with the actor's
 * capabilities (D-82); this renders what came back. After a successful write it
 * re-reads rather than mutating the list locally — an optimistic edit would be
 * React holding a second opinion, which is the drift D-39/D-40 had to undo.
 */
export function UserNotes({
  userId,
  providerOverride,
  mutationsOverride,
}: {
  userId: string;
  providerOverride?: CrmDataProvider;
  mutationsOverride?: CrmMutations;
}) {
  const { session } = useSession();
  const { result, loading, refetch } = useUserNotes(userId, providerOverride);

  // The single source for the WRITE right (D-53). React must not carry its own
  // list of roles: a second list is a list that drifts from the matrix. The SAME
  // right gates writing a note, pinning one and editing one. Whether an individual
  // note may be EDITED is a per-note capability the provider owns (canEditBody);
  // this only decides whether the composer and the pin controls are offered.
  const canWrite = canEditUserNotes(session.role);

  const pin = useSetNotePinned(userId, { mutationsOverride });
  const edit = useUpdateNoteBody(userId, { mutationsOverride });

  // Which note (if any) is open for editing. Single-valued, so only one note is
  // ever in edit mode at a time.
  const [editingNoteId, setEditingNoteId] = React.useState<string | null>(null);

  // One ref per rendered pin/edit control, keyed by note id, so focus can return to
  // the right control after the list reorders or an editor closes under it.
  const pinButtonRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const editButtonRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const pinFocusRef = React.useRef<string | null>(null);
  const editFocusRef = React.useRef<string | null>(null);

  const items = result?.data?.items ?? [];

  // A role/session switch discards any open draft: an edit begun as one role must
  // not be saved as another. The hooks clear their own attempt/feedback; this drops
  // the editor. Keyed on identity, not on `session`, so an unrelated re-render does
  // not close an editor mid-type.
  const sessionIdentity = `${session.employeeId}:${session.role}`;
  React.useEffect(() => {
    setEditingNoteId(null);
  }, [sessionIdentity]);

  /**
   * Return focus to the acted note's pin control once the pin operation settles.
   * Keyed on `result` (changes after a refetch) and `pin.status` (changes when a
   * no-refetch error resolves). The control is found by note id, not DOM position.
   */
  React.useEffect(() => {
    const target = pinFocusRef.current;
    if (!target || pin.status === "pending") return;
    const btn = pinButtonRefs.current.get(target);
    if (btn) {
      btn.focus();
      pinFocusRef.current = null;
    }
  }, [result, pin.status]);

  /**
   * Return focus to the acted note's "Изменить" control after the editor closes —
   * on save success, on conflict/not_found (both re-read), and on cancel/Escape
   * (no re-read). `editingNoteId` is in the deps so a cancel, which changes nothing
   * else, still triggers the restore; `result`/`edit.status` cover the async paths.
   */
  React.useEffect(() => {
    const target = editFocusRef.current;
    if (!target || edit.status === "pending" || editingNoteId !== null) return;
    const btn = editButtonRefs.current.get(target);
    if (btn) {
      btn.focus();
      editFocusRef.current = null;
    }
  }, [result, edit.status, editingNoteId]);

  const onTogglePin = React.useCallback(
    async (note: CrmNote) => {
      // The desired end state is the opposite of what is shown; `expectedPinned`
      // is what is shown, so the provider can detect a race (D-77).
      const { ok, code } = await pin.submit({
        noteId: note.id,
        pinned: !note.pinned,
        expectedPinned: note.pinned,
      });
      pinFocusRef.current = note.id;
      // Re-read on success (order changed) and on conflict (show what won). A
      // storage failure wrote nothing, so the list is already correct.
      if (ok || code === "conflict") refetch();
    },
    [pin, refetch],
  );

  const onStartEdit = React.useCallback(
    (noteId: string) => {
      edit.clearFeedback();
      setEditingNoteId(noteId);
    },
    [edit],
  );

  const onCancelEdit = React.useCallback((noteId: string) => {
    // Discard the draft (the editor unmounts) and hand focus back to its control.
    editFocusRef.current = noteId;
    setEditingNoteId(null);
  }, []);

  const onSaveEdit = React.useCallback(
    async (note: CrmNote, draft: string) => {
      const { ok, code } = await edit.submit({
        noteId: note.id,
        body: draft,
        // The note's `updatedAt` as this actor last read it — the concurrency
        // precondition (D-82).
        expectedUpdatedAt: note.updatedAt,
      });
      if (ok || code === "conflict" || code === "not_found") {
        // Close the editor and re-read: success reorders/updates, a conflict or a
        // vanished note must show what is actually stored now. Focus returns to the
        // note's edit control.
        editFocusRef.current = note.id;
        setEditingNoteId(null);
        refetch();
        return;
      }
      // internal / invalid_input / upstream — nothing was written, so keep the draft
      // open for a retry under the SAME key; focus stays in the editor.
    },
    [edit, refetch],
  );

  return (
    <SectionCard
      title={NOTES_LABEL.title}
      aside={items.length > 0 ? String(items.length) : undefined}
    >
      {canWrite ? (
        <NoteComposer userId={userId} onAdded={refetch} mutationsOverride={mutationsOverride} />
      ) : (
        // A calm sentence, not a disabled button: a dead control advertises a
        // capability this role will never have, and cannot be focused to explain
        // itself to a screen reader (DECISIONS D-59).
        <p className="mb-3 text-xs text-text-muted">{NOTES_LABEL.forbidden}</p>
      )}

      <NotesList
        result={result}
        loading={loading}
        onRetry={refetch}
        canPin={canWrite}
        pin={pin}
        edit={edit}
        editingNoteId={editingNoteId}
        onTogglePin={onTogglePin}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onSaveEdit={onSaveEdit}
        registerPinButton={(id, el) => {
          if (el) pinButtonRefs.current.set(id, el);
          else pinButtonRefs.current.delete(id);
        }}
        registerEditButton={(id, el) => {
          if (el) editButtonRefs.current.set(id, el);
          else editButtonRefs.current.delete(id);
        }}
      />
    </SectionCard>
  );
}

interface RowCallbacks {
  onTogglePin: (note: CrmNote) => void;
  onStartEdit: (noteId: string) => void;
  onCancelEdit: (noteId: string) => void;
  onSaveEdit: (note: CrmNote, draft: string) => void;
  registerPinButton: (id: string, el: HTMLButtonElement | null) => void;
  registerEditButton: (id: string, el: HTMLButtonElement | null) => void;
}

function NotesList({
  result,
  loading,
  onRetry,
  canPin,
  pin,
  edit,
  editingNoteId,
  ...callbacks
}: {
  result: Result<Paginated<CrmNoteListItem>> | null;
  loading: boolean;
  onRetry: () => void;
  canPin: boolean;
  pin: UseSetNotePinned;
  edit: UseUpdateNoteBody;
  editingNoteId: string | null;
} & RowCallbacks) {
  // Local to the section: a notes failure must not replace the profile, and a
  // notes load must not hold it up.
  if (loading && !result) {
    return (
      <div className="space-y-2" role="status" aria-label={NOTES_LABEL.loading}>
        <Skeleton className="h-16 w-full rounded-md" />
      </div>
    );
  }

  if (result?.status === "error") {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-xs text-danger">
          {noteErrorMessage(result.error?.code)}
        </p>
        {result.error?.retriable ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {NOTES_LABEL.retry}
          </Button>
        ) : null}
      </div>
    );
  }

  const items = result?.data?.items ?? [];
  if (items.length === 0) {
    // Says what this role has to show. It does not claim the user has no notes:
    // a note hidden from this actor is removed before it ever gets here.
    return <p className="text-xs text-text-muted">{NOTES_LABEL.empty}</p>;
  }

  return (
    <ol className="space-y-2">
      {items.map((item) => (
        <NoteRow
          key={item.note.id}
          item={item}
          canPin={canPin}
          pin={pin}
          edit={edit}
          isEditing={editingNoteId === item.note.id}
          {...callbacks}
        />
      ))}
    </ol>
  );
}

function NoteRow({
  item,
  canPin,
  pin,
  edit,
  isEditing,
  onTogglePin,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  registerPinButton,
  registerEditButton,
}: {
  item: CrmNoteListItem;
  canPin: boolean;
  pin: UseSetNotePinned;
  edit: UseUpdateNoteBody;
  isEditing: boolean;
} & RowCallbacks) {
  const note = item.note;
  const canEditBody = item.capabilities.canEditBody;

  const pinActive = pin.active?.noteId === note.id;
  const pinPending = pinActive && pin.status === "pending";

  // Feedback is shown only on the note the current operation is about, so success
  // on one note does not annotate another. Pin and edit feedback are mutually
  // exclusive in practice; each is guarded by its own `active`.
  const pinFeedback: { tone: "success" | "error"; text: string } | null =
    pinActive && pin.status === "success"
      ? {
          tone: "success",
          text: pin.active?.pinned ? NOTE_PIN_LABEL.successPinned : NOTE_PIN_LABEL.successUnpinned,
        }
      : pinActive && pin.status === "error"
        ? { tone: "error", text: notePinErrorMessage(pin.errorCode ?? undefined) }
        : null;

  // Edit feedback shown on the row only once the editor has closed (success,
  // conflict, not_found). Keep-draft errors stay inside the editor instead.
  const editActive = edit.active?.noteId === note.id;
  const editFeedback: { tone: "success" | "error"; text: string } | null =
    !isEditing && editActive && edit.status === "success"
      ? { tone: "success", text: NOTE_EDIT_LABEL.success }
      : !isEditing && editActive && edit.status === "error"
        ? { tone: "error", text: noteEditErrorMessage(edit.errorCode ?? undefined) }
        : null;

  return (
    <li className="rounded-md border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{NOTE_VISIBILITY_LABEL[note.visibility]}</Badge>
        {note.pinned ? <Badge tone="info">{NOTE_PIN_LABEL.pinnedBadge}</Badge> : null}
        <Tooltip content={formatExactTime(note.createdAt)} side="top">
          <time dateTime={note.createdAt} className="text-2xs tabular-nums text-text-muted">
            {formatRelativeTime(note.createdAt, displayNowMs())}
          </time>
        </Tooltip>

        {/* Controls sit at the end of the meta row. While this row is editing, they
            are hidden — one operation per row at a time. Only notes the provider
            marked `canEditBody` (own, authored, visible) get an edit control; a
            forbidden or fixture note never does (D-82/D-59). The pin control follows
            the role-level write right, exactly as before. */}
        {!isEditing ? (
          <div className="ml-auto flex items-center gap-1">
            {canEditBody ? (
              <button
                type="button"
                ref={(el) => registerEditButton(note.id, el)}
                onClick={() => onStartEdit(note.id)}
                aria-label={NOTE_EDIT_LABEL.editAction}
                title={NOTE_EDIT_LABEL.editAction}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-transparent text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <EditGlyph />
              </button>
            ) : null}
            {canPin ? (
              <PinButton
                note={note}
                pending={pinPending}
                onToggle={() => onTogglePin(note)}
                registerButton={registerPinButton}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {isEditing ? (
        <NoteBodyEditor
          note={note}
          edit={edit}
          onCancel={() => onCancelEdit(note.id)}
          onSave={(draft) => onSaveEdit(note, draft)}
        />
      ) : (
        <>
          {/* Plain text: React escapes it, so a body is never interpreted as markup.
              No author id, no note id, no storage metadata. */}
          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-text-primary">
            {note.body}
          </p>

          {pinFeedback ? (
            <p
              className={pinFeedback.tone === "success" ? "mt-1 text-2xs text-success" : "mt-1 text-2xs text-danger"}
              role={pinFeedback.tone === "success" ? "status" : "alert"}
              aria-live={pinFeedback.tone === "success" ? "polite" : undefined}
            >
              {pinFeedback.text}
            </p>
          ) : null}

          {editFeedback ? (
            <p
              className={editFeedback.tone === "success" ? "mt-1 text-2xs text-success" : "mt-1 text-2xs text-danger"}
              role={editFeedback.tone === "success" ? "status" : "alert"}
              aria-live={editFeedback.tone === "success" ? "polite" : undefined}
            >
              {editFeedback.text}
            </p>
          ) : null}
        </>
      )}
    </li>
  );
}

/**
 * Inline body editor — replaces the note's text with a labelled textarea while its
 * row is in edit mode. Inline rather than a dialog or sheet (D-59, as the composer):
 * the section exists to show the notes, and a modal would hide the very note being
 * edited. One editor is mounted at a time (the section enforces it).
 */
function NoteBodyEditor({
  note,
  edit,
  onCancel,
  onSave,
}: {
  note: CrmNote;
  edit: UseUpdateNoteBody;
  onCancel: () => void;
  onSave: (draft: string) => void;
}) {
  const [draft, setDraft] = React.useState(note.body);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fieldId = React.useId();
  const counterId = React.useId();
  const feedbackId = React.useId();

  const isActive = edit.active?.noteId === note.id;
  const pending = isActive && edit.status === "pending";
  // Only a keep-draft error is shown inside the editor; conflict/not_found close it
  // and surface on the row instead. Those two are handled by the section, so any
  // error still visible here is an in-place one (internal/invalid/upstream).
  const errorText =
    isActive && edit.status === "error" && edit.errorCode
      ? noteEditErrorMessage(edit.errorCode)
      : null;

  const normalized = normalizeNoteBody(draft);
  // Save is disabled for a body that is empty, too long, or unchanged — the
  // provider still rejects each defensively, but a disabled control says so without
  // a round-trip. `too_long` cannot occur (the textarea caps length) but is guarded
  // anyway.
  const unchanged = normalized.ok && normalized.body === note.body;
  const saveDisabled = pending || !normalized.ok || unchanged;

  // Focus the textarea when the editor opens, cursor at the end of the prefilled
  // body, so typing continues the note rather than replacing it.
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveDisabled) return;
    onSave(draft);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Escape cancels the edit and restores focus to the note's control (D-82).
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-1 space-y-2">
      <div>
        <label htmlFor={fieldId} className="mb-1 block text-2xs text-text-muted">
          {NOTE_EDIT_LABEL.editLabel}
        </label>
        <textarea
          id={fieldId}
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          maxLength={NOTE_BODY_MAX_LENGTH}
          aria-describedby={[counterId, errorText ? feedbackId : null].filter(Boolean).join(" ")}
          aria-invalid={errorText ? true : undefined}
          className={cn(
            "min-h-[72px] w-full resize-y rounded border bg-surface px-2.5 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            errorText ? "border-danger" : "border-border",
          )}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={counterId} className="text-2xs tabular-nums text-text-muted">
          {draft.trim().length} / {NOTE_BODY_MAX_LENGTH}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-11 sm:h-8"
            onClick={onCancel}
          >
            {NOTE_EDIT_LABEL.cancel}
          </Button>
          <Button type="submit" size="sm" className="h-11 sm:h-8" disabled={saveDisabled} aria-busy={pending}>
            {pending ? NOTE_EDIT_LABEL.pending : NOTE_EDIT_LABEL.save}
          </Button>
        </div>
      </div>

      {errorText ? (
        <p id={feedbackId} role="alert" className="text-xs text-danger">
          {errorText}
        </p>
      ) : null}
    </form>
  );
}

function PinButton({
  note,
  pending,
  onToggle,
  registerButton,
}: {
  note: CrmNote;
  pending: boolean;
  onToggle: () => void;
  registerButton: (id: string, el: HTMLButtonElement | null) => void;
}) {
  // Pending is announced in words through the accessible name, the way the owner
  // form and composer announce it — no colour-only signal.
  const label = pending
    ? NOTE_PIN_LABEL.pending
    : note.pinned
      ? NOTE_PIN_LABEL.unpinAction
      : NOTE_PIN_LABEL.pinAction;

  return (
    <button
      type="button"
      ref={(el) => registerButton(note.id, el)}
      onClick={onToggle}
      disabled={pending}
      aria-pressed={note.pinned}
      aria-busy={pending}
      aria-label={label}
      title={label}
      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-transparent text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-pressed:text-accent"
    >
      <PinGlyph filled={note.pinned} />
    </button>
  );
}

/** A small pushpin. Decorative — the button carries the accessible name. */
function PinGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 1.8 14.2 6.5l-2.3.5-2.8 2.8.4 2.6-1.5 1.5-2.8-2.8L2 14.6l2.9-3.9-2.8-2.8L3.6 6.4l2.6.4L9 4l.5-2.2Z" />
    </svg>
  );
}

/** A small pencil. Decorative — the button carries the accessible name. */
function EditGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11.5 2.5 13.5 4.5 5 13l-3 .5.5-3 9-8Z" />
    </svg>
  );
}
