"use client";

import * as React from "react";
import type { CrmDataProvider, PrimaryOwnerCandidate } from "@/data/contracts/CrmDataProvider";
import type { Result } from "@/data/contracts/result";
import { getCrmDataProvider } from "@/application/provider";
import { contextFromSession } from "@/application/context";
import { sessionGrants } from "@/domain/identity/access";
import { useSession } from "@/components/crm-shell/session-context";

export interface UseOwnerCandidates {
  result: Result<PrimaryOwnerCandidate[]> | null;
  loading: boolean;
}

/**
 * The list of employees the owner picker may offer.
 *
 * A read of its own rather than part of `getUser360`: the candidate list is not a
 * property of the user being viewed — the same list serves every user — and folding
 * it into the aggregate would mean refetching a whole profile to populate a dropdown.
 * The user's CURRENT owner stays in the aggregate (D-35); this only supplies what may
 * be chosen. React never assembles the list itself: the provider owns it, and a copy
 * here would be a fourth owner list to drift (Phase 1B4-C).
 *
 * It is not called at all for a role that cannot assign, which is why the effect
 * checks the permission before reading: the refusal is real (`unauthorized`), but
 * asking a question we know the answer to is a round trip to be told no.
 *
 * It resolves the provider the same way `useUser360Query` and `useUserNotes` do —
 * default state, no demo-state lookup — so all three share the one cached provider,
 * and therefore the one mutation-overlay adapter.
 */
export function useOwnerCandidates(providerOverride?: CrmDataProvider): UseOwnerCandidates {
  const { session } = useSession();
  const provider = React.useMemo(
    () => providerOverride ?? getCrmDataProvider(),
    [providerOverride],
  );

  const [result, setResult] = React.useState<Result<PrimaryOwnerCandidate[]> | null>(null);
  const [loading, setLoading] = React.useState(true);

  const allowed = sessionGrants(session, "assign_owner");

  React.useEffect(() => {
    if (!allowed) {
      // Not an error state: this role has no picker to fill.
      setResult(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    provider.getPrimaryOwnerCandidates(contextFromSession(session)).then((res) => {
      if (cancelled) return;
      setResult(res);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // `session` is part of the key on purpose, exactly as in `useUserNotes`:
    // switching role must re-ask, so a list fetched for the previous role is never
    // left standing for the next one.
  }, [allowed, provider, session]);

  return { result, loading };
}
