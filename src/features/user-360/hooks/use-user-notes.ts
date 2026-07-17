"use client";

import * as React from "react";
import type { CrmDataProvider, CrmNoteListItem } from "@/data/contracts/CrmDataProvider";
import type { Paginated, Result } from "@/data/contracts/result";
import { getCrmDataProvider } from "@/application/provider";
import { contextFromSession } from "@/application/context";
import { useSession } from "@/components/crm-shell/session-context";

/**
 * Contract default (DATA_PROVIDER_CONTRACT §7). Phase 1B4-B renders the first
 * page only and ships no pagination control: a fixture user has one seeded note
 * plus whatever this browser authored, so a "load more" would be a control that
 * never has anything to load. Documented in docs/USER_360.md.
 */
export const NOTES_PAGE_SIZE = 50;

export interface UseUserNotesQuery {
  result: Result<Paginated<CrmNoteListItem>> | null;
  loading: boolean;
  refetch: () => void;
}

/**
 * The notes read — deliberately separate from `getUser360`.
 *
 * It reads `getUserNotesView`, not the bare `getUserNotes`: the section acts on
 * notes (pin, and now body edit), so it needs each note's provider-owned
 * capabilities alongside it (Phase 1B4-E). The view is the same projected, ordered
 * list, wrapped with `{ note, capabilities }`.
 *
 * Notes are NOT folded into the User 360 aggregate: their privacy rule is
 * per-note and lives in one canonical projector, whose only consumer is the notes
 * read (D-55). Adding notes to the aggregate would either duplicate that projector
 * or make the aggregate carry notes it had to re-filter — the exact drift D-39/D-40
 * had to undo. So the screen makes a second read, and it fails independently: a
 * notes error never replaces the profile.
 *
 * It resolves the provider the same way `useUser360Query` does — the default
 * state, with no demo-state lookup. Reading Today's demo state here would hand
 * back a *different* cached provider than the one that served getUser360, i.e. a
 * different mutation-overlay adapter.
 *
 * `providerOverride` exists only for tests; production uses getCrmDataProvider().
 */
export function useUserNotes(
  userId: string,
  providerOverride?: CrmDataProvider,
): UseUserNotesQuery {
  const { session } = useSession();
  const provider = React.useMemo(
    () => providerOverride ?? getCrmDataProvider(),
    [providerOverride],
  );

  const [result, setResult] = React.useState<Result<Paginated<CrmNoteListItem>> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    provider
      .getUserNotesView(contextFromSession(session), {
        userId,
        page: { pageSize: NOTES_PAGE_SIZE },
      })
      .then((res) => {
        if (cancelled) return;
        setResult(res);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `session` is part of the key on purpose: switching role must re-read, so a
    // note the previous role could see is not left on screen for the next one.
  }, [provider, session, userId, nonce]);

  const refetch = React.useCallback(() => setNonce((n) => n + 1), []);

  return { result, loading, refetch };
}
