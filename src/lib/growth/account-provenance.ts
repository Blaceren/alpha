/**
 * POCKET-REG-FINAL-INTERNAL-CORRECTION-1 (§3/§4) — where a PREPROD account came
 * from, decided by explicit authority rather than by the shape of its address.
 *
 * WHAT WENT WRONG BEFORE. The predecessor module asked one question — does this
 * address end in `@ata-preprod.invalid`? — and everything that answered "no" was
 * reported as real. On PREPROD that produced a decomposition claiming 187 of 198
 * Growth events were real business activity when only 4 belonged to accounts on
 * a routable address at all. The mechanism was sound; the predicate was one
 * suffix wide where the environment held eight conventions.
 *
 * THE CORRECTION IS NOT A WIDER SUFFIX LIST. Widening the check to every
 * RFC 2606 / RFC 6761 reserved TLD would make the same category error in the
 * other direction: it would declare 46 of 49 accounts synthetic on the strength
 * of a naming convention, including seven accounts whose conventions
 * (`@learner.test`, `@dev.invalid`) have no owner anywhere in this repository.
 *
 * NON-ROUTABLE IS A PROPERTY OF AN ADDRESS. SYNTHETIC IS A CLAIM ABOUT ORIGIN.
 * They are different facts, they are proven by different evidence, and this
 * module keeps them apart:
 *
 *   `isReservedNonRoutableAddress` answers only the first, and makes no
 *   provenance claim whatsoever.
 *
 *   `classifyAccountProvenance` answers the second, and only from authorities
 *   that were WRITTEN BY SOMETHING — a provisioning audit row, a StaffProfile,
 *   an AUTH_REGISTER row and the client address it recorded, or membership of a
 *   domain this repository demonstrably owns for fixtures.
 *
 * THERE IS NO "REAL" CLASS, AND THAT IS THE POINT. An account is not a person
 * because it failed a fixture test. `PROVEN_ORGANIC` exists in the vocabulary
 * so the contract can express the fact, and it requires positive evidence that
 * PREPROD does not currently hold for any account. Everything that is neither
 * proven synthetic nor proven organic is reported as UNPROVEN or UNKNOWN, out
 * loud, however large those classes turn out to be.
 *
 * NO SCHEMA CHANGE. Every authority below is already persisted: `AuditLog`,
 * `StaffProfile`, `User.email`. Nothing here needs a column or a migration.
 */

/**
 * Reserved, permanently non-routable TLDs.
 *
 * `.test`, `.example`, `.invalid` and `.localhost` are reserved by RFC 2606 and
 * RFC 6761 and can never be delegated, so an address under one cannot receive
 * mail and cannot belong to a contactable person.
 *
 * THAT IS ALL THIS PROVES. It says nothing about who created the account or
 * why, which is why it is exported separately from the provenance classifier
 * and is never used as a fixture test on its own.
 */
export const RESERVED_NON_ROUTABLE_TLDS = [
  ".invalid",
  ".test",
  ".example",
  ".localhost",
] as const;

/**
 * Does this address sit under a reserved, non-routable TLD?
 *
 * Compared lower-cased and anchored on a dot boundary, so
 * `victim@example.invalid.attacker.com` is NOT matched: the suffix must be the
 * actual public suffix, not a substring of a longer routable domain.
 */
export function isReservedNonRoutableAddress(email: string | null | undefined): boolean {
  if (typeof email !== "string") return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  if (domain.length === 0) return false;
  return RESERVED_NON_ROUTABLE_TLDS.some((tld) => domain.endsWith(tld));
}

