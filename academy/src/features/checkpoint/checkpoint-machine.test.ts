/**
 * L4VC-1 — the checkpoint state model.
 *
 * Every verdict belongs to the Backend. These tests pin that in both
 * directions: a state the Academy understands is rendered exactly, and anything
 * it does not understand fails closed to "cannot verify", never to a pass.
 */
import { describe, it, expect } from "vitest";
import {
  canSubmit,
  initialState,
  phaseFor,
  phaseForError,
  reducer,
  type CheckpointMachineState,
} from "@/features/checkpoint/checkpoint-machine";
import type { AcademyCheckpointState } from "@/lib/curriculum/academy-view";
import type { CheckpointVerificationResult } from "@/lib/checkpoint/types";

function cp(partial: Partial<AcademyCheckpointState> = {}): AcademyCheckpointState {
  return {
    verificationState: "verification_unavailable",
    reason: "checkpoint_disabled",
    canVerify: false,
    canStart: false,
    canComplete: false,
    retryAfterSeconds: null,
    ...partial,
  };
}

function result(partial: Partial<CheckpointVerificationResult> = {}): CheckpointVerificationResult {
  return {
    verificationState: "not_met",
    verificationReason: "not_met",
    retryAfterSeconds: null,
    completed: false,
    replayed: false,
    level: { levelNumber: 4, stableCode: "v2.l004" },
    nextLevelNumber: null,
    xpAwarded: 0,
    xpTransactionId: null,
    ...partial,
  };
}

describe("checkpoint phase mapping", () => {
  it("maps every Backend state to its honest screen", () => {
    expect(phaseFor("ready", "none")).toBe("ready");
    expect(phaseFor("checking", "none")).toBe("checking");
    expect(phaseFor("cooldown", "cooldown_active")).toBe("cooldown");
    expect(phaseFor("cooldown", "rate_limited")).toBe("cooldown");
    expect(phaseFor("not_met", "not_met")).toBe("not_met");
    expect(phaseFor("completed", "none")).toBe("completed");
  });

  it("separates 'cannot look' from 'looked and not met'", () => {
    // The distinction the whole feature exists to protect.
    expect(phaseFor("verification_unavailable", "provider_timeout")).toBe("provider_unavailable");
    expect(phaseFor("not_met", "not_met")).toBe("not_met");
    expect(phaseFor("verification_unavailable", "provider_timeout")).not.toBe("not_met");
  });

  it("maps both flag-off reasons to the disabled screen", () => {
    expect(phaseFor("verification_unavailable", "checkpoint_disabled")).toBe("disabled");
    expect(phaseFor("verification_unavailable", "provider_disabled")).toBe("disabled");
  });

  it("maps identity and currency reasons to their own screens", () => {
    expect(phaseFor("verification_unavailable", "identity_unlinked")).toBe("identity_unlinked");
    expect(phaseFor("verification_unavailable", "identity_mismatch")).toBe("identity_mismatch");
    expect(phaseFor("verification_unavailable", "unsupported_currency")).toBe("unsupported_currency");
  });

  it("maps every provider fault to one bounded unavailable screen", () => {
    for (const reason of [
      "provider_unconfigured", "requirement_unconfigured", "integration_unknown",
      "provider_timeout", "provider_maintenance", "provider_rate_limited",
      "stale", "invalid_provider_response", "unsupported",
    ]) {
      expect(phaseFor("verification_unavailable", reason)).toBe("provider_unavailable");
    }
  });

  it("fails closed on anything it does not understand", () => {
    const unknown: Array<[string, string]> = [
      ["auto_passed", "none"],
      ["verified", "balance_ok"],
      ["", ""],
      ["verification_unavailable", "balance_below_50_usd"],
    ];
    for (const [state, reason] of unknown) {
      const phase = phaseFor(state, reason);
      expect(phase).toBe("provider_unavailable");
      expect(phase).not.toBe("completed");
      expect(phase).not.toBe("ready");
    }
  });
});

describe("checkpoint submit permission", () => {
  it("is refused whenever the Backend withholds it", () => {
    const state = initialState(cp({ verificationState: "ready", reason: "none" }));
    expect(canSubmit(state, cp({ canVerify: false }))).toBe(false);
  });

  it("is granted only on ready / not_met / error, with Backend permission", () => {
    const permit = cp({ canVerify: true });
    const at = (phase: CheckpointMachineState["phase"]) =>
      canSubmit({ phase, retryAfterSeconds: null, requestId: null, error: null, completed: false }, permit);
    expect(at("ready")).toBe(true);
    expect(at("not_met")).toBe(true);
    expect(at("error")).toBe(true);
    // Busy, finished or waiting: never.
    expect(at("checking")).toBe(false);
    expect(at("completed")).toBe(false);
    expect(at("cooldown")).toBe(false);
    expect(at("disabled")).toBe(false);
    expect(at("provider_unavailable")).toBe(false);
    expect(at("identity_unlinked")).toBe(false);
    expect(at("identity_mismatch")).toBe(false);
    expect(at("unsupported_currency")).toBe(false);
  });
});

