/**
 * TOOLS-V2 — Risk Calculator (L15).
 *
 *   GET  /api/tools/risk-plan   the plan in force (or null), its earlier
 *                               versions, and the shares the form offers
 *   POST /api/tools/risk-plan   «Сохранить Risk Plan»: a new version, 201; the
 *                               same plan as the newest version adds nothing, 200
 *
 * Gate order: learner session (+ CSRF on POST) → rate limit → tool unlocked
 * (L15 durably completed) → input. A locked tool answers `TOOL_LOCKED` and reads
 * nothing. No query parameter is accepted, and nothing is ever deleted.
 */
import { assertToolUnlocked } from "@/lib/tools/access";
import {
  assertNoQueryParams,
  enforceToolRateLimit,
  parseJsonObject,
  requireToolLearner,
  toolData,
  toolErrorResponse,
} from "@/lib/tools/http";
import { RISK_CALCULATOR_TOOL_CODE, parseRiskPlan, riskReference, toRiskPlanDto } from "@/lib/tools/risk";
import { readRiskPlans, saveRiskPlan, type RiskPlanState } from "@/lib/tools/risk-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function stateDto(state: RiskPlanState) {
  return {
    plan: state.current ? toRiskPlanDto(state.current.row, state.current.version) : null,
    history: state.history.map((item) => toRiskPlanDto(item.row, item.version)),
  };
}

export async function GET(request: Request) {
  const gate = await requireToolLearner(request, { mutation: false });
  if ("response" in gate) return gate.response;
  try {
    assertNoQueryParams(request);
    enforceToolRateLimit(gate.userId, "read");
    await assertToolUnlocked(gate.userId, RISK_CALCULATOR_TOOL_CODE);
    const state = await readRiskPlans(gate.userId);
    return toolData({ ...stateDto(state), reference: riskReference() });
  } catch (error) {
    return toolErrorResponse(error, "GET /api/tools/risk-plan");
  }
}

export async function POST(request: Request) {
  const gate = await requireToolLearner(request, { mutation: true });
  if ("response" in gate) return gate.response;
  try {
    assertNoQueryParams(request);
    enforceToolRateLimit(gate.userId, "write");
    await assertToolUnlocked(gate.userId, RISK_CALCULATOR_TOOL_CODE);
    const body = await parseJsonObject(request);
    const plan = parseRiskPlan(body.plan);
    const { created, state } = await saveRiskPlan(gate.userId, plan);
    return toolData(stateDto(state), created ? 201 : 200);
  } catch (error) {
    return toolErrorResponse(error, "POST /api/tools/risk-plan");
  }
}
