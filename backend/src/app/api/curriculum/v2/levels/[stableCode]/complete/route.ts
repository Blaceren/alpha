/**
 * A1 — the legal HTTP owner for completing a `lesson:lesson` or `lesson:manual`
 * level.
 *
 * WHY THIS ROUTE EXISTS
 * `completion.ts` has always mapped both pairs to the `level_completion` owner
 * and nothing could reach it, so a learner who finished a manual lesson or one
 * of the 13 canonical `lesson:manual` practical levels (product decision R1)
 * had no action available at all. The level stayed `in_progress` forever and
 * every later level stayed locked behind it.
 *
 * WHAT THIS ROUTE IS
 * A thin authenticated wrapper. It performs NO domain logic: the shipped
 * command resolves the learner's enrollment, refuses a level with a different
 * owner, refuses a level that is not current or not started, runs in one
 * transaction, delegates progression to the canonical completion engine and is
 * idempotent on the request identity.
 *
 * WHAT IT CANNOT DO
 * Act for another learner (`gatePhase4Self` supplies the actor id from the
 * session), name an enrollment, name a level id, choose an XP amount, choose a
 * status, backdate a completion, or complete an assessment, report, mentor
 * review, financial checkpoint or the Pocket registration level — those pairs
 * belong to owners that require proof this route cannot produce.
 *
 * THE BODY CARRIES ONE FIELD. A `requestId`, and nothing else. The schema is
 * strict, so `userId`, `enrollmentId`, `xpReward`, `completedAt` or `status`
 * are 400s rather than ignored extra keys.
 */
import { z } from "zod";
import { STABLE_CODE_PATTERN } from "@/lib/curriculum/constants";
import {
  completeManualLevel,
  MANUAL_COMPLETION_REQUEST_ID_PATTERN,
} from "@/lib/curriculum/manual-completion";
import {
  gatePhase4Self,
  jsonBody,
  phase4Data,
  phase4Error,
  phase4Exception,
  strictBody,
  strictQuery,
} from "@/lib/curriculum/phase4-http";

const completeBodySchema = z.strictObject({
  requestId: z.string().regex(MANUAL_COMPLETION_REQUEST_ID_PATTERN),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ stableCode: string }> },
) {
  const gate = await gatePhase4Self(request, "content", true);
  if (!gate.ok) return gate.response;

  try {
    strictQuery(request, []);
    const { stableCode } = await params;

    // Rejected before the command is reached, so a malformed code never costs a
    // transaction. A well-formed code that names nothing is the command's call,
    // because only it can see the learner's pinned curriculum.
    if (!STABLE_CODE_PATTERN.test(stableCode)) {
      return phase4Error("INPUT_INVALID", 400, [
        { code: "INPUT_INVALID", reference: "stableCode" },
      ]);
    }

    const body = strictBody(completeBodySchema, await jsonBody(request));

    const receipt = await completeManualLevel({
      actorUserId: gate.actorId,
      stableCode,
      requestId: body.requestId,
    });

    return phase4Data({ ok: true, ...receipt });
  } catch (error) {
    return phase4Exception(error, "manual level completion POST");
  }
}