describe("checkpoint reducer", () => {
  it("recovers the exact server state after a refresh", () => {
    // A refresh re-renders from the server block, so the learner returns to the
    // same honest screen and the same countdown.
    const cooling = initialState(
      cp({ verificationState: "cooldown", reason: "cooldown_active", retryAfterSeconds: 37 }),
    );
    expect(cooling.phase).toBe("cooldown");
    expect(cooling.retryAfterSeconds).toBe(37);
    expect(cooling.completed).toBe(false);

    const done = initialState(cp({ verificationState: "completed", reason: "none" }));
    expect(done.phase).toBe("completed");
    expect(done.completed).toBe(true);
  });

  it("ignores a second submit while one is in flight (double click)", () => {
    const ready = initialState(cp({ verificationState: "ready", reason: "none" }));
    const first = reducer(ready, { type: "verify_pending", requestId: "ata-cp-1234abcd" });
    expect(first.phase).toBe("checking");
    const second = reducer(first, { type: "verify_pending", requestId: "ata-cp-second99" });
    // Same object: the second click changed nothing, so no second request
    // identity was ever created.
    expect(second).toBe(first);
    expect(second.requestId).toBe("ata-cp-1234abcd");
  });

  it("never re-enters checking from completed", () => {
    const done = initialState(cp({ verificationState: "completed", reason: "none" }));
    expect(reducer(done, { type: "verify_pending", requestId: "ata-cp-xxxxxxxx" })).toBe(done);
  });

  it("keeps the request identity so a retry replays instead of re-asking", () => {
    const ready = initialState(cp({ verificationState: "ready", reason: "none" }));
    const pending = reducer(ready, { type: "verify_pending", requestId: "ata-cp-stable11" });
    const failed = reducer(pending, {
      type: "verify_err",
      error: { code: "NETWORK_ERROR", status: null, requestId: null, message: "" } as never,
    });
    expect(failed.phase).toBe("error");
    expect(failed.requestId).toBe("ata-cp-stable11");
  });

  it("takes completion only from the Backend's own flag", () => {
    const ready = initialState(cp({ verificationState: "ready", reason: "none" }));
    const pending = reducer(ready, { type: "verify_pending", requestId: "ata-cp-1234abcd" });

    const passed = reducer(pending, {
      type: "verify_ok",
      result: result({ verificationState: "completed", verificationReason: "none", completed: true }),
    });
    expect(passed.phase).toBe("completed");
    expect(passed.completed).toBe(true);

    // A "completed" state name WITHOUT the completed flag must not be treated
    // as a pass by the part of the app that acts on it.
    const inconsistent = reducer(pending, {
      type: "verify_ok",
      result: result({ verificationState: "completed", verificationReason: "none", completed: false }),
    });
    expect(inconsistent.completed).toBe(false);
  });

  it("counts the wait down and reopens the control at zero", () => {
    let state = initialState(
      cp({ verificationState: "cooldown", reason: "cooldown_active", retryAfterSeconds: 3 }),
    );
    state = reducer(state, { type: "tick" });
    expect(state.retryAfterSeconds).toBe(2);
    expect(state.phase).toBe("cooldown");
    state = reducer(state, { type: "tick" });
    expect(state.retryAfterSeconds).toBe(1);
    state = reducer(state, { type: "tick" });
    expect(state.retryAfterSeconds).toBeNull();
    expect(state.phase).toBe("ready");
    // Ticking past zero is inert.
    expect(reducer(state, { type: "tick" })).toBe(state);
  });

  it("a countdown on a non-cooldown screen expires without changing its meaning", () => {
    const unavailable = initialState(
      cp({
        verificationState: "verification_unavailable",
        reason: "provider_rate_limited",
        retryAfterSeconds: 1,
      }),
    );
    const after = reducer(unavailable, { type: "tick" });
    expect(after.retryAfterSeconds).toBeNull();
    // Still unavailable — the wait expiring does not mean the provider is back.
    expect(after.phase).toBe("provider_unavailable");
  });

  it("a 404 fails closed to disabled, not to an error the learner can retry", () => {
    expect(phaseForError({ code: "NOT_FOUND", status: 404 } as never)).toBe("disabled");
    expect(phaseForError({ code: "BACKEND_UNAVAILABLE", status: 502 } as never)).toBe("error");
  });

  it("holds no field an amount could occupy", () => {
    const state = initialState(cp({ verificationState: "not_met", reason: "not_met" }));
    expect(Object.keys(state).sort()).toEqual([
      "completed", "error", "phase", "requestId", "retryAfterSeconds",
    ]);
    const settled = reducer(
      reducer(initialState(cp({ verificationState: "ready", reason: "none" })), {
        type: "verify_pending",
        requestId: "ata-cp-1234abcd",
      }),
      { type: "verify_ok", result: result() },
    );
    expect(JSON.stringify(settled)).not.toMatch(/balance|remaining|deposit|amount/i);
  });
});
