/**
 * PREPROD ACTIVATION AUTHORIZATION — what the database IS, said deterministically.
 *
 * WHY THIS MODULE EXISTS. The first implementation let the caller state the
 * digest the target was expected to hold, and after the migration stage that
 * statement was compared only against the file itself. That is not a check: a
 * caller that runs `sha256sum` on whatever is there and passes the result has
 * proved nothing, and the independent audit demonstrated exactly that — a
 * post-migration database with a silently altered `User` row was authorized for
 * the structural import.
 *
 * The fix is to stop asking anybody what the database should contain and to
 * PRECOMPUTE it instead. Every expected stage state is derived, before the first
 * real mutation, by rehearsing the sanctioned stages on a private copy of the
 * rollback backup (see `rehearsal.ts`). What this module provides is the
 * measurement those expectations are made of, and the same measurement is taken
 * again on the live target at every authorization boundary.
 *
 * WHY NOT A FILE DIGEST. A SQLite file's bytes are not reproducible: page
 * layout, freelist order and the `_prisma_migrations` timestamps all differ
 * between two runs of the same migration. A rehearsal-derived byte digest could
 * never match. So every fingerprint here is SEMANTIC — rows and columns read out
 * in a canonical order, with the columns that legitimately differ between two
 * identical runs normalised away and DOCUMENTED below.
 *
 * WHAT IS NORMALISED, AND WHY EACH ONE.
 *
 *   `id` and every `*Id` foreign key   autoincrement, assigned in insertion
 *                                      order; replaced by the semantic key of
 *                                      the row they point at.
 *   `createdAt` / `updatedAt`          set to `now()` by the importers; reduced
 *                                      to present/absent where they survive at
 *                                      all.
 *   `*ById` actor columns              resolved to the actor's e-mail, which is
 *                                      what the overlay actually pins.
 *
 * Everything else is compared BY VALUE, including `publishedAt` presence, the
 * reviewed payloads, the contract fingerprints and the authority decisions:
 * those are editorial evidence carried by the artifact rather than generated at
 * import time, so they are reproducible and a change in one of them matters.
 *
 * THE BUSINESS CONTINUITY DIGEST IS ALLOW-BY-DEFAULT. Every table in the
 * database is included unless it appears in `STAGE_MUTABLE_TABLES`. A table
 * added by a future migration is therefore covered automatically rather than
 * sitting silently outside the fence, which is the failure mode a hand-kept
 * include-list has.
 *
 * CORRECTION-2 — WHAT THE INDEPENDENT AUDIT FOUND. Three tables are filtered
 * rather than digested whole, because a sanctioned stage legitimately appends to
 * them and the appended rows carry values that are NOT reproducible between the
 * rehearsal and the real run: a provisioned principal's `User.passwordHash` ends
 * in `Date.now()`, its `StaffProfile.id` is a `cuid()`, and an `AuditLog` row
 * gets an autoincrement id and a wall-clock time. The first implementation dealt
 * with that by removing those rows from the fence ENTIRELY, at every stage.
 *
 * The audit exploited that twice:
 *
 *   HIGH-1   a `User` row on a PINNED principal address — with `role = admin` —
 *            inserted at POST_MIGRATION moved no digest, so the structural
 *            import was authorized against a database that was not the reviewed
 *            state. The hole ran backwards too: after the overlay, a principal's
 *            role could be changed and the target still classified as exactly
 *            POST_OVERLAY.
 *
 *   MEDIUM-1 `AuditLog` was fenced as `id <= entryMaxAuditLogId`, so every row
 *            above that watermark was invisible and arbitrary audit history
 *            could be appended during an activation with nothing measuring it.
 *
 * THE CORRECTION IS TO STOP EXCLUDING AND START PROJECTING. Those rows stay out
 * of the RAW per-table digests — their non-reproducible columns would make a
 * rehearsal-derived expectation unmatchable — and are covered instead by two new
 * fingerprint components that normalise away exactly the non-reproducible
 * columns and pin everything else:
 *
 *   `historicalPrincipalDigest`  one line per PINNED principal address, saying
 *                                absent, or present with its role, status,
 *                                credential SHAPE and staff profile. Absence is
 *                                a value, so a principal that appears before the
 *                                stage which creates it changes the digest.
 *
 *   `activationAuditDelta`       the rows above the entry watermark, projected
 *                                semantically and COUNTED. Empty before the
 *                                overlay; exactly the overlay's own import event
 *                                after it. An extra row — including a duplicate
 *                                of the expected one — changes it.
 *
 * The contract is now the one the correction brief states: entry state, plus an
 * explicit sanctioned stage delta, equals the expected state for that stage.
 * Nothing is ignored; what cannot be compared by value is compared by a normal
 * form documented here and derived by ONE function, so the rehearsal, the
 * manifest, authorization and resume classification cannot drift apart.
 */
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { PreprodActivationError } from "./errors";

/**
 * Bumped by CORRECTION-2: a fingerprint now carries two components that did not
 * exist before, so a manifest prepared by the previous build describes a
 * measurement this build does not take. The manifest schema compares this
 * literal, which turns that into a refusal rather than a silent mismatch.
 */
export const SEMANTIC_STATE_VERSION = "ata.preprod-activation-semantic-state/2" as const;

/**
 * The tables the two sanctioned importers write.
 *
 * Read off the importers themselves rather than guessed: `package/import.ts`
 * writes the first group and `editorial-overlay/import.ts` writes the second.
 * They are outside the business-continuity digest because a sanctioned stage is
 * SUPPOSED to change them — and they are covered instead by the curriculum and
 * editorial digests, which pin exactly what each stage was rehearsed to produce.
 *
 * CORRECTION-2, ON `ContentAsset`. The independent audit observed that no stage
 * mutated it and asked whether it belongs here. It does: `package/import.ts`
 * creates a `ContentAsset` row for every asset a level's content declares, so
 * ownership is real and belongs to the structural stage. The accepted
 * `ata-v2.canonical-100` package simply declares no assets yet, which is a fact
 * about that package and not about the contract. It stays stage-owned, and it is
 * not unmeasured either way: `CURRICULUM_PROJECTIONS` carries a `ContentAsset`
 * projection, so a row that appears where the rehearsal produced none moves the
 * curriculum digest. Moving it into the fence would have been correct only until
 * the first package that ships an asset, and then wrong silently.
 */
