/**
 * TOOLS-V2 — Risk Calculator (L15): the learner's Risk Plan for binary options.
 *
 * WHAT IT IS. Lessons L11–L14 teach trading capital, the size of a trade and
 * losing streaks, the daily loss limit, and the personal Risk Plan. The tool
 * turns the learner's own four numbers into that plan's arithmetic:
 *
 *   the amount of one trade      capital × risk share
 *   its two outcomes             + amount × payout  /  − amount
 *   the daily loss limit         capital × limit share, and how many losing
 *                                trades reach it
 *   the break-even win rate      1 / (1 + payout)
 *   five losses in a row         at a fixed amount, and doubling after each
 *
 * and keeps it, with the scenario and the cancel condition written in advance,
 * as the Risk Plan.
 *
 * BINARY OPTIONS HAVE NO STOP. The risk of a trade is its whole amount, so the
 * previous calculator's entry price and stop are gone (owner decision
 * 2026-09-21: rebuilt for binary options, following the presentation).
 *
 * THE CAPITAL IS THE LEARNER'S OWN NUMBER, typed as the plan's input. It is
 * never read from Pocket and is not a balance ATA knows. Every figure here is
 * planning arithmetic on those inputs — nothing sums what the learner actually
 * traded, so DD-303/DD-304 hold.
 *
 * VERSIONS. «Сохранить Risk Plan» adds a version and the newest is the plan in
 * force. Nothing is edited in place or deleted: the learner keeps the history.
 */
import { z } from "zod";
import type { ToolRiskPlan } from "@prisma/client";
import { ToolError } from "./errors";
import { PAYOUT_PERCENT } from "./reference";
import { formatMinor, parseAmountToMinor } from "./trade-card";

export const RISK_CALCULATOR_TOOL_CODE = "tool.risk_calculator" as const;

/** The share of capital one trade risks, in percent: the four the lessons teach. */
export const RISK_SHARES = [1, 2, 3, 5] as const;
export type RiskShare = (typeof RISK_SHARES)[number];

export const RISK_LIMITS = {
  /** $1.00: one percent of it is still a cent. */
  minCapitalMinor: 100,
  /** $1 000 000.00, the typo guard the Trade Card uses for a stake. */
  maxCapitalMinor: 100_000_000,
  minDailyLimitPercent: 1,
  maxDailyLimitPercent: 100,
  minTextLength: 3,
  maxTextLength: 1000,
  /** The losing streak the lessons use: five in a row. */
  streakLength: 5,
  /** Earlier versions shown under the plan in force. */
  historySize: 10,
} as const;

/* ------------------------------------------------------------ arithmetic */

export type RiskInputs = {
  readonly capitalMinor: number;
  readonly payoutPercent: number;
  readonly riskPercent: number;
  readonly dailyLimitPercent: number;
};

export type RiskNumbers = {
  /** One trade: capital × risk share, rounded half-up to a cent. */
  readonly tradeAmountMinor: number;
  readonly ifRightMinor: number;
  readonly ifWrongMinor: number;
  readonly dailyLimitMinor: number;
  /** Losing trades until the daily limit is reached. Zero when one trade is already past it. */
  readonly lossesToStop: number;
  /** 1 / (1 + payout), in hundredths of a percent: 90% payout → 5263 (52.63%). */
  readonly breakEvenBasisPoints: number;
  readonly streak: {
    readonly length: number;
    /** The same amount every time. */
    readonly fixedLossMinor: number;
    readonly fixedShareBasisPoints: number;
    /** The amount doubled after every loss: 8, 16, 32, 64, 128. */
    readonly doublingStepsMinor: readonly number[];
    readonly doublingLossMinor: number;
    readonly doublingShareBasisPoints: number;
    /** How many of the doubled trades the capital pays for in full. */
    readonly doublingTradesCovered: number;
  };
};

/** A share of the capital in hundredths of a percent, rounded half-up. */
function shareOf(partMinor: number, capitalMinor: number): number {
  return Math.round((partMinor * 10_000) / capitalMinor);
}

export function riskNumbers(inputs: RiskInputs): RiskNumbers {
  const { capitalMinor, payoutPercent, riskPercent, dailyLimitPercent } = inputs;
  const tradeAmountMinor = Math.max(1, Math.round((capitalMinor * riskPercent) / 100));
  const dailyLimitMinor = Math.round((capitalMinor * dailyLimitPercent) / 100);
  const length = RISK_LIMITS.streakLength;
  const doublingStepsMinor = Array.from({ length }, (_, index) => tradeAmountMinor * 2 ** index);
  const doublingLossMinor = doublingStepsMinor.reduce((sum, step) => sum + step, 0);
  let covered = 0;
  let spent = 0;
  for (const step of doublingStepsMinor) {
    if (spent + step > capitalMinor) break;
    spent += step;
    covered += 1;
  }
  const fixedLossMinor = tradeAmountMinor * length;
  return {
    tradeAmountMinor,
    ifRightMinor: Math.round((tradeAmountMinor * payoutPercent) / 100),
    ifWrongMinor: tradeAmountMinor,
    dailyLimitMinor,
    lossesToStop: Math.floor(dailyLimitMinor / tradeAmountMinor),
    breakEvenBasisPoints: Math.round(1_000_000 / (100 + payoutPercent)),
    streak: {
      length,
      fixedLossMinor,
      fixedShareBasisPoints: shareOf(fixedLossMinor, capitalMinor),
      doublingStepsMinor,
      doublingLossMinor,
      doublingShareBasisPoints: shareOf(doublingLossMinor, capitalMinor),
      doublingTradesCovered: covered,
    },
  };
}

