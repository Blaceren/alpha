"use client";

import * as React from "react";
import type { CrmDataProvider } from "@/data/contracts/CrmDataProvider";
import type { Result } from "@/data/contracts/result";
import type { User360 } from "@/domain/users/user-360";
import { getCrmDataProvider } from "@/application/provider";
import { contextFromSession } from "@/application/context";
import { useSession } from "@/components/crm-shell/session-context";

export interface UseUser360Query {
  result: Result<User360> | null;
  loading: boolean;
  retry: () => void;
}

/**
 * Owns the single read of the User 360 aggregate. One provider call returns the
 * whole screen already projected for the caller's role — the UI never composes
 * permissions from several partial reads.
 *
 * `providerOverride` exists only for tests; production uses getCrmDataProvider().
 */
export function useUser360Query(userId: string, providerOverride?: CrmDataProvider): UseUser360Query {
  const { session } = useSession();
  const provider = React.useMemo(
    () => providerOverride ?? getCrmDataProvider(),
    [providerOverride],
  );

  const [result, setResult] = React.useState<Result<User360> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    provider.getUser360(contextFromSession(session), { userId }).then((res) => {
      if (cancelled) return;
      setResult(res);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [provider, session, userId, nonce]);

  return { result, loading, retry: () => setNonce((n) => n + 1) };
}
