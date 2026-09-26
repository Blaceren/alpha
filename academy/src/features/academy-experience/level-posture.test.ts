/**
 * Level Detail must speak the same four-posture language as Home and Path.
 *
 * The point is the same one the Action Field tests hold: waiting is not blocked.
 * A learner whose report is under review, or whose checkpoint the platform
 * cannot currently verify, has done their part — and on the level page that has
 * to look different from a level they cannot start.
 */
import { describe, expect, it } from "vitest";
import { levelPosture } from "@/features/academy-experience/level-detail-screen";
import type { AcademyLevelSummary } from "@/lib/curriculum/academy-view";

type State = AcademyLevelSummary["state"];

describe("levelPosture", () => {
  it("actionable states are act", () => {
    expect(levelPosture("available")).toBe("act");
    expect(levelPosture("in_progress")).toBe("act");
  });

  it("pending review is WAITING, never blocked", () => {
    expect(levelPosture("pending_review")).toBe("waiting");
    expect(levelPosture("pending_review")).not.toBe("blocked");
  });

  it("an unverifiable checkpoint is WAITING, never blocked", () => {
    // Nothing is blocking the learner: the platform cannot ask right now.
    expect(levelPosture("checkpoint_unverified")).toBe("waiting");
    expect(levelPosture("checkpoint_unverified")).not.toBe("blocked");
  });

  it("completed is done", () => {
    expect(levelPosture("completed")).toBe("done");
  });

  it("locked is blocked", () => {
    expect(levelPosture("locked")).toBe("blocked");
  });

  it("an unrecognised state fails closed to blocked", () => {
    expect(levelPosture("banana" as unknown as State)).toBe("blocked");
  });

  it("every canonical state maps to exactly one of the four postures", () => {
    const states: State[] = [
      "completed",
      "pending_review",
      "in_progress",
      "available",
      "checkpoint_unverified",
      "locked",
    ];
    const allowed = new Set(["act", "waiting", "blocked", "done"]);
    for (const s of states) expect(allowed.has(levelPosture(s))).toBe(true);
    // And the mapping is not degenerate — all four postures are reachable.
    expect(new Set(states.map(levelPosture)).size).toBe(4);
  });
});
