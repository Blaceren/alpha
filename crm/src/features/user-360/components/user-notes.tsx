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
  NOTE_DELETE_LABEL,
  NOTE_EDIT_LABEL,
  NOTE_PIN_LABEL,
  NOTE_VISIBILITY_EDIT_LABEL,
  NOTE_VISIBILITY_LABEL,
} from "@/config/labels";
import { sessionGrants } from "@/domain/identity/access";
import { NOTE_BODY_MAX_LENGTH, normalizeNoteBody } from "@/domain/notes/note";
import { useSession } from "@/components/crm-shell/session-context";
import { formatExactTime, formatRelativeTime } from "@/lib/format";
import { displayNowMs } from "@/features/users/lib/display-clock";
import { SectionCard } from "./section-card";
import { NoteComposer } from "./note-composer";
import { useUserNotes } from "../hooks/use-user-notes";
import { useSetNotePinned, type UseSetNotePinned } from "../hooks/use-set-note-pinned";
import { useUpdateNoteBody, type UseUpdateNoteBody } from "../hooks/use-update-note-body";
import { useSetNoteVisibility, type UseSetNoteVisibility } from "../hooks/use-set-note-visibility";
import { useDeleteNote, type UseDeleteNote } from "../hooks/use-delete-note";
import { noteErrorMessage } from "../lib/note-error";
import { notePinErrorMessage } from "../lib/note-pin-error";
import { noteEditErrorMessage } from "../lib/note-edit-error";
import { noteVisibilityErrorMessage } from "../lib/note-visibility-error";
import { noteDeleteErrorMessage } from "../lib/note-delete-error";

/**
 * Which inline surface a row has open. Exactly one per row, and one per list — body
 * edit, visibility edit and the delete confirm can never be open at the same time
 * (D-96). `delete` is a confirmation, not a draft editor, but it takes the same
 * single slot so opening it cannot silently discard an open editor's draft.
 */
type EditorMode = "body" | "visibility" | "delete";
interface ActiveEditor {
  noteId: string;
  mode: EditorMode;
}

