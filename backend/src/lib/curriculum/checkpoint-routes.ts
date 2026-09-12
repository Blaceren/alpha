/**
 * L4VC-1 — the single learner-owned checkpoint verification route.
 *
 * POST /api/curriculum/v2/levels/{stableCode}/checkpoint/verify
 *
 * One route, one verb, one body field. There is no GET (the checkpoint state is
 * already part of the curriculum read model), no staff override route, and no
 * route that accepts a balance, an account or an amount from anyone.
 */
import { NextResponse } from "next/server";
import {
  checkpointData,
  checkpointDisabled,
  checkpointError,
  checkpointException,
  checkpointJsonBody,
  checkpointStableCodePath,
  checkpointVerificationDto,
  gateCheckpointSelf,
  isCheckpointNotFoundMarker,
  verifyCheckpointBodySchema,
} from "./checkpoint-http";
import { verifyCurrentCheckpoint } from "./checkpoint-verification";

type RouteContext = { params: Promise<{ stableCode: string }> };

export function selfCheckpointVerifyRoute() {
  return async function POST(
    request: Request,
    context: RouteContext,
  ): Promise<NextResponse> {
    const gate = await gateCheckpointSelf(request);
    if (!gate.ok) return gate.response;

    try {
      const { stableCode } = await context.params;
      const level = checkpointStableCodePath(stableCode);

      const body = await checkpointJsonBody(request);
      const parsed = verifyCheckpointBodySchema.safeParse(body);
      if (!parsed.success) {
        // A learner who sent a balance, a currency, an account or a login lands
        // here: the schema is strict, so those are rejected rather than ignored.
        return checkpointError("CHECKPOINT_INPUT_INVALID", 400, [
          { code: "INPUT_INVALID", reference: "body" },
        ]);
      }

      const result = await verifyCurrentCheckpoint({
        actorUserId: gate.actorId,
        stableCode: level,
        requestId: parsed.data.requestId,
      });
      return checkpointData(checkpointVerificationDto(result));
    } catch (error) {
      if (isCheckpointNotFoundMarker(error)) return checkpointDisabled();
      return checkpointException(error);
    }
  };
}
