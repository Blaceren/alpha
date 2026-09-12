/**
 * QAOPS-1 — provisioning the ONE synthetic PREPROD QA operator.
 *
 * WHAT IT DOES, EXHAUSTIVELY
 * Creates (or completes) exactly one `User` at the reserved synthetic address
 * plus exactly one `StaffProfile` attached to it, and writes an audit row for
 * each write. That is the entire set of tables this file can touch.
 *
 * THE THREE OUTCOMES, AND THE FOURTH THAT REFUSES
 *   CREATED ................. nothing was there; user + staff profile written
 *   STAFF_PROFILE_CREATED ... the user was already exactly right and had no
 *                             profile (a half-finished earlier run); only the
 *                             profile was written
 *   ALREADY_CONFIGURED ...... everything already matches; ZERO writes
 *   CONFLICT ................ something at that address disagrees; ZERO writes,
 *                             and a human decides
 *
 * IDEMPOTENCE IS BY EXACT MATCH, NEVER BY OVERWRITE. There is no `update` and no
 * `upsert` update branch anywhere in this file. An existing principal is either
 * bit-for-bit what this tool would have created — in which case there is nothing
 * to do — or it is a conflict. It is never edited into shape. That is what makes
 * "never overwrite an unrelated existing user's role, password or profile merely
 * because an email matches" a structural property rather than a promise: the
 * code that would do the overwriting does not exist.
 *
 * A CONSEQUENCE WORTH STATING: this tool cannot rotate the operator's password.
 * A forgotten password is not a thing it can fix, deliberately, because the
 * write that fixes it is the same write that could silently re-key an account.
 *
 * WHAT IT REFUSES TO BUILD. No enrollment, no XP, no progress, no
 * ExchangeAccount, no PocketTraderIdentity, no affiliate attribution, no
 * curriculum row of any kind. It also refuses to REUSE a principal that has any
 * of those, because a principal with a learner footprint is somebody else's
 * account that happens to share an address, whatever the address says.
 *
 * THIS IS NOT `scripts/live/upsertLiveTestAccounts.cjs`. That script writes six
 * hardcoded accounts on a real `.com` domain, shares one password across all of
 * them, has no environment guard, and its update branch overwrites role, status
 * and password hash on whatever it matches. Every one of those properties is
 * inverted here, and the regression asserts the inversion.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  QA_OPERATOR_AUDIT_ACTION,
  QA_OPERATOR_BCRYPT_COST,
  QA_OPERATOR_EMAIL,
  QA_OPERATOR_NAME,
  QA_OPERATOR_STAFF_AUDIT_ACTION,
  QA_OPERATOR_STAFF_DISPLAY_NAME,
  QA_OPERATOR_STAFF_ROLE,
  QA_OPERATOR_USER_ROLE,
} from "./identity";

export type ProvisionAction =
  | "created"
  | "staff_profile_created"
  | "already_configured"
  | "conflict";

export type ProvisionOutcome = {
  readonly action: ProvisionAction;
  /** Present whenever a principal exists at the reserved address. */
  readonly userId: number | null;
  readonly staffProfileId: string | null;
  /** Bounded, non-secret reasons. Populated only for `conflict`. */
  readonly conflicts: readonly string[];
  /** True when this call wrote nothing at all. */
  readonly readOnly: boolean;
};

/**
 * What "compatible" means, in one place.
 *
 * Every field this tool would have written is compared, plus the four
 * learner-footprint relations. `passwordHash` is compared only as "is it
 * non-empty" and is never loaded: `User.passwordHash` defaults to `""`, and
 * `bcrypt.compare(anything, "")` is false, so an empty hash is an account nobody
 * can log into — which for a principal whose whole purpose is CRM login is a
 * conflict, not a compatible reuse. The stored hash itself is never selected, so
 * it cannot be printed, logged or leaked by this process.
 */
type ExistingPrincipal = {
  id: number;
  role: string;
  status: string;
  name: string;
  emailVerifiedAt: Date | null;
  staffProfile: { id: string; staffRole: string; displayName: string } | null;
  curriculumEnrollments: { id: number }[];
  exchangeAccount: { id: number } | null;
  pocketTraderIdentity: { id: number } | null;
  affiliateAttribution: { id: number } | null;
};

const PRINCIPAL_SELECT = {
  id: true,
  role: true,
  status: true,
  name: true,
  emailVerifiedAt: true,
  staffProfile: { select: { id: true, staffRole: true, displayName: true } },
  curriculumEnrollments: { select: { id: true }, take: 1 },
  exchangeAccount: { select: { id: true } },
  pocketTraderIdentity: { select: { id: true } },
  affiliateAttribution: { select: { id: true } },
} as const;

