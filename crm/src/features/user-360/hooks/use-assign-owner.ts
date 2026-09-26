"use client";

import * as React from "react";
import type { CrmMutations } from "@/data/contracts/CrmMutations";
import type { CrmErrorCode } from "@/data/contracts/result";
import { getCrmMutations } from "@/application/provider";
import { contextFromSession } from "@/application/context";
import { useSession } from "@/components/crm-shell/session-context";

export type AssignOwnerStatus = "idle" | "pending" | "success" | "error";

export interface UseAssignOwner {
  status: AssignOwnerStatus;
  errorCode: CrmErrorCode | null;
  /** Resolves `true` only when the owner now is what was asked for. */
  submit: (input: { ownerId: string | null; expectedOwnerId: string | null }) => Promise<boolean>;
  /** Drops success/error text quietly — used when the selection changes. */
  clearFeedback: () => void;
}

export interface UseAssignOwnerOptions {
  /** Tests only; production resolves the app's single provider instance. */
  mutationsOverride?: CrmMutations;
}

/**
 * Owns the `assignPrimaryOwner` call, its state machine and the idempotency key.
 *
 * Key lifecycle follows `useAddNote` (D-61) — `${useId()}:${userId}:${attempt}`, no
 * Math.random, no Date.now, no crypto, no dependency — with the same rules about when
 * `attempt` may advance:
 *   - changing the selection does not mint a key (the key does not depend on the owner);
 *   - a retry after a storage failure repeats the key, which is what makes the retry
 *     safe rather than a possible second write;
 *   - a double submit repeats the key, and the provider replays instead of writing twice;
 *   - success advances it, so the next change is a new command;
 *   - `conflict` advances it, because the key has already been accepted for a
 *     different command and would keep conflicting forever otherwise.
 *
 * The key is never rendered, never logged and never put in an attribute.
 *
 * `attempt` ALSO resets when the session identity changes. The provider fingerprints
 * the actor's role, so a key minted under crm_admin and submitted under crm_manager
 * describes a different command and would come back as a spurious `conflict` — both
 * roles may assign, so the control does not unmount to save us (Phase 1B4-C).
 */
export function useAssignOwner(userId: string, options: UseAssignOwnerOptions = {}): UseAssignOwner {
  const { mutationsOverride } = options;
  const { session } = useSession();
  const mutations = React.useMemo(
    () => mutationsOverride ?? getCrmMutations(),
    [mutationsOverride],
  );

  const baseKey = React.useId();
  const [status, setStatus] = React.useState<AssignOwnerStatus>("idle");
  const [errorCode, setErrorCode] = React.useState<CrmErrorCode | null>(null);

  // Refs, not state: an attempt counter nothing renders should not cause a render,
  // and `pending` has to be readable synchronously — two clicks in one tick would
  // both observe a not-yet-rerendered "idle" and both call through.
  const attemptRef = React.useRef(0);
  const pendingRef = React.useRef(false);

  const sessionIdentity = `${session.employeeId}:${session.role}`;
  const identityRef = React.useRef(sessionIdentity);
  if (identityRef.current !== sessionIdentity) {
    identityRef.current = sessionIdentity;
    attemptRef.current += 1;
  }

  const submit = React.useCallback(
    async ({
      ownerId,
      expectedOwnerId,
    }: {
      ownerId: string | null;
      expectedOwnerId: string | null;
    }): Promise<boolean> => {
      if (pendingRef.current) return false;

      pendingRef.current = true;
      setStatus("pending");
      setErrorCode(null);

      try {
        const res = await mutations.assignPrimaryOwner(contextFromSession(session), {
          userId,
          ownerId,
          expectedOwnerId,
          idempotencyKey: `${baseKey}:${userId}:${attemptRef.current}`,
        });

        if (res.status === "error" || !res.data) {
          const code: CrmErrorCode = res.error?.code ?? "internal";
          if (code === "conflict") attemptRef.current += 1;
          setStatus("error");
          setErrorCode(code);
          return false;
        }

        // `replayed: true` says this exact command had already been applied under
        // this key. The owner is what was asked for either way, so it is an ordinary
        // success — reporting a replay would describe our bookkeeping.
        attemptRef.current += 1;
        setStatus("success");
        setErrorCode(null);
        return true;
      } finally {
        pendingRef.current = false;
      }
    },
    [baseKey, mutations, session, userId],
  );

  const clearFeedback = React.useCallback(() => {
    setStatus((s) => (s === "pending" ? s : "idle"));
    setErrorCode(null);
  }, []);

  return { status, errorCode, submit, clearFeedback };
}
