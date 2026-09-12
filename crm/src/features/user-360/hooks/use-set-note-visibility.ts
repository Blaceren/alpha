"use client";

import * as React from "react";
import type { CrmMutations } from "@/data/contracts/CrmMutations";
import type { CrmErrorCode } from "@/data/contracts/result";
import { getCrmMutations } from "@/application/provider";
import { contextFromSession } from "@/application/context";
import { useSession } from "@/components/crm-shell/session-context";

export type SetNoteVisibilityStatus = "idle" | "pending" | "success" | "error";

/** The note a visibility change targets. */
export interface ActiveVisibility {
  noteId: string;
}

export interface UseSetNoteVisibility {
  status: SetNoteVisibilityStatus;
  errorCode: CrmErrorCode | null;
  /** Which note the last/ongoing change is about, so the section can render feedback. */
  active: ActiveVisibility | null;
  /**
   * `ok` is `true` only when the note now holds the requested visibility. `code` is
   * the failure code otherwise, so the caller can tell a `conflict`/`not_found`
   * (re-read to show what is stored) from a storage failure (keep the draft and let
   * the same key retry).
   */
  submit: (input: {
    noteId: string;
    visibility: "team" | "private";
    expectedUpdatedAt: string;
  }) => Promise<{ ok: boolean; code: CrmErrorCode | null }>;
  /** Drops success/error state quietly. */
  clearFeedback: () => void;
}

export interface UseSetNoteVisibilityOptions {
  /** Tests only; production resolves the app's single provider instance. */
  mutationsOverride?: CrmMutations;
}

/**
 * Owns the `setNoteVisibility` call, its state machine and the idempotency key.
 *
 * A carbon copy of `useUpdateNoteBody`'s lifecycle (D-61, D-83): one hook instance
 * per list, `active` records which note the state is about, and the key is
 * `${useId()}:${userId}:${noteId}:${attempt}` — no Math.random, no Date.now, no
 * crypto, no dependency. `attempt` advances on success and on `conflict` (the key
 * has been spent on a different command), repeats on a storage-failure retry (safe:
 * nothing was written) and on a double submit (the provider replays), and resets on
 * a session-identity change (the provider fingerprints the actor's role). The whole
 * feedback state is cleared on that switch too — it described a command the previous
 * role sent. The visibility value is never in the key and never rendered.
 */
export function useSetNoteVisibility(
  userId: string,
  options: UseSetNoteVisibilityOptions = {},
): UseSetNoteVisibility {
  const { mutationsOverride } = options;
  const { session } = useSession();
  const mutations = React.useMemo(
    () => mutationsOverride ?? getCrmMutations(),
    [mutationsOverride],
  );

  const baseKey = React.useId();
  const [status, setStatus] = React.useState<SetNoteVisibilityStatus>("idle");
  const [errorCode, setErrorCode] = React.useState<CrmErrorCode | null>(null);
  const [active, setActive] = React.useState<ActiveVisibility | null>(null);

  const attemptRef = React.useRef(0);
  const pendingRef = React.useRef(false);

  const sessionIdentity = `${session.employeeId}:${session.role}`;
  const identityRef = React.useRef(sessionIdentity);
  if (identityRef.current !== sessionIdentity) {
    identityRef.current = sessionIdentity;
    attemptRef.current += 1;
    pendingRef.current = false;
  }

  const submit = React.useCallback(
    async ({
      noteId,
      visibility,
      expectedUpdatedAt,
    }: {
      noteId: string;
      visibility: "team" | "private";
      expectedUpdatedAt: string;
    }): Promise<{ ok: boolean; code: CrmErrorCode | null }> => {
      if (pendingRef.current) return { ok: false, code: null };

      pendingRef.current = true;
      setActive({ noteId });
      setStatus("pending");
      setErrorCode(null);

      try {
        const res = await mutations.setNoteVisibility(contextFromSession(session), {
          userId,
          noteId,
          visibility,
          expectedUpdatedAt,
          idempotencyKey: `${baseKey}:${userId}:${noteId}:${attemptRef.current}`,
        });

        if (res.status === "error" || !res.data) {
          const code: CrmErrorCode = res.error?.code ?? "internal";
          if (code === "conflict") attemptRef.current += 1;
          setStatus("error");
          setErrorCode(code);
          return { ok: false, code };
        }

        attemptRef.current += 1;
        setStatus("success");
        setErrorCode(null);
        return { ok: true, code: null };
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

  React.useEffect(() => {
    setStatus("idle");
    setErrorCode(null);
    setActive(null);
  }, [sessionIdentity]);

  return { status, errorCode, active, submit, clearFeedback };
}