/**
 * Compare an existing principal against the frozen identity.
 *
 * Returns the reasons it is NOT the QA operator. An empty list means the User
 * row is exactly right; the staff profile is judged separately by the caller,
 * because "user right, profile missing" is a completable state and "user right,
 * profile wrong" is not.
 */
export function describeUserConflicts(existing: ExistingPrincipal): string[] {
  const conflicts: string[] = [];
  if (existing.role !== QA_OPERATOR_USER_ROLE) {
    conflicts.push(`role is ${existing.role}, expected ${QA_OPERATOR_USER_ROLE}`);
  }
  if (existing.status !== "active") {
    conflicts.push(`status is ${existing.status}, expected active`);
  }
  if (existing.name !== QA_OPERATOR_NAME) {
    conflicts.push("name does not match the reserved synthetic identity");
  }
  if (existing.emailVerifiedAt === null) {
    conflicts.push("emailVerifiedAt is null, so the principal cannot log in");
  }
  // A principal carrying any learner state is not this tool's principal, whatever
  // its address says. Refusing here is what stops a reused address from silently
  // acquiring an admin role.
  if (existing.curriculumEnrollments.length > 0) {
    conflicts.push("principal has a curriculum enrollment");
  }
  if (existing.exchangeAccount !== null) conflicts.push("principal has an ExchangeAccount");
  if (existing.pocketTraderIdentity !== null) {
    conflicts.push("principal has a PocketTraderIdentity");
  }
  if (existing.affiliateAttribution !== null) {
    conflicts.push("principal has an AffiliateAttribution");
  }
  return conflicts;
}

/** The staff-profile half of the comparison. */
export function describeStaffProfileConflicts(
  profile: { staffRole: string; displayName: string } | null,
): string[] {
  if (profile === null) return [];
  const conflicts: string[] = [];
  if (profile.staffRole !== QA_OPERATOR_STAFF_ROLE) {
    conflicts.push(`staffRole is ${profile.staffRole}, expected ${QA_OPERATOR_STAFF_ROLE}`);
  }
  if (profile.displayName !== QA_OPERATOR_STAFF_DISPLAY_NAME) {
    conflicts.push("staff displayName does not match the reserved synthetic identity");
  }
  return conflicts;
}

async function hasUsablePassword(
  tx: Prisma.TransactionClient,
  userId: number,
): Promise<boolean> {
  // Asked as a COUNT so the hash is never selected into this process.
  const usable = await tx.user.count({ where: { id: userId, NOT: { passwordHash: "" } } });
  return usable === 1;
}

/**
 * Inspect the reserved address without writing anything.
 *
 * This is the whole of the DRY RUN, and it is also the first half of the apply
 * path — the apply path re-reads and re-decides inside its transaction, so a
 * dry run's answer is never carried forward as an authorization.
 */
export async function inspectQaOperator(db: PrismaClient): Promise<ProvisionOutcome> {
  const existing = (await db.user.findUnique({
    where: { email: QA_OPERATOR_EMAIL },
    select: PRINCIPAL_SELECT,
  })) as ExistingPrincipal | null;

  if (!existing) {
    return { action: "created", userId: null, staffProfileId: null, conflicts: [], readOnly: true };
  }

  const conflicts = [
    ...describeUserConflicts(existing),
    ...describeStaffProfileConflicts(existing.staffProfile),
  ];
  if (!(await hasUsablePassword(db, existing.id))) {
    conflicts.push("principal has no password set");
  }

  if (conflicts.length > 0) {
    return {
      action: "conflict",
      userId: existing.id,
      staffProfileId: existing.staffProfile?.id ?? null,
      conflicts,
      readOnly: true,
    };
  }

  return {
    action: existing.staffProfile === null ? "staff_profile_created" : "already_configured",
    userId: existing.id,
    staffProfileId: existing.staffProfile?.id ?? null,
    conflicts: [],
    readOnly: true,
  };
}

/**
 * Provision, for real.
 *
 * ONE TRANSACTION. Every precondition is re-checked inside it, immediately
 * before the write, so a principal that appeared between the dry run and now
 * cannot be trampled. The audit row is written in the SAME transaction as the
 * thing it describes, so a durable QA principal without an audit record is not a
 * state the database can hold — the same discipline `attestStagingGate` applies
 * to its own attestation row.
 *
 * THE AUDIT ACTOR IS THE SYNTHETIC PRINCIPAL ITSELF. Not null, not a system
 * pseudo-user, and above all not a real employee: the only honest answer to "who
 * did this" for a host-side act that brings a principal into existence is that
 * principal. The action names say what it is
 * (`PREPROD_QA_OPERATOR_PROVISIONED`), and the metadata records the environment,
 * so nobody reading the trail later has to infer the nature of the row.
 */
