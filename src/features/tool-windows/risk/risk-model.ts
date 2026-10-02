/**
 * Risk Calculator (L15) — the learner's Risk Plan for binary options.
 *
 * THE BACKEND IS THE AUTHORITY. The arithmetic and the rules below copy the
 * Backend's (`backend/src/lib/tools/risk.ts`) so the numbers follow the learner's
 * typing live; a saved plan comes back with the Backend's own figures, and a
 * value the Backend refuses comes back as a field error.
 *
 * BINARY OPTIONS HAVE NO STOP: the risk of a trade is its whole amount. The
 * capital is the learner's own number for the plan — never read from Pocket,
 * not a balance — and every figure is arithmetic on those inputs, never a sum
 * of what the learner traded (DD-303/DD-304).
 *
 * Money travels as decimal strings ("8.00") and is computed in integer cents.
 */
import { formatMinor, parseAmountToMinor } from "../trade-card/trade-card-model";
import { localDateTime } from "../model/local-date";
import { PAYOUT_MESSAGE, parsePayoutPercent } from "../model/numeric-input";

/* ------------------------------------------------------------------ types */

/** One saved version of the plan, exactly as the Backend sends it. */
export type RiskPlan = {
  readonly id: string;
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

export type RiskReference = {
  readonly riskShares: readonly number[];
  readonly streakLength: number;
};

/** The plan in force, its earlier versions (newest first) and what the form offers. */
export type RiskState = {
  readonly plan: RiskPlan | null;
  readonly history: readonly RiskPlan[];
  readonly reference: RiskReference;
};

/** What the form holds while the learner types: strings, as typed. */
export type RiskDraft = {
  capital: string;
  payoutPercent: string;
  riskPercent: string;
  dailyLimitPercent: string;
  scenario: string;
  cancelCondition: string;
};

export type RiskField = keyof RiskDraft;
export type RiskErrors = Partial<Record<RiskField, string>>;

/** What the Backend accepts. */
export type RiskPlanInput = {
  capital: string;
  payoutPercent: number;
  riskPercent: number;
  dailyLimitPercent: number;
  scenario: string;
  cancelCondition: string;
};

/** The plan's arithmetic, in cents and hundredths of a percent. */
export type RiskNumbers = {
  readonly tradeAmountMinor: number;
  readonly ifRightMinor: number;
  readonly ifWrongMinor: number;
  readonly dailyLimitMinor: number;
  readonly lossesToStop: number;
  readonly breakEvenBasisPoints: number;
  readonly streak: {
    readonly length: number;
    readonly fixedLossMinor: number;
    readonly fixedShareBasisPoints: number;
    readonly doublingStepsMinor: readonly number[];
    readonly doublingLossMinor: number;
    readonly doublingShareBasisPoints: number;
    readonly doublingTradesCovered: number;
  };
};

/* ----------------------------------------------------------------- limits */

export const RISK_LIMITS = {
  minCapitalMinor: 100,
  maxCapitalMinor: 100_000_000,
  minDailyLimitPercent: 1,
  maxDailyLimitPercent: 100,
  minTextLength: 3,
  maxTextLength: 1000,
  streakLength: 5,
} as const;

/* ------------------------------------------------------------- arithmetic */

function shareOf(partMinor: number, capitalMinor: number): number {
  return Math.round((partMinor * 10_000) / capitalMinor);
}

/** Same arithmetic as the Backend, to the cent. */
export function riskNumbers(inputs: {
  capitalMinor: number;
  payoutPercent: number;
  riskPercent: number;
  dailyLimitPercent: number;
}): RiskNumbers {
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

/**
 * "248.00" → 24800. The Backend's own figures, which may pass the input limits
 * (five doubled trades on a large capital), so this reads any "whole.cents".
 */
export function moneyMinor(amount: string): number {
  const match = /^(\d+)\.(\d{2})$/.exec(amount);
  return match ? Number(match[1]) * 100 + Number(match[2]) : 0;
}

/** A saved plan's own figures, back in cents, so the screen draws both the same way. */
export function numbersOfPlan(plan: RiskPlan): RiskNumbers {
  const cents = moneyMinor;
  const { numbers } = plan;
  return {
    tradeAmountMinor: cents(numbers.tradeAmount),
    ifRightMinor: cents(numbers.ifRight),
    ifWrongMinor: cents(numbers.ifWrong),
    dailyLimitMinor: cents(numbers.dailyLimit),
    lossesToStop: numbers.lossesToStop,
    breakEvenBasisPoints: numbers.breakEvenBasisPoints,
    streak: {
      length: numbers.streak.length,
      fixedLossMinor: cents(numbers.streak.fixedLoss),
      fixedShareBasisPoints: numbers.streak.fixedShareBasisPoints,
      doublingStepsMinor: numbers.streak.doublingSteps.map(cents),
      doublingLossMinor: cents(numbers.streak.doublingLoss),
      doublingShareBasisPoints: numbers.streak.doublingShareBasisPoints,
      doublingTradesCovered: numbers.streak.doublingTradesCovered,
    },
  };
}

/* ------------------------------------------------------------- formatting */

/** A narrow no-break space: «$24 000.00» never breaks between its groups. */
const GROUP = "\u202f";

/** «$8.00», «$24 000.00»: two decimals, thousands apart from 10 000 up. */
export function money(minor: number): string {
  const [whole, cents] = formatMinor(minor).split(".") as [string, string];
  return `$${group(whole)}.${cents}`;
}

const MINUS = "−";

/** «+$7.20» */
export function gainMoney(minor: number): string {
  return `+${money(minor)}`;
}

/** «−$8.00» */
export function lossMoney(minor: number): string {
  return `${MINUS}${money(minor)}`;
}

/** «$400», «$400.50»: the capital as a person says it. */
export function capitalWords(minor: number): string {
  const [whole, cents] = formatMinor(minor).split(".") as [string, string];
  return cents === "00" ? `$${group(whole)}` : `$${group(whole)}.${cents}`;
}

/** «8 + 16 + 32 + 64 + 128»: the doubled amounts, cents only where there are any. */
export function stepsWords(stepsMinor: readonly number[]): string {
  return stepsMinor
    .map((step) => {
      const [whole, cents] = formatMinor(step).split(".") as [string, string];
      return cents === "00" ? group(whole) : `${group(whole)}.${cents}`;
    })
    .join(" + ");
}

function group(whole: string): string {
  return whole.length > 4 ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP) : whole;
}

/** «52.6%», «10%», «155%»: hundredths of a percent, one decimal at most. */
export function percent(basisPoints: number): string {
  const tenths = Math.round(basisPoints / 10);
  return tenths % 10 === 0 ? `${tenths / 10}%` : `${(tenths / 10).toFixed(1)}%`;
}

/** «21 сентября, 18:40»: when a version was saved, on the learner's clock. */
export const versionTime = localDateTime;

/** «3 убыточные сделки», with the Russian plural. */
export function losingTradesWords(count: number): string {
  const rules = new Intl.PluralRules("ru");
  const form = rules.select(count);
  const noun = form === "one" ? "убыточная сделка" : form === "few" ? "убыточные сделки" : "убыточных сделок";
  return `${count} ${noun}`;
}

/* ---------------------------------------------------------------- drafts */

export function emptyRiskDraft(): RiskDraft {
  return { capital: "", payoutPercent: "", riskPercent: "", dailyLimitPercent: "", scenario: "", cancelCondition: "" };
}

/** The form holding the plan in force, ready to change. */
export function draftOfPlan(plan: RiskPlan): RiskDraft {
  const capitalMinor = parseAmountToMinor(plan.capital);
  return {
    capital: capitalMinor === null ? plan.capital : formatMinor(capitalMinor).replace(/\.00$/, ""),
    payoutPercent: String(plan.payoutPercent),
    riskPercent: String(plan.riskPercent),
    dailyLimitPercent: String(plan.dailyLimitPercent),
    scenario: plan.scenario,
    cancelCondition: plan.cancelCondition,
  };
}

function parseWholePercent(raw: string, min: number, max: number): number | null {
  const trimmed = raw.trim().replace("%", "").trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

function parseCapital(raw: string): number | null {
  const minor = parseAmountToMinor(raw);
  return minor !== null && minor >= RISK_LIMITS.minCapitalMinor && minor <= RISK_LIMITS.maxCapitalMinor ? minor : null;
}

/** The four numbers, when they are all valid; the results wait for them. */
export function draftInputs(
  draft: RiskDraft,
  shares: readonly number[],
): { capitalMinor: number; payoutPercent: number; riskPercent: number; dailyLimitPercent: number } | null {
  const capitalMinor = parseCapital(draft.capital);
  const payoutPercent = parsePayoutPercent(draft.payoutPercent);
  const riskPercent = Number(draft.riskPercent);
  const dailyLimitPercent = parseWholePercent(
    draft.dailyLimitPercent,
    RISK_LIMITS.minDailyLimitPercent,
    RISK_LIMITS.maxDailyLimitPercent,
  );
  if (capitalMinor === null || payoutPercent === null || dailyLimitPercent === null) return null;
  if (!shares.includes(riskPercent)) return null;
  return { capitalMinor, payoutPercent, riskPercent, dailyLimitPercent };
}

const MESSAGES: Record<RiskField, string> = {
  capital: "Капитал — сумма от $1 до $1 000 000, до двух знаков после точки.",
  payoutPercent: PAYOUT_MESSAGE,
  riskPercent: "Выберите долю риска на сделку.",
  dailyLimitPercent: "Дневной лимит — целое число процентов от 1 до 100.",
  scenario: `Запишите сценарий — от ${RISK_LIMITS.minTextLength} до ${RISK_LIMITS.maxTextLength} символов.`,
  cancelCondition: `Запишите условие отмены — от ${RISK_LIMITS.minTextLength} до ${RISK_LIMITS.maxTextLength} символов.`,
};

export function riskFieldMessage(field: RiskField): string {
  return MESSAGES[field];
}

/** Every field checked at once, the way the Backend will. */
export function validateRiskDraft(
  draft: RiskDraft,
  shares: readonly number[],
): { ok: true; plan: RiskPlanInput } | { ok: false; errors: RiskErrors } {
  const errors: RiskErrors = {};
  const capitalMinor = parseCapital(draft.capital);
  if (capitalMinor === null) errors.capital = MESSAGES.capital;
  const payoutPercent = parsePayoutPercent(draft.payoutPercent);
  if (payoutPercent === null) errors.payoutPercent = MESSAGES.payoutPercent;
  const riskPercent = Number(draft.riskPercent);
  if (!shares.includes(riskPercent)) errors.riskPercent = MESSAGES.riskPercent;
  const dailyLimitPercent = parseWholePercent(
    draft.dailyLimitPercent,
    RISK_LIMITS.minDailyLimitPercent,
    RISK_LIMITS.maxDailyLimitPercent,
  );
  if (dailyLimitPercent === null) errors.dailyLimitPercent = MESSAGES.dailyLimitPercent;
  const scenario = draft.scenario.trim();
  if (scenario.length < RISK_LIMITS.minTextLength || scenario.length > RISK_LIMITS.maxTextLength) {
    errors.scenario = MESSAGES.scenario;
  }
  const cancelCondition = draft.cancelCondition.trim();
  if (cancelCondition.length < RISK_LIMITS.minTextLength || cancelCondition.length > RISK_LIMITS.maxTextLength) {
    errors.cancelCondition = MESSAGES.cancelCondition;
  }
  if (Object.keys(errors).length > 0 || capitalMinor === null || payoutPercent === null || dailyLimitPercent === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    plan: {
      capital: formatMinor(capitalMinor),
      payoutPercent,
      riskPercent,
      dailyLimitPercent,
      scenario,
      cancelCondition,
    },
  };
}

/** Whether the form still says exactly what the plan in force says. */
export function draftMatchesPlan(draft: RiskDraft, plan: RiskPlan, shares: readonly number[]): boolean {
  const checked = validateRiskDraft(draft, shares);
  if (!checked.ok) return false;
  const input = checked.plan;
  return (
    input.capital === plan.capital &&
    input.payoutPercent === plan.payoutPercent &&
    input.riskPercent === plan.riskPercent &&
    input.dailyLimitPercent === plan.dailyLimitPercent &&
    input.scenario === plan.scenario &&
    input.cancelCondition === plan.cancelCondition
  );
}

/** The Backend names a refused field as `invalid_<field>`; map it back onto the form. */
export function riskFieldOfServerDetail(detail: string | null): RiskField | null {
  const map: Record<string, RiskField> = {
    invalid_capital: "capital",
    invalid_payoutPercent: "payoutPercent",
    invalid_riskPercent: "riskPercent",
    invalid_dailyLimitPercent: "dailyLimitPercent",
    invalid_scenario: "scenario",
    invalid_cancelCondition: "cancelCondition",
  };
  return detail ? (map[detail] ?? null) : null;
}
