/**
 * Runtime validation for the synthetic dataset (Phase 1B1 §5).
 * Invalid fixtures must FAIL loudly (tests call assertValidDataset), never
 * render silently. Uses Zod for shape + imperative checks for cross-field rules.
 */
import { z } from "zod";
import type { MockUser } from "@/domain/users/mock-user";

const ISO = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "invalid ISO date");
const ISO_NULL = ISO.nullable();

const financialSchema = z.object({
  netDepositsUsd: z.number(),
  balanceUsd: z.number().nullable(),
  balanceTimestamp: ISO_NULL,
});

const userShape = z.object({
  identity: z.object({
    userId: z.string().regex(/^usr_mock_\d{3}$/),
    displayName: z.string().min(1),
    maskedEmail: z.string().includes("*"),
    fullEmail: z.string().email(),
    registeredAt: ISO,
  }),
  progression: z.object({
    currentLevel: z.number().int().positive(),
    highestCompletedLevel: z.number().int().nonnegative(),
    xp: z.number().nonnegative(),
  }),
  financial: financialSchema,
});

/** Personas that MUST be present (by primaryScenario), per MOCK_DATA_PLAN. */
export const REQUIRED_SCENARIOS = [
  "new_registered_no_start",
  "pocket_registration_incomplete",
  "email_not_confirmed",
  "pre_ftd",
  "first_depositor",
  "active_learner",
  "lesson_abandoned",
  "progression_stalled",
  "repeated_test_failure",
  "report_pending",
  "report_rejected_no_return",
  "mentor_sla_warning",
  "mentor_sla_breached",
  "checkpoint_approaching",
  "checkpoint_grace",
  "financial_access_suspended",
  "financial_access_restored",
  "repeat_funder",
  "frequent_repeat_funder",
  "high_value_candidate",
  "inactive_3d",
  "inactive_7d",
  "dormant_14d",
  "dormant_30d",
  "returned_after_absence",
  "support_blocked",
  "communication_fatigue",
  "completed_current_curriculum",
] as const;

const FORBIDDEN_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "proton.me",
];

export interface ValidationIssue {
  userId: string | null;
  message: string;
}

/** Returns all validation issues; empty array = valid dataset. */
export function validateDataset(users: MockUser[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (userId: string | null, message: string) => issues.push({ userId, message });

  if (users.length !== 30) add(null, `expected 30 users, found ${users.length}`);

  const ids = new Set<string>();
  const emails = new Set<string>();

  for (const u of users) {
    const id = u.identity.userId;

    const parsed = userShape.safeParse(u);
    if (!parsed.success) {
      for (const e of parsed.error.issues) add(id, `${e.path.join(".")}: ${e.message}`);
    }

    if (ids.has(id)) add(id, "duplicate user id");
    ids.add(id);
    if (emails.has(u.identity.fullEmail)) add(id, "duplicate email");
    emails.add(u.identity.fullEmail);

    // email domain safety
    const domain = u.identity.fullEmail.split("@")[1] ?? "";
    if (FORBIDDEN_EMAIL_DOMAINS.includes(domain)) add(id, `real email domain ${domain}`);
    if (!/\.(test|example)$/.test(domain) && domain !== "example.test") {
      add(id, `email domain must be synthetic (*.test), got ${domain}`);
    }

    // no secrets / production identifiers
    if (u.financial.traderId && !u.financial.traderId.startsWith("pp_mock_")) {
      add(id, "trader id not synthetic");
    }

    // level bounds (1..100 or explicit post-100 checkpoint state)
    const lvl = u.progression.currentLevel;
    if (lvl > 100 && u.progression.checkpointStatus !== "future_checkpoint_not_defined") {
      add(id, `level ${lvl} > 100 but checkpoint not future_checkpoint_not_defined`);
    }
    if (u.progression.highestCompletedLevel > lvl) {
      add(id, "highestCompletedLevel > currentLevel");
    }

    // financial formula: Net = FTD + redeposits − successful withdrawals
    const ftd = u.financial.ftd?.amountUsd ?? 0;
    const re = u.financial.redeposits.reduce((s, d) => s + d.amountUsd, 0);
    const sw = u.financial.successfulWithdrawals.reduce((s, w) => s + w.amountUsd, 0);
    const expectedNet = ftd + re - sw;
    if (u.financial.netDepositsUsd !== expectedNet) {
      add(id, `net deposits ${u.financial.netDepositsUsd} != formula ${expectedNet}`);
    }

    // balance freshness consistency: balance present ⇒ timestamp present, unless balance_unknown
    if (u.financial.balanceUsd != null && u.financial.balanceTimestamp == null) {
      if (u.state.fundingStatus !== "balance_unknown") {
        add(id, "balance present without timestamp and not balance_unknown");
      }
    }

    // checkpoint consistency
    if (u.state.fundingStatus === "checkpoint_grace" && !u.financial.grace?.active) {
      add(id, "funding checkpoint_grace but no active grace state");
    }
    if (u.state.fundingStatus === "financial_access_suspended" && !u.financial.accessSuspended) {
      add(id, "funding suspended but accessSuspended false");
    }

    // at most one primary owner (string or null — structurally enforced, checked non-empty)
    if (u.operations.primaryOwnerId !== null && u.operations.primaryOwnerId.trim() === "") {
      add(id, "empty primary owner id");
    }
  }

  // required persona coverage
  const scenarios = new Set(users.map((u) => u.primaryScenario));
  for (const s of REQUIRED_SCENARIOS) {
    if (!scenarios.has(s)) add(null, `missing required persona scenario: ${s}`);
  }

  return issues;
}

/** Throws if the dataset is invalid — used by fixtures load + tests. */
export function assertValidDataset(users: MockUser[]): void {
  const issues = validateDataset(users);
  if (issues.length > 0) {
    const summary = issues.map((i) => `- ${i.userId ?? "dataset"}: ${i.message}`).join("\n");
    throw new Error(`Invalid synthetic dataset (${issues.length} issue(s)):\n${summary}`);
  }
}