/**
 * Notes on the User 360 (Phase 1B4-B; pinning 1B4-D, body editing 1B4-E, visibility
 * change 1B5-C) — the screen's second, independent read.
 *
 * What this component does NOT do is the point of it: it does not decide which notes
 * are visible, order them, or decide which are editable / visibility-changeable, and
 * it never splices a changed note into the list. `getUserNotesView` projects (D-55),
 * resolves the effective pin from the audit log (D-76), sorts (contract §7) and
 * annotates each note with the actor's capabilities (`canEditBody`,
 * `canChangeVisibility` — D-82/D-92); this renders what came back. After a successful
 * write it re-reads rather than mutating the list — an optimistic change would be
 * React holding a second opinion (the drift D-39/D-40 had to undo). Turning a note
 * `private` makes the canonical projector drop it for every actor except its author.
 *
 * Exactly one inline editor is open at a time across the whole list — body OR
 * visibility, never both, never two rows. While a row is editing, its other controls
 * are not rendered, so a second editor can never be opened over an open one and a
 * draft is never silently discarded.
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

  // The single source for the WRITE right (D-53). The SAME right gates writing,
  // pinning, editing and changing visibility; whether an individual note may be
  // edited or have its visibility changed is a per-note capability the provider owns
  // (canEditBody / canChangeVisibility). This only decides whether the composer and
  // the pin controls are offered.
  const canWrite = sessionGrants(session, "edit_user_notes");

  const pin = useSetNotePinned(userId, { mutationsOverride });
  const edit = useUpdateNoteBody(userId, { mutationsOverride });
  const visibility = useSetNoteVisibility(userId, { mutationsOverride });
  const del = useDeleteNote(userId, { mutationsOverride });

  // Which row (if any) has an editor open, and in which mode. Single-valued, so only
  // one editor of one mode is ever open at a time.
  const [activeEditor, setActiveEditor] = React.useState<ActiveEditor | null>(null);

  // One ref per rendered control, keyed by note id, so focus can return to the right
  // control after the list reorders or an editor closes under it.
  const pinButtonRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const editButtonRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const visibilityButtonRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const deleteButtonRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const pinFocusRef = React.useRef<string | null>(null);
  const editFocusRef = React.useRef<string | null>(null);
  const visibilityFocusRef = React.useRef<string | null>(null);
  const deleteFocusRef = React.useRef<string | null>(null);
  // Set when the row is expected to be gone (success / not_found): focus the fallback
  // rather than a delete-control that is about to unmount.
  const deleteFallbackFocusRef = React.useRef(false);

  // Post-delete focus targets: the composer textarea (natural next place to act), and
  // a section-level status line as the fallback when the composer is off-screen (the
  // mobile collapsed state) or the note vanished (D-96).
  const composerInputRef = React.useRef<HTMLTextAreaElement>(null);
  const deleteStatusRef = React.useRef<HTMLParagraphElement>(null);

  /**
   * Focus the composer if it can actually take focus (it is hidden on mobile when the
   * disclosure is collapsed), else the section status line, else leave focus where the
   * browser puts it (<body> — safe and non-trapping). Detected by attempting the focus
   * and checking whether it landed, rather than reading layout, so it holds whether or
   * not a stylesheet is applied.
   */
  const focusAfterDelete = React.useCallback(() => {
    const composer = composerInputRef.current;
    if (composer) {
      composer.focus();
      if (document.activeElement === composer) return;
    }
    deleteStatusRef.current?.focus();
  }, []);

  const items = result?.data?.items ?? [];

  // A role/session switch discards any open editor: a change begun as one role must
  // not be saved as another. The hooks clear their own attempt/feedback; this drops
  // the editor. Keyed on identity, not on `session`, so an unrelated re-render does
  // not close an editor mid-type.
  const sessionIdentity = `${session.employeeId}:${session.role}`;
  React.useEffect(() => {
    setActiveEditor(null);
  }, [sessionIdentity]);

  React.useEffect(() => {
    const target = pinFocusRef.current;
    if (!target || pin.status === "pending") return;
    const btn = pinButtonRefs.current.get(target);
    if (btn) {
      btn.focus();
      pinFocusRef.current = null;
    }
  }, [result, pin.status]);

  React.useEffect(() => {
    const target = editFocusRef.current;
    if (!target || edit.status === "pending" || activeEditor !== null) return;
    const btn = editButtonRefs.current.get(target);
    if (btn) {
      btn.focus();
      editFocusRef.current = null;
    }
  }, [result, edit.status, activeEditor]);

  /**
   * Return focus to the acted note's «Изменить доступ» control after the visibility
   * editor closes — on save success, on conflict/not_found (both re-read), and on
   * cancel/Escape. If the note vanished from the list (it was turned `private` while
   * another actor is viewing — but focus restore runs for the acting author, who
   * keeps seeing it), the missing ref is simply skipped and focus stays in a safe
   * place within the section.
   */
  React.useEffect(() => {
    const target = visibilityFocusRef.current;
    if (!target || visibility.status === "pending" || activeEditor !== null) return;
    const btn = visibilityButtonRefs.current.get(target);
    if (btn) {
      btn.focus();
      visibilityFocusRef.current = null;
    } else {
      // The control is gone (note left this actor's list). Drop the target so we do
      // not chase a ref that will never mount; the browser keeps focus on <body>,
      // which is a safe, non-trapping place.
      visibilityFocusRef.current = null;
    }
  }, [result, visibility.status, activeEditor]);

  /**
   * After a delete resolves, focus goes to the note's delete-control if the note is
   * still there (a `conflict` that kept it), or to a safe fallback if it is gone (a
   * success, or a `not_found` that removed it): the composer, else the section status
   * (D-96). Runs after the confirm closes and the refetch lands.
   */
  React.useEffect(() => {
    if (del.status === "pending" || activeEditor !== null) return;
    // Success / not_found: the row is (or is about to be) gone, so focus the composer
    // directly — never a delete-control that a refetch is about to unmount.
    if (deleteFallbackFocusRef.current) {
      deleteFallbackFocusRef.current = false;
      focusAfterDelete();
      return;
    }
    // Conflict / cancel: the note survives, so focus returns to its delete-control; if
    // it is somehow gone, the safe fallback stands in.
    const target = deleteFocusRef.current;
    if (!target) return;
    deleteFocusRef.current = null;
    const btn = deleteButtonRefs.current.get(target);
    if (btn) {
      btn.focus();
    } else {
      focusAfterDelete();
    }
  }, [result, del.status, activeEditor, focusAfterDelete]);

  const onTogglePin = React.useCallback(
    async (note: CrmNote) => {
      const { ok, code } = await pin.submit({
        noteId: note.id,
        pinned: !note.pinned,
        expectedPinned: note.pinned,
      });
      pinFocusRef.current = note.id;
      if (ok || code === "conflict") refetch();
    },
    [pin, refetch],
  );

  const onStartEdit = React.useCallback(
    (noteId: string) => {
      edit.clearFeedback();
      setActiveEditor({ noteId, mode: "body" });
    },
    [edit],
  );

  const onStartVisibility = React.useCallback(
    (noteId: string) => {
      visibility.clearFeedback();
      setActiveEditor({ noteId, mode: "visibility" });
    },
    [visibility],
  );

  const onCancelEdit = React.useCallback((noteId: string) => {
    editFocusRef.current = noteId;
    setActiveEditor(null);
  }, []);

  const onCancelVisibility = React.useCallback((noteId: string) => {
    visibilityFocusRef.current = noteId;
    setActiveEditor(null);
  }, []);

  const onSaveEdit = React.useCallback(
    async (note: CrmNote, draft: string) => {
      const { ok, code } = await edit.submit({
        noteId: note.id,
        body: draft,
        expectedUpdatedAt: note.updatedAt,
      });
      if (ok || code === "conflict" || code === "not_found") {
        editFocusRef.current = note.id;
        setActiveEditor(null);
        refetch();
        return;
      }
      // internal / invalid_input / upstream — nothing was written, so keep the draft
      // open for a retry under the SAME key; focus stays in the editor.
    },
    [edit, refetch],
  );

  const onSaveVisibility = React.useCallback(
    async (note: CrmNote, next: "team" | "private") => {
      const { ok, code } = await visibility.submit({
        noteId: note.id,
        visibility: next,
        // The note's `updatedAt` as this actor last read it — the concurrency
        // precondition (D-83).
        expectedUpdatedAt: note.updatedAt,
      });
      if (ok || code === "conflict" || code === "not_found") {
        // Close the editor and re-read: success may drop the note from other actors'
        // lists (private) and updates this one; a conflict/vanish must show what is
        // actually stored now. Focus returns to the note's control.
        visibilityFocusRef.current = note.id;
        setActiveEditor(null);
        refetch();
        return;
      }
      // internal / invalid_input / upstream — nothing was written; keep the editor
      // open for a retry under the SAME key.
    },
    [visibility, refetch],
  );

  const onStartDelete = React.useCallback(
    (noteId: string) => {
      del.clearFeedback();
      setActiveEditor({ noteId, mode: "delete" });
    },
    [del],
  );

  const onCancelDelete = React.useCallback((noteId: string) => {
    deleteFocusRef.current = noteId;
    setActiveEditor(null);
  }, []);

  const onConfirmDelete = React.useCallback(
    async (note: CrmNote) => {
      const { ok, code } = await del.submit({
        noteId: note.id,
        // The note's `updatedAt` as this actor last read it — the concurrency
        // precondition, so a delete never discards an intervening edit (D-96).
        expectedUpdatedAt: note.updatedAt,
      });
      if (ok || code === "conflict" || code === "not_found") {
        // Close the confirm and re-read: success drops the row, a conflict/vanish must
        // show what is actually stored now.
        if (ok || code === "not_found") {
          // The row is gone — focus a safe fallback (composer / section status).
          deleteFallbackFocusRef.current = true;
        } else {
          // Conflict: the note survives; focus returns to its delete-control.
          deleteFocusRef.current = note.id;
        }
        setActiveEditor(null);
        refetch();
        return;
      }
      // internal / invalid_input / upstream — nothing was deleted; keep the confirm
      // open for a retry under the SAME key.
    },
    [del, refetch],
  );

  // The section-level delete outcome — a per-row line has nowhere to render once the
  // row is gone (success/not_found), and a conflict closes the confirm too. A storage
  // failure is the exception: it keeps the confirm open and shows its error THERE, so
  // the section line stays quiet while the confirm for this note is still open.
  const deleteConfirmOpen = activeEditor?.mode === "delete";
  const deleteFeedback: { tone: "success" | "error"; text: string } | null =
    del.status === "success"
      ? { tone: "success", text: NOTE_DELETE_LABEL.success }
      : del.status === "error" && !deleteConfirmOpen
        ? { tone: "error", text: noteDeleteErrorMessage(del.errorCode ?? undefined) }
        : null;

  return (
    <SectionCard
      title={NOTES_LABEL.title}
      aside={items.length > 0 ? String(items.length) : undefined}
    >
      {canWrite ? (
        <NoteComposer
          userId={userId}
          onAdded={refetch}
          mutationsOverride={mutationsOverride}
          inputRef={composerInputRef}
        />
      ) : (
        <p className="mb-3 text-xs text-text-muted">{NOTES_LABEL.forbidden}</p>
      )}

      {deleteFeedback ? (
        <p
          ref={deleteStatusRef}
          tabIndex={-1}
          role={deleteFeedback.tone === "success" ? "status" : "alert"}
          aria-live={deleteFeedback.tone === "success" ? "polite" : undefined}
          className={cn(
            "mb-3 text-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            deleteFeedback.tone === "success" ? "text-success" : "text-danger",
          )}
        >
          {deleteFeedback.text}
        </p>
      ) : null}

      <NotesList
        result={result}
        loading={loading}
        onRetry={refetch}
        canPin={canWrite}
        pin={pin}
        edit={edit}
        visibility={visibility}
        del={del}
        activeEditor={activeEditor}
        onTogglePin={onTogglePin}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onSaveEdit={onSaveEdit}
        onStartVisibility={onStartVisibility}
        onCancelVisibility={onCancelVisibility}
        onSaveVisibility={onSaveVisibility}
        onStartDelete={onStartDelete}
        onCancelDelete={onCancelDelete}
        onConfirmDelete={onConfirmDelete}
        registerPinButton={(id, el) => {
          if (el) pinButtonRefs.current.set(id, el);
          else pinButtonRefs.current.delete(id);
        }}
        registerEditButton={(id, el) => {
          if (el) editButtonRefs.current.set(id, el);
          else editButtonRefs.current.delete(id);
        }}
        registerVisibilityButton={(id, el) => {
          if (el) visibilityButtonRefs.current.set(id, el);
          else visibilityButtonRefs.current.delete(id);
        }}
        registerDeleteButton={(id, el) => {
          if (el) deleteButtonRefs.current.set(id, el);
          else deleteButtonRefs.current.delete(id);
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
  onStartVisibility: (noteId: string) => void;
  onCancelVisibility: (noteId: string) => void;
  onSaveVisibility: (note: CrmNote, next: "team" | "private") => void;
  onStartDelete: (noteId: string) => void;
  onCancelDelete: (noteId: string) => void;
  onConfirmDelete: (note: CrmNote) => void;
  registerPinButton: (id: string, el: HTMLButtonElement | null) => void;
  registerEditButton: (id: string, el: HTMLButtonElement | null) => void;
  registerVisibilityButton: (id: string, el: HTMLButtonElement | null) => void;
  registerDeleteButton: (id: string, el: HTMLButtonElement | null) => void;
}

function NotesList({
  result,
  loading,
  onRetry,
  canPin,
  pin,
  edit,
  visibility,
  del,
  activeEditor,
  ...callbacks
}: {
  result: Result<Paginated<CrmNoteListItem>> | null;
  loading: boolean;
  onRetry: () => void;
  canPin: boolean;
  pin: UseSetNotePinned;
  edit: UseUpdateNoteBody;
  visibility: UseSetNoteVisibility;
  del: UseDeleteNote;
  activeEditor: ActiveEditor | null;
} & RowCallbacks) {
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
          visibility={visibility}
          del={del}
          activeMode={activeEditor?.noteId === item.note.id ? activeEditor.mode : null}
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
  visibility,
  del,
  activeMode,
  onTogglePin,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onStartVisibility,
  onCancelVisibility,
  onSaveVisibility,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
  registerPinButton,
  registerEditButton,
  registerVisibilityButton,
  registerDeleteButton,
}: {
  item: CrmNoteListItem;
  canPin: boolean;
  pin: UseSetNotePinned;
  edit: UseUpdateNoteBody;
  visibility: UseSetNoteVisibility;
  del: UseDeleteNote;
  /** Which inline surface this row has open, or null if none. */
  activeMode: EditorMode | null;
} & RowCallbacks) {
  const note = item.note;
  const canEditBody = item.capabilities.canEditBody;
  const canChangeVisibility = item.capabilities.canChangeVisibility;
  const canDelete = item.capabilities.canDelete;
  const isEditing = activeMode !== null;

  const pinActive = pin.active?.noteId === note.id;
  const pinPending = pinActive && pin.status === "pending";

  const pinFeedback: { tone: "success" | "error"; text: string } | null =
    pinActive && pin.status === "success"
      ? {
          tone: "success",
          text: pin.active?.pinned ? NOTE_PIN_LABEL.successPinned : NOTE_PIN_LABEL.successUnpinned,
        }
      : pinActive && pin.status === "error"
        ? { tone: "error", text: notePinErrorMessage(pin.errorCode ?? undefined) }
        : null;

  const editActive = edit.active?.noteId === note.id;
  const editFeedback: { tone: "success" | "error"; text: string } | null =
    !isEditing && editActive && edit.status === "success"
      ? { tone: "success", text: NOTE_EDIT_LABEL.success }
      : !isEditing && editActive && edit.status === "error"
        ? { tone: "error", text: noteEditErrorMessage(edit.errorCode ?? undefined) }
        : null;

  const visActive = visibility.active?.noteId === note.id;
  const visFeedback: { tone: "success" | "error"; text: string } | null =
    !isEditing && visActive && visibility.status === "success"
      ? { tone: "success", text: NOTE_VISIBILITY_EDIT_LABEL.success }
      : !isEditing && visActive && visibility.status === "error"
        ? { tone: "error", text: noteVisibilityErrorMessage(visibility.errorCode ?? undefined) }
        : null;

  return (
    <li className="rounded-md border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Visibility expressed in WORDS, not by colour: «Командная заметка» /
            «Приватная заметка». Calm neutral tone, never a warning red. */}
        <Badge tone="neutral">{NOTE_VISIBILITY_LABEL[note.visibility]}</Badge>
        {note.pinned ? <Badge tone="info">{NOTE_PIN_LABEL.pinnedBadge}</Badge> : null}
        <Tooltip content={formatExactTime(note.createdAt)} side="top">
          <time dateTime={note.createdAt} className="text-2xs tabular-nums text-text-muted">
            {formatRelativeTime(note.createdAt, displayNowMs())}
          </time>
        </Tooltip>

        {/* Controls sit at the end of the meta row. While this row is editing (body
            OR visibility), they are all hidden — one editor per row, and a second
            editor can never be opened over an open one, so a draft is never silently
            lost. Only notes the provider marked get each control (own, authored,
            visible — D-82/D-92). */}
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
            {canChangeVisibility ? (
              <button
                type="button"
                ref={(el) => registerVisibilityButton(note.id, el)}
                onClick={() => onStartVisibility(note.id)}
                aria-label={NOTE_VISIBILITY_EDIT_LABEL.editAction}
                title={NOTE_VISIBILITY_EDIT_LABEL.editAction}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-transparent text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <VisibilityGlyph />
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
            {canDelete ? (
              <button
                type="button"
                ref={(el) => registerDeleteButton(note.id, el)}
                onClick={() => onStartDelete(note.id)}
                aria-label={NOTE_DELETE_LABEL.deleteAction}
                title={NOTE_DELETE_LABEL.deleteAction}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-transparent text-text-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <TrashGlyph />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {activeMode === "body" ? (
        <NoteBodyEditor
          note={note}
          edit={edit}
          onCancel={() => onCancelEdit(note.id)}
          onSave={(draft) => onSaveEdit(note, draft)}
        />
      ) : activeMode === "visibility" ? (
        <NoteVisibilityEditor
          note={note}
          visibility={visibility}
          onCancel={() => onCancelVisibility(note.id)}
          onSave={(next) => onSaveVisibility(note, next)}
        />
      ) : (
        <>
          {/* Plain text: React escapes it, so a body is never interpreted as markup.
              No author id, no note id, no storage metadata. The body stays visible
              under the delete confirm — nothing is hidden before it is removed. */}
          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-text-primary">
            {note.body}
          </p>

          {activeMode === "delete" ? (
            <NoteDeleteConfirm
              note={note}
              del={del}
              onCancel={() => onCancelDelete(note.id)}
              onConfirm={() => onConfirmDelete(note)}
            />
          ) : null}

          {pinFeedback ? (
            <FeedbackLine tone={pinFeedback.tone} text={pinFeedback.text} />
          ) : null}
          {editFeedback ? (
            <FeedbackLine tone={editFeedback.tone} text={editFeedback.text} />
          ) : null}
          {visFeedback ? (
            <FeedbackLine tone={visFeedback.tone} text={visFeedback.text} />
          ) : null}
        </>
      )}
    </li>
  );
}

/**
 * Inline delete confirmation — appears inside the note row, never a dialog, sheet,
 * toast or `window.confirm` (D-96). Destructive tone (danger border + danger commit
 * button) appears ONLY here, in the confirm state; the idle trash control is calm and
 * neutral. Escape cancels without deleting; a storage failure keeps the confirm open
 * with a safe Russian error and retries under the same key.
 */
function NoteDeleteConfirm({
  note,
  del,
  onCancel,
  onConfirm,
}: {
  note: CrmNote;
  del: UseDeleteNote;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = React.useId();
  const bodyId = React.useId();
  const feedbackId = React.useId();
  const confirmRef = React.useRef<HTMLButtonElement>(null);

  const isActive = del.active?.noteId === note.id;
  const pending = isActive && del.status === "pending";
  // Only an error that KEEPS the confirm open reaches here (conflict/not_found close
  // it and refetch). So this is a storage/internal/upstream failure — retriable, same
  // key. `invalid_input`/`unauthorized` are defensive: the control is not offered.
  const errorText =
    isActive && del.status === "error" && del.errorCode
      ? noteDeleteErrorMessage(del.errorCode)
      : null;

  // Move focus onto the destructive commit when the confirm opens, so keyboard users
  // land on the action the confirm is about (Escape still cancels from anywhere in it).
  React.useEffect(() => {
    confirmRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      aria-describedby={[bodyId, errorText ? feedbackId : null].filter(Boolean).join(" ")}
      onKeyDown={handleKeyDown}
      className="mt-2 space-y-2 rounded-md border border-danger/40 bg-danger/5 p-2.5"
    >
      <p id={titleId} className="text-xs font-medium text-text-primary">
        {NOTE_DELETE_LABEL.confirmTitle}
      </p>
      <p id={bodyId} className="text-2xs text-text-muted">
        {NOTE_DELETE_LABEL.confirmBody}
      </p>

      {errorText ? (
        <p id={feedbackId} role="alert" className="text-xs text-danger">
          {errorText}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-11 sm:h-8"
          onClick={onCancel}
        >
          {NOTE_DELETE_LABEL.cancel}
        </Button>
        <Button
          ref={confirmRef}
          type="button"
          variant="danger"
          size="sm"
          className="h-11 sm:h-8"
          onClick={onConfirm}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? NOTE_DELETE_LABEL.pending : NOTE_DELETE_LABEL.confirm}
        </Button>
      </div>
    </div>
  );
}

function FeedbackLine({ tone, text }: { tone: "success" | "error"; text: string }) {
  return (
    <p
      className={tone === "success" ? "mt-1 text-2xs text-success" : "mt-1 text-2xs text-danger"}
      role={tone === "success" ? "status" : "alert"}
      aria-live={tone === "success" ? "polite" : undefined}
    >
      {text}
    </p>
  );
}

/**
 * Inline body editor — replaces the note's text with a labelled textarea while its
 * row is in edit mode. Inline rather than a dialog or sheet (D-59, as the composer).
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
  const errorText =
    isActive && edit.status === "error" && edit.errorCode
      ? noteEditErrorMessage(edit.errorCode)
      : null;

  const normalized = normalizeNoteBody(draft);
  const unchanged = normalized.ok && normalized.body === note.body;
  const saveDisabled = pending || !normalized.ok || unchanged;

  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveDisabled) return;
    onSave(draft);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
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

/**
 * Inline visibility editor — replaces the note's text with a labelled native select
 * while its row is in visibility mode (Phase 1B5-C). Inline, native `<select>`, no
 * dialog/sheet/toast (D-92). Only the two writable visibilities are offered; there
 * is no `role_restricted` option (D-91). Saving is explicit — never on change.
 */
function NoteVisibilityEditor({
  note,
  visibility,
  onCancel,
  onSave,
}: {
  note: CrmNote;
  visibility: UseSetNoteVisibility;
  onCancel: () => void;
  onSave: (next: "team" | "private") => void;
}) {
  // The stored visibility is always team/private on a visible note (role_restricted
  // is dropped by the projector). Coerce for the select's controlled value.
  const current: "team" | "private" = note.visibility === "private" ? "private" : "team";
  const [draft, setDraft] = React.useState<"team" | "private">(current);
  const selectRef = React.useRef<HTMLSelectElement>(null);
  const fieldId = React.useId();
  const feedbackId = React.useId();

  const isActive = visibility.active?.noteId === note.id;
  const pending = isActive && visibility.status === "pending";
  const errorText =
    isActive && visibility.status === "error" && visibility.errorCode
      ? noteVisibilityErrorMessage(visibility.errorCode)
      : null;

  // Save is disabled for an unchanged selection — the provider rejects it defensively
  // too, but a disabled control says so without a round-trip.
  const unchanged = draft === current;
  const saveDisabled = pending || unchanged;

  React.useEffect(() => {
    selectRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveDisabled) return;
    onSave(draft);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLSelectElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-1 space-y-2">
      <div>
        <label htmlFor={fieldId} className="mb-1 block text-2xs text-text-muted">
          {NOTE_VISIBILITY_EDIT_LABEL.fieldLabel}
        </label>
        <select
          id={fieldId}
          ref={selectRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value === "private" ? "private" : "team")}
          onKeyDown={handleKeyDown}
          aria-describedby={errorText ? feedbackId : undefined}
          aria-invalid={errorText ? true : undefined}
          className={cn(
            "h-11 w-full rounded border bg-surface px-2.5 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9",
            errorText ? "border-danger" : "border-border",
          )}
        >
          <option value="team">{NOTE_VISIBILITY_EDIT_LABEL.optionTeam}</option>
          <option value="private">{NOTE_VISIBILITY_EDIT_LABEL.optionPrivate}</option>
        </select>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-11 sm:h-8"
          onClick={onCancel}
        >
          {NOTE_VISIBILITY_EDIT_LABEL.cancel}
        </Button>
        <Button type="submit" size="sm" className="h-11 sm:h-8" disabled={saveDisabled} aria-busy={pending}>
          {pending ? NOTE_VISIBILITY_EDIT_LABEL.pending : NOTE_VISIBILITY_EDIT_LABEL.save}
        </Button>
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

/**
 * A small shield — distinct from the pencil (edit) and the pushpin (pin), so the
 * three controls never read alike. Decorative; the button carries the accessible
 * name «Изменить доступ к заметке».
 */
function VisibilityGlyph() {
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
      <path d="M8 1.5 13 3.2v4.1c0 3.2-2.1 5.6-5 7.2-2.9-1.6-5-4-5-7.2V3.2L8 1.5Z" />
      <path d="M5.8 8.1 7.3 9.6l3-3.4" />
    </svg>
  );
}

/**
 * A small trash can — distinct from the pencil (edit), the shield (visibility) and
 * the pushpin (pin), so the four controls never read alike. Decorative; the button
 * carries the accessible name «Удалить заметку». Neutral in idle; the destructive
 * tone lives in the confirm, not the glyph.
 */
function TrashGlyph() {
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
      <path d="M2.5 4h11" />
      <path d="M6 4V2.6h4V4" />
      <path d="M3.6 4l.6 9.1a1 1 0 0 0 1 .9h5.6a1 1 0 0 0 1-.9L12.4 4" />
      <path d="M6.5 6.6v4.8M9.5 6.6v4.8" />
    </svg>
  );
}
