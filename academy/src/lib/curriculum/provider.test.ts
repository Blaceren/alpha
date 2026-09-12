import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Prevent the api path (and its next/headers import) from loading; the fixture
// path never calls these.
vi.mock("@/server/curriculum/server-read", () => ({
  readCurriculumCurrent: vi.fn(),
  readLevelContent: vi.fn(),
}));

import { getCurriculumView, getLevelDetail } from "@/lib/curriculum/provider";
import { resetAcademyConfigCache } from "@/config/academy-config";
import * as provider from "@/lib/curriculum/provider";

let original: string | undefined;
beforeEach(() => {
  original = process.env.ACADEMY_MODE;
  process.env.ACADEMY_MODE = "fixture";
  resetAcademyConfigCache();
});
afterEach(() => {
  process.env.ACADEMY_MODE = original;
  resetAcademyConfigCache();
});

describe("fixture provider (parity, via the same mapper)", () => {
  it("returns an enrolled view with L1 completed and L2 available", async () => {
    const result = await getCurriculumView();
    expect(result.ok).toBe(true);
    if (result.ok && result.view.state === "enrolled") {
      const levels = result.view.modules[0]!.levels;
      expect(levels[0]!.state).toBe("completed");
      expect(levels[1]!.state).toBe("available");
      expect(result.view.progress.completedLevels).toBe(1);
    } else {
      throw new Error("expected enrolled fixture view");
    }
  });

  it("builds a fixture level detail with honest not-configured content", async () => {
    const result = await getLevelDetail("level.002");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail.summary.levelCode).toBe("level.002");
      expect(result.detail.content.available).toBe(false);
      expect(result.detail.content.unavailableReason).toBe("not_configured");
    }
  });

  it("returns LEVEL_NOT_FOUND for an unknown code", async () => {
    const result = await getLevelDetail("does.not.exist");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("LEVEL_NOT_FOUND");
  });
});

describe("provider has no write capability", () => {
  it("exports only read (get*) functions — no mutation verbs", () => {
    const mutationVerbs = /(create|update|delete|submit|complete|start|write|patch|put|post|unlock|mark)/i;
    for (const name of Object.keys(provider)) {
      if (typeof (provider as Record<string, unknown>)[name] === "function") {
        expect(name, `provider export ${name} must be a read`).not.toMatch(mutationVerbs);
      }
    }
  });
});
