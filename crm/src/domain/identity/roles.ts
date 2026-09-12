/**
 * CRM roles and permission primitives.
 * Source of truth: docs/ROLE_PERMISSION_MATRIX.md.
 *
 * NOTE: This is a frontend visibility model for Phase 1A mock mode. It is NOT
 * production security. Real authorization is enforced by the backend API.
 *
 * The `Permission` union below is the one exception to "visibility only": it is
 * also the vocabulary the production session parser accepts, so it is pinned to
 * the canonical cross-repository contract. See `Permission` and G4-R7.
 */
import type { CrmSessionPermission } from "@/domain/identity/crm-session-permission-contract";

export type CrmRole =
  | "crm_admin"
  | "crm_manager"
  | "retention_manager"
  | "mentor"
  | "support"
  | "moderator"
  | "analyst"
  | "content_manager"
  | "read_only"
  // PHASE-1 ADMIN — the dedicated administrative progression operator. Holds
  // exactly one permission, `curriculum_progress_override`.
  | "progression_operator";

export const CRM_ROLES: readonly CrmRole[] = [
  "crm_admin",
  "crm_manager",
  "retention_manager",
  "mentor",
  "support",
  "moderator",
  "analyst",
  "content_manager",
  "read_only",
  "progression_operator",
] as const;

export const CRM_ROLE_LABEL: Record<CrmRole, string> = {
  crm_admin: "Администратор CRM",
  crm_manager: "Менеджер CRM",
  retention_manager: "Retention-менеджер",
  mentor: "Mentor",
  support: "Support",
  moderator: "Moderator",
  analyst: "Аналитик",
  content_manager: "Контент-менеджер",
  read_only: "Только просмотр",
  progression_operator: "Оператор прогресса",
};

/** Navigable sections (docs/CRM_INFORMATION_ARCHITECTURE.md §1). */
export type SectionKey =
  | "today"
  | "users"
  | "segments"
  | "tasks"
  | "cases"
  | "mentor"
  | "support"
  | "financial"
  | "communications"
  | "automations"
  | "analytics"
  | "audit"
  /**
   * AFD-5A — the affiliate management workspace. Deliberately its own section
   * rather than a tab under `analytics`: it is CONFIGURATION (partners,
   * campaigns, tracking links), and AFD-5A ships no traffic analytics at all.
   */
  | "affiliates"
  /**
   * G4-GROWTH — the internal staff Growth observability workspace.
   *
   * Its own section rather than a tab under `affiliates`, because the two answer
   * different questions for different people: `affiliates` is CONFIGURATION
   * (who buys traffic, which link were they given), and `growth` is
   * MEASUREMENT (what did that traffic do). It is also NOT the external
   * affiliate partner portal, which does not exist and is out of scope.
   */
  | "growth"
  /**
   * COMMUNITY-V1 — the Community moderation workspace.
   *
   * Its own section rather than a tab under `cases`, because it is not case
   * work: a case is a private thread with one learner, and this is public
   * content everyone can already see. It sits under "Очереди" beside Mentor and
   * Support because, like them, it is a backlog somebody works through.
   */
  | "community_moderation"
  | "settings";

/**
 * Discrete permissions checked by the centralized permission layer.
 *
 * G4-R7: this union must contain EXACTLY the canonical session vocabulary in
 * `crm-session-permission-contract.ts`, no more and no less. It is not "kept
 * intentionally small" any more — that description is what let it fall four
 * entries behind the backend and break every session that carried one of them.
 * The `_permissionVocabularyParity` assertion below turns any divergence into a
 * compile error rather than a runtime logout.
 *
 * Recognising a permission is NOT granting it. Membership here only means the
 * session parser can read the name; which roles HOLD it is decided solely by
 * the backend's `STAFF_ROLE_PERMISSIONS`, and `ROLE_PERMISSIONS` in
 * `permissions.ts` (mock mode only) is unchanged by anything in this union.
 */
