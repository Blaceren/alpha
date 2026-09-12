import { describe, it, expect } from "vitest";
import { mapLevelState } from "@/lib/curriculum/progress-state";

describe("mapLevelState (enrolled context)", () => {
  it("completed -> completed, accessible, terminal", () => {
    const s = mapLevelState({ presentationState: "completed", blockers: [], isExternal: false });
    expect(s.state).toBe("completed");
    expect(s.routeAccessible).toBe(true);
    expect(s.terminal).toBe(true);
  });

  it("available -> available and accessible", () => {
    const s = mapLevelState({ presentationState: "available", blockers: [], isExternal: false });
    expect(s.state).toBe("available");
    expect(s.routeAccessible).toBe(true);
  });

  it("in_progress -> in_progress", () => {
    expect(mapLevelState({ presentationState: "in_progress", blockers: [], isExternal: false }).state).toBe("in_progress");
  });

  it("pending_review -> pending_review (waiting review), not terminal", () => {
    const s = mapLevelState({ presentationState: "pending_review", blockers: [], isExternal: false });
    expect(s.state).toBe("pending_review");
    expect(s.terminal).toBe(false);
  });

  it("locked with checkpoint blocker -> locked/checkpoint", () => {
    const s = mapLevelState({ presentationState: "locked", blockers: ["checkpoint_engine_unavailable", "not_current_level"], isExternal: false });
    expect(s.state).toBe("locked");
    expect(s.lockReason).toBe("checkpoint");
    expect(s.routeAccessible).toBe(false);
  });

  it("locked with only sequence -> locked/sequence", () => {
    const s = mapLevelState({ presentationState: "locked", blockers: ["not_current_level", "sequence_incomplete"], isExternal: false });
    expect(s.lockReason).toBe("sequence");
  });

  it("external event locked -> lock reason external", () => {
    const s = mapLevelState({ presentationState: "locked", blockers: ["not_current_level"], isExternal: true });
    expect(s.lockReason).toBe("external");
  });

  it("xp_eligible is NOT accessible (still locked to the learner)", () => {
    const s = mapLevelState({ presentationState: "xp_eligible", blockers: ["not_current_level", "sequence_incomplete"], isExternal: false });
    expect(s.state).toBe("locked");
    expect(s.routeAccessible).toBe(false);
  });

  it("an UNKNOWN presentation state fails LOCKED (never unlocks)", () => {
    const s = mapLevelState({ presentationState: "surprise", blockers: [], isExternal: false });
    expect(s.state).toBe("locked");
    expect(s.routeAccessible).toBe(false);
  });
});

describe("mapLevelState (completed context, no presentationState)", () => {
  it("durable completed -> completed", () => {
    expect(mapLevelState({ durableStatus: "completed", isExternal: false }).state).toBe("completed");
  });
  it("durable pending_review -> pending_review", () => {
    expect(mapLevelState({ durableStatus: "pending_review", isExternal: false }).state).toBe("pending_review");
  });
  it("no durable status -> locked (never accessible by default)", () => {
    const s = mapLevelState({ durableStatus: null, isExternal: false });
    expect(s.state).toBe("locked");
  });
});
