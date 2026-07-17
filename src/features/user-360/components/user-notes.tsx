"use client";

import * as React from "react";
import type { CrmDataProvider, CrmNote } from "@/data/contracts/CrmDataProvider";
import type { CrmMutations } from "@/data/contracts/CrmMutations";
import type { Paginated, Result } from "@/data/contracts/result";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { NOTES_LABEL, NOTE_PIN_LABEL, NOTE_VISIBILITY_LABEL } from "@/config/labels";
import { canEditUserNotes } from "@/domain/identity/access";
import { useSession } from "@/components/crm-shell/session-context";
import { formatExactTime, formatRelativeTime } from "@/lib/format";
import { displayNowMs } from "@/features/users/lib/display-clock";
import { SectionCard } from "./section-card";
import { NoteComposer } from "./note-composer";
import { useUserNotes } from "../hooks/use-user-notes";
import { useSetNotePinned, type UseSetNotePinned } from "../hooks/use-set-note-pinned";
import { noteErrorMessage } from "../lib/note-error";
import { notePinErrorMessage } from "../lib/note-pin-error";

/**
 * Notes on the User 360 (Phase 1B4-B; pinning added in 1B4-D) — the screen's
 * second, independent read.
 *
 * What this component does NOT do is the point of it: it does not decide which
 * notes are visible, it does not order them, and it never splices a created or
 * re-pinned note into the list. `getUserNotes` projects (D-55), resolves the
 * effective pin from the audit log (D-76) and sorts (contract §7); this renders
 * what came back. After a successful write it re-reads rather than reordering
 * locally — an optimistic reorder would be React holding a second opinion about
 * order, which is the drift D-39/D-40 had to undo.
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

  // The single source for the mutation right (D-53). React must not carry its
  // own list of roles: a second list is a list that drifts from the matrix. The
  // SAME right gates writing a note and pinning one — pinning is editing (D-75).
  const canEdit = canEditUserNotes(session.role);

  const pin = useSetNotePinned(userId, { mutationsOverride });

  // One ref per rendered pin control, keyed by note id, so focus can return to the
  // right control after the list reorders under it.
  const buttonRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const focusTargetRef = React.useRef<string | null>(null);

  const items = result?.data?.items ?? [];

  /**
   * Return focus to the acted note's control once the operation has settled — a
   * successful re-read, a conflict re-read, or an error that left the list in
   * place. Keyed on `result` (which changes after a refetch) and `pin.status`
   * (which changes when a no-refetch error resolves), so whichever lands last does
   * the focusing. The control is found by note id, not by DOM position, so a note
   * that moved to the top is still the one focused.
   */
  React.useEffect(() => {
    const target = focusTargetRef.current;
    if (!target || pin.status === "pending") return;
    const btn = buttonRefs.current.get(target);
    if (btn) {
      btn.focus();
      focusTargetRef.current = null;
    }
  }, [result, pin.status]);

  const onTogglePin = React.useCallback(
    async (note: CrmNote) => {
      // The desired end state is the opposite of what is shown; `expectedPinned`
      // is what is shown, so the provider can detect a race (D-77).
      const { ok, code } = await pin.submit({
        noteId: note.id,
        pinned: !note.pinned,
        expectedPinned: note.pinned,
      });
      // Focus returns to this note's control whatever happened.
      focusTargetRef.current = note.id;
      // Re-read on success (the list order changed) and on conflict (show what
      // actually won). A storage failure wrote nothing, so the list is already
      // correct and is left untouched — the retry uses the same key.
      if (ok || code === "conflict") refetch();
    },
    [pin, refetch],
  );

  return (
    <SectionCard
      title={NOTES_LABEL.title}
      aside={items.length > 0 ? String(items.length) : undefined}
    >
      {canEdit ? (
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
        canEdit={canEdit}
        pin={pin}
        onTogglePin={onTogglePin}
        registerButton={(id, el) => {
          if (el) buttonRefs.current.set(id, el);
          else buttonRefs.current.delete(id);
        }}
      />
    </SectionCard>
  );
}

function NotesList({
  result,
  loading,
  onRetry,
  canEdit,
  pin,
  onTogglePin,
  registerButton,
}: {
  result: Result<Paginated<CrmNote>> | null;
  loading: boolean;
  onRetry: () => void;
  canEdit: boolean;
  pin: UseSetNotePinned;
  onTogglePin: (note: CrmNote) => void;
  registerButton: (id: string, el: HTMLButtonElement | null) => void;
}) {
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
      {items.map((note) => (
        <NoteRow
          key={note.id}
          note={note}
          canEdit={canEdit}
          pin={pin}
          onTogglePin={onTogglePin}
          registerButton={registerButton}
        />
      ))}
    </ol>
  );
}

function NoteRow({
  note,
  canEdit,
  pin,
  onTogglePin,
  registerButton,
}: {
  note: CrmNote;
  canEdit: boolean;
  pin: UseSetNotePinned;
  onTogglePin: (note: CrmNote) => void;
  registerButton: (id: string, el: HTMLButtonElement | null) => void;
}) {
  const isActive = pin.active?.noteId === note.id;
  const isPending = isActive && pin.status === "pending";

  // Feedback is shown only on the note the current operation is about, so a
  // success on one note does not annotate another.
  const feedback: { tone: "success" | "error"; text: string } | null =
    isActive && pin.status === "success"
      ? {
          tone: "success",
          text: pin.active?.pinned ? NOTE_PIN_LABEL.successPinned : NOTE_PIN_LABEL.successUnpinned,
        }
      : isActive && pin.status === "error"
        ? { tone: "error", text: notePinErrorMessage(pin.errorCode ?? undefined) }
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

        {/* The pin control sits at the end of the meta row. Only edit roles get it
            — a forbidden role sees the pinned badge but no control, never a
            disabled one (D-59). It is a real button with an accessible name that
            is the full instruction, not the pin glyph. */}
        {canEdit ? (
          <PinButton
            note={note}
            pending={isPending}
            onToggle={() => onTogglePin(note)}
            registerButton={registerButton}
          />
        ) : null}
      </div>

      {/* Plain text: React escapes it, so a body is never interpreted as markup.
          No author id, no note id, no storage metadata — the reader gets the note,
          not our bookkeeping. */}
      <p className="mt-1 whitespace-pre-wrap break-words text-xs text-text-primary">
        {note.body}
      </p>

      {feedback ? (
        <p
          className={feedback.tone === "success" ? "mt-1 text-2xs text-success" : "mt-1 text-2xs text-danger"}
          role={feedback.tone === "success" ? "status" : "alert"}
          aria-live={feedback.tone === "success" ? "polite" : undefined}
        >
          {feedback.text}
        </p>
      ) : null}
    </li>
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
      className="ml-auto inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-transparent text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-pressed:text-accent"
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