export type Permission =
  | "view_exact_financials"
  | "view_identity_full_email"
  | "reveal_pii"
  | "assign_owner"
  | "export"
  | "view_audit"
  | "manage_settings"
  /**
   * Edit dimension of ROLE_PERMISSION_MATRIX §1, narrowed to notes — the only
   * entity Phase 1B4-A can write. Tasks, cases, lifecycle override and owner
   * assignment get their own permissions when they get their own mutations;
   * `assign_owner` is a different dimension and is never reused for editing.
   */
  | "edit_user_notes"
  /**
   * CRM User Notes v1 (backend migration 31). Read and create are SEPARATE
   * permissions and neither is implied by the other. `edit_user_notes` above
   * stays reserved for future mutation of an EXISTING note (edit, delete,
   * pin/unpin, visibility) and grants neither of these.
   */
  | "view_user_notes"
  | "create_user_notes"
  /**
   * AFD-5A. A READ permission over the affiliate inventory — partners,
   * campaigns and tracking links — and, from AFD-5B, their traffic analytics.
   *
   * It grants no mutation. Creating, editing, activating, pausing and archiving
   * affiliate entities all still require `manage_settings`, and the backend is
   * what enforces that: hiding a button here is a convenience, not the gate.
   *
   * G4-R7 note: this comment used to identify the permission as backend
   * `CRM_PERMISSIONS[10]`. That positional reference was accidental coupling —
   * nothing in either repository resolves a permission by index — and it is now
   * named instead. Array ORDER remains a deliberate protocol property (entries
   * are appended, never inserted) and is pinned by the contract tests; array
   * POSITION is not an identity and never was.
   */
  | "view_affiliate_analytics"
  /**
   * PHASE-G0 curriculum authoring, and PHASE-G2 source adjudication. These four
   * are the entries whose absence caused G4-R7: the backend has emitted them
   * since 2026-08-08 and 2026-08-10 respectively, and this union never received
   * them, so every session carrying one failed to parse.
   *
   * The CRM has no authoring surface today and reads none of these four for any
   * affordance. They are here because the SESSION PARSER must be able to read
   * the complete vocabulary the backend can send — a permission the client
   * cannot name is a permission that logs its holder out.
   *
   * They are four rather than one because four-eyes review needs them separate:
   * `curriculum_read` is "may look", `curriculum_author` is "may write a draft
   * and submit it", `curriculum_approve` is "may accept work as editorial
   * truth", and `curriculum_source_authority` is "may decide which of two
   * competing SOURCES wins". Collapsing them would make every editor their own
   * reviewer.
   */
  | "curriculum_read"
  | "curriculum_author"
  | "curriculum_approve"
  | "curriculum_source_authority"
  /**
   * LEARNER-OPERATIONS-V1. The nine operational permissions.
   *
   * Unlike the four curriculum entries above, the CRM DOES read these for
   * affordances — the Learner Operations workspace is a real client of this
   * vocabulary. Every affordance they gate is still only an affordance: the
   * backend re-checks the identical permission on every route, and hiding a
   * button has never been a gate in this codebase.
   *
   * `learner_ops_report_review` and `learner_ops_mentor_review` are the two
   * that matter most. They are the CRM half of LO-AUTH-AXIS-1: report-review
   * and mentor-review authority used to live entirely on the backend's
   * `User.role` axis, where no CRM screen could show who held it and no CRM
   * administrator could take it away. They are required IN ADDITION to that
   * role check, never instead of it, so naming them here narrows authority and
   * can never widen it.
   */
  | "learner_ops_view"
  | "learner_ops_handle"
  | "learner_ops_report_review"
  | "learner_ops_mentor_review"
  | "learner_ops_escalate"
  | "learner_ops_manage_queues"
  | "learner_ops_qa"
  | "learner_ops_analytics"
  | "learner_ops_admin"
  // v4 — raising an escalation and answering one are different
  // responsibilities held by different people. See
  // LO-ESCALATION-RESOLVE-AUTHORITY-1.
  | "learner_ops_escalation_resolve"
  // v5 — Community moderation. Its own axis, deliberately not a `learner_ops_*`
  // permission: moderating a public discussion is not handling a support case.
  // See COMMUNITY-V1.
  | "community_moderate"
  // v6 — administrative forward progression correction. Its own axis: correcting
  // a learner's record is not handling a case, reviewing work, or changing rules.
  // See PHASE-1 ADMIN.
  | "curriculum_progress_override";

/**
 * Compile-time proof that this union and the canonical cross-repository session
 * vocabulary stay identical. If either drifts, this stops compiling — the same
 * idiom the backend already uses to pin `CrmStaffRole` to the Prisma enum.
 *
 * This is the mechanism G4-R7 lacked. The previous agreement between the two
 * repositories was a comment saying the list "must track the backend's
 * CRM_PERMISSIONS exactly, not approximately", and a comment cannot fail a
 * build.
 */
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _permissionVocabularyParity: AssertEqual<Permission, CrmSessionPermission> = true;
void _permissionVocabularyParity;