export const STAGE_MUTABLE_TABLES: readonly string[] = [
  // structural import
  "AssessmentVersion",
  "ContentAsset",
  "ContentLocalization",
  "ContentVersion",
  "CurriculumVersion",
  "LevelDefinition",
  "LevelResourceBinding",
  "ModuleDefinition",
  "QuestionDefinition",
  "QuestionLocalization",
  "ReportAssignmentLocalization",
  "ReportAssignmentVersion",
  "ReportFieldDefinition",
  "ReportFieldLocalization",
  // editorial overlay
  "EditorialReviewNote",
  "SourceAuthorityResolution",
  "VideoProductionAssessmentLink",
  "VideoProductionVersion",
];

/**
 * Tables a sanctioned stage APPENDS to, where every pre-existing row must still
 * be proved unchanged.
 *
 * These are not excluded. Each is included with a row filter that removes
 * exactly the rows the activation is allowed to add, so everything present at
 * entry stays inside the fence. Dropping them wholesale would have left the
 * audit's own exploit — a tampered `User` row — unmeasured.
 *
 * CORRECTION-2. The filter is the RAW half of the contract and is no longer the
 * whole of it. What each filter removes is named here and is measured by a
 * dedicated projection below, so no row is outside the fingerprint:
 *
 *   `User`, `StaffProfile`  rows for the pinned historical principals →
 *                           `captureHistoricalPrincipalState`
 *   `AuditLog`              rows above the entry watermark →
 *                           `captureActivationAuditDelta`
 */
export const FILTERED_BUSINESS_TABLES: readonly string[] = ["User", "StaffProfile", "AuditLog"];

/**
 * Which projection owns the rows each filtered table removes from the raw digest.
 *
 * Exported so the regression suite can assert that a filter never gains an owner
 * of "nobody" — that is precisely the shape of the defect CORRECTION-2 closes.
 */
export const FILTERED_TABLE_STAGE_OWNERS: Readonly<Record<string, string>> = {
  User: "historicalPrincipalDigest",
  StaffProfile: "historicalPrincipalDigest",
  AuditLog: "activationAuditDelta",
};

/** `_prisma_migrations` has its own lineage digest below. */
const MIGRATION_TABLE = "_prisma_migrations";

export type BusinessContinuityFilter = {
  /** E-mails of the overlay's historical principals. Compared case-insensitively. */
  readonly principalEmails: readonly string[];
  /** Highest `AuditLog.id` at entry; anything above it is the activation's own trail. */
  readonly entryMaxAuditLogId: number;
};

export type MigrationLineage = {
  appliedCount: number;
  failedCount: number;
  /** Ordered `name+checksum` pairs, digested. Catches a renamed or re-checksummed migration. */
  digest: string;
  /** Rendered for review; the digest is what is compared. */
  names: string[];
};

/**
 * The rows above the entry `AuditLog` watermark, as a comparable value.
 *
 * `rowCount` is carried alongside the digest because it is the number an
 * operator can check by hand, and because a refusal that can say "one audit row
 * was expected here and I found four" is worth more than one that says a digest
 * moved.
 */
export type ActivationAuditDelta = {
  rowCount: number;
  digest: string;
};

