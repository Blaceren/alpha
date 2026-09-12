/**
 * L4HG-1 — the Academy renders the Backend's checkpoint verdict and never
 * widens it.
 *
 * The Academy is not progression authority: it may narrow a Backend permission
 * but never grant one. These tests pin that in both directions — a Backend that
 * says "unavailable" must present as unavailable, and a Backend payload the
 * Academy does not understand must also present as unavailable rather than as a
 * passable gate.
 */
import { describe, it, expect } from "vitest";
import { toAcademyCurriculumView } from "@/lib/curriculum/view-model";
import { mapLevelState } from "@/lib/curriculum/progress-state";
import { isBackendCurriculumRead } from "@/lib/curriculum/backend-dto";
import type { BackendCurriculumRead, BackendLevel, BackendCheckpoint } from "@/lib/curriculum/backend-dto";

const UNAVAILABLE: BackendCheckpoint = {
  kind: "financial_checkpoint",
  integrationCode: "checkpoint.module-01",
  verificationState: "verification_unavailable",
  verificationReason: "checkpoint_disabled",
  canVerify: false,
  canStart: false,
  canComplete: false,
};

function level(partial: Partial<BackendLevel> & { levelNumber: number; stableCode: string; type: string }): BackendLevel {
  return {
    title: `L${partial.levelNumber}`,
    shortDescription: null,
    learningObjective: "obj",
    completionMethod: "manual",
    xpReward: 0,
    requirements: { previousLevel: partial.levelNumber === 1 ? null : partial.levelNumber - 1, requiredXp: 0, checkpointLevel: null },
    status: "active",
    durableStatus: null,
    progress: null,
    checkpoint: null,
    ...partial,
  } as BackendLevel;
}

/**
 * A learner standing on L4 with L1-L3 completed — the live post-L3 shape.
 * Pass `"omit"` to model an older Backend that sends no checkpoint block at all
 * (a literal `undefined` would just select the default).
 */
function atCheckpoint(checkpoint: BackendCheckpoint | null | "omit" = UNAVAILABLE): BackendCurriculumRead {
  const completed = (n: number, type: string) =>
    level({
      levelNumber: n, stableCode: `l00${n}`, type, presentationState: "completed", blockers: [],
      durableStatus: "completed",
      progress: { status: "completed", startedAt: "2026-01-02T00:00:00.000Z", lastProgressAt: "2026-01-02T00:00:00.000Z", completedAt: "2026-01-02T00:00:00.000Z", completionMethod: "manual", attemptCount: 1 },
    });
  return {
    kind: "enrolled",
    curriculum: { code: "ata-v2", name: "ATA", versionNumber: 2, status: "published", effectiveFrom: null, publishedAt: "2026-01-01T00:00:00.000Z" },
    enrollment: { status: "active", enrolledAt: "2026-01-01T00:00:00.000Z", currentLevel: 4, highestCompletedLevel: 3, lastMeaningfulActionAt: "2026-02-01T00:00:00.000Z", completedAt: null },
    modules: [
      {
        moduleNumber: 1, code: "m01", title: "Первое знакомство", description: "d",
        firstLevel: 1, lastLevel: 4, checkpointLevel: 4, learningObjective: "lo", status: "active",
        levels: [
          completed(1, "external_event"),
          completed(2, "lesson"),
          completed(3, "report"),
          level({
            levelNumber: 4, stableCode: "l004", type: "financial_checkpoint",
            completionMethod: "balance_check",
            presentationState: "checkpoint_unverified",
            blockers: ["checkpoint_verification_unavailable"],
            requirements: { previousLevel: 3, requiredXp: 0, checkpointLevel: null },
            ...(checkpoint === "omit" ? {} : { checkpoint }),
          }),
        ],
      },
    ],
    xp: { kind: "disabled" },
  };
}

function l4Of(read: BackendCurriculumRead) {
  const view = toAcademyCurriculumView(read);
  if (view.state !== "enrolled") throw new Error("expected enrolled");
  return view.modules[0]!.levels.find((entry) => entry.levelCode === "l004")!;
}

