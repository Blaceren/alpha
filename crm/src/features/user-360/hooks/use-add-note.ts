"use client";

import * as React from "react";
import type { CrmMutations } from "@/data/contracts/CrmMutations";
import type { CrmErrorCode } from "@/data/contracts/result";
import type { NoteBodyError } from "@/domain/notes/note";
import { normalizeNoteBody } from "@/domain/notes/note";
import { getCrmMutations } from "@/application/provider";
import { contextFromSession } from "@/application/context";
import { useSession } from "@/components/crm-shell/session-context";

export type AddNoteStatus = "idle" | "pending" | "success" | "error";

/**
 * Two shapes of failure that read differently to a user: their text is wrong
 * (fixable in the field) versus the write was refused (nothing to fix by typing).
 */
export type AddNoteError =
  | { kind: "validation"; reason: NoteBodyError }
  | { kind: "provider"; code: CrmErrorCode };

export interface UseAddNote {
  status: AddNoteStatus;
  error: AddNoteError | null;
  /** Resolves `true` only when a note now exists. */
  submit: (body: string) => Promise<boolean>;
  /** Drops success/error text quietly — used when the draft changes. */
  clearFeedback: () => void;
}

export interface UseAddNoteOptions {
  /** Tests only; production resolves the app's single provider instance. */
  mutationsOverride?: CrmMutations;
}

/**
 * Owns the addNote call, its state machine and the idempotency key.
 *
 * Key lifecycle (no Math.random, no Date.now, no crypto, no dependency — D-57
 * applies to the mock's determinism and there is no reason for the UI to be less
 * reproducible than the provider it drives):
 *
 *   key = `${useId()}:${userId}:${attempt}`
 *
 * `useId` is stable across renders and hydration and unique among mounted
 * components; `attempt` advances only when the current key can no longer be
 * reused. So:
 *   - editing the draft does not mint a key (the key does not depend on the body);
 *   - a retry after a storage failure repeats the key — nothing was written, and
 *     repeating it is what makes the retry safe rather than a possible duplicate;
 *   - a double submit repeats the key, and the provider replays instead of
 *     writing twice;
 *   - success advances it, so the next note is a new command;
 *   - conflict advances it, because the key has already been accepted for a
 *     different command and would keep conflicting forever otherwise.
 *
 * The key is never rendered, never logged and never put in an attribute.
 */
export function useAddNote(userId: string, options: UseAddNoteOptions = {}): UseAddNote {
  const { mutationsOverride } = options;
  const { session } = useSession();
  const mutations = React.useMemo(
    () => mutationsOverride ?? getCrmMutations(),
    [mutationsOverride],
  );

  const baseKey = React.useId();
  const [status, setStatus] = React.useState<AddNoteStatus>("idle");
  const [error, setError] = React.useState<AddNoteError | null>(null);

  // Refs, not state: an attempt counter nothing renders should not cause a
  // render, and `pending` has to be readable synchronously — two clicks in one
  // tick would both observe a not-yet-rerendered "idle" and both call through.
  const attemptRef = React.useRef(0);
  const pendingRef = React.useRef(false);

  /**
   * Advance the key when the session identity changes (Phase 1B4-C).
   *
   * The provider fingerprints the actor's role along with the body, so a key minted
   * under crm_admin and submitted under crm_manager describes a different command
   * and comes back as a `conflict` that has nothing to do with anything the employee
   * did. Both roles may write notes, so the composer does not unmount on the switch
   * and would otherwise carry the stale key straight into the next submit.
   */
  const sessionIdentity = `${session.employeeId}:${session.role}`;
  const identityRef = React.useRef(sessionIdentity);
  if (identityRef.current !== sessionIdentity) {
    identityRef.current = sessionIdentity;
    attemptRef.current += 1;
  }

  const submit = React.useCallback(
    async (raw: string): Promise<boolean> => {
      if (pendingRef.current) return false;

      // Client validation mirrors the provider through the same domain function,
      // so the two cannot disagree about what an acceptable body is. It does not
      // replace the provider's check — it only avoids a call that must fail.
      const normalized = normalizeNoteBody(raw);
      if (!normalized.ok) {
        setStatus("error");
        setError({ kind: "validation", reason: normalized.error });
        return false;
      }

      pendingRef.current = true;
      setStatus("pending");
      setError(null);

      try {
        const res = await mutations.addNote(contextFromSession(session), {
          userId,
          body: normalized.body,
          idempotencyKey: `${baseKey}:${userId}:${attemptRef.current}`,
        });

        if (res.status === "error" || !res.data) {
          const code: CrmErrorCode = res.error?.code ?? "internal";
          if (code === "conflict") attemptRef.current += 1;
          setStatus("error");
          setError({ kind: "provider", code });
          return false;
        }

        // `replayed: true` says this exact command had already been applied under
        // this key. The note exists either way, so it is an ordinary success —
        // telling the user about a replay would describe our bookkeeping, not
        // anything they did or need to act on.
        attemptRef.current += 1;
        setStatus("success");
        setError(null);
        return true;
      } finally {
        pendingRef.current = false;
      }
    },
    [baseKey, mutations, session, userId],
  );

  const clearFeedback = React.useCallback(() => {
    setStatus((s) => (s === "pending" ? s : "idle"));
    setError(null);
  }, []);

  return { status, error, submit, clearFeedback };
}