export type StageFingerprint = {
  version: typeof SEMANTIC_STATE_VERSION;
  schemaDigest: string;
  migrationLineage: MigrationLineage;
  businessContinuityDigest: string;
  /** CORRECTION-2: the pinned principals, present or absent, in their exact state. */
  historicalPrincipalDigest: string;
  /** CORRECTION-2: the audit rows a sanctioned stage is allowed to have written. */
  activationAuditDelta: ActivationAuditDelta;
  curriculumDigest: string;
  editorialDigest: string;
  /** One value over all of the above. Compared first; the parts name the failure. */
  compositeDigest: string;
};

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function open(absolutePath: string): DatabaseSync {
  try {
    return new DatabaseSync(absolutePath, { readOnly: true });
  } catch (error) {
    throw new PreprodActivationError(
      "TARGET_UNREADABLE",
      `cannot read semantic state from ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Stable rendering of one SQLite value. Keeps null distinct from the text "null". */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "\u0000null";
  if (value instanceof Uint8Array) {
    return `\u0000blob:${crypto.createHash("sha256").update(value).digest("hex")}`;
  }
  if (typeof value === "number") {
    return `\u0000num:${Number.isInteger(value) ? value.toFixed(0) : String(value)}`;
  }
  if (typeof value === "bigint") return `\u0000num:${value.toString()}`;
  return `\u0000str:${String(value)}`;
}

/**
 * Digest a result set without depending on the order rows come back in.
 *
 * Lines are sorted before hashing, so a query with no total order — and SQLite
 * promises none without one — still yields the same value for the same rows.
 */
function digestRows(rows: Array<Record<string, unknown>>, columns: readonly string[]): string {
  const lines = rows.map((row) => columns.map((column) => cell(row[column])).join(""));
  lines.sort();
  return sha256(lines.join("\u0001"));
}

function tableNames(db: DatabaseSync): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function columnNames(db: DatabaseSync, table: string): string[] {
  return (db.prepare("SELECT name FROM pragma_table_info(?)").all(table) as Array<{ name: string }>).map(
    (row) => row.name,
  );
}

/* ------------------------------------------------------------------ *
 * schema
 * ------------------------------------------------------------------ */

/**
 * The shape of the database, independent of what is in it.
 *
 * `sqlite_master.sql` is normalised for whitespace only — every identifier, type
 * and constraint is compared verbatim, so a column added or a constraint dropped
 * after the sanctioned migration is a mismatch. Auto-generated indexes are left
 * out because SQLite names them by creation order.
 */
export function captureSchemaDigest(db: DatabaseSync): string {
  const rows = db
    .prepare(
      `SELECT type, name, tbl_name, COALESCE(sql, '') AS sql
         FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_autoindex_%'
          AND name NOT LIKE 'sqlite_stat%'`,
    )
    .all() as Array<{ type: string; name: string; tbl_name: string; sql: string }>;
  const lines = rows.map(
    (row) => `${row.type}\u0000${row.name}\u0000${row.tbl_name}\u0000${row.sql.replace(/\s+/g, " ").trim()}`,
  );
  lines.sort();
  return sha256(lines.join("\u0001"));
}

/* ------------------------------------------------------------------ *
 * migration lineage
 * ------------------------------------------------------------------ */

/**
 * Which migrations this database has, by name AND by checksum.
 *
 * A count alone was never enough: a database can hold 46 rows in
 * `_prisma_migrations` whose names or checksums are not the sanctioned ones. The
 * timestamps are deliberately not digested — they differ between the rehearsal
 * and the real run and carry no authority — but an unfinished or rolled-back
 * migration is counted and reported separately.
 */
export function captureMigrationLineage(db: DatabaseSync): MigrationLineage {
  const rows = db
    .prepare(
      `SELECT migration_name AS name, checksum, rolled_back_at AS rolledBackAt, finished_at AS finishedAt
         FROM ${MIGRATION_TABLE}`,
    )
    .all() as Array<{ name: string; checksum: string; rolledBackAt: unknown; finishedAt: unknown }>;

  const isNull = (value: unknown): boolean => value === null || value === undefined;
  const applied = rows.filter((row) => isNull(row.rolledBackAt) && !isNull(row.finishedAt));
  const failedCount = rows.length - applied.length;

  const lines = applied.map((row) => `${row.name}\u0000${row.checksum}`);
  lines.sort();

  return {
    appliedCount: applied.length,
    failedCount,
    digest: sha256(lines.join("\u0001")),
    names: applied.map((row) => row.name).sort(),
  };
}

/* ------------------------------------------------------------------ *
 * business continuity
 * ------------------------------------------------------------------ */

/**
 * Everything the activation is NOT allowed to change, digested per table.
 *
 * This is the check that closes H1. The migration stage adds tables and columns
 * without touching a business row, and the structural and editorial stages touch
 * only the curriculum surface. So this value must be IDENTICAL at entry, after
 * the migration, after the structural import and after the overlay — and it is
 * compared against the rehearsal-derived expectation at every one of those
 * boundaries. A tampered user, an altered payout, an injected postback: each
 * moves this digest, and none of them can be blessed by restating the file's
 * current sha256, because no caller-supplied digest authorizes anything.
 */
export function captureBusinessContinuity(
  db: DatabaseSync,
  filter: BusinessContinuityFilter,
): { digest: string; perTable: Record<string, string> } {
  const mutable = new Set<string>([...STAGE_MUTABLE_TABLES, MIGRATION_TABLE]);
  const principals = filter.principalEmails.map((email) => email.trim().toLowerCase()).filter(Boolean);
  const perTable: Record<string, string> = {};

  for (const table of tableNames(db)) {
    if (mutable.has(table)) continue;
    const columns = columnNames(db, table).slice().sort();
    if (columns.length === 0) continue;

    const projection = columns.map((column) => `"${column}"`).join(", ");
    let sql = `SELECT ${projection} FROM "${table}"`;
    const params: Array<string | number> = [];

    // The three append-only tables keep every pre-existing row in the fence and
    // remove exactly the rows a sanctioned stage is allowed to add.
    if (table === "User" && principals.length > 0) {
      sql += ` WHERE lower("email") NOT IN (${principals.map(() => "?").join(", ")})`;
      params.push(...principals);
    } else if (table === "StaffProfile" && principals.length > 0) {
      sql += ` WHERE "userId" NOT IN (SELECT "id" FROM "User" WHERE lower("email") IN (${principals
        .map(() => "?")
        .join(", ")}))`;
      params.push(...principals);
    } else if (table === "AuditLog") {
      sql += ` WHERE "id" <= ?`;
      params.push(filter.entryMaxAuditLogId);
    }

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    perTable[table] = digestRows(rows, columns);
  }

  const lines = Object.keys(perTable)
    .sort()
    .map((table) => `${table}\u0000${perTable[table]}`);
  return { digest: sha256(lines.join("\u0001")), perTable };
}

/* ------------------------------------------------------------------ *
 * CORRECTION-2 — the historical principals, as a stage-aware value
 * ------------------------------------------------------------------ */

/**
 * The pinned principal addresses, each in exactly one of three states.
 *
 * WHY A PROJECTION AND NOT THE RAW ROWS. The overlay provisions these accounts
 * itself, and two of the columns it writes cannot be reproduced: `passwordHash`
 * ends in `Date.now().toString(36)` and `StaffProfile.id` is a `cuid()`. A raw
 * digest would therefore differ between the rehearsal and the real run for a
 * database that is CORRECT, which is why the first implementation dropped the
 * rows instead — and dropping them is what let an `admin` account be smuggled in
 * on a pinned address without moving any digest.
 *
 * WHAT IS COMPARED. Everything that decides whether this identity can act, plus
 * the identity itself:
 *
 *   presence          absent is a VALUE, not a missing line. This is the half
 *                     that closes HIGH-1: before the overlay these addresses
 *                     must not exist, and their appearance changes the digest at
 *                     ENTRY, POST_MIGRATION and POST_STRUCTURAL alike.
 *   role, status      `status` is the loginability gate — the overlay writes
 *                     `blocked`, and the login route refuses `blocked` outright.
 *   name              what the evidence rows attribute authorship to.
 *   referralCode      derived from the ref and the overlay code, so reproducible.
 *   credential SHAPE  the placeholder is deliberately not a bcrypt digest. The
 *                     VALUE is never digested — a credential is not evidence —
 *                     but "is this still the no-login placeholder" is, because
 *                     replacing it with a real hash is exactly the privilege
 *                     escalation this component exists to catch.
 *   emailVerifiedAt   presence only; the timestamp is not reproducible.
 *   staff profile     presence, display name, staff role and permission version.
 *
 * WHAT IS NOT COMPARED, AND WHY. `id`, `createdAt`, `updatedAt`, the `cuid()`
 * and the placeholder's random tail: all assigned at write time and different on
 * every run. Nothing else is left out.
 */
export function captureHistoricalPrincipalState(
  db: DatabaseSync,
  principalEmails: readonly string[],
): string {
  const emails = [...new Set(principalEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))].sort();
  if (emails.length === 0) return sha256("no-principals-pinned");

  // The placeholder the overlay writes instead of a credential. Matching its
  // PREFIX keeps the comparison reproducible while still proving that the row
  // carries no authentication path.
  const NO_LOGIN_PREFIX = "!overlay-provisioned-no-login!";

  const user = db.prepare(
    `SELECT "email"        AS email,
            "role"         AS role,
            "status"       AS status,
            "name"         AS name,
            "referralCode" AS referralCode,
            CASE WHEN "emailVerifiedAt" IS NULL THEN 'no' ELSE 'yes' END AS emailVerified,
            "leaderboardExcluded" AS leaderboardExcluded,
            CASE
              WHEN "passwordHash" = '' THEN 'empty'
              WHEN substr("passwordHash", 1, ${NO_LOGIN_PREFIX.length}) = ? THEN 'overlay-no-login-placeholder'
              ELSE 'other'
            END AS credentialShape
       FROM "User"
      WHERE lower("email") = ?`,
  );
  const staff = db.prepare(
    `SELECT s."displayName"       AS displayName,
            s."staffRole"         AS staffRole,
            s."permissionVersion" AS permissionVersion
       FROM "StaffProfile" s
       JOIN "User" u ON u."id" = s."userId"
      WHERE lower(u."email") = ?`,
  );

  const lines = emails.map((email) => {
    const row = user.get(NO_LOGIN_PREFIX, email) as Record<string, unknown> | undefined;
    if (!row) return `${email} absent`;
    const profile = staff.get(email) as Record<string, unknown> | undefined;
    const account = ["role", "status", "name", "referralCode", "emailVerified", "leaderboardExcluded", "credentialShape"]
      .map((column) => cell(row[column]))
      .join("");
    const staffPart = profile
      ? `staff${["displayName", "staffRole", "permissionVersion"].map((column) => cell(profile[column])).join("")}`
      : "staff absent";
    return `${email} present${account} ${staffPart}`;
  });

  lines.sort();
  return sha256(lines.join(""));
}

/* ------------------------------------------------------------------ *
 * CORRECTION-2 — the audit rows a sanctioned stage may have written
 * ------------------------------------------------------------------ */

/**
 * Canonical JSON, with autoincrement ids normalised out.
 *
 * The overlay's own audit metadata names the principals it provisioned by their
 * row id, and that id is only stable while the preceding state is. Any key whose
 * name ends in `Id` and whose value is a number is therefore replaced by a
 * marker; everything else — the overlay fingerprint, the checkpoint digest, the
 * source commit, the counts — is compared by value, which is the whole reason
 * this row is worth pinning.
 *
 * Keys are emitted in sorted order so two structurally equal objects that were
 * serialised in different orders still compare equal.
 */
function canonicalAuditMetadata(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalAuditMetadata).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, v]) => `${JSON.stringify(key)}:${/Id$/.test(key) && typeof v === "number" ? '"<row-id>"' : canonicalAuditMetadata(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The `AuditLog` rows above the entry watermark, projected and counted.
 *
 * WHAT THIS REPLACES. `WHERE id <= entryMaxAuditLogId` fenced the prefix and
 * said nothing at all about the suffix, so any number of rows could be appended
 * to a database and it still measured as the exact reviewed state. The prefix is
 * still digested whole by `captureBusinessContinuity`; this is the other half.
 *
 * WHY A PROJECTION. The activation legitimately writes one row — the overlay's
 * import event — and its `id` and `createdAt` are assigned when it is written,
 * so neither can be compared against a rehearsal. Everything that says WHAT the
 * event was survives normalisation:
 *
 *   action, entityType                 the event's identity in domain terms.
 *   entity                             resolved to `code@vN` when it names a
 *                                      `CurriculumVersion`, so a row id never
 *                                      enters the fingerprint; otherwise the
 *                                      declared `entityId` is kept verbatim,
 *                                      because a row nobody sanctioned should
 *                                      move this digest rather than be tidied.
 *   actor                              the e-mail behind `userId`, never the id.
 *   ip, userAgent                      presence only. The activation writes
 *                                      neither; an application request that
 *                                      wrote audit history mid-activation would
 *                                      carry them, and that must be visible.
 *   metadata                           canonicalised as above.
 *
 * COUNT IS PART OF THE VALUE. Lines are sorted and joined, so a duplicate of the
 * expected row is a second identical line and changes the digest; `rowCount` is
 * carried as well so the refusal can say the useful number out loud.
 */
export function captureActivationAuditDelta(
  db: DatabaseSync,
  entryMaxAuditLogId: number,
): ActivationAuditDelta {
  const rows = db
    .prepare(
      `SELECT a."action"     AS action,
              a."entityType" AS entityType,
              CASE
                WHEN a."entityType" = 'CurriculumVersion'
                 AND c."code" IS NOT NULL THEN c."code" || '@v' || c."versionNumber"
                ELSE a."entityId"
              END AS entity,
              (SELECT u."email" FROM "User" u WHERE u."id" = a."userId") AS actor,
              CASE WHEN a."ip" IS NULL THEN 'no' ELSE 'yes' END AS hasIp,
              CASE WHEN a."userAgent" IS NULL THEN 'no' ELSE 'yes' END AS hasUserAgent,
              a."metadata"   AS metadata
         FROM "AuditLog" a
         LEFT JOIN "CurriculumVersion" c
                ON a."entityType" = 'CurriculumVersion'
               AND c."id" = CAST(a."entityId" AS INTEGER)
        WHERE a."id" > ?`,
    )
    .all(entryMaxAuditLogId) as Array<Record<string, unknown>>;

  const lines = rows.map((row) => {
    let metadata: unknown = null;
    if (typeof row.metadata === "string" && row.metadata.length > 0) {
      try {
        metadata = JSON.parse(row.metadata);
      } catch {
        // Unparseable metadata is compared verbatim rather than dropped: a row
        // this function cannot read is exactly a row that must not be waved past.
        metadata = { unparseable: row.metadata };
      }
    } else if (row.metadata !== null && row.metadata !== undefined) {
      metadata = row.metadata;
    }
    return [
      cell(row.action),
      cell(row.entityType),
      cell(row.entity),
      cell(row.actor ?? null),
      cell(row.hasIp),
      cell(row.hasUserAgent),
      ` meta:${canonicalAuditMetadata(metadata)}`,
    ].join("");
  });

  lines.sort();
  return { rowCount: rows.length, digest: sha256(lines.join("")) };
}

/** Highest `AuditLog.id` right now — pinned at entry so later rows can be told apart. */
export function readMaxAuditLogId(absolutePath: string): number {
  const db = open(absolutePath);
  try {
    const row = db.prepare('SELECT COALESCE(MAX("id"), 0) AS n FROM "AuditLog"').get() as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------ *
 * curriculum structure
 * ------------------------------------------------------------------ */

type Projection = [label: string, sql: string, columns: readonly string[]];

/**
 * WHY A PROJECTION MAY BE ABSENT, AND WHY THAT IS SAFE.
 *
 * The entry database is at the 41 lineage, where the editorial tables and the
 * authoring columns do not exist yet — migrations 42-46 add them. A projection
 * that cannot be PREPARED against the schema in front of us is recorded as
 * `absent` instead of throwing, so one function measures both lineages.
 *
 * That is not a way to weaken a fingerprint. The label and its absence are
 * themselves part of the digest, so a database offering fewer projections gets a
 * DIFFERENT value rather than a smaller one; and `schemaDigest` pins the schema
 * independently, so a target cannot be reshaped to make a projection disappear
 * without the schema comparison catching it first. `listAvailableProjections` is
 * asserted by the regression suite at the 46 lineage — where every mutation
 * stage runs — so a typo in one of these queries fails a test rather than
 * quietly narrowing what is compared.
 */
function digestProjections(db: DatabaseSync, projections: readonly Projection[]): string {
  const parts = projections.map(([label, sql, columns]) => {
    let statement: ReturnType<DatabaseSync["prepare"]>;
    try {
      statement = db.prepare(sql);
    } catch {
      return `${label} absent`;
    }
    const rows = statement.all() as Array<Record<string, unknown>>;
    return `${label}\u0000${rows.length}\u0000${digestRows(rows, columns)}`;
  });
  parts.sort();
  return sha256(parts.join("\u0001"));
}

const CURRICULUM_PROJECTIONS: readonly Projection[] = [
  [
    "CurriculumVersion",
    `SELECT c."code" AS code, c."name" AS name, c."status" AS status, c."versionNumber" AS versionNumber,
            c."effectiveFrom" AS effectiveFrom, c."changeNotes" AS changeNotes,
            CASE WHEN c."publishedAt" IS NULL THEN 'no' ELSE 'yes' END AS published,
            (SELECT u."email" FROM "User" u WHERE u."id" = c."createdById") AS createdBy
       FROM "CurriculumVersion" c`,
    ["code", "name", "status", "versionNumber", "effectiveFrom", "changeNotes", "published", "createdBy"],
  ],
  [
    "ModuleDefinition",
    `SELECT c."code" || '@v' || c."versionNumber" AS curriculum, m."moduleNumber" AS moduleNumber, m."code" AS code,
            m."title" AS title, m."description" AS description, m."firstLevel" AS firstLevel, m."lastLevel" AS lastLevel,
            m."checkpointLevel" AS checkpointLevel, m."learningObjective" AS learningObjective, m."status" AS status
       FROM "ModuleDefinition" m JOIN "CurriculumVersion" c ON c."id" = m."curriculumVersionId"`,
    ["curriculum", "moduleNumber", "code", "title", "description", "firstLevel", "lastLevel", "checkpointLevel", "learningObjective", "status"],
  ],
  [
    "LevelDefinition",
    `SELECT c."code" || '@v' || c."versionNumber" AS curriculum, l."stableCode" AS stableCode, l."levelNumber" AS levelNumber,
            m."code" AS module, l."type" AS type, l."title" AS title, l."shortDescription" AS shortDescription,
            l."learningObjective" AS learningObjective, l."completionMethod" AS completionMethod, l."xpReward" AS xpReward,
            l."requiredXp" AS requiredXp, l."requiredPreviousLevel" AS requiredPreviousLevel,
            l."requiredCheckpointLevel" AS requiredCheckpointLevel, l."featureUnlockCode" AS featureUnlockCode,
            l."visibilityRule" AS visibilityRule, l."status" AS status
       FROM "LevelDefinition" l
       JOIN "CurriculumVersion" c ON c."id" = l."curriculumVersionId"
       LEFT JOIN "ModuleDefinition" m ON m."id" = l."moduleId"`,
    ["curriculum", "stableCode", "levelNumber", "module", "type", "title", "shortDescription", "learningObjective", "completionMethod", "xpReward", "requiredXp", "requiredPreviousLevel", "requiredCheckpointLevel", "featureUnlockCode", "visibilityRule", "status"],
  ],
  [
    "LevelResourceBinding",
    `SELECT c."code" || '@v' || c."versionNumber" AS curriculum, l."stableCode" AS level,
            (SELECT cv."versionNumber" FROM "ContentVersion" cv WHERE cv."id" = b."contentVersionId") AS contentVersion,
            (SELECT av."versionNumber" FROM "AssessmentVersion" av WHERE av."id" = b."assessmentVersionId") AS assessmentVersion
       FROM "LevelResourceBinding" b
       JOIN "LevelDefinition" l ON l."id" = b."levelDefinitionId"
       JOIN "CurriculumVersion" c ON c."id" = b."curriculumVersionId"`,
    ["curriculum", "level", "contentVersion", "assessmentVersion"],
  ],
  [
    "ContentVersion",
    `SELECT c."code" || '@v' || c."versionNumber" AS curriculum, l."stableCode" AS level, cv."versionNumber" AS versionNumber,
            cv."status" AS status, cv."videoDurationSeconds" AS videoDurationSeconds, cv."changeNotes" AS changeNotes,
            cv."revision" AS revision, cv."editorialState" AS editorialState,
            CASE WHEN cv."publishedAt" IS NULL THEN 'no' ELSE 'yes' END AS published,
            CASE WHEN cv."archivedAt" IS NULL THEN 'no' ELSE 'yes' END AS archived
       FROM "ContentVersion" cv
       JOIN "LevelDefinition" l ON l."id" = cv."levelDefinitionId"
       JOIN "CurriculumVersion" c ON c."id" = cv."curriculumVersionId"`,
    ["curriculum", "level", "versionNumber", "status", "videoDurationSeconds", "changeNotes", "revision", "editorialState", "published", "archived"],
  ],
  [
    "ContentLocalization",
    `SELECT l."stableCode" AS level, cv."versionNumber" AS contentVersion, cl."locale" AS locale, cl."title" AS title,
            cl."subtitle" AS subtitle, cl."learningObjectiveExtension" AS ext, cl."summary" AS summary,
            cl."transcript" AS transcript, cl."body" AS body
       FROM "ContentLocalization" cl
       JOIN "ContentVersion" cv ON cv."id" = cl."contentVersionId"
       JOIN "LevelDefinition" l ON l."id" = cv."levelDefinitionId"`,
    ["level", "contentVersion", "locale", "title", "subtitle", "ext", "summary", "transcript", "body"],
  ],
  [
    "ContentAsset",
    `SELECT l."stableCode" AS level, cv."versionNumber" AS contentVersion, a."kind" AS kind, a."assetCode" AS assetCode,
            a."locale" AS locale, a."url" AS url, a."mimeType" AS mimeType, a."sizeBytes" AS sizeBytes,
            a."durationSeconds" AS durationSeconds, a."checksum" AS checksum, a."sortOrder" AS sortOrder
       FROM "ContentAsset" a
       JOIN "ContentVersion" cv ON cv."id" = a."contentVersionId"
       JOIN "LevelDefinition" l ON l."id" = cv."levelDefinitionId"`,
    ["level", "contentVersion", "kind", "assetCode", "locale", "url", "mimeType", "sizeBytes", "durationSeconds", "checksum", "sortOrder"],
  ],
  [
    "AssessmentVersion",
    `SELECT c."code" || '@v' || c."versionNumber" AS curriculum, l."stableCode" AS level, av."versionNumber" AS versionNumber,
            av."status" AS status, av."passPercent" AS passPercent, av."maxAttempts" AS maxAttempts,
            av."showExplanation" AS showExplanation, av."changeNotes" AS changeNotes, av."revision" AS revision,
            av."editorialState" AS editorialState,
            CASE WHEN av."publishedAt" IS NULL THEN 'no' ELSE 'yes' END AS published,
            CASE WHEN av."archivedAt" IS NULL THEN 'no' ELSE 'yes' END AS archived,
            (SELECT p."versionNumber" FROM "AssessmentVersion" p WHERE p."id" = av."predecessorVersionId") AS predecessor
       FROM "AssessmentVersion" av
       JOIN "LevelDefinition" l ON l."id" = av."levelDefinitionId"
       JOIN "CurriculumVersion" c ON c."id" = av."curriculumVersionId"`,
    ["curriculum", "level", "versionNumber", "status", "passPercent", "maxAttempts", "showExplanation", "changeNotes", "revision", "editorialState", "published", "archived", "predecessor"],
  ],
  [
    "QuestionDefinition",
    `SELECT l."stableCode" AS level, av."versionNumber" AS assessmentVersion, q."questionNumber" AS questionNumber,
            q."stableKey" AS stableKey, q."type" AS type, q."skillTag" AS skillTag, q."status" AS status,
            q."options" AS options, q."correctAnswer" AS correctAnswer
       FROM "QuestionDefinition" q
       JOIN "AssessmentVersion" av ON av."id" = q."assessmentVersionId"
       JOIN "LevelDefinition" l ON l."id" = av."levelDefinitionId"`,
    ["level", "assessmentVersion", "questionNumber", "stableKey", "type", "skillTag", "status", "options", "correctAnswer"],
  ],
  [
    "QuestionLocalization",
    `SELECT l."stableCode" AS level, av."versionNumber" AS assessmentVersion, q."stableKey" AS stableKey,
            ql."locale" AS locale, ql."prompt" AS prompt, ql."optionLabels" AS optionLabels, ql."explanation" AS explanation
       FROM "QuestionLocalization" ql
       JOIN "QuestionDefinition" q ON q."id" = ql."questionId"
       JOIN "AssessmentVersion" av ON av."id" = q."assessmentVersionId"
       JOIN "LevelDefinition" l ON l."id" = av."levelDefinitionId"`,
    ["level", "assessmentVersion", "stableKey", "locale", "prompt", "optionLabels", "explanation"],
  ],
  [
    "ReportAssignmentVersion",
    `SELECT l."stableCode" AS level, r."versionNumber" AS versionNumber, r."status" AS status, r."changeNotes" AS changeNotes
       FROM "ReportAssignmentVersion" r
       JOIN "LevelDefinition" l ON l."id" = r."levelDefinitionId"`,
    ["level", "versionNumber", "status", "changeNotes"],
  ],
  [
    "ReportAssignmentLocalization",
    `SELECT l."stableCode" AS level, r."versionNumber" AS assignmentVersion, x."locale" AS locale, x."title" AS title,
            x."instructions" AS instructions, x."successCriteriaSummary" AS successCriteria, x."submitLabel" AS submitLabel
       FROM "ReportAssignmentLocalization" x
       JOIN "ReportAssignmentVersion" r ON r."id" = x."reportAssignmentVersionId"
       JOIN "LevelDefinition" l ON l."id" = r."levelDefinitionId"`,
    ["level", "assignmentVersion", "locale", "title", "instructions", "successCriteria", "submitLabel"],
  ],
  [
    "ReportFieldDefinition",
    `SELECT l."stableCode" AS level, r."versionNumber" AS assignmentVersion, f."stableKey" AS stableKey, f."type" AS type,
            f."required" AS required, f."sortOrder" AS sortOrder, f."validationRules" AS validationRules,
            f."choiceCodes" AS choiceCodes, f."requiredWhen" AS requiredWhen
       FROM "ReportFieldDefinition" f
       JOIN "ReportAssignmentVersion" r ON r."id" = f."reportAssignmentVersionId"
       JOIN "LevelDefinition" l ON l."id" = r."levelDefinitionId"`,
    ["level", "assignmentVersion", "stableKey", "type", "required", "sortOrder", "validationRules", "choiceCodes", "requiredWhen"],
  ],
  [
    "ReportFieldLocalization",
    `SELECT l."stableCode" AS level, r."versionNumber" AS assignmentVersion, f."stableKey" AS fieldKey, x."locale" AS locale,
            x."label" AS label, x."helpText" AS helpText, x."placeholder" AS placeholder, x."choiceLabels" AS choiceLabels
       FROM "ReportFieldLocalization" x
       JOIN "ReportFieldDefinition" f ON f."id" = x."reportFieldDefinitionId"
       JOIN "ReportAssignmentVersion" r ON r."id" = f."reportAssignmentVersionId"
       JOIN "LevelDefinition" l ON l."id" = r."levelDefinitionId"`,
    ["level", "assignmentVersion", "fieldKey", "locale", "label", "helpText", "placeholder", "choiceLabels"],
  ],
];

/**
 * The whole curriculum surface, addressed semantically.
 *
 * Every row is keyed by stable code and version number rather than by id, and
 * every actor reference is resolved to an e-mail, so the value is reproducible
 * between the rehearsal copy and the live target even though each assigns its
 * own primary keys.
 */
export function captureCurriculumDigest(db: DatabaseSync): string {
  return digestProjections(db, CURRICULUM_PROJECTIONS);
}

/* ------------------------------------------------------------------ *
 * editorial surface
 * ------------------------------------------------------------------ */

const EDITORIAL_PROJECTIONS: readonly Projection[] = [
  [
    "VideoProductionVersion",
    `SELECT l."stableCode" AS level, v."versionNumber" AS versionNumber, v."revision" AS revision,
            v."editorialState" AS editorialState, v."levelNumber" AS levelNumber, v."contractVersion" AS contractVersion,
            v."sourceProvenance" AS sourceProvenance, v."scriptState" AS scriptState, v."videoState" AS videoState,
            v."qaState" AS qaState, v."contractPayload" AS contractPayload, v."contractFingerprint" AS contractFingerprint,
            v."assessmentFingerprint" AS assessmentFingerprint, v."productionEvidenceStale" AS stale,
            (SELECT u."email" FROM "User" u WHERE u."id" = v."approvedById") AS approvedBy,
            (SELECT u."email" FROM "User" u WHERE u."id" = v."lastAuthoredById") AS authoredBy,
            (SELECT u."email" FROM "User" u WHERE u."id" = v."submittedById") AS submittedBy
       FROM "VideoProductionVersion" v
       JOIN "LevelDefinition" l ON l."id" = v."levelDefinitionId"`,
    ["level", "versionNumber", "revision", "editorialState", "levelNumber", "contractVersion", "sourceProvenance", "scriptState", "videoState", "qaState", "contractPayload", "contractFingerprint", "assessmentFingerprint", "stale", "approvedBy", "authoredBy", "submittedBy"],
  ],
  [
    "VideoProductionAssessmentLink",
    `SELECT l."stableCode" AS level, v."versionNumber" AS videoVersion, av."versionNumber" AS assessmentVersion,
            k."assessmentRevision" AS assessmentRevision, k."assessmentBankFingerprint" AS bankFingerprint,
            (SELECT u."email" FROM "User" u WHERE u."id" = k."linkedById") AS linkedBy
       FROM "VideoProductionAssessmentLink" k
       JOIN "VideoProductionVersion" v ON v."id" = k."videoProductionVersionId"
       JOIN "LevelDefinition" l ON l."id" = v."levelDefinitionId"
       LEFT JOIN "AssessmentVersion" av ON av."id" = k."assessmentVersionId"`,
    ["level", "videoVersion", "assessmentVersion", "assessmentRevision", "bankFingerprint", "linkedBy"],
  ],
  [
    "SourceAuthorityResolution",
    `SELECT l."stableCode" AS level, s."questionIndex" AS questionIndex, s."field" AS field, s."conflictPath" AS conflictPath,
            s."decision" AS decision, s."currentValueHash" AS currentValueHash, s."blueprintValueHash" AS blueprintValueHash,
            s."blueprintSourceDocumentSha256" AS blueprintDoc, s."contractFingerprintAtDecision" AS contractFp,
            s."bankFingerprintAtDecision" AS bankFp, s."assessmentRevisionAtDecision" AS assessmentRevision,
            s."rationale" AS rationale, s."evidenceRef" AS evidenceRef, s."evidenceSha256" AS evidenceSha,
            s."batchId" AS batchId,
            (SELECT u."email" FROM "User" u WHERE u."id" = s."decidedById") AS decidedBy,
            CASE WHEN s."supersededAt" IS NULL THEN 'no' ELSE 'yes' END AS superseded
       FROM "SourceAuthorityResolution" s
       LEFT JOIN "LevelDefinition" l ON l."id" = s."levelDefinitionId"`,
    ["level", "questionIndex", "field", "conflictPath", "decision", "currentValueHash", "blueprintValueHash", "blueprintDoc", "contractFp", "bankFp", "assessmentRevision", "rationale", "evidenceRef", "evidenceSha", "batchId", "decidedBy", "superseded"],
  ],
  [
    "EditorialReviewNote",
    `SELECT n."targetRevision" AS targetRevision, n."path" AS path, n."body" AS body,
            (SELECT u."email" FROM "User" u WHERE u."id" = n."authorId") AS author,
            CASE WHEN n."resolvedAt" IS NULL THEN 'no' ELSE 'yes' END AS resolved,
            (SELECT l."stableCode" FROM "ContentVersion" cv JOIN "LevelDefinition" l ON l."id" = cv."levelDefinitionId" WHERE cv."id" = n."contentVersionId") AS contentLevel,
            (SELECT cv."versionNumber" FROM "ContentVersion" cv WHERE cv."id" = n."contentVersionId") AS contentVersion,
            (SELECT l."stableCode" FROM "AssessmentVersion" av JOIN "LevelDefinition" l ON l."id" = av."levelDefinitionId" WHERE av."id" = n."assessmentVersionId") AS assessmentLevel,
            (SELECT av."versionNumber" FROM "AssessmentVersion" av WHERE av."id" = n."assessmentVersionId") AS assessmentVersion,
            (SELECT l."stableCode" FROM "VideoProductionVersion" v JOIN "LevelDefinition" l ON l."id" = v."levelDefinitionId" WHERE v."id" = n."videoProductionVersionId") AS videoLevel
       FROM "EditorialReviewNote" n`,
    ["targetRevision", "path", "body", "author", "resolved", "contentLevel", "contentVersion", "assessmentLevel", "assessmentVersion", "videoLevel"],
  ],
];

/**
 * The evidence the overlay transports, addressed semantically.
 *
 * Kept apart from the curriculum digest so a refusal can say WHICH half moved: a
 * structural difference and an editorial difference have different causes and
 * different responses.
 */
export function captureEditorialDigest(db: DatabaseSync): string {
  return digestProjections(db, EDITORIAL_PROJECTIONS);
}

/* ------------------------------------------------------------------ *
 * one stage fingerprint
 * ------------------------------------------------------------------ */

export function captureStageFingerprint(
  absolutePath: string,
  filter: BusinessContinuityFilter,
): StageFingerprint {
  const db = open(absolutePath);
  try {
    const schemaDigest = captureSchemaDigest(db);
    const migrationLineage = captureMigrationLineage(db);
    const business = captureBusinessContinuity(db, filter);
    // CORRECTION-2: the two components that measure exactly what the raw table
    // filters remove. Read from the same connection and the same instant, so a
    // fingerprint stays one observation rather than several.
    const historicalPrincipalDigest = captureHistoricalPrincipalState(db, filter.principalEmails);
    const activationAuditDelta = captureActivationAuditDelta(db, filter.entryMaxAuditLogId);
    const curriculumDigest = captureCurriculumDigest(db);
    const editorialDigest = captureEditorialDigest(db);
    const compositeDigest = sha256(
      [
        SEMANTIC_STATE_VERSION,
        schemaDigest,
        migrationLineage.digest,
        String(migrationLineage.appliedCount),
        String(migrationLineage.failedCount),
        business.digest,
        historicalPrincipalDigest,
        String(activationAuditDelta.rowCount),
        activationAuditDelta.digest,
        curriculumDigest,
        editorialDigest,
      ].join("\u0001"),
    );
    return {
      version: SEMANTIC_STATE_VERSION,
      schemaDigest,
      migrationLineage,
      businessContinuityDigest: business.digest,
      historicalPrincipalDigest,
      activationAuditDelta,
      curriculumDigest,
      editorialDigest,
      compositeDigest,
    };
  } finally {
    db.close();
  }
}

function availableProjections(db: DatabaseSync, projections: readonly Projection[]): string[] {
  const live: string[] = [];
  for (const [label, sql] of projections) {
    try {
      db.prepare(sql);
      live.push(label);
    } catch {
      /* not present at this lineage */
    }
  }
  return live;
}

/**
 * Which projections this database's schema can answer.
 *
 * The regression suite asserts that a migrated fixture answers ALL of them. That
 * is what stops a mistyped column from turning a compared surface into an
 * uncompared one without anybody noticing.
 */
export function listAvailableProjections(absolutePath: string): {
  curriculum: string[];
  editorial: string[];
  curriculumTotal: number;
  editorialTotal: number;
} {
  const db = open(absolutePath);
  try {
    return {
      curriculum: availableProjections(db, CURRICULUM_PROJECTIONS),
      editorial: availableProjections(db, EDITORIAL_PROJECTIONS),
      curriculumTotal: CURRICULUM_PROJECTIONS.length,
      editorialTotal: EDITORIAL_PROJECTIONS.length,
    };
  } finally {
    db.close();
  }
}

/** Per-table business digests, so a refusal can name the exact table. */
export function captureBusinessPerTable(
  absolutePath: string,
  filter: BusinessContinuityFilter,
): Record<string, string> {
  const db = open(absolutePath);
  try {
    return captureBusinessContinuity(db, filter).perTable;
  } finally {
    db.close();
  }
}

/**
 * Compare an observed state against a precomputed expectation.
 *
 * Returns the parts that differ, coarsest first, or an empty list when the two
 * are identical. The caller decides whether a difference means "refuse" or "this
 * stage has already run" — see `stages.ts`.
 */
export function diffStageFingerprint(expected: StageFingerprint, actual: StageFingerprint): string[] {
  const drift: string[] = [];
  if (expected.version !== actual.version) {
    drift.push(`semantic-state version (${expected.version} != ${actual.version})`);
  }
  if (expected.migrationLineage.appliedCount !== actual.migrationLineage.appliedCount) {
    drift.push(
      `applied migration count (expected ${expected.migrationLineage.appliedCount}, found ${actual.migrationLineage.appliedCount})`,
    );
  }
  if (actual.migrationLineage.failedCount !== 0) {
    drift.push(`${actual.migrationLineage.failedCount} unfinished or rolled-back migration(s)`);
  }
  if (expected.migrationLineage.digest !== actual.migrationLineage.digest) {
    drift.push("migration lineage (names/checksums)");
  }
  if (expected.schemaDigest !== actual.schemaDigest) drift.push("database schema");
  if (expected.businessContinuityDigest !== actual.businessContinuityDigest) drift.push("business data continuity");
  // CORRECTION-2. Both of these are business continuity too, but a refusal that
  // says "a historical principal is not in its reviewed state" or "3 audit rows
  // were written where 1 was expected" tells an operator what to go and look at,
  // and the generic message does not.
  if (expected.historicalPrincipalDigest !== actual.historicalPrincipalDigest) {
    drift.push("historical editorial principals (presence, role, status, credential shape or staff profile)");
  }
  if (expected.activationAuditDelta.rowCount !== actual.activationAuditDelta.rowCount) {
    drift.push(
      `activation-owned audit rows (expected ${expected.activationAuditDelta.rowCount}, found ${actual.activationAuditDelta.rowCount})`,
    );
  } else if (expected.activationAuditDelta.digest !== actual.activationAuditDelta.digest) {
    drift.push("activation-owned audit rows (same count, different events)");
  }
  if (expected.curriculumDigest !== actual.curriculumDigest) drift.push("curriculum structure");
  if (expected.editorialDigest !== actual.editorialDigest) drift.push("editorial evidence");
  if (drift.length === 0 && expected.compositeDigest !== actual.compositeDigest) drift.push("composite state digest");
  return drift;
}
