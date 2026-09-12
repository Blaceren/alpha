/**
 * The unified operational inbox, and the staff-side case create.
 *
 * ONE ENTRY POINT. Support, report review, mentor review, escalations,
 * complaints and follow-ups are TYPES in this one list, not separate screens —
 * which is the difference between "what needs attention" being answerable and
 * an operator having to remember which page to check.
 */
import {
  assertOnlyQueryParams,
  learnerOpsData,
  learnerOpsErrorResponse,
  parseJsonBody,
  requireLearnerOpsStaff,
} from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { listQueue } from "@/lib/learner-ops/queue";
import { createCase } from "@/lib/learner-ops/case";
import { queueQuerySchema, staffCreateCaseSchema } from "@/lib/learner-ops/schemas";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const QUERY_KEYS = [
  "limit",
  "cursor",
  "queueKey",
  "status",
  "type",
  "priority",
  "assignment",
  "breached",
] as const;

export async function GET(request: Request) {
  try {
    const gate = await requireLearnerOpsStaff(["learner_ops_view"]);
    assertOnlyQueryParams(request, QUERY_KEYS);

    const params = new URL(request.url).searchParams;
    const raw = Object.fromEntries(
      QUERY_KEYS.filter((key) => params.get(key) !== null).map((key) => [key, params.get(key)]),
    );
    const parsed = queueQuerySchema.safeParse(raw);
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid query");

    // `viewerStaffId` comes from the GATE, never from the request — there is no
    // parameter through which a caller could ask for somebody else's "my work".
    const result = await listQueue({ ...parsed.data, viewerStaffId: gate.actor.staffId });
    return learnerOpsData(result);
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops cases GET");
  }
}

export async function POST(request: Request) {
  try {
    const gate = await requireLearnerOpsStaff(["learner_ops_view", "learner_ops_handle"]);
    const parsed = staffCreateCaseSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid body");

    const created = await createCase({ ...parsed.data, actor: gate.actor });
    return learnerOpsData({ id: created.id, reference: created.reference }, 201);
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops cases POST");
  }
}