/* ------------------------------------------------------------- the plan */

const planSchema = z.strictObject({
  capital: z.string().max(20),
  payoutPercent: z.number().int().min(PAYOUT_PERCENT.min).max(PAYOUT_PERCENT.max),
  riskPercent: z.number().int(),
  dailyLimitPercent: z.number().int().min(RISK_LIMITS.minDailyLimitPercent).max(RISK_LIMITS.maxDailyLimitPercent),
  scenario: z.string().max(RISK_LIMITS.maxTextLength * 2),
  cancelCondition: z.string().max(RISK_LIMITS.maxTextLength * 2),
});

export type RiskPlanInput = RiskInputs & {
  readonly scenario: string;
  readonly cancelCondition: string;
};

function cleanText(raw: string, field: string): string {
  const text = raw.trim();
  if (text.length < RISK_LIMITS.minTextLength || text.length > RISK_LIMITS.maxTextLength) {
    throw new ToolError("TOOL_VALIDATION", `invalid_${field}`);
  }
  return text;
}

/** Validate a plan body. Every refusal is a `TOOL_VALIDATION` naming the field. */
export function parseRiskPlan(input: unknown): RiskPlanInput {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    throw new ToolError("TOOL_VALIDATION", typeof field === "string" ? `invalid_${field}` : "invalid_plan");
  }
  const plan = parsed.data;
  const capitalMinor = parseAmountToMinor(plan.capital);
  if (capitalMinor === null || capitalMinor < RISK_LIMITS.minCapitalMinor || capitalMinor > RISK_LIMITS.maxCapitalMinor) {
    throw new ToolError("TOOL_VALIDATION", "invalid_capital");
  }
  if (!(RISK_SHARES as readonly number[]).includes(plan.riskPercent)) {
    throw new ToolError("TOOL_VALIDATION", "invalid_riskPercent");
  }
  return {
    capitalMinor,
    payoutPercent: plan.payoutPercent,
    riskPercent: plan.riskPercent,
    dailyLimitPercent: plan.dailyLimitPercent,
    scenario: cleanText(plan.scenario, "scenario"),
    cancelCondition: cleanText(plan.cancelCondition, "cancelCondition"),
  };
}

/** Whether a saved version already says exactly this: a repeated save adds nothing. */
export function isSamePlan(row: ToolRiskPlan, plan: RiskPlanInput): boolean {
  return (
    row.capitalMinor === plan.capitalMinor &&
    row.payoutPercent === plan.payoutPercent &&
    row.riskPercent === plan.riskPercent &&
    row.dailyLimitPercent === plan.dailyLimitPercent &&
    row.scenario === plan.scenario &&
    row.cancelCondition === plan.cancelCondition
  );
}

/* ---------------------------------------------------------------- output */

export type RiskPlanDto = {
  readonly id: string;
  /** 1 for the first plan the learner saved. */
  readonly version: number;
  readonly capital: string;
  readonly payoutPercent: number;
  readonly riskPercent: number;
  readonly dailyLimitPercent: number;
  readonly scenario: string;
  readonly cancelCondition: string;
  readonly createdAt: string;
  readonly numbers: {
    readonly tradeAmount: string;
    readonly ifRight: string;
    readonly ifWrong: string;
    readonly dailyLimit: string;
    readonly lossesToStop: number;
    readonly breakEvenBasisPoints: number;
    readonly streak: {
      readonly length: number;
      readonly fixedLoss: string;
      readonly fixedShareBasisPoints: number;
      readonly doublingSteps: readonly string[];
      readonly doublingLoss: string;
      readonly doublingShareBasisPoints: number;
      readonly doublingTradesCovered: number;
    };
  };
};

export function toRiskPlanDto(row: ToolRiskPlan, version: number): RiskPlanDto {
  const numbers = riskNumbers(row);
  return {
    id: row.id,
    version,
    capital: formatMinor(row.capitalMinor),
    payoutPercent: row.payoutPercent,
    riskPercent: row.riskPercent,
    dailyLimitPercent: row.dailyLimitPercent,
    scenario: row.scenario,
    cancelCondition: row.cancelCondition,
    createdAt: row.createdAt.toISOString(),
    numbers: {
      tradeAmount: formatMinor(numbers.tradeAmountMinor),
      ifRight: formatMinor(numbers.ifRightMinor),
      ifWrong: formatMinor(numbers.ifWrongMinor),
      dailyLimit: formatMinor(numbers.dailyLimitMinor),
      lossesToStop: numbers.lossesToStop,
      breakEvenBasisPoints: numbers.breakEvenBasisPoints,
      streak: {
        length: numbers.streak.length,
        fixedLoss: formatMinor(numbers.streak.fixedLossMinor),
        fixedShareBasisPoints: numbers.streak.fixedShareBasisPoints,
        doublingSteps: numbers.streak.doublingStepsMinor.map(formatMinor),
        doublingLoss: formatMinor(numbers.streak.doublingLossMinor),
        doublingShareBasisPoints: numbers.streak.doublingShareBasisPoints,
        doublingTradesCovered: numbers.streak.doublingTradesCovered,
      },
    },
  };
}

/** What the form picks from. */
export function riskReference() {
  return {
    riskShares: [...RISK_SHARES],
    streakLength: RISK_LIMITS.streakLength,
  };
}
