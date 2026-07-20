"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { NOTES_LABEL } from "@/config/labels";
import { NOTE_BODY_MAX_LENGTH } from "@/domain/notes/note";
import type { CrmMutations } from "@/data/contracts/CrmMutations";
import { useAddNote } from "../hooks/use-add-note";
import { NOTE_ERROR_MESSAGE, NOTE_VALIDATION_MESSAGE } from "../lib/note-error";

/**
 * Inline note composer — the only mutating control in the CRM.
 *
 * Inline rather than a dialog or a sheet (D-59): the section exists to show the
 * notes, a modal would hide the very list the new note joins, and a new note
 * sorts to the top of that list, so composing directly above it keeps the result
 * next to where it was typed. Dialog is used in this codebase for topbar
 * placeholders and Sheet for transient filters; neither is an authoring surface.
 *
 * Rendered only for roles that may write (see UserNotes) — a disabled form is
 * never rendered as a substitute.
 */
export function NoteComposer({
  userId,
  onAdded,
  mutationsOverride,
  inputRef,
}: {
  userId: string;
  /** Called after a note exists, so the section can re-read through the provider. */
  onAdded: () => void;
  mutationsOverride?: CrmMutations;
  /**
   * Optional external ref to the composer's textarea. The section uses it as the
   * post-delete focus target (Phase 1B6): after a note row vanishes, focus lands on
   * the composer, the natural next place to act.
   */
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [body, setBody] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);
  const { status, error, submit, clearFeedback } = useAddNote(userId, { mutationsOverride });

  const localRef = React.useRef<HTMLTextAreaElement | null>(null);
  // Merge the internal ref (used for the composer's own focus behaviour) with the
  // optional external one, so the parent can focus the same node.
  const textareaRef = localRef;
  const setTextareaNode = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      localRef.current = node;
      if (inputRef) {
        (inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      }
    },
    [inputRef],
  );
  const fieldId = React.useId();
  const counterId = React.useId();
  const feedbackId = React.useId();
  const bodyId = React.useId();

  const pending = status === "pending";
  const invalid = error?.kind === "validation";

  const feedback: { tone: "error" | "success"; text: string } | null = error
    ? {
        tone: "error",
        text:
          error.kind === "validation"
            ? NOTE_VALIDATION_MESSAGE[error.reason]
            : NOTE_ERROR_MESSAGE[error.code],
      }
    : status === "success"
      ? { tone: "success", text: NOTES_LABEL.success }
      : null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await submit(body);
    if (!created) return;
    // Only a real provider success clears the field and re-reads the list.
    setBody("");
    onAdded();
    textareaRef.current?.focus();
  }

  function handleChange(value: string) {
    setBody(value);
    // Editing quietly retires the previous verdict — no timer, so a screen
    // reader is never racing a disappearing message.
    if (status !== "idle") clearFeedback();
  }

  function toggleOnMobile() {
    const next = !expanded;
    setExpanded(next);
    // The control the tap asked for should be the one that has focus.
    if (next) window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <div className="mb-3">
      {/* Mobile only: the composer starts as one 44px row so it cannot eat the
          first screen. It stays mounted and its name changes when open — a
          disclosure whose trigger vanished would leave `aria-expanded` stuck at
          false and no way back, and "Добавить заметку" would name two controls
          at once. On sm+ `sm:hidden` removes it from the accessibility tree
          entirely and the form below is always open. */}
      <Button
        type="button"
        variant="secondary"
        className="mb-2 h-11 w-full sm:hidden"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={toggleOnMobile}
      >
        {expanded ? NOTES_LABEL.collapse : NOTES_LABEL.submit}
      </Button>

      <form
        id={bodyId}
        onSubmit={handleSubmit}
        className={cn("space-y-2", expanded ? "block" : "hidden sm:block")}
      >
        <div>
          <label htmlFor={fieldId} className="mb-1 block text-2xs text-text-muted">
            {NOTES_LABEL.composerLabel}
          </label>
          <textarea
            id={fieldId}
            ref={setTextareaNode}
            value={body}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={NOTES_LABEL.composerPlaceholder}
            rows={3}
            maxLength={NOTE_BODY_MAX_LENGTH}
            aria-describedby={[counterId, feedback ? feedbackId : null].filter(Boolean).join(" ")}
            aria-invalid={invalid || undefined}
            className={cn(
              "min-h-[72px] w-full resize-y rounded border bg-surface px-2.5 py-2 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              invalid ? "border-danger" : "border-border",
            )}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span id={counterId} className="text-2xs tabular-nums text-text-muted">
            {body.trim().length} / {NOTE_BODY_MAX_LENGTH}
          </span>
          {/* Pending is stated in words, not only in colour or opacity. */}
          <Button type="submit" size="sm" className="h-11 sm:h-8" disabled={pending} aria-busy={pending}>
            {pending ? NOTES_LABEL.submitPending : NOTES_LABEL.submit}
          </Button>
        </div>

        {feedback ? (
          <p
            id={feedbackId}
            role={feedback.tone === "error" ? "alert" : "status"}
            aria-live={feedback.tone === "error" ? undefined : "polite"}
            className={cn(
              "text-xs",
              feedback.tone === "error" ? "text-danger" : "text-success",
            )}
          >
            {feedback.text}
          </p>
        ) : null}
      </form>
    </div>
  );
}
