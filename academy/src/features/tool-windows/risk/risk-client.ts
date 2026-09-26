/**
 * The Risk Calculator client: its path and the shapes it guards. The transport
 * is the tools' shared one (`tools-client-core.ts`).
 */
import { PROXY_BASE, isRecord, toolGet, toolSend, type ToolResult } from "../tools-client-core";
import type { RiskPlan, RiskPlanInput, RiskState } from "./risk-model";

const RISK_PATH = `${PROXY_BASE}/tools/risk-plan`;

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const isMoney = (value: unknown): value is string => typeof value === "string" && /^\d+\.\d{2}$/.test(value);

export function isRiskPlan(value: unknown): value is RiskPlan {
  if (!isRecord(value) || !isRecord(value.numbers) || !isRecord(value.numbers.streak)) return false;
  const { numbers } = value;
  const streak = numbers.streak as Record<string, unknown>;
  return (
    typeof value.id === "string" &&
    isCount(value.version) &&
    isMoney(value.capital) &&
    isCount(value.payoutPercent) &&
    isCount(value.riskPercent) &&
    isCount(value.dailyLimitPercent) &&
    typeof value.scenario === "string" &&
    typeof value.cancelCondition === "string" &&
    typeof value.createdAt === "string" &&
    isMoney(numbers.tradeAmount) &&
    isMoney(numbers.ifRight) &&
    isMoney(numbers.ifWrong) &&
    isMoney(numbers.dailyLimit) &&
    isCount(numbers.lossesToStop) &&
    isCount(numbers.breakEvenBasisPoints) &&
    isCount(streak.length) &&
    isMoney(streak.fixedLoss) &&
    isCount(streak.fixedShareBasisPoints) &&
    Array.isArray(streak.doublingSteps) &&
    streak.doublingSteps.every(isMoney) &&
    isMoney(streak.doublingLoss) &&
    isCount(streak.doublingShareBasisPoints) &&
    isCount(streak.doublingTradesCovered)
  );
}

function isHistory(value: unknown): value is RiskPlan[] {
  return Array.isArray(value) && value.every(isRiskPlan);
}

export function isRiskState(value: unknown): value is RiskState {
  if (!isRecord(value) || !isRecord(value.reference)) return false;
  const { reference } = value;
  return (
    (value.plan === null || isRiskPlan(value.plan)) &&
    isHistory(value.history) &&
    Array.isArray(reference.riskShares) &&
    reference.riskShares.length > 0 &&
    reference.riskShares.every(isCount) &&
    isCount(reference.streakLength)
  );
}

/** What a save answers: the plan in force and its earlier versions, as a read does. */
function isSavedState(value: unknown): value is Omit<RiskState, "reference"> {
  return isRecord(value) && (value.plan === null || isRiskPlan(value.plan)) && isHistory(value.history);
}

export function fetchRiskState(): Promise<ToolResult<RiskState>> {
  return toolGet(RISK_PATH, isRiskState);
}

/** «Сохранить Risk Plan»: a new version, unless the plan in force already says this. */
export function saveRiskPlan(plan: RiskPlanInput): Promise<ToolResult<Omit<RiskState, "reference">>> {
  return toolSend("POST", RISK_PATH, { plan }, isSavedState);
}