export async function provisionQaOperator(
  db: PrismaClient,
  password: string,
  now: Date = new Date(),
): Promise<ProvisionOutcome> {
  // Hashed OUTSIDE the transaction: bcrypt at cost 10 is deliberately slow, and
  // holding a write transaction open across it would be a self-inflicted lock.
  const passwordHash = await bcrypt.hash(password, QA_OPERATOR_BCRYPT_COST);

  return db.$transaction(async (tx) => {
    const existing = (await tx.user.findUnique({
      where: { email: QA_OPERATOR_EMAIL },
      select: PRINCIPAL_SELECT,
    })) as ExistingPrincipal | null;

    /* ---------------------------------------------------------- create path */
    if (!existing) {
      // The exact field set `POST /api/admin/users` writes for a staff account:
      // email, name, role, status active, a bcrypt hash at cost 10, and
      // `emailVerifiedAt` stamped so the principal is login-capable even if
      // `EMAIL_VERIFICATION_REQUIRED` is later switched on.
      const user = await tx.user.create({
        data: {
          email: QA_OPERATOR_EMAIL,
          name: QA_OPERATOR_NAME,
          role: QA_OPERATOR_USER_ROLE,
          status: "active",
          passwordHash,
          emailVerifiedAt: now,
        },
        select: { id: true },
      });

      const profile = await tx.staffProfile.create({
        data: {
          userId: user.id,
          displayName: QA_OPERATOR_STAFF_DISPLAY_NAME,
          staffRole: QA_OPERATOR_STAFF_ROLE,
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: QA_OPERATOR_AUDIT_ACTION,
          entityType: "User",
          entityId: String(user.id),
          // Bounded and non-secret: what was made, where, and with what
          // authority. No password, no hash, no token. The address is a
          // compile-time constant in this repository, not a personal one.
          metadata: {
            environment: "staging",
            synthetic: true,
            purpose: "preprod_qa_operator",
            email: QA_OPERATOR_EMAIL,
            role: QA_OPERATOR_USER_ROLE,
            staffRole: QA_OPERATOR_STAFF_ROLE,
            staffProfileId: profile.id,
          },
        },
      });

      return {
        action: "created" as const,
        userId: user.id,
        staffProfileId: profile.id,
        conflicts: [],
        readOnly: false,
      };
    }

    /* --------------------------------------------------------- reuse path */
    const conflicts = [
      ...describeUserConflicts(existing),
      ...describeStaffProfileConflicts(existing.staffProfile),
    ];
    if (!(await hasUsablePassword(tx, existing.id))) {
      conflicts.push("principal has no password set");
    }

    if (conflicts.length > 0) {
      // Refuse without writing. Note what does NOT happen here: no role is
      // corrected, no status is reactivated, no password is re-keyed.
      return {
        action: "conflict" as const,
        userId: existing.id,
        staffProfileId: existing.staffProfile?.id ?? null,
        conflicts,
        readOnly: true,
      };
    }

    if (existing.staffProfile !== null) {
      // Exact reuse. The supplied password is NOT compared and NOT written: the
      // account is already login-capable, and re-keying it is precisely the
      // overwrite this tool refuses to perform.
      return {
        action: "already_configured" as const,
        userId: existing.id,
        staffProfileId: existing.staffProfile.id,
        conflicts: [],
        readOnly: true,
      };
    }

    // The User row is exactly right and the profile is missing — a half-finished
    // earlier run. Only the missing row is created; the User is not touched.
    const profile = await tx.staffProfile.create({
      data: {
        userId: existing.id,
        displayName: QA_OPERATOR_STAFF_DISPLAY_NAME,
        staffRole: QA_OPERATOR_STAFF_ROLE,
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        userId: existing.id,
        action: QA_OPERATOR_STAFF_AUDIT_ACTION,
        entityType: "StaffProfile",
        entityId: profile.id,
        metadata: {
          environment: "staging",
          synthetic: true,
          purpose: "preprod_qa_operator",
          email: QA_OPERATOR_EMAIL,
          staffRole: QA_OPERATOR_STAFF_ROLE,
          staffProfileId: profile.id,
        },
      },
    });

    return {
      action: "staff_profile_created" as const,
      userId: existing.id,
      staffProfileId: profile.id,
      conflicts: [],
      readOnly: false,
    };
  });
}
