/**
 * L2START-PLAYER-1 — the legal HTTP owner for starting a curriculum level.
 *
 * WHY THIS EXISTS
 * `startCurrentCurriculumLevel` has always been the domain owner of the
 * `available -> in_progress` transition, but nothing exposed it. A learner who
 * completed L1 therefore reached L2 `available` and could go no further:
 * lesson progress answered `NOT_STARTED` and the assessment answered
 * `ASSESSMENT_LEVEL_NOT_STARTED`, both correctly, because the level had never
 * been started and no route could start it. Every prior end-to-end phase hid
 * this by inserting `UserLevelProgress` rows directly.
 *
 * WHAT THIS ROUTE IS
 * A thin, authenticated wrapper. It performs NO domain logic of its own: the
 * shipped owner resolves the enrolment, checks prerequisites, refuses a level
 * that is not available, refuses a financial checkpoint, runs in one
 * transaction, is idempotent, and recovers from a concurrent duplicate start.
 * Re-implementing any of that here would be a second start implementation,
 * which is exactly the failure mode this phase exists to remove.
 *
 * WHY THE STABLE CODE IS A GUARD, NOT A SELECTOR
 * The owner starts the learner's CURRENT level by design — a learner may not
 * nominate which level to start, and no parameter exists through which they
 * could. The path segment states which level the caller believes is current,
 * and `expectedStableCode` makes the owner refuse, inside its own transaction
 * and before any write, if that is not the level it was about to start. So a
 * request naming a locked, completed, unknown or merely stale level changes
 * nothing at all.
 *
 * WHAT IT CANNOT DO
 * Complete a level, award XP, unlock a future level, act for another learner,
 * or accept a target status. `gatePhase4Self` supplies the actor id from the
 * session, so the learner acts only for themselves.
 */
import {
  gatePhase4Self,
  phase4Data,
  phase4Error,
  phase4Exception,
  strictQuery,
} from "@/lib/curriculum/phase4-http";
import { startCurrentCurriculumLevel } from "@/lib/curriculum/level-state";
import { STABLE_CODE_PATTERN } from "@/lib/curriculum/constants";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ stableCode: string }> },
) {
  const gate = await gatePhase4Self(request, "content", true);
  if (!gate.ok) return gate.response;

  try {
    strictQuery(request, []);
    const { stableCode } = await params;

    // Rejected before the owner is reached, so a malformed code never costs a
    // transaction. A well-formed code that names nothing is the owner's call,
    // because only it can see the learner's curriculum.
    if (!STABLE_CODE_PATTERN.test(stableCode)) {
      return phase4Error("INPUT_INVALID", 400, [
        { code: "INPUT_INVALID", reference: "stableCode" },
      ]);
    }

    const started = await startCurrentCurriculumLevel({
      actorUserId: gate.actorId,
      expectedStableCode: stableCode,
    });

    return phase4Data({
      ok: true,
      state: started.progress.status,
      stableCode: started.levelDefinition.stableCode,
      levelNumber: started.levelDefinition.levelNumber,
      // False on an idempotent repeat. The learner sees the same state either
      // way; this only tells a client whether anything actually changed.
      created: started.created,
    });
  } catch (error) {
    // Every level-start refusal is mapped centrally, so any future caller of
    // the start owner gets the same statuses instead of a 500.
    return phase4Exception(error, "level start POST");
  }
}
