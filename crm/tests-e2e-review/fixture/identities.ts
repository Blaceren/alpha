/**
 * The identities and reports the MR-1R seeder creates, declared once.
 *
 * This is the fixture's contract with the tests. Everything here is synthetic:
 * `@fixture.invalid` is non-routable by RFC 2606, no address exists outside this
 * file, and no live credential is referenced. The password itself is never stored
 * here — it arrives from the isolated fixture environment at seed time.
 */

export const CURRICULUM_CODE = "ata-v2";
export const REPORT_LEVEL_STABLE_CODE = "v2.l003.pervye-pyat-demo-sdelok";

/** Staff and learner accounts every run recreates from scratch. */
export const FIXTURE = {
  mentor: "mr1r.mentor@fixture.invalid",
  admin: "mr1r.admin@fixture.invalid",
  support: "mr1r.support@fixture.invalid",
  userStaff: "mr1r.userstaff@fixture.invalid",
  inactiveMentor: "mr1r.inactive@fixture.invalid",
  learner: "mr1r.learner@fixture.invalid",
} as const;

export const MENTOR_POOL_SIZE = 40;
export const ADMIN_POOL_SIZE = 10;

export function pooledMentor(slot: number): string {
  return `mr1r.pm${String(slot).padStart(2, "0")}@fixture.invalid`;
}

export function pooledAdmin(slot: number): string {
  return `mr1r.pa${String(slot).padStart(2, "0")}@fixture.invalid`;
}

/**
 * Report owners, one per scenario that decides a report.
 *
 * Each decision journey owns a learner nobody else touches, so approving in one
 * scenario can never empty another's queue. `queueAlpha` and `queueBeta` exist
 * only to be LOOKED at: no journey ever claims, approves or rejects them, which
 * is what makes the queue-rendering assertions independent of run order.
 */
export interface ReportOwner {
  /** Manifest key the tests read. */
  key: "learnerA" | "learnerB" | "learnerC" | "queueAlpha" | "queueBeta";
  email: string;
  /** Display name the CRM queue renders; tests match rows on it. */
  name: string;
  /** True for owners no journey may ever decide. */
  readOnly: boolean;
}

export const REPORT_OWNERS: readonly ReportOwner[] = [
  { key: "learnerA", email: "mr1r.learner-a@fixture.invalid", name: "MR1R Learner A", readOnly: false },
  { key: "learnerB", email: "mr1r.learner-b@fixture.invalid", name: "MR1R Learner B", readOnly: false },
  { key: "learnerC", email: "mr1r.learner-c@fixture.invalid", name: "MR1R Learner C", readOnly: false },
  { key: "queueAlpha", email: "mr1r.queue-alpha@fixture.invalid", name: "MR1R Queue Alpha", readOnly: true },
  { key: "queueBeta", email: "mr1r.queue-beta@fixture.invalid", name: "MR1R Queue Beta", readOnly: true },
];

/** Rubric the seeder authors and publishes, mirroring the R1–R7 contract. */
export const RUBRIC_CRITERIA = [
  { code: "r1-process", title: "R1 — process", commentRequired: true },
  { code: "r2-risk", title: "R2 — risk", commentRequired: false },
  { code: "r3-discipline", title: "R3 — discipline", commentRequired: false },
  { code: "r4-evidence", title: "R4 — evidence", commentRequired: true },
  { code: "r5-reflection", title: "R5 — reflection", commentRequired: false },
  { code: "r6-accuracy", title: "R6 — accuracy", commentRequired: false },
  { code: "r7-completeness", title: "R7 — completeness", commentRequired: false },
] as const;

export const RUBRIC_SCALE = [
  { code: "meets", label: "Соответствует" },
  { code: "revise", label: "Требует доработки" },
] as const;

export const REJECTION_REASONS = [
  { code: "missing-evidence", title: "Недостаточно доказательств", guidance: "Добавьте скриншоты сделок." },
  { code: "incomplete-analysis", title: "Неполный анализ", guidance: "Раскройте причины отклонений." },
] as const;

/**
 * Fixed clock for every authored row.
 *
 * Wall-clock timestamps would make two seeds of the same inputs differ, and the
 * point of this fixture is that they do not.
 */
export const SEED_EPOCH_MS = 1780272000000;
