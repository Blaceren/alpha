/**
 * G4-GROWTH — the Growth V1 provider goal contract, in one place.
 *
 * WHAT THIS REPLACES. `goalToPocketType` in the Pocket route mapped FOURTEEN
 * caller-supplied strings onto business behaviour, including `commission`,
 * `withdrawal`, `successful_withdrawal` and `canceled_withdrawal`, and every one
 * of them reached a processor that mutates `ExchangeAccount` money state. The
 * caller chose which by sending a string. That is the structural defect the
 * PROD-readiness audit named, and it is corrected here rather than documented
 * again.
 *
 * THREE GOALS. `reg`, `dep`, `redep`. Nothing else is a Growth V1 event, and
 * nothing else may be selected by a caller. The database says the same thing
 * (`ProviderIngressEvent.goal` has a three-member CHECK), so an application
 * mistake cannot persist a fourth.
 *
 * WHY THE OLD ALIASES ARE GONE RATHER THAN DEPRECATED. They had no provider
 * mandate — Pocket's documented macro set uses the three literals above. They
 * were reachable only while the integration was enabled, and it is disabled on
 * every environment, so nothing that works today stops working. Keeping them
 * "just in case" would preserve exactly the property this phase exists to
 * remove.
 *
 * WITHDRAWAL AND COMMISSION ARE NOT DELETED FROM THE PLATFORM. They remain in
 * `postbackProcessor` for owners that have a legitimate need. What changed is
 * that neither Pocket receiver can reach them, which is §17's "separate them
 * from this trusted Growth V1 receiver".
 */

/** The three canonical Growth V1 goals. */
export const GROWTH_V1_GOALS = ["reg", "dep", "redep"] as const;

export type GrowthV1Goal = (typeof GROWTH_V1_GOALS)[number];

/**
 * Goals a caller may name, mapped to the canonical goal.
 *
 * DELIBERATELY NOT A SYNONYM TABLE. The only entries are the literals Pocket's
 * own macro documentation uses. `ftd`, `first_deposit`, `redeposit`,
 * `registration` and the rest were ATA inventions with no provider mandate — a
 * provider that starts sending one of them is a contract change to be reviewed,
 * not something to absorb silently.
 */
const CANONICAL_GOALS: ReadonlyMap<string, GrowthV1Goal> = new Map([
  ["reg", "reg"],
  ["dep", "dep"],
  ["redep", "redep"],
]);

export type GoalResolution =
  | { readonly kind: "supported"; readonly goal: GrowthV1Goal }
  /** A syntactically fine string that names no Growth V1 event. Fail closed. */
  | { readonly kind: "unsupported" }
  /** Absent, duplicated, or not a string at all. Fail closed. */
  | { readonly kind: "absent" };

/**
 * Resolve the goal from the query, refusing ambiguity.
 *
 * `getAll` rather than `get`: `?goal=reg&goal=dep` must be an explicit refusal,
 * never a silent "first one wins" that lets a caller present one goal to a log
 * and another to a dispatcher.
 *
 * NO TRIMMING AND NO CASE FOLDING. `" REG "` is not `reg`. A provider that sends
 * a differently-cased literal is a contract change, and quietly normalising it
 * would mean the allowlist matches strings the operator never agreed to.
 */
export function resolveGrowthV1Goal(params: URLSearchParams): GoalResolution {
  const goals = params.getAll("goal");

  if (goals.length !== 1) return { kind: "absent" };

  const canonical = CANONICAL_GOALS.get(goals[0]);
  if (canonical === undefined) return { kind: "unsupported" };

  return { kind: "supported", goal: canonical };
}

/**
 * Resolve a goal from a parsed JSON body field.
 *
 * The POST receiver reaches the same processor as the GET one, so it gets the
 * same allowlist. A second, laxer spelling of "which goals exist" is how the two
 * routes drifted apart in the first place.
 */
export function resolveGrowthV1GoalFromValue(value: unknown): GoalResolution {
  if (typeof value !== "string") return { kind: "absent" };

  const canonical = CANONICAL_GOALS.get(value);
  if (canonical === undefined) return { kind: "unsupported" };

  return { kind: "supported", goal: canonical };
}

/**
 * Goals that are explicitly refused and worth naming in an audit reason.
 *
 * Used ONLY to record a more precise rejection code for an operator. It never
 * widens what is accepted: anything not in `CANONICAL_GOALS` is refused whether
 * or not it appears here.
 */
export const REFUSED_FINANCIAL_GOALS: readonly string[] = [
  "commission",
  "withdrawal",
  "successful_withdrawal",
  "canceled_withdrawal",
  "withdraw",
];

export function isExplicitlyRefusedFinancialGoal(raw: string | null | undefined): boolean {
  return typeof raw === "string" && REFUSED_FINANCIAL_GOALS.includes(raw.toLowerCase());
}
