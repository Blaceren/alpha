/**
 * LO-AUTH-AXIS-1 — the second axis on the two canonical review gates.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT
 *
 * Report-review and mentor-review authority has been granted since G3 by
 * `User.role IN (admin, mentor)` and by nothing else. Approving a report or a
 * mentor review COMPLETES A LEVEL — it is the most consequential authority a
 * staff member can hold — and the CRM, which is where staff are administered,
 * could neither display it, grant it, nor take it away.
 *
 * Measured on live PREPROD before this module existed:
 *
 *     StaffProfile role   User.role   n   consequence
 *     crm_admin           admin       3   consistent
 *     crm_admin           user        2   full CRM admin, CANNOT review
 *     mentor              mentor      3   consistent
 *     moderator           admin       1   ZERO CRM permissions, CAN COMPLETE LEVELS
 *     support             support     2   consistent
 *
 * The `moderator` row is the one that matters. That principal's CRM role grants
 * it nothing at all, and it nevertheless held level-completion authority — a
 * power nobody administering the CRM could see it had.
 *
 * ---------------------------------------------------------------------------
 * THE FIX, AND ITS SHAPE
 *
 * The gate now requires BOTH axes:
 *
 *     User.role IN (admin, mentor)              — unchanged, still checked first
 *   AND
 *     StaffProfile holds learner_ops_*_review   — new
 *
 * THE NEW CHECK IS ADDITIONAL, NEVER ALTERNATIVE. It is intersected with the
 * existing rule, so it can only ever NARROW authority. There is no code path in
 * which holding the CRM permission grants review to somebody `User.role` would
 * have refused. That is what makes this safe to apply to an accepted, closed
 * workflow: the worst case is that somebody who could review yesterday cannot
 * today, which is a grant-matrix decision an administrator can now actually see
 * and make.
 *
 * WHO IS AFFECTED IN PREPROD, stated rather than discovered later: the three
 * `mentor` and three `crm_admin` + `admin` principals keep review authority
 * because those StaffRoles hold the new permissions. The `moderator` + `admin`
 * principal loses it. That is not a regression — it is the entire point.
 *
 * WHY IT IS A SEPARATE MODULE. The two canonical owners
 * (`report-review.ts`, `mentor-review.ts`) keep their own gates and their own
 * error vocabulary. This adds one assertion each, in one place, so the rule
 * cannot be applied to one review family and forgotten on the other.
 */
import { resolveEffectivePermissions } from "@/lib/crm/roles";
import { canPerformMentorReview, canPerformReportReview } from "@/lib/crm/roles";
import { prisma } from "@/lib/prisma";

export type ReviewKind = "report" | "mentor";

/**
 * Does this USER — already established as an `admin` or `mentor` by the
 * existing gate — also hold the CRM permission for this review family?
 *
 * FAILS CLOSED in every ambiguous case: no StaffProfile, an unrecognised staff
 * role, or a role whose grant set does not include the permission all return
 * false. A reviewer with no CRM identity is exactly the situation this exists
 * to refuse, because it is a reviewer nobody can administer.
 */
export async function hasCrmReviewAuthority(
  userId: number,
  kind: ReviewKind,
): Promise<boolean> {
  const profile = await prisma.staffProfile.findUnique({
    where: { userId },
    select: { staffRole: true },
  });
  if (!profile) return false;

  // `resolveEffectivePermissions` is the ONE resolver, and it already fails
  // closed (empty set) for a role it does not recognise. The permission set is
  // always computed from the STORED role — never from the session payload, so
  // this cannot be influenced by anything a client sent.
  const permissions = resolveEffectivePermissions(profile.staffRole);
  return kind === "report"
    ? canPerformReportReview(permissions)
    : canPerformMentorReview(permissions);
}
