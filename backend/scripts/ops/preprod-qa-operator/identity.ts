/**
 * QAOPS-1 — the ONE synthetic PREPROD QA operator identity.
 *
 * WHY A CONSTANT AND NOT AN ARGUMENT
 * Every property below is frozen in source. There is no `--email`, no `--role`
 * and no `--staff-role` flag anywhere in this capability, so the tool cannot be
 * pointed at a second principal, at a real employee, or at a learner. "Exactly
 * one operator" is therefore a property of the code rather than of how carefully
 * someone typed a command.
 *
 * THE ADDRESS
 * `.invalid` is a reserved, permanently non-routable TLD (RFC 2606), so this
 * address can never belong to a real person and can never receive mail. It is
 * also the convention the existing PREPROD staff principals already use
 * (`@ata.invalid`, `@ata.test`, `@example.invalid`), so this introduces no new
 * one. `test.com` is deliberately NOT used: it is a real, registrable domain.
 *
 * IT IS LOWERCASE ON PURPOSE. `loginSchema` applies `.toLowerCase()` to the
 * submitted address and `POST /api/auth/login` then does an EXACT
 * `findUnique({ where: { email } })` — and `User.email` is unique
 * case-SENSITIVELY. A stored address with any uppercase character is therefore
 * an account nobody can log into. The regression asserts the constant is already
 * equal to its own lowercase form rather than lowercasing it here, because a
 * normalisation step would hide the mistake instead of catching it.
 */

/** The reserved address. Clearly synthetic, clearly PREPROD, clearly QA. */
export const QA_OPERATOR_EMAIL = "preprod-qa-operator@ata.invalid";

/** `User.name`. Read by staff surfaces; says what this principal is. */
export const QA_OPERATOR_NAME = "PREPROD QA Operator (synthetic)";

/**
 * `StaffProfile.displayName`. This is the name a reviewer sees against a
 * decision in the CRM, so it states the nature of the principal there too.
 */
export const QA_OPERATOR_STAFF_DISPLAY_NAME = "PREPROD QA Operator (synthetic)";

/**
 * `User.role`. SOURCE-DERIVED, and the floor rather than a preference:
 *
 *   • `attestStagingGate` re-reads the operator inside its transaction and
 *     fails `STAGING_ATTESTATION_FORBIDDEN` unless `role === "admin"` and
 *     `status === "active"` (src/lib/curriculum/staging-attestation.ts). It
 *     accepts no other role, so nothing narrower can execute the two operations
 *     this capability exists for.
 *   • the L3 report review chain gates on `requireTaskReportReviewer`, which
 *     accepts `admin | mentor` (src/lib/apiAuth.ts).
 *
 * `mentor` would satisfy the review half and NOT the attestation half, so one
 * principal covering both must be `admin`. See 03_QA_OPERATOR_MODEL.md for why
 * that does not widen the curriculum-authoring surface.
 */
export const QA_OPERATOR_USER_ROLE = "admin" as const;

/**
 * `StaffProfile.staffRole`. The minimum that exists.
 *
 * A StaffProfile is required for CRM access and for nothing else:
 * `resolveCrmSession` answers 403 `crm.session.not_staff` for any authenticated
 * user without one, and consults no other field (src/lib/crm/session.ts). The
 * role it carries decides only the CRM permission set, via
 * `resolveEffectivePermissions`.
 *
 * TWO ROLES RESOLVE TO THE EMPTY PERMISSION SET — `mentor` and `moderator`
 * (src/lib/crm/roles.ts). `moderator` is chosen because it is strictly narrower
 * on the one axis where they differ: `CRM_ELIGIBLE_OWNER_ROLES` contains
 * `mentor` and not `moderator`, so a `mentor` profile is additionally a
 * candidate to be assigned as a learner's CRM owner. This principal needs no
 * such candidacy.
 *
 * Choosing the empty-permission role costs nothing here: the CRM report-review
 * workspace mounts for ANY authenticated CRM employee and the reviewer boundary
 * is decided by the Backend from `User.role`, not from `staffRole` — see
 * 07_CRM_AUTH_COMPATIBILITY.md.
 */
export const QA_OPERATOR_STAFF_ROLE = "moderator" as const;

/**
 * Bcrypt cost. 10 is what the two accepted user-creating routes use
 * (`POST /api/auth/register` and `POST /api/admin/users`). It is stated here so
 * the provisioner cannot drift from the product's own hashing contract.
 *
 * `scripts/live/upsertLiveTestAccounts.cjs` uses 12; that script is deliberately
 * not a reference for anything in this capability.
 */
export const QA_OPERATOR_BCRYPT_COST = 10;

/** Audit action for the provisioning write. Names the environment and the kind. */
export const QA_OPERATOR_AUDIT_ACTION = "PREPROD_QA_OPERATOR_PROVISIONED";

/**
 * Audit action for attaching the staff profile to an already-correct principal.
 * Separate from the action above so the two halves of a resumed provisioning
 * run are distinguishable in the trail rather than collapsed into one claim.
 */
export const QA_OPERATOR_STAFF_AUDIT_ACTION = "PREPROD_QA_OPERATOR_STAFF_PROFILE_ATTACHED";