/**
 * Domains this repository owns for fixtures, each with the source that owns it.
 *
 * A domain earns a place here by being referenced from a fixture, regression or
 * provisioning module IN THIS REPOSITORY — not by being non-routable. That is
 * the difference between "we made these accounts" and "these accounts have
 * unusual addresses".
 *
 * DELIBERATELY ABSENT, and each for a stated reason:
 *
 *   `@ata.test`      — named in scripts/ops/preprod-qa-operator/identity.ts as an
 *                      EXISTING STAFF convention, not a fixture one. The accounts
 *                      on it are the seeded staff principals; classifying every
 *                      `@ata.test` address as a fixture would mislabel them.
 *   `@learner.test`  — no owner anywhere in this repository.
 *   `@dev.invalid`   — no owner anywhere in this repository.
 *
 * The last two are exactly what `LEGACY_UNKNOWN_PROVENANCE` is for. Guessing
 * would be cheaper and would be a lie.
 */
export const FIXTURE_OWNED_EMAIL_DOMAINS: ReadonlyArray<{
  readonly domain: string;
  readonly ownedBy: string;
}> = [
  { domain: "@ata-preprod.invalid", ownedBy: "src/lib/growth/account-provenance.ts — this programme's acceptance learners" },
  { domain: "@example.invalid", ownedBy: "scripts/regression/* — the general regression-harness convention" },
  { domain: "@ata.invalid", ownedBy: "scripts/ops/preprod-qa-operator/identity.ts and scripts/regression/*" },
  { domain: "@ata-editorial.invalid", ownedBy: "scripts/regression/curriculumOverlayPrincipalReuseRegression.ts" },
];

/** Is this address on a domain this repository owns for fixtures? */
export function isFixtureOwnedDomain(email: string | null | undefined): boolean {
  if (typeof email !== "string") return false;
  const normalised = email.trim().toLowerCase();
  return FIXTURE_OWNED_EMAIL_DOMAINS.some((entry) => normalised.endsWith(entry.domain));
}

/**
 * Was this registration driven from inside the host rather than by a client?
 *
 * `AuditLog.ip` records the client address `POST /api/auth/register` saw. A
 * loopback or RFC 1918 address means the request originated on the machine or
 * inside its private network — a provisioning script or an E2E harness, not
 * somebody's browser. A public address means a real client somewhere, which
 * proves the transport and NOT the intent behind it.
 */
