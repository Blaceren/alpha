import { describe, it, expect } from "vitest";
import {
  isBackendCurriculumEnvelope,
  isBackendCurriculumRead,
  isBackendLevelContentEnvelope,
} from "@/lib/curriculum/backend-dto";

const validLevel = {
  levelNumber: 1,
  stableCode: "l001",
  type: "lesson",
  title: "T",
  shortDescription: null,
  learningObjective: "o",
  completionMethod: "manual",
  xpReward: 10,
  requirements: { previousLevel: null, requiredXp: 0, checkpointLevel: null },
  status: "active",
  presentationState: "available",
  blockers: [],
  durableStatus: null,
  progress: null,
};

const validEnrolled = {
  kind: "enrolled",
  curriculum: { code: "ata-v2", name: "ATA", versionNumber: 1, status: "published", effectiveFrom: null, publishedAt: null },
  enrollment: { status: "active", enrolledAt: "2026-01-01T00:00:00.000Z", currentLevel: 1, highestCompletedLevel: 0, lastMeaningfulActionAt: null, completedAt: null },
  modules: [{ moduleNumber: 1, code: "m01", title: "M", description: null, firstLevel: 1, lastLevel: 1, checkpointLevel: null, learningObjective: "lo", status: "active", levels: [validLevel] }],
  xp: { kind: "disabled" },
};

describe("backend curriculum guards", () => {
  it("accepts a valid enrolled read + envelope", () => {
    expect(isBackendCurriculumRead(validEnrolled)).toBe(true);
    expect(isBackendCurriculumEnvelope({ data: validEnrolled })).toBe(true);
  });

  it("accepts an UNKNOWN level type string (safe-mapped downstream)", () => {
    const withUnknownType = structuredClone(validEnrolled);
    withUnknownType.modules[0]!.levels[0]!.type = "brand_new";
    expect(isBackendCurriculumRead(withUnknownType)).toBe(true);
  });

  it("rejects a read with a missing stable code", () => {
    const bad = structuredClone(validEnrolled);
    delete (bad.modules[0]!.levels[0] as Record<string, unknown>).stableCode;
    expect(isBackendCurriculumRead(bad)).toBe(false);
  });

  it("rejects a malformed level order (non-number)", () => {
    const bad = structuredClone(validEnrolled);
    (bad.modules[0]!.levels[0] as Record<string, unknown>).levelNumber = "1";
    expect(isBackendCurriculumRead(bad)).toBe(false);
  });

  it("rejects invalid progress (attemptCount not a number)", () => {
    const bad = structuredClone(validEnrolled);
    (bad.modules[0]!.levels[0] as Record<string, unknown>).progress = { status: "completed", startedAt: "x", lastProgressAt: null, completedAt: "x", completionMethod: null, attemptCount: "1" };
    expect(isBackendCurriculumRead(bad)).toBe(false);
  });

  it("rejects an unknown top-level kind", () => {
    expect(isBackendCurriculumRead({ kind: "surprise" })).toBe(false);
  });

  it("validates the content envelope and rejects a malformed one", () => {
    const content = { kind: "available", level: { levelNumber: 2, stableCode: "l002", type: "lesson", title: "T", shortDescription: "s", learningObjective: "o" }, content: { versionNumber: 1, videoDurationSeconds: null, publishedAt: "2026-01-01T00:00:00.000Z", localization: { locale: "ru", title: "t", subtitle: "s", learningObjectiveExtension: "e", summary: "s", transcript: null, body: {} }, assets: [] }, progress: null };
    expect(isBackendLevelContentEnvelope({ data: content })).toBe(true);
    expect(isBackendLevelContentEnvelope({ data: { kind: "nope" } })).toBe(false);
  });
});
