/**
 * PHASE-F — the APPROVED ATA XP POLICY, owned by Backend.
 *
 * ============================ WHAT THIS IS ============================
 * The one place that says what a completed ATA level is worth. Phase C shipped
 * the canonical 100-level structure with the 79 non-gate rewards recorded as
 * `xpRewardStatus: "unresolved"`, because no accepted source defined a schedule
 * and inventing one would have been a product decision made by a converter.
 *
 * The decision now exists. It is:
 *
 *   lesson:assessment_pass              → 100 XP   × 58 = 5 800
 *   lesson:manual                       → 150 XP   × 13 = 1 950
 *   mentor_review:mentor_review         → 250 XP   ×  7 = 1 750
 *   report:report_approval              → 500 XP   ×  1 =   500
 *   financial_checkpoint:balance_check  →   0 XP   × 20 =     0
 *   external_event:pocket_postback      →   0 XP   ×  1 =     0
 *                                                   ───   ──────
 *                                                   100   10 000
 *
 * ===================== WHAT THE POLICY IS KEYED ON =====================
 * The CANONICAL COMPLETION PAIR — `${type}:${completionMethod}` — and nothing
 * else. Deliberately NOT the level number, the module number, the rank, the
 * unlock level, or any fixture value: every one of those is a different fact
 * that happens to correlate with the reward today, and a policy that read one of
 * them would silently change the schedule the first time the correlation broke.
 * The pair is what the completion engine already dispatches on, so a level is
 * worth what its KIND OF WORK is worth.
 *
 * ================== WHY THIS IS NOT IN THE GENERIC ENGINE ==================
 * `LevelDefinition.xpReward` stays a free non-negative integer and the generic
 * curriculum infrastructure keeps supporting any explicit value. A different
 * curriculum on this platform may pay whatever it likes. This file is the ATA
 * PRODUCT profile — it is consulted by the ATA-100 builder and by the ATA-100
 * package validator, and by nothing generic.
 *
 * ======================== WHAT IT IS NOT ALLOWED TO DO ========================
 * It is not an award mechanism. It never touches the ledger, a request, a
 * learner or a database. XP is awarded by exactly one runtime owner —
 * `completion.ts`, from the accepted `LevelDefinition.xpReward` of the imported
 * package — and this policy's only job is to decide what that stored number must
 * be for the ATA curriculum. Keeping the two apart is what makes "the browser
 * cannot influence a reward" structural: there is no path from here to a write.
 */
import {
  ATA_LEVELS,
  completionContractFor,
  type AtaLevelSource,
} from "@/lib/curriculum/product-ata-100";
import { completionPair } from "@/lib/curriculum/completion-pairs";

/**
 * THE APPROVED SCHEDULE. Keys are canonical completion pairs.
 *
 * Every pair the ATA curriculum can declare appears here exactly once. A pair
 * that is absent has no ATA reward and `ataXpRewardForPair` answers `null`
 * rather than guessing a default — an unpriced pair is a product question, not a
 * zero.
 */
export const ATA_XP_SCHEDULE: Readonly<Record<string, number>> = Object.freeze({
  "lesson:assessment_pass": 100,
  "lesson:manual": 150,
  "mentor_review:mentor_review": 250,
  "report:report_approval": 500,
  "financial_checkpoint:balance_check": 0,
  "external_event:pocket_postback": 0,
});

/** The approved product total, stated rather than derived. */
export const ATA_TOTAL_XP = 10_000 as const;

/**
 * The approved reward for a completion pair, or `null` when the ATA product has
 * not priced that pair.
 */
export function ataXpRewardForPair(
  type: string,
  completionMethod: string,
): number | null {
  const reward = ATA_XP_SCHEDULE[completionPair(type, completionMethod)];
  return reward === undefined ? null : reward;
}

/**
 * The approved reward for a canonical ATA level.
 *
 * Resolved through `completionContractFor`, so the level's KIND decides its pair
 * and the pair decides its reward. There is no branch here that reads
 * `levelNumber`, `moduleNumber` or `mentorReview` directly — the practical
 * split between `lesson:manual` and `mentor_review:mentor_review` is already
 * owned by `resolvePracticalLevelContract` (product decision R1) and is not
 * restated.
 *
 * Throws for a level whose pair the product has not priced: an ATA level with no
 * approved reward is a build-time contradiction, not a runtime zero.
 */
export function ataXpRewardForLevel(level: AtaLevelSource): number {
  const contract = completionContractFor(level);
  const reward = ataXpRewardForPair(contract.type, contract.completionMethod);
  if (reward === null) {
    throw new Error(
      `ATA XP policy has no reward for ${completionPair(contract.type, contract.completionMethod)} (level ${level.levelNumber})`,
    );
  }
  return reward;
}

/**
 * The `xpRewardStatus` an ATA level carries, from the policy's own knowledge.
 *
 * `approved` exactly when the schedule PRICES the level's pair. That is the
 * whole rule: an unpriced pair is a decision nobody has taken, and saying
 * `approved` for one would be the Phase-C placeholder problem in reverse — a
 * silence read as a decision. Every canonical level is priced today, so every
 * canonical level is `approved`; the branch exists so a future pair added to the
 * structure without a price is recorded honestly instead of inheriting one.
 */
export function ataXpRewardStatusForLevel(level: AtaLevelSource): "approved" | "unresolved" {
  const contract = completionContractFor(level);
  return ataXpRewardForPair(contract.type, contract.completionMethod) === null
    ? "unresolved"
    : "approved";
}

export type AtaXpScheduleBucket = {
  /** The canonical completion pair. */
  readonly pair: string;
  /** The approved reward for one level of this pair. */
  readonly xpReward: number;
  /** How many canonical levels declare it. */
  readonly levels: number;
  /** `xpReward × levels`. */
  readonly subtotal: number;
};

/**
 * The schedule projected onto the canonical 100 levels, in schedule order.
 *
 * DERIVED FROM `ATA_LEVELS`, never hand-counted: "58 assessment levels" is a
 * fact about the structural source, and writing it down a second time is how the
 * two start to disagree. The expected totals a test asserts come from here, and
 * the assertion that this sums to 10 000 is what pins the product decision.
 */
export function ataXpScheduleBuckets(): AtaXpScheduleBucket[] {
  const counts = new Map<string, number>(
    Object.keys(ATA_XP_SCHEDULE).map((pair) => [pair, 0]),
  );
  for (const level of ATA_LEVELS) {
    const contract = completionContractFor(level);
    const pair = completionPair(contract.type, contract.completionMethod);
    if (!counts.has(pair)) {
      throw new Error(`ATA XP policy has no reward for ${pair} (level ${level.levelNumber})`);
    }
    counts.set(pair, counts.get(pair)! + 1);
  }
  return Object.entries(ATA_XP_SCHEDULE).map(([pair, xpReward]) => {
    const levels = counts.get(pair)!;
    return { pair, xpReward, levels, subtotal: xpReward * levels };
  });
}

/** The sum of the approved schedule over the canonical 100 levels. */
export function ataXpScheduleTotal(): number {
  return ataXpScheduleBuckets().reduce((total, bucket) => total + bucket.subtotal, 0);
}

/**
 * The counts the product decision states, as a lookup a report can print.
 *
 * Same derivation as the buckets; exposed separately because a completeness
 * report wants «58 × 100» and a validator wants «this level must be 100».
 */
export function ataXpScheduleCounts(): Readonly<Record<string, number>> {
  return Object.freeze(
    Object.fromEntries(ataXpScheduleBuckets().map((bucket) => [bucket.pair, bucket.levels])),
  );
}
