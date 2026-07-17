"use client";

import * as React from "react";
import type { CrmDataProvider } from "@/data/contracts/CrmDataProvider";
import type { CrmMutations } from "@/data/contracts/CrmMutations";
import { Button } from "@/components/ui/button";
import { OWNER_ASSIGN_LABEL } from "@/config/labels";
import { useSession } from "@/components/crm-shell/session-context";
import { useAssignOwner } from "../hooks/use-assign-owner";
import { useOwnerCandidates } from "../hooks/use-owner-candidates";
import { ownerErrorMessage } from "../lib/owner-error";

/**
 * A `<select>` value is a string, so "no owner" needs one. It never leaves the
 * component: the command carries `ownerId: null`.
 */
const UNASSIGNED_VALUE = "__unassigned__";

/**
 * Inline owner picker inside "Ответственный и работа" (Phase 1B4-C).
 *
 * A native `<select>`, not a combobox: there are five candidates plus "no owner", so
 * typeahead would solve nothing and buy a pile of a11y surface to get wrong. Native
 * also gets keyboard, focus and the mobile picker right for free.
 *
 * An explicit Save, not auto-submit on change. Unlike adding a note, this REPLACES a
 * value: a mis-click on a five-item list would silently overwrite whoever was there,
 * with no undo. The extra click is the undo.
 *
 * No optimistic update (D-60): submit → provider result → parent refetches `getUser360`
 * → the owner is rendered from the canonical read model. The selection follows that
 * read model rather than leading it, so the screen can never show an owner the
 * provider did not confirm.
 */
export function OwnerAssignForm({
  userId,
  currentOwnerId,
  onAssigned,
  providerOverride,
  mutationsOverride,
}: {
  userId: string;
  /** The owner as the last `getUser360` reported it — the caller's `expectedOwnerId`. */
  currentOwnerId: string | null;
  /** Refetch of the whole aggregate. Owner lives in it, so there is nothing narrower. */
  onAssigned: () => void;
  providerOverride?: CrmDataProvider;
  mutationsOverride?: CrmMutations;
}) {
  const { session } = useSession();
  const fieldId = React.useId();
  const selectRef = React.useRef<HTMLSelectElement>(null);

  const { result: candidates, loading: candidatesLoading } = useOwnerCandidates(providerOverride);
  const { status, errorCode, submit, clearFeedback } = useAssignOwner(userId, {
    mutationsOverride,
  });

  const [selected, setSelected] = React.useState<string | null>(currentOwnerId);

  /**
   * Re-sync the selection with the canonical read model whenever that model moves
   * under us — a successful write, a conflict refetch, or a role switch (which
   * re-reads the aggregate). Adjusting state during render rather than in an effect
   * is the documented pattern for "prop changed, derived state must follow": an
   * effect would paint the stale selection for one frame first.
   *
   * The session is part of the token because a role switch must drop an unsaved
   * selection even when the owner itself did not change.
   */
  const syncToken = `${session.employeeId}:${session.role}:${currentOwnerId ?? ""}`;
  const [lastSync, setLastSync] = React.useState(syncToken);
  if (lastSync !== syncToken) {
    setLastSync(syncToken);
    setSelected(currentOwnerId);
  }

  // Success/error text is about a command the previous role sent; it must not
  // outlive the switch. Not folded into the render-time sync above: that one must
  // NOT clear feedback, or the success message would vanish the moment the refetch
  // it triggered came back.
  const sessionIdentity = `${session.employeeId}:${session.role}`;
  React.useEffect(() => {
    clearFeedback();
  }, [sessionIdentity, clearFeedback]);

  const pending = status === "pending";
  const unchanged = selected === currentOwnerId;

  // Return focus to the select on the pending→success transition, in an effect
  // rather than inline: at the moment `submit` resolves the select is still rendered
  // `disabled` (pending has not been painted away yet), and a browser silently
  // refuses to focus a disabled control. Keying on the status transition rather than
  // a flag set in the handler avoids a race — `submit` flips the status to success
  // before it returns, so a flag set after the await would be set too late for this
  // very render's effect to see it.
  const prevStatusRef = React.useRef(status);
  React.useEffect(() => {
    if (status === "success" && prevStatusRef.current !== "success") {
      selectRef.current?.focus();
    }
    prevStatusRef.current = status;
  }, [status]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Guarded in the handler as well as by `disabled`: an unchanged command would
    // write an audit record saying the owner changed to what it already was.
    if (pending || unchanged) return;

    await submit({ ownerId: selected, expectedOwnerId: currentOwnerId });
    // Both outcomes re-read: success to render what was stored, conflict to replace a
    // stale screen with the value that actually won. Losing the race is not a reason
    // to keep showing the loser.
    onAssigned();
  }

  // The list failing is not a reason to hide the current owner — but it is a reason
  // not to offer a picker that cannot be filled.
  if (candidatesLoading) {
    return (
      <p className="mt-3 text-2xs text-text-muted" role="status">
        {OWNER_ASSIGN_LABEL.loadingCandidates}
      </p>
    );
  }
  if (!candidates?.data) {
    return (
      <p className="mt-3 text-2xs text-danger" role="alert">
        {ownerErrorMessage(candidates?.error?.code)}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 border-t border-border pt-3">
      <label htmlFor={fieldId} className="mb-1 block text-2xs text-text-muted">
        {OWNER_ASSIGN_LABEL.fieldLabel}
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <select
          id={fieldId}
          ref={selectRef}
          value={selected ?? UNASSIGNED_VALUE}
          disabled={pending}
          onChange={(e) => {
            const v = e.target.value;
            setSelected(v === UNASSIGNED_VALUE ? null : v);
            clearFeedback();
          }}
          className="min-h-[44px] min-w-0 flex-1 rounded border border-border bg-surface px-2 text-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <option value={UNASSIGNED_VALUE}>{OWNER_ASSIGN_LABEL.unassignedOption}</option>
          {candidates.data.map((c) => (
            <option key={c.employeeId} value={c.employeeId}>
              {c.displayName}
            </option>
          ))}
        </select>

        {/* Pending is said in words through the control's own accessible name, and
            marked with aria-busy — the same way the note composer announces it. A
            second live region repeating "Сохраняем…" would say it twice to a screen
            reader and add nothing for anyone else. */}
        <Button
          type="submit"
          size="md"
          disabled={pending || unchanged}
          aria-busy={pending}
          className="min-h-[44px]"
        >
          {pending ? OWNER_ASSIGN_LABEL.submitPending : OWNER_ASSIGN_LABEL.submit}
        </Button>
      </div>

      {status === "success" ? (
        <p className="mt-2 text-2xs text-success" role="status">
          {OWNER_ASSIGN_LABEL.success}
        </p>
      ) : null}

      {status === "error" ? (
        <p className="mt-2 text-2xs text-danger" role="alert">
          {ownerErrorMessage(errorCode ?? undefined)}
        </p>
      ) : null}
    </form>
  );
}