describe("checkpoint presentation state", () => {
  it("maps checkpoint_unverified to its own state, not available and not locked", () => {
    const info = mapLevelState({
      presentationState: "checkpoint_unverified",
      blockers: ["checkpoint_verification_unavailable"],
      isExternal: false,
    });
    expect(info.state).toBe("checkpoint_unverified");
    expect(info.state).not.toBe("available");
    expect(info.state).not.toBe("locked");
    expect(info.lockReason).toBeNull();
    expect(info.terminal).toBe(false);
    // The gate itself is readable; there is no lesson content behind it.
    expect(info.routeAccessible).toBe(true);
    expect(info.contentViewable).toBe(false);
  });

  it("labels the state truthfully and not as blocked", () => {
    const info = mapLevelState({ presentationState: "checkpoint_unverified", blockers: [], isExternal: false });
    expect(info.label).toBe("Проверка недоступна");
    expect(info.label).not.toContain("Заблокирован");
  });

  it("an unknown Backend state still fails to locked", () => {
    const info = mapLevelState({ presentationState: "checkpoint_verified_maybe", blockers: [], isExternal: false });
    expect(info.state).toBe("locked");
  });

  it("the new blocker maps to the checkpoint lock reason when a level is locked", () => {
    const info = mapLevelState({
      presentationState: "locked",
      blockers: ["sequence_incomplete", "checkpoint_verification_unavailable"],
      isExternal: false,
    });
    expect(info.state).toBe("locked");
    expect(info.lockReason).toBe("checkpoint");
  });
});

