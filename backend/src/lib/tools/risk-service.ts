/**
 * TOOLS-V2 — Risk Plan persistence.
 *
 * APPEND-ONLY. A save adds a version; the newest version is the plan in force.
 * Nothing here updates or deletes a row, so the learner's history of plans is
 * the table itself.
 *
 * A REPEATED SAVE ADDS NOTHING. When the newest version already says exactly
 * what was sent — a double press, or a save with nothing changed — that
 * version is the answer. The read and the write run in one transaction, so two
 * identical saves racing each other cannot both append.
 */
import type { PrismaClient, ToolRiskPlan } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { RISK_LIMITS, isSamePlan, type RiskPlanInput } from "./risk";

type Db = Pick<PrismaClient, "toolRiskPlan" | "$transaction">;

export type RiskPlanState = {
  /** The plan in force, or null before the first save. */
  readonly current: { readonly row: ToolRiskPlan; readonly version: number } | null;
  /** Earlier versions, newest first, at most `RISK_LIMITS.historySize`. */
  readonly history: readonly { readonly row: ToolRiskPlan; readonly version: number }[];
};

const NEWEST_FIRST = [{ createdAt: "desc" as const }, { id: "desc" as const }];

type Reader = Pick<PrismaClient, "toolRiskPlan">;

async function stateOf(userId: number, db: Reader): Promise<RiskPlanState> {
  const [total, rows] = await Promise.all([
    db.toolRiskPlan.count({ where: { userId } }),
    db.toolRiskPlan.findMany({ where: { userId }, orderBy: NEWEST_FIRST, take: RISK_LIMITS.historySize + 1 }),
  ]);
  const versions = rows.map((row, index) => ({ row, version: total - index }));
  return { current: versions[0] ?? null, history: versions.slice(1) };
}

/** The learner's plan in force and its earlier versions. */
export function readRiskPlans(userId: number, db: Reader = defaultPrisma): Promise<RiskPlanState> {
  return stateOf(userId, db);
}

/** «Сохранить Risk Plan»: a new version, unless the newest already says exactly this. */
export async function saveRiskPlan(
  userId: number,
  plan: RiskPlanInput,
  db: Db = defaultPrisma,
): Promise<{ readonly created: boolean; readonly state: RiskPlanState }> {
  return db.$transaction(async (tx) => {
    const newest = await tx.toolRiskPlan.findFirst({ where: { userId }, orderBy: NEWEST_FIRST });
    const created = !(newest && isSamePlan(newest, plan));
    if (created) {
      await tx.toolRiskPlan.create({
        data: {
          userId,
          capitalMinor: plan.capitalMinor,
          payoutPercent: plan.payoutPercent,
          riskPercent: plan.riskPercent,
          dailyLimitPercent: plan.dailyLimitPercent,
          scenario: plan.scenario,
          cancelCondition: plan.cancelCondition,
        },
      });
    }
    return { created, state: await stateOf(userId, tx) };
  });
}
