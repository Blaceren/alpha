/**
 * LO-AUTH-AXIS-1 — the server-side authority probe for Journey B/C.
 *
 * WHAT IT IS FOR. The acceptance contract requires proof that canonical review
 * authority is the INTERSECTION of two axes, and that each negative control is
 * refused for a DIFFERENT reason. Hidden UI is not evidence: a queue tab the
 * CRM declines to render proves nothing about what the server would do with a
 * hand-written request. This probe asks the server's own predicates, on the
 * live database, for every principal at once — including the ones whose browser
 * sessions do not exist, which is exactly where UI evidence runs out.
 *
 * IT IS READ-ONLY, AND THAT IS STRUCTURAL. It opens Prisma, reads `User.role`,
 * `User.status` and `StaffProfile.staffRole`, and calls two pure predicates. It
 * has no write path, no `--apply`, and grants nothing to anybody. Running it
 * cannot change an authorization outcome it is reporting on.
 *
 * THE TWO AXES, EACH ASKED WITH THE REAL FUNCTION.
 *
 *   axis 1 — CANONICAL ACADEMY AUTHORITY. `requireTaskReportReviewer` and the
 *     mentor-review gate both reduce to `hasRole(user.role, ["admin","mentor"])`
 *     over an active session user. `hasRole` is imported here, not restated, so
 *     this probe cannot drift from the gate it is describing.
 *
 *   axis 2 — CRM LEARNER OPERATIONS AUTHORITY. `hasCrmReviewAuthority` is the
 *     single function both canonical owners call, imported and called directly
 *     against the stored StaffRole.
 *
 * WHY `preprod-qa-operator` IS IN THE TABLE. It holds `admin` on the canonical
 * axis and therefore PASSES axis 1, while holding `moderator` on the CRM axis
 * and therefore FAILS axis 2. It is the one principal that proves the
 * intersection actually narrows — that axis 1 alone is not sufficient. It is
 * read here and never written, and it keeps its role as the negative control.
 *
 *   DATABASE_URL=... npx tsx scripts/ops/learnerOpsReviewAuthorityProbe.ts
 */
import { PrismaClient, type UserRole } from "@prisma/client";
import { hasRole } from "@/lib/auth";
import { hasCrmReviewAuthority } from "@/lib/learner-ops/review-authority";
import {
  canEscalateLearnerOps,
  canResolveLearnerOpsEscalation,
  resolveEffectivePermissions,
} from "@/lib/crm/roles";
import { STAFF_FIXTURES } from "./learner-ops-fixture/identities";

/** Exactly the set `requireTaskReportReviewer` allows. Imported semantics, restated set. */
const CANONICAL_REVIEW_ROLES: UserRole[] = ["admin", "mentor"];

/**
 * The principals under test. The three phase fixtures plus the pre-existing QA
 * operator, which is READ ONLY and must keep failing axis 2.
 */
const PROBED_EMAILS: readonly string[] = [
  ...STAFF_FIXTURES.map((f) => f.email),
  "preprod-qa-operator@ata.invalid",
];

type Verdict = {
  email: string;
  exists: boolean;
  userRole: string | null;
  staffRole: string | null;
  active: boolean;
  /** Canonical Academy axis — would `requireTaskReportReviewer` admit them? */
  canonicalAxis: boolean;
  /** CRM axis, per review family. */
  crmReportAxis: boolean;
  crmMentorAxis: boolean;
  /** The intersection each canonical owner actually enforces. */
  mayDecideReportReview: boolean;
  mayDecideMentorReview: boolean;
  /**
   * The escalation split, contract v4. These are exactly the sets
   * `requireLearnerOpsStaff` compares against: it resolves the session's
   * permissions from the STORED staff role and refuses 403 when a required name
   * is absent. Reporting them here answers "what would the route do?" for
   * principals whose browser sessions do not exist, which is where UI evidence
   * runs out.
   */
  mayRaiseEscalation: boolean;
  mayResolveEscalation: boolean;
  /** Which axis refused, so a reader learns WHY and not merely THAT. */
  refusedBy: "none" | "canonical_axis" | "crm_axis" | "both_axes" | "absent";
};

function refusalOf(canonical: boolean, crm: boolean, exists: boolean): Verdict["refusedBy"] {
  if (!exists) return "absent";
  if (canonical && crm) return "none";
  if (!canonical && !crm) return "both_axes";
  return canonical ? "crm_axis" : "canonical_axis";
}

async function main(): Promise<number> {
  const prisma = new PrismaClient();
  const verdicts: Verdict[] = [];
  try {
    for (const email of PROBED_EMAILS) {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, role: true, status: true, staffProfile: { select: { staffRole: true } } },
      });
      if (!user) {
        verdicts.push({
          email, exists: false, userRole: null, staffRole: null, active: false,
          canonicalAxis: false, crmReportAxis: false, crmMentorAxis: false,
          mayDecideReportReview: false, mayDecideMentorReview: false,
          mayRaiseEscalation: false, mayResolveEscalation: false, refusedBy: "absent",
        });
        continue;
      }

      const active = user.status === "active";
      // Axis 1 exactly as the gate computes it: an inactive user never reaches
      // the role check at all, because `requireUser` refuses first.
      const canonicalAxis = active && hasRole(user.role, CANONICAL_REVIEW_ROLES);
      const crmReportAxis = await hasCrmReviewAuthority(user.id, "report");
      const crmMentorAxis = await hasCrmReviewAuthority(user.id, "mentor");

      // The escalation axes come from the stored StaffRole through the one
      // resolver, exactly as the HTTP gate does. A principal with no
      // StaffProfile resolves to the empty set and is refused both.
      const staffRole = user.staffProfile?.staffRole ?? null;
      const permissions = staffRole === null ? [] : resolveEffectivePermissions(staffRole);

      verdicts.push({
        email,
        exists: true,
        userRole: user.role,
        staffRole: user.staffProfile?.staffRole ?? null,
        active,
        canonicalAxis,
        crmReportAxis,
        crmMentorAxis,
        mayDecideReportReview: canonicalAxis && crmReportAxis,
        mayDecideMentorReview: canonicalAxis && crmMentorAxis,
        mayRaiseEscalation: canEscalateLearnerOps(permissions),
        mayResolveEscalation: canResolveLearnerOpsEscalation(permissions),
        refusedBy: refusalOf(canonicalAxis, crmReportAxis, true),
      });
    }
  } finally {
    await prisma.$disconnect();
  }

  for (const v of verdicts) {
    process.stderr.write(
      `  ${v.email.padEnd(38)} user=${String(v.userRole).padEnd(8)} staff=${String(v.staffRole).padEnd(10)} ` +
        `report=${v.mayDecideReportReview ? "ALLOW" : "REFUSE"} mentor=${v.mayDecideMentorReview ? "ALLOW" : "REFUSE"} ` +
        `raise=${v.mayRaiseEscalation ? "ALLOW" : "REFUSE"} resolve=${v.mayResolveEscalation ? "ALLOW" : "REFUSE"} (${v.refusedBy})\n`,
    );
  }
  process.stdout.write(JSON.stringify({ ok: true, verdicts }, null, 2) + "\n");
  return 0;
}

const invokedDirectly =
  typeof process.argv[1] === "string" && process.argv[1].includes("learnerOpsReviewAuthorityProbe");

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exit(1);
    });
}
