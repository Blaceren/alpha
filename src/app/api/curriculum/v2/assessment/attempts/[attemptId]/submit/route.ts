import { z } from "zod";
import { submitOwnAssessmentAttempt } from "@/lib/curriculum/assessment-runtime";
import { gatePhase4Self, idempotencyKey, jsonBody, phase4Data, phase4Exception, positivePathId, strictBody, strictQuery } from "@/lib/curriculum/phase4-http";

const bodySchema = z.strictObject({ answers: z.array(z.strictObject({ questionKey: z.string().trim().min(1).max(64), answer: z.unknown() })).min(1).max(200) });
export async function POST(request: Request, { params }: { params: Promise<{ attemptId: string }> }) {
  const gate = await gatePhase4Self(request, "assessment", true); if (!gate.ok) return gate.response;
  try {
    strictQuery(request, []); const requestId = idempotencyKey(request); const attemptId = positivePathId((await params).attemptId, "attemptId"); const body = strictBody(bodySchema, await jsonBody(request));
    const result = await submitOwnAssessmentAttempt(gate.actorId, { attemptId, requestId, answers: body.answers });
    return phase4Data({ created: result.created, status: result.attempt.status, attemptNumber: result.attempt.attemptNumber, submittedAt: result.attempt.submittedAt, durationSeconds: result.attempt.durationSeconds, totalQuestions: result.attempt.totalQuestions, correctCount: result.attempt.correctCount, scoreBasisPoints: result.attempt.scoreBasisPoints, passed: result.attempt.status === "passed", completion: result.completion });
  } catch (error) { return phase4Exception(error, "assessment submit POST"); }
}
