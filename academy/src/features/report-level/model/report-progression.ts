/**
 * Report → progression augmentation (Phase D3-D).
 *
 * WHAT THIS IS: the ONE clean layer that turns an approved report into a session
 * completion the EXISTING progression resolver already understands (DD-297).
 * There is no second store, no `report-completion` key and no re-implemented
 * unlock algorithm — an approved report simply projects «level N is completed»
 * onto the session, and `resolveRouteAvailability` opens the next level exactly
 * as it does for a finished lesson.
 *
 * WHAT IT NEVER DOES: it never writes anything. `ata.lesson-progress.v1` is NOT
 * touched (DD-297) — completion is DERIVED from the report workspace at read
 * time. It never downgrades progression: it only ADDS completions, so it can
 * only ever move the marker forward, and applying it under the canonical profile
 * (Артём on level 18) is a no-op. It is idempotent — a duplicate completion
 * folds away through the canonical `withCompletedLevel` helper.
 *
 * Deliberately NOT here: Pocket, XP, balances, any financial value, mentor
 * identity, a checkpoint page. An approved report opens the NEXT curriculum step
 * through the same resolver as everything else — nothing more.
 */

import {
  withCompletedLevel,
  type LessonSessionProgress,
} from "@/features/lesson/model/lesson-session-progress";
import { parseLevelCode } from "@/features/lesson/model/lesson";
import { isReportLevelNumber } from "@/features/report-level/model/report";
import type { ReportWorkspaceStateV3 } from "@/features/report-level/model/report-workspace-v3";

/**
 * The level numbers whose stored report is `approved`.
 *
 * The store's parser already fails closed: by the time a draft reaches here,
 * `status === "approved"` means it was structurally valid (a real report level,
 * ready, with a valid submittedAt and a valid ISO approvedAt). Malformed or
 * inconsistent approvals were downgraded before this point — so this reads a
 * verdict that is already provisional-but-consistent, never a forged one.
 */
export function approvedReportLevelNumbers(workspace: ReportWorkspaceStateV3): number[] {
  const numbers: number[] = [];
  for (const report of workspace.reports) {
    if (report.status !== "approved") continue;
    const levelNumber = parseLevelCode(report.levelCode);
    if (levelNumber === null) continue;
    // Defensive: only a curriculum report level may project a completion.
    if (!isReportLevelNumber(levelNumber)) continue;
    numbers.push(levelNumber);
  }
  return numbers.sort((a, b) => a - b);
}

/**
 * The session projection with every approved report folded in as a completion.
 *
 * Uses the canonical `withCompletedLevel` helper (never a bespoke rule), which
 * records the level as completed AND opens its successor in the session's
 * `unlocked` set — so the existing resolver reports the next level as available
 * without any hardcoded «after approved open N+1». Additive and idempotent:
 * seeding an approval the marker already passed changes nothing.
 */
export function sessionWithApprovedReports(
  session: LessonSessionProgress,
  workspace: ReportWorkspaceStateV3,
): LessonSessionProgress {
  return approvedReportLevelNumbers(workspace).reduce(
    (acc, levelNumber) => withCompletedLevel(acc, levelNumber),
    session,
  );
}
