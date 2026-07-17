"use client";

import * as React from "react";
import type { CrmMutations } from "@/data/contracts/CrmMutations";
import type { CrmErrorCode } from "@/data/contracts/result";
import { getCrmMutations } from "@/application/provider";
import { contextFromSession } from "@/application/context";
import { useSession } from "@/components/crm-shell/session-context";

export type UpdateNoteBodyStatus = "idle" | "pending" | "success" | "error";

/** The note a body edit targets. */
export interface ActiveEdit {
  noteId: string;
}

export interface UseUpdateNoteBody {
  status: UpdateNoteBodyStatus;
  errorCode: CrmErrorCode | null;
  /**
   * Which note the last/ongoing edit is about, so the section can render feedback
   * next to that row and return focus to its control. `null` at idle.
   */
  active: ActiveEdit | null;
  /**
   * `ok` is `true` only when the note now holds the requested body. `code` is the
   * failure code otherwise, so the caller can tell a `conflict`/`not_found`
   * (re-read to show what is actually stored) from a storage failure (keep the
   * draft and let the same key retry).
   */
  submit: (input: {
    noteId: string;
    body: string;
    expectedUpdatedAt: string;
  }) => Promise<{ ok: boolean; code: CrmErrorCode | null }>;
  /** Drops success/error state quietly. */
  clearFeedback: () => void;
}

export interface UseUpdateNoteBodyOptions {
  /** Tests only; production resolves the app's single provider instance. */
  mutationsOverride?: CrmMutations;
}

/**
 * Owns the `updateNoteBody` call, its state machine and the idempotency key.
 *
 * One hook instance serves the whole notes list rather than one per row — only one
 * note may be edited at a time (the section enforces it), and a per-row hook would
 * mint a `useId` per note and re-key them as the list reorders. `active` records
 * which note the current state is about.
 *
 * Key lifecycle follows `useAddNote`/`useSetNotePinned` (D-61) —
 * `${useId()}:${userId}:${noteId}:${attempt}`, no Math.random, no Date.now, no
 * crypto, no dependency — with the same rules about when `attempt` may advance:
 *   - a retry after a storage failure repeats the key (nothing was written), which
 *     is what makes the retry safe rather than a possible second write;
 *   - a double submit repeats the key, and the provider replays instead of writing twice;
 *   - success advances it, so the next edit is a new command;
 *   - `conflict` advances it, because the key has already been accepted for a
 *     different command and would keep conflicting forever otherwise.
 * `noteId` is in the key so two different notes never share one, independent of the
 * shared attempt counter.
 *
 * `attempt` ALSO resets when the session identity changes: the provider fingerprints
 * the actor's role, so a key minted under one role and submitted under another
 * describes a different command and would come back as a spurious `conflict`. The
 * whole feedback state is cleared on that switch too — it described a command the
 * previous role sent (mirrors 1B4-C/1B4-D).
 *
 * The body is NEVER in the key, never rendered, never logged and never put in an
 * attribute; the key itself is likewise never rendered.
 */
export function useUpdateNoteBody(
  userId: string,
  options: UseUpdateNoteBodyOptions = {},
): UseUpdateNoteBody {
  const { mutationsOverride } = options;
  const { session } = useSession();
  const mutations = React.useMemo(
    () => mutationsOverride ?? getCrmMutations(),
    [mutationsOverride],
  );

  const baseKey = React.useId();
  const [status, setStatus] = React.useState<UpdateNoteBodyStatus>("idle");
  const [errorCode, setErrorCode] = React.useState<CrmErrorCode | null>(null);
  const [active, setActive] = React.useState<ActiveEdit | null>(null);

  // Refs, not state: an attempt counter nothing renders should not cause a render,
  // and `pending` has to be readable synchronously — two saves in one tick would
  // both observe a not-yet-rerendered "idle" and both call through.
  const attemptRef = React.useRef(0);
  const pendingRef = React.useRef(false);

  const sessionIdentity = `${session.employeeId}:${session.role}`;
  const identityRef = React.useRef(sessionIdentity);
  if (identityRef.current !== sessionIdentity) {
    identityRef.current = sessionIdentity;
    attemptRef.current += 1;
    // The pending guard is a ref, so it must be dropped here too, or an in-flight
    // edit abandoned by a role switch would wedge the control shut.
    pendingRef.current = false;
  }

  const submit = React.useCallback(
    async ({
      noteId,
      body,
      expectedUpdatedAt,
    }: {
      noteId: string;
      body: string;
      expectedUpdatedAt: string;
    }): Promise<{ ok: boolean; code: CrmErrorCode | null }> => {
      if (pendingRef.current) return { ok: false, code: null };

      pendingRef.current = true;
      setActive({ noteId });
      setStatus("pending");
      setErrorCode(null);

      try {
        const res = await mutations.updateNoteBody(contextFromSession(session), {
          userId,
          noteId,
          body,
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

        // `replayed: true` says this exact command had already been applied under
        // this key. The note holds the requested body either way, so it is an
        // ordinary success — reporting a replay would describe our bookkeeping.
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

  // Only status/error are dropped; a stale `active` is harmless because feedback
  // renders only while status is success or error.
  const clearFeedback = React.useCallback(() => {
    setStatus((s) => (s === "pending" ? s : "idle"));
    setErrorCode(null);
  }, []);

  // Feedback must not outlive a role switch: it is about a command the previous
  // role sent. Not folded into the render-time reset above, which must NOT clear
  // active/status or a success line would vanish the moment its refetch returned.
  React.useEffect(() => {
    setStatus("idle");
    setErrorCode(null);
    setActive(null);
  }, [sessionIdentity]);

  return { status, errorCode, active, submit, clearFeedback };
}
