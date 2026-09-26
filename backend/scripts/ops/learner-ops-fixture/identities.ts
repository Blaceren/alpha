/**
 * LEARNER-OPERATIONS-V1 acceptance fixtures — the CLOSED identity allowlist.
 *
 * THERE IS NO `--email`. Every principal this tool can touch is written down
 * here, at review time, in source. The CLI names a KEY from this table and
 * nothing else, so a shell on this host cannot point the provisioner at a real
 * learner, a real employee, or an address the reviewer never saw. That is the
 * single most important property of this file.
 *
 * WHY THESE PRINCIPALS AND NOT FEWER. The acceptance journeys have to prove that
 * capability is SEPARATED — that a frontline operator cannot approve educational
 * work, that a reviewer does not administer the department, and that an
 * administrator is not a progression bypass. One principal holding everything
 * would make every one of those assertions unprovable, because there would be
 * nobody to refuse.
 *
 * WHY THESE PRINCIPALS AND NOT MORE. `crm_manager` and `retention_manager` are
 * deliberately absent: their Learner Operations grants are strict subsets of the
 * three below, so provisioning them would add live credentials without adding a
 * single provable assertion.
 *
 * WHAT THIS TOOL WILL NOT TOUCH, EVER — enforced by `isAllowlisted` below:
 *   • `preprod-qa-operator@ata.invalid`, which must stay the NEGATIVE RBAC
 *     CONTROL (StaffRole `moderator`, UserRole `admin`, zero `learner_ops_*`).
 *     Granting it anything would destroy the one principal that can prove denial.
 *   • every existing learner, including the commercial fixtures (users 66/67),
 *     whose accepted Affiliate and Pocket evidence must not be contaminated.
 */
import type { StaffRole, UserRole } from "@prisma/client";

/** The reserved-domain suffix every fixture identity must carry. */
const SYNTHETIC_SUFFIX = "@learner-ops.invalid";

export type StaffFixtureKey = "operator" | "reviewer" | "admin";
export type LearnerFixtureKey =
  | "support"
  | "report"
  | "mentor"
  | "escalation"
  | "complaint"
  | "external";

export type StaffFixture = {
  readonly key: StaffFixtureKey;
  readonly email: string;
  readonly name: string;
  readonly displayName: string;
  readonly staffRole: StaffRole;
  readonly userRole: UserRole;
  readonly why: string;
};

/**
 * THREE staff principals, each existing to make one refusal provable.
 *
 * `userRole` is the CANONICAL Academy reviewer axis and is granted ONLY to the
 * reviewer. The operator and the admin are deliberately `user` on that axis, so
 * LO-AUTH-AXIS-1's intersection is exercised from both sides: the reviewer holds
 * both axes and passes, and the admin holds every Learner Operations permission
 * except the two review ones AND lacks the platform role, so it is refused
 * twice over.
 */
export const STAFF_FIXTURES: readonly StaffFixture[] = [
  {
    key: "operator",
    email: `lo-operator${SYNTHETIC_SUFFIX}`,
    name: "LO Operator (synthetic)",
    displayName: "LO Оператор (synthetic)",
    // `support` grants view + handle + escalate. It grants NEITHER review
    // permission, which is what makes "a frontline operator cannot approve
    // educational work" a provable assertion rather than a claim.
    staffRole: "support",
    userRole: "user",
    why: "frontline: queue, claim, reply, note, escalate — never approve",
  },
  {
    key: "reviewer",
    email: `lo-reviewer${SYNTHETIC_SUFFIX}`,
    name: "LO Reviewer (synthetic)",
    displayName: "LO Наставник (synthetic)",
    // `mentor` grants view + handle + both review permissions, and `mentor` on
    // the platform axis satisfies `requireTaskReportReviewer`. Both halves of
    // the LO-AUTH-AXIS-1 intersection are present, so this principal is the
    // POSITIVE control for canonical review.
    staffRole: "mentor",
    userRole: "mentor",
    why: "canonical report + mentor review, both axes satisfied",
  },
  {
    key: "admin",
    email: `lo-admin${SYNTHETIC_SUFFIX}`,
    name: "LO Admin (synthetic)",
    displayName: "LO Администратор (synthetic)",
    // `crm_admin` holds all nine Learner Operations permissions INCLUDING the
    // two review ones — but `userRole: "user"` means the canonical Academy gate
    // still refuses it. That combination is the point: it proves the CRM
    // permission alone is NOT sufficient for review, which is the exact claim
    // "additional, never alternative" makes.
    staffRole: "crm_admin",
    userRole: "user",
    why: "configuration + QA + analytics; CRM review permission WITHOUT the platform axis",
  },
];

export type LearnerFixture = {
  readonly key: LearnerFixtureKey;
  readonly email: string;
  readonly name: string;
  readonly why: string;
};

/**
 * SIX learners, one per journey.
 *
 * Separate accounts rather than one account walked through contradictory
 * states: a learner cannot simultaneously have a report awaiting revision and
 * the same report approved, and mutating one fixture between journeys would
 * make every earlier journey's evidence unreproducible.
 */
export const LEARNER_FIXTURES: readonly LearnerFixture[] = [
  { key: "support", email: `lo-learner-support${SYNTHETIC_SUFFIX}`, name: "LO Support Learner (synthetic)", why: "journey A — ordinary support" },
  { key: "report", email: `lo-learner-report${SYNTHETIC_SUFFIX}`, name: "LO Report Learner (synthetic)", why: "journey B — L3 report review" },
  { key: "mentor", email: `lo-learner-mentor${SYNTHETIC_SUFFIX}`, name: "LO Mentor Learner (synthetic)", why: "journey C — mentor review" },
  { key: "escalation", email: `lo-learner-escalation${SYNTHETIC_SUFFIX}`, name: "LO Escalation Learner (synthetic)", why: "journey D — educational escalation" },
  { key: "complaint", email: `lo-learner-complaint${SYNTHETIC_SUFFIX}`, name: "LO Complaint Learner (synthetic)", why: "journey E — complaint / service recovery" },
  { key: "external", email: `lo-learner-external${SYNTHETIC_SUFFIX}`, name: "LO External Learner (synthetic)", why: "journey F — external / Pocket" },
];

/** Every address this tool may write, and there is no other source of one. */
export const ALLOWLISTED_EMAILS: readonly string[] = [
  ...STAFF_FIXTURES.map((f) => f.email),
  ...LEARNER_FIXTURES.map((f) => f.email),
];

/**
 * The single containment predicate.
 *
 * Membership is by EXACT string against the table above — not a domain-suffix
 * test, which would admit any address somebody appended the suffix to. The
 * suffix assertion is an additional belt: `.invalid` is reserved by RFC 2606 and
 * can never be a deliverable address, so a fixture can never receive real mail.
 */
export function isAllowlisted(email: string): boolean {
  return ALLOWLISTED_EMAILS.includes(email) && email.endsWith(SYNTHETIC_SUFFIX);
}

export function staffFixture(key: string): StaffFixture | null {
  return STAFF_FIXTURES.find((f) => f.key === key) ?? null;
}

export function learnerFixture(key: string): LearnerFixture | null {
  return LEARNER_FIXTURES.find((f) => f.key === key) ?? null;
}

/** The audit action every provisioning row carries. */
export const LEARNER_OPS_FIXTURE_AUDIT_ACTION = "LEARNER_OPS_ACCEPTANCE_FIXTURE_PROVISIONED";

/** bcrypt cost, matching what the platform's own registration uses. */
export const FIXTURE_BCRYPT_COST = 10;
