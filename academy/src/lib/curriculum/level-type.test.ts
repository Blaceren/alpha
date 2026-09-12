import { describe, it, expect } from "vitest";
import { mapLevelType, type BackendLevelType } from "@/lib/curriculum/level-type";

const ALL: BackendLevelType[] = [
  "external_event",
  "lesson",
  "scenario",
  "practice",
  "report",
  "mentor_review",
  "financial_checkpoint",
  "final_exam",
];

describe("mapLevelType", () => {
  it("maps every Backend type to a supported, non-lesson-defaulted concept", () => {
    for (const type of ALL) {
      const info = mapLevelType(type);
      expect(info.supported).toBe(true);
    }
  });

  it("external_event is external and not self-completable", () => {
    const info = mapLevelType("external_event");
    expect(info.isExternal).toBe(true);
    expect(info.selfCompletableInPrinciple).toBe(false);
  });

  it("financial_checkpoint is a checkpoint, not a lesson", () => {
    const info = mapLevelType("financial_checkpoint");
    expect(info.type).toBe("checkpoint");
    expect(info.isCheckpoint).toBe(true);
  });

  it("mentor_review and report are not self-completable", () => {
    expect(mapLevelType("mentor_review").selfCompletableInPrinciple).toBe(false);
    expect(mapLevelType("report").selfCompletableInPrinciple).toBe(false);
  });

  it("an UNKNOWN type maps to unsupported, never to lesson", () => {
    const info = mapLevelType("brand_new_type");
    expect(info.type).toBe("unsupported");
    expect(info.supported).toBe(false);
    expect(info.type).not.toBe("lesson");
  });
});
