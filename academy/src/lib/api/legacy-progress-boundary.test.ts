/**
 * LEGACY-USER-PROGRESS-COLUMNS-1 — the boundary, pinned.
 *
 * THE SITUATION. `User.level` and `User.xp` are live columns of the V1 system:
 * they are written by promocode redemption, daily rewards, the registration
 * invite bonus and V1 task completion, and they are read by CRM user detail, the
 * CRM dashboard filter, the admin user editor, community chat moderation
 * (`channel.requiredLevel && user.level < channel.requiredLevel`) and the V1
 * `/levels` rank page. They are CANONICAL AUTHORITY for that system.
 *
 * They are LEGACY STORAGE with respect to the V2 curriculum, which keeps its own
 * progression in `UserLevelProgress` and its own XP in the curriculum records.
 * The two disagree by design and by a lot: learner 73 reads `level: 1, xp: 0`
 * from `/api/auth/me` while the curriculum places them on level 15 with 1700 XP.
 *
 * THE RESOLUTION. Neither column is synchronised, rewritten or removed —
 * synchronising would corrupt V1 rank and chat gating, and removal would need a
 * migration for no product gain. Instead the boundary is enforced where it
 * matters: the Academy's viewer DTO does not carry them, so no Academy surface
 * can read a stale progress number even by accident. That is the property these
 * tests hold, and the reason this file exists rather than a comment.
 */
import { describe, expect, it } from "vitest";
import { toAcademyViewer } from "@/lib/api/viewer";

describe("LEGACY-USER-PROGRESS-COLUMNS-1", () => {
  /**
   * The Backend session payload for learner 73, including the two V1 columns
   * exactly as `/api/auth/me` returns them.
   *
   * Note the cast, because it is itself part of the finding: `BackendPublicUser`
   * does not DECLARE level or xp, so the boundary is already enforced by the
   * type and not only by the projection body. The cast is what lets these tests
   * push the real wire shape through anyway and prove the runtime drops them
   * too — belt and braces on the property that actually matters.
   */
  const backendUser = {
    id: 73,
    name: "LO Mentor Learner (synthetic)",
    email: "lo-learner-mentor@learner-ops.invalid",
    role: "user",
    status: "active",
    level: 1,
    xp: 0,
  } as unknown as Parameters<typeof toAcademyViewer>[0];

  it("the Academy viewer DTO carries no level and no xp at all", () => {
    const viewer = toAcademyViewer(backendUser);
    expect(viewer).not.toBeNull();
    expect(Object.keys(viewer!)).not.toContain("level");
    expect(Object.keys(viewer!)).not.toContain("xp");
  });

  it("a stale legacy value cannot travel into the Academy through the viewer", () => {
    // Even at an absurd value, nothing about it survives the projection.
    const viewer = toAcademyViewer({ ...backendUser, level: 999, xp: 123456 } as unknown as Parameters<typeof toAcademyViewer>[0]);
    expect(JSON.stringify(viewer)).not.toContain("999");
    expect(JSON.stringify(viewer)).not.toContain("123456");
  });

  it("the viewer keeps only identity and session facts", () => {
    const viewer = toAcademyViewer(backendUser);
    expect(new Set(Object.keys(viewer!))).toEqual(
      new Set(["id", "name", "role", "status", "synthetic"]),
    );
  });

  it("curriculum XP and legacy XP are allowed to disagree — that is the design", () => {
    // Documented as an executable fact so a future reader does not "fix" the
    // divergence by writing canonical values back into the V1 columns.
    const viewer = toAcademyViewer(backendUser);
    expect(viewer!.name).toBe("LO Mentor Learner (synthetic)");
    // The Academy learns progress from the curriculum view, never from here.
    expect(viewer as unknown as Record<string, unknown>).not.toHaveProperty("level");
  });
});
