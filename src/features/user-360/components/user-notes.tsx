"use client";

import * as React from "react";
import type { CrmDataProvider, CrmNote } from "@/data/contracts/CrmDataProvider";
import type { CrmMutations } from "@/data/contracts/CrmMutations";
import type { Paginated, Result } from "@/data/contracts/result";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { NOTES_LABEL, NOTE_VISIBILITY_LABEL } from "@/config/labels";
import { canEditUserNotes } from "@/domain/identity/access";
import { useSession } from "@/components/crm-shell/session-context";
import { formatExactTime, formatRelativeTime } from "@/lib/format";
import { displayNowMs } from "@/features/users/lib/display-clock";
import { SectionCard } from "./section-card";
import { NoteComposer } from "./note-composer";
import { useUserNotes } from "../hooks/use-user-notes";
import { noteErrorMessage } from "../lib/note-error";

/**
 * Notes on the User 360 (Phase 1B4-B) — the screen's second, independent read.
 *
 * What this component does NOT do is the point of it: it does not decide which
 * notes are visible, it does not order them, and it never splices a created note
 * into the list. `getUserNotes` projects (D-55) and sorts (contract §7); this
 * renders what came back. After a successful write it re-reads rather than
 * inserting locally — an optimistic insert would be React holding a second
 * opinion about visibility and order, which is the drift D-39/D-40 had to undo.
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
  // own list of roles: a second list is a list that drifts from the matrix.
  const canEdit = canEditUserNotes(session.role);

  const items = result?.data?.items ?? [];

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

      <NotesList result={result} loading={loading} onRetry={refetch} />
    </SectionCard>
  );
}

function NotesList({
  result,
  loading,
  onRetry,
}: {
  result: Result<Paginated<CrmNote>> | null;
  loading: boolean;
  onRetry: () => void;
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
        <li key={note.id} className="rounded-md border border-border px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{NOTE_VISIBILITY_LABEL[note.visibility]}</Badge>
            <Tooltip content={formatExactTime(note.createdAt)} side="top">
              <time dateTime={note.createdAt} className="text-2xs tabular-nums text-text-muted">
                {formatRelativeTime(note.createdAt, displayNowMs())}
              </time>
            </Tooltip>
          </div>
          {/* Plain text: React escapes it, so a body is never interpreted as
              markup. No author id, no note id, no storage metadata — the reader
              gets the note, not our bookkeeping. */}
          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-text-primary">
            {note.body}
          </p>
        </li>
      ))}
    </ol>
  );
}