export function isInternalClientAddress(ip: string | null | undefined): boolean {
  if (typeof ip !== "string") return false;
  const value = ip.trim().toLowerCase();
  if (value === "::1" || value === "localhost") return true;
  if (value.startsWith("127.")) return true;
  if (value.startsWith("10.")) return true;
  if (value.startsWith("192.168.")) return true;
  const match = /^172\.(\d{1,2})\./.exec(value);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/** The provenance classes. There is no class meaning "real by default". */
export type AccountProvenanceClass =
  /** Something in this system wrote down that it made this account. */
  | "PROVEN_SYNTHETIC_FIXTURE"
  /**
   * Positive evidence of a person. Requires more than a routable address and a
   * successful registration; PREPROD currently holds no such evidence, so this
   * class is expected to be empty and the report says so rather than quietly
   * promoting the residue into it.
   */
  | "PROVEN_ORGANIC"
  /**
   * Registered through the real self-service endpoint from a real client, with
   * nothing proving either person or fixture. Honest residue, not "real".
   */
  | "SELF_SERVICE_UNPROVEN_PROVENANCE"
  /**
   * No registration authority and no provisioning authority: the row was
   * inserted directly by a seed or a script that left no trail.
   */
  | "LEGACY_UNKNOWN_PROVENANCE";

/** What the classifier was given, and what it concluded. */
export type AccountProvenance = {
  readonly class: AccountProvenanceClass;
  /** The authority that decided the class, named so a reader can go check it. */
  readonly decidedBy: string;
  /** Orthogonal to the class: a staff principal can be synthetic or not. */
  readonly staffOperational: boolean;
  /** Orthogonal to the class: an address property, never a provenance claim. */
  readonly reservedNonRoutableAddress: boolean;
};

export type AccountProvenanceInput = {
  readonly email: string | null | undefined;
  /** A `PREPROD_*_PROVISIONED` audit row carrying `metadata.synthetic === true`. */
  readonly hasSyntheticProvisioningAudit: boolean;
  /** A `PREPROD_ACCEPTANCE_FIXTURE_DECLARED` audit row for this account. */
  readonly hasAcceptanceFixtureDeclaration: boolean;
  /** Does the account carry a StaffProfile? */
  readonly hasStaffProfile: boolean;
  /** The `AUTH_REGISTER` audit row, if one exists, with the client it recorded. */
  readonly selfServiceRegistration: { readonly clientIp: string | null } | null;
};

/**
 * Decide provenance from authority, strongest first.
 *
 * THE ORDER IS THE CONTRACT. An explicit written declaration outranks an
 * inference from the client address, which outranks a domain convention, which
 * outranks the absence of any trail. Reordering these changes what the counts
 * mean, so the regression pins the order rather than only the outcomes.
 */
export function classifyAccountProvenance(input: AccountProvenanceInput): AccountProvenance {
  const staffOperational = input.hasStaffProfile;
  const reservedNonRoutableAddress = isReservedNonRoutableAddress(input.email);

  const decide = (cls: AccountProvenanceClass, decidedBy: string): AccountProvenance => ({
    class: cls,
    decidedBy,
    staffOperational,
    reservedNonRoutableAddress,
  });

  if (input.hasSyntheticProvisioningAudit) {
    return decide("PROVEN_SYNTHETIC_FIXTURE", "audit: PREPROD_*_PROVISIONED with metadata.synthetic = true");
  }
  if (input.hasAcceptanceFixtureDeclaration) {
    return decide("PROVEN_SYNTHETIC_FIXTURE", "audit: PREPROD_ACCEPTANCE_FIXTURE_DECLARED");
  }
  if (input.selfServiceRegistration && isInternalClientAddress(input.selfServiceRegistration.clientIp)) {
    return decide("PROVEN_SYNTHETIC_FIXTURE", "audit: AUTH_REGISTER from a loopback/private client address");
  }
  if (isFixtureOwnedDomain(input.email)) {
    return decide("PROVEN_SYNTHETIC_FIXTURE", "address on a domain this repository owns for fixtures");
  }
  if (input.selfServiceRegistration) {
    return decide("SELF_SERVICE_UNPROVEN_PROVENANCE", "audit: AUTH_REGISTER from a public client address");
  }
  return decide("LEGACY_UNKNOWN_PROVENANCE", "no registration authority and no provisioning authority");
}

/**
 * The audit action a phase writes to declare an account it created for
 * acceptance. Uses the mechanism the platform already has for exactly this
 * (`PREPROD_QA_OPERATOR_PROVISIONED` writes `synthetic: true` the same way)
 * rather than introducing a column.
 */
export const ACCEPTANCE_FIXTURE_AUDIT_ACTION = "PREPROD_ACCEPTANCE_FIXTURE_DECLARED";

/** Audit actions that carry `metadata.synthetic = true` for a provisioned principal. */
export const SYNTHETIC_PROVISIONING_AUDIT_ACTION_PREFIX = "PREPROD_";

/**
 * SQL twins, derived from the same constants so the two cannot drift.
 *
 * These are fragments for the reporting tool, which runs read-only against a
 * copy. They are not used by any product query — see the regression, which
 * asserts `analytics/sources.ts` imports none of this.
 */
export const RESERVED_NON_ROUTABLE_SQL_PREDICATE = RESERVED_NON_ROUTABLE_TLDS
  .map((tld) => `LOWER("email") LIKE '%${tld}'`)
  .join(" OR ");

export const FIXTURE_OWNED_DOMAIN_SQL_PREDICATE = FIXTURE_OWNED_EMAIL_DOMAINS
  .map((entry) => `LOWER("email") LIKE '%${entry.domain}'`)
  .join(" OR ");