describe("checkpoint view model", () => {
  it("carries the Backend verdict onto the level summary", () => {
    const l4 = l4Of(atCheckpoint());
    expect(l4.typeInfo.isCheckpoint).toBe(true);
    expect(l4.state).toBe("checkpoint_unverified");
    expect(l4.checkpoint).toEqual({
      verificationState: "verification_unavailable",
      reason: "checkpoint_disabled",
      canVerify: false,
      canStart: false,
      canComplete: false,
      // L4VC-1 adds a WAIT in seconds. Null here — there is nothing to wait for
      // when verification is switched off.
      retryAfterSeconds: null,
    });
  });

  it("offers only the read action — never a verify action", () => {
    const l4 = l4Of(atCheckpoint());
    expect(l4.actions).toEqual(["view"]);
    expect(l4.checkpoint!.canVerify).toBe(false);
    expect(l4.checkpoint!.canStart).toBe(false);
    expect(l4.checkpoint!.canComplete).toBe(false);
  });

  it("non-checkpoint levels carry no checkpoint block", () => {
    const view = toAcademyCurriculumView(atCheckpoint());
    if (view.state !== "enrolled") throw new Error("expected enrolled");
    for (const code of ["l001", "l002", "l003"]) {
      expect(view.modules[0]!.levels.find((entry) => entry.levelCode === code)!.checkpoint).toBeNull();
    }
  });

  it("a missing checkpoint block (older Backend) fails closed", () => {
    const l4 = l4Of(atCheckpoint("omit"));
    expect(l4.checkpoint).toEqual({
      verificationState: "unsupported",
      reason: "unsupported",
      canVerify: false,
      canStart: false,
      canComplete: false,
      retryAfterSeconds: null,
    });
  });

  it("an unrecognised verification state fails closed, even if the Backend permits actions", () => {
    const l4 = l4Of(
      atCheckpoint({
        ...UNAVAILABLE,
        verificationState: "balance_verified_ok",
        verificationReason: "balance_ok",
        canVerify: true,
        canComplete: true,
      }),
    );
    // The Academy must never invent a pass from a payload it does not know.
    expect(l4.checkpoint!.verificationState).toBe("unsupported");
    expect(l4.checkpoint!.reason).toBe("unsupported");
    expect(l4.checkpoint!.canVerify).toBe(false);
    expect(l4.checkpoint!.canComplete).toBe(false);
  });

  it("an unknown reason degrades to unsupported and never reaches the UI", () => {
    // A reason the Academy does not know must not be rendered verbatim: an
    // invented reason string is the one place a Backend could smuggle a
    // financial statement into learner-visible copy.
    const l4 = l4Of(atCheckpoint({ ...UNAVAILABLE, verificationReason: "balance_below_50_usd" }));
    expect(l4.checkpoint!.reason).toBe("unsupported");
    expect(JSON.stringify(l4)).not.toContain("balance");
  });

  it("L4VC-1 states are carried through exactly, and never widened", () => {
    for (const [verificationState, verificationReason] of [
      ["ready", "none"],
      ["checking", "none"],
      ["cooldown", "cooldown_active"],
      ["not_met", "not_met"],
      ["completed", "none"],
      ["verification_unavailable", "provider_disabled"],
      ["verification_unavailable", "identity_unlinked"],
      ["verification_unavailable", "identity_mismatch"],
      ["verification_unavailable", "unsupported_currency"],
      ["verification_unavailable", "requirement_unconfigured"],
      ["verification_unavailable", "provider_timeout"],
      ["verification_unavailable", "provider_maintenance"],
      ["verification_unavailable", "provider_rate_limited"],
      ["verification_unavailable", "stale"],
      ["verification_unavailable", "invalid_provider_response"],
    ] as const) {
      const l4 = l4Of(atCheckpoint({ ...UNAVAILABLE, verificationState, verificationReason }));
      expect(l4.checkpoint!.verificationState).toBe(verificationState);
      expect(l4.checkpoint!.reason).toBe(verificationReason);
      // Backend said false, so the Academy says false — in every state.
      expect(l4.checkpoint!.canVerify).toBe(false);
      expect(l4.checkpoint!.canStart).toBe(false);
      expect(l4.checkpoint!.canComplete).toBe(false);
    }
  });

  it("canVerify is honoured only when the Backend grants it on a known state", () => {
    const granted = l4Of(
      atCheckpoint({ ...UNAVAILABLE, verificationState: "ready", verificationReason: "none", canVerify: true }),
    );
    expect(granted.checkpoint!.canVerify).toBe(true);
    // ...but never for a state the Academy does not understand.
    const invented = l4Of(
      atCheckpoint({ ...UNAVAILABLE, verificationState: "auto_passed", verificationReason: "none", canVerify: true }),
    );
    expect(invented.checkpoint!.canVerify).toBe(false);
    expect(invented.checkpoint!.verificationState).toBe("unsupported");
  });

  it("retryAfterSeconds is a bounded positive duration or null", () => {
    const cooling = l4Of(
      atCheckpoint({
        ...UNAVAILABLE, verificationState: "cooldown", verificationReason: "cooldown_active",
        retryAfterSeconds: 42,
      }),
    );
    expect(cooling.checkpoint!.retryAfterSeconds).toBe(42);
    // Absurd, negative, non-finite and over-long waits are dropped, not shown.
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 99_999]) {
      const l4 = l4Of(
        atCheckpoint({
          ...UNAVAILABLE, verificationState: "cooldown", verificationReason: "cooldown_active",
          retryAfterSeconds: bad,
        }),
      );
      expect(l4.checkpoint!.retryAfterSeconds).toBeNull();
    }
  });

  it("L5 is not fabricated: the read exposes only the levels the Backend sent", () => {
    const view = toAcademyCurriculumView(atCheckpoint());
    if (view.state !== "enrolled") throw new Error("expected enrolled");
    expect(view.modules[0]!.levels.map((entry) => entry.levelCode)).toEqual(["l001", "l002", "l003", "l004"]);
    expect(view.progress.nextAvailableLevelCode).toBeNull();
  });
});

describe("checkpoint wire guard", () => {
  it("accepts a payload carrying the bounded checkpoint block", () => {
    expect(isBackendCurriculumRead(atCheckpoint())).toBe(true);
  });

  it("accepts a payload without the block (older Backend)", () => {
    expect(isBackendCurriculumRead(atCheckpoint("omit"))).toBe(true);
  });

  it("rejects a malformed checkpoint block instead of guessing", () => {
    const read = atCheckpoint({ ...UNAVAILABLE, canVerify: "yes" as unknown as boolean });
    expect(isBackendCurriculumRead(read)).toBe(false);
  });
});
