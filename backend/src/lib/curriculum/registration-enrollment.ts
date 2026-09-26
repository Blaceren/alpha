/**
 * PHASE-F — REGISTRATION → AUTOMATIC CURRICULUM ENROLLMENT.
 *
 * ============================ THE ARCHITECTURE ============================
 * ONE Backend business operation. `POST /api/auth/register` already runs a
 * single transaction that creates the learner, seeds their legacy task
 * progress, records the referral relationship and freezes acquisition
 * attribution. Curriculum enrollment joins THAT transaction; it is not a second
 * call afterwards and it is emphatically not a second request from the Academy.
 *
 * WHY NOT AN ACADEMY-SIDE SECOND POST
 * Because there is no version of it that is safe. Register-then-enroll from the
 * browser has four ways to end with a learner who exists and is not enrolled —
 * the tab closes, the network drops, the second call 500s, the user navigates —
 * and the platform would have already returned 201 and set a session. The
 * failure would be invisible, per-learner, and only discoverable by noticing
 * that Home says «нет активной программы» for someone who registered yesterday.
 * A transaction has one outcome for both facts.
 *
 * ========================== THE ACTIVATION CONDITION ==========================
 * Auto-enrollment runs when ALL THREE of these are true:
 *
 *     CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED === "true"
 *     CURRICULUM_V2_ENROLLMENT_ENABLED               === "true"
 *     CURRICULUM_V2_READ_ENABLED                     === "true"
 *
 * Absent means OFF for every one of them, so a deployment that has thought about
 * none of this behaves exactly as it does today. The first is the new product
 * switch; the other two are the flags the shared enrollment primitive already
 * required, restated here so the ACTIVATION CONDITION is one readable predicate
 * rather than something a reader has to reconstruct from two files.
 *
 * `NODE_ENV` is not part of it. A product feature flag that reads the build mode
 * is a feature that behaves differently in staging than in production for
 * reasons nobody wrote down.
 *
 * ============================== FAIL CLOSED ==============================
 * When auto-enrollment is ON and enrollment cannot be produced — no published
 * curriculum, two published curricula, a corrupt graph, an enrollment write that
 * fails — this throws. The throw aborts the registration transaction, so:
 *
 *     no user, no session, no attribution, no conversion event, no referral row.
 *
 * The learner is told the platform is unavailable and can try again once the
 * configuration is fixed. The alternative — swallow the error and return 201 —
 * would manufacture exactly the half-registered account this design exists to
 * make impossible.
 *
 * When auto-enrollment is OFF this is a no-op that touches nothing, which is
 * what makes the code safe to ship long before the switch is thrown.
 *
 * ========================= EXISTING USERS ARE UNTOUCHED =========================
 * This hook applies to NEW successful registrations only. Nothing here scans,
 * backfills or bulk-enrolls anybody who already has an account; enrolling
 * existing PREPROD test accounts is an explicit operator step that belongs to
 * the activation rehearsal, not to a registration handler.
 */
import type { Prisma } from "@prisma/client";
import {
  isCurriculumV2EnrollmentEnabled,
  isCurriculumV2ReadEnabled,
  isCurriculumV2RegistrationAutoEnrollEnabled,
} from "@/lib/env";
import { enrollActiveCurriculumForNewUserInTransaction } from "./enrollment";

/**
 * THE activation condition, in one place.
 *
 * Read at call time — never captured at module load — so a long-lived process
 * and a test both see the current value.
 */
export function isRegistrationAutoEnrollmentActive(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isCurriculumV2RegistrationAutoEnrollEnabled(env) &&
    isCurriculumV2EnrollmentEnabled(env) &&
    isCurriculumV2ReadEnabled(env)
  );
}

export type RegistrationAutoEnrollmentResult =
  /** The switch is off. Nothing was read and nothing was written. */
  | { kind: "inactive" }
  /** An enrollment exists for this learner and this curriculum. */
  | { kind: "enrolled"; enrollmentId: number; curriculumVersionId: number; created: boolean };

/**
 * Enroll a just-registered learner, inside the registration transaction.
 *
 * `userId` must be a learner created earlier in `tx`. There is no actor
 * parameter and no curriculum parameter: the primitive resolves the single
 * active published `ata-v2` version itself and pins it, exactly as the operator
 * command does, so nothing a registrant submits can influence what they are
 * enrolled in.
 *
 * Throws `EnrollmentDomainError` on any refusal. The caller does not catch it.
 */
export async function autoEnrollNewRegistrationInTransaction(
  tx: Prisma.TransactionClient,
  input: { userId: number; asOf: Date },
): Promise<RegistrationAutoEnrollmentResult> {
  if (!isRegistrationAutoEnrollmentActive()) return { kind: "inactive" };

  const result = await enrollActiveCurriculumForNewUserInTransaction(tx, {
    userId: input.userId,
    asOf: input.asOf,
    provenance: "system_registration",
  });

  return {
    kind: "enrolled",
    enrollmentId: result.enrollment.id,
    curriculumVersionId: result.enrollment.curriculumVersionId,
    created: result.created,
  };
}
