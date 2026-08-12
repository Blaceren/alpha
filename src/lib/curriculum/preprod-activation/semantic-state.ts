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
 *
 * CORRECTION-3 — WHAT THE SECOND INDEPENDENT AUDIT FOUND. The two halves above
 * were written as two SQL predicates over the same table, and the audit proved
 * they did not select the same rows.
 *
 *   HIGH-1   the raw fence removed rows with `lower("email") NOT IN (...)` — a
 *            SET predicate, so every case variant of a pinned address left the
 *            fence — while the projection read them back with a scalar `get()`,
 *            which returns ONE row. `User.email` is unique case-SENSITIVELY
 *            (`CREATE UNIQUE INDEX "User_email_key" ON "User"("email")`), so a
 *            second row on `Editor.One@…` beside a sanctioned `editor.one@…`
 *            belonged to NO component: an unreviewed `role = admin`,
 *            `status = active` account with a usable credential measured as
 *            exactly the reviewed state, and at POST_MIGRATION that authorized
 *            the structural import.
 *
 *   MEDIUM-1 the credential test was `substr(hash, 1, 30) = marker`, so any
 *            value carrying that prefix — including one with a bcrypt digest
 *            appended after it — classified as the no-login placeholder.
 *
 *   MEDIUM-2 metadata normalisation erased ANY numeric property whose name
 *            ended in `Id`, by naming convention rather than by decision.
 *
 * THE CORRECTION IS TO STOP WRITING THE FENCE AS TWO PREDICATES. Membership of
 * a principal identity class is decided ONCE, in `resolvePrincipalRowSets`, and
 * both halves are then driven by the resulting ROW IDS:
 *
 *   raw business continuity   `WHERE "id" NOT IN (<principal row ids>)`
 *   principal projection      `WHERE "id"     IN (<principal row ids>)`
 *
 * Those two sets partition the table BY CONSTRUCTION, so no row can fall
 * between them however the canonical identity rule is later changed — the bug
 * class is closed structurally rather than by making two predicates agree.
 * `captureSemanticCoverage` renders that partition as a value, and the
 * regression suite asserts it.
 *
 * On top of the partition: the projection represents EVERY row in each class
 * together with its cardinality, so multiplicity is itself semantic state; the
 * credential test is a closed whole-format check derived from the provisioner;
 * and metadata normalisation is an explicit path registry that preserves
 * everything it does not name.
 */
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { PreprodActivationError } from "./errors";

/**
 * Bumped by CORRECTION-3: the principal component now represents every row in
 * each identity class rather than one, and audit metadata is normalised by an
 * explicit registry rather than by a naming rule, so the same database yields a
 * different — and strictly more complete — value than build 2 produced. A
 * manifest prepared by either previous build therefore describes a measurement
 * this build does not take. The manifest schema compares this literal, which
 * turns that into a diagnosable refusal rather than a silent mismatch.
 *
 * History: /1 pre-CORRECTION-2, /2 added `historicalPrincipalDigest` and
 * `activationAuditDelta`, /3 made both of them total.
 */
export const SEMANTIC_STATE_VERSION = "ata.preprod-activation-semantic-state/3" as const;

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
 *
 * CORRECTION-4, ON THE PROGRESSION-OWNER TABLES. Package revision 2 made the
 * structural importer materialize the completion owners a level's
 * `completionMethod` needs at runtime — the L3 report's grading contract and the
 * twenty financial checkpoint requirements. That grew the importer's surface by
 * nine tables which this list did not name, so they fell to the business fence
 * and `rehearseActivation` reported the successor's own product data as a
 * business-data breach. No manifest could be prepared and no successor could be
 * authorized.
 *
 * The classification was re-derived from source rather than from the table
 * names. Only two files in `src/` write any of the nine: `package/import.ts`
 * (the structural stage) and `report-authoring.ts` (the CRM authoring surface,
 * which is not an activation stage). The editorial overlay importer writes none
 * of them, and no learner or runtime flow writes any of them.
 *
 * WHY THIS DOES NOT WEAKEN THE BUSINESS FENCE. Every row in all nine is
 * curriculum-version-owned configuration reachable from a `CurriculumVersion` —
 * verified on live PREPROD, where all nine tables together hold 41 rows and
 * **zero** are orphans. Learner grading data is not in them: it lives in
 * `ReportReview`, `ReportReviewScore` and `ReportSubmission`, which stay inside
 * the fence, and which reference these tables `onDelete: Restrict`, so a rubric
 * row that has graded a real report cannot be deleted at all.
 *
 * This is the same shape as `ContentVersion`, already stage-owned while holding
 * rows for v1, v2 and v3 at once: ownership is declared at table scope and the
 * rows are measured by `CURRICULUM_PROJECTIONS` entries that span EVERY
 * curriculum version, so tampering with an archived version's rubric still moves
 * the curriculum digest. Nine matching projections were added below in the same
 * commit. Neither half is safe alone — declaring ownership without projecting
 * would let a wrong threshold or a wrong rubric pass POST_IMPORT unseen, which
 * is the "filter with an owner of nobody" failure CORRECTION-2 exists to
 * prevent.
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
  // structural import — progression owners, package revision 2 (CORRECTION-4)
  "LevelCheckpointRequirement",
  "LevelReportBinding",
  "ReportRejectionReason",
  "ReportRejectionReasonLocalization",
  "ReportRubricCriterion",
  "ReportRubricCriterionLocalization",
  "ReportRubricScaleOption",
  "ReportRubricScaleOptionLocalization",
  "ReportRubricVersion",
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
  User: "historicalPrincipals",
  StaffProfile: "historicalPrincipals",
  AuditLog: "activationAuditDelta",
};

/* ------------------------------------------------------------------ *
 * CORRECTION-3 — one canonical identity, one membership decision
 * ------------------------------------------------------------------ */

/**
 * The canonical form of a historical-principal address.
 *
 * WHY THIS EXACT RULE. It is the one the artifact itself already applies:
 * `editorial-overlay/schema.ts` declares `principalRef` as
 * `z.string().trim().min(3).max(320).toLowerCase()`, so a ref has been trimmed
 * and lower-cased by the JavaScript rule before it ever reaches a manifest.
 * Matching that here means the fence groups addresses exactly as the accepted
 * artifact contract does, and nothing about application login semantics is
 * changed by this module — the login route continues to resolve accounts by
 * exact `findUnique({ where: { email } })`, which is precisely why two rows in
 * one canonical class are two separately reachable identities and why both have
 * to be measured.
 *
 * WHY NOT SQL. `lower()` in SQLite folds ASCII only, while JavaScript
 * `toLowerCase()` is Unicode-aware, so the two disagree on inputs like `İ`. The
 * previous build used the SQL rule in one half and the JavaScript rule in the
 * other, which is one of the two ways HIGH-1 could open. Membership is now
 * decided here, once, and SQL is never asked the question.
 */
export function canonicalPrincipalIdentity(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Every row belonging to a pinned principal identity class, resolved once.
 *
 * This is the single membership decision the whole module is built on. The raw
 * business-continuity digest excludes exactly these row ids and the principal
 * projection includes exactly these row ids, so the two sets partition each
 * table and `captureSemanticCoverage` can prove it. A row cannot be lost
 * between them, because there is no second predicate to disagree with.
 */
export type PrincipalRowSets = {
  /** Canonical identities pinned by the manifest, deduplicated and sorted. */
  readonly identities: readonly string[];
  /** `User.id`s per canonical identity, ascending. Length is the cardinality. */
  readonly userIdsByIdentity: ReadonlyMap<string, readonly number[]>;
  /** Every `User.id` in any pinned class. */
  readonly principalUserIds: ReadonlySet<number>;
};

export function resolvePrincipalRowSets(
  db: DatabaseSync,
  principalEmails: readonly string[],
): PrincipalRowSets {
  const identities = [
    ...new Set(principalEmails.map(canonicalPrincipalIdentity).filter((email) => email.length > 0)),
  ].sort();

  const userIdsByIdentity = new Map<string, number[]>();
  for (const identity of identities) userIdsByIdentity.set(identity, []);

  if (identities.length > 0) {
    // Every row is canonicalised by the SAME function, in this process. Reading
    // the identity column for the whole table is what `captureBusinessContinuity`
    // already does for every table it digests, so this costs nothing new.
    const rows = db.prepare('SELECT "id" AS id, "email" AS email FROM "User"').all() as Array<{
      id: number;
      email: unknown;
    }>;
    for (const row of rows) {
      if (typeof row.email !== "string") continue;
      const bucket = userIdsByIdentity.get(canonicalPrincipalIdentity(row.email));
      if (bucket) bucket.push(row.id);
    }
    for (const bucket of userIdsByIdentity.values()) bucket.sort((a, b) => a - b);
  }

  const principalUserIds = new Set<number>();
  for (const bucket of userIdsByIdentity.values()) for (const id of bucket) principalUserIds.add(id);

  return { identities, userIdsByIdentity, principalUserIds };
}

/**
 * `IN (...)` list for a set of integer row ids.
 *
 * An empty set renders as `-1`, NOT as `NULL`. This matters: SQL `x NOT IN (NULL)`
 * evaluates to NULL rather than true, so a `NULL` sentinel would make the raw
 * fence match ZERO rows whenever no principal row exists — which is every state
 * before the overlay. Row ids are positive autoincrement integers, so `-1` can
 * never match: `id NOT IN (-1)` is true for every row and `id IN (-1)` is false
 * for every row, which is exactly the empty-class behaviour both halves need.
 */
function idList(ids: Iterable<number>): string {
  const rendered = [...ids].map((id) => String(Math.trunc(id))).join(", ");
  return rendered.length > 0 ? rendered : "-1";
}

/** `_prisma_migrations` has its own lineage digest below. */
const MIGRATION_TABLE = "_prisma_migrations";

export type BusinessContinuityFilter = {
  /**
   * The overlay's historical principals. Grouped into identity classes by
   * `canonicalPrincipalIdentity`, which is the rule the artifact contract itself
   * applies to a `principalRef`.
   */
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
  /**
   * CORRECTION-2, made total by CORRECTION-3: every row in every pinned
   * principal identity class, with its cardinality.
   */
  historicalPrincipals: HistoricalPrincipalState;
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
 * WHAT THIS VALUE ACTUALLY IS, AND WHAT IT IS NOT (corrected by CORRECTION-3).
 * The previous comment claimed this digest is identical at all four states. It
 * is not, and no code ever depended on that claim: the expectation is
 * STAGE-SPECIFIC, one rehearsal-derived fingerprint per state, and each
 * boundary is compared against its own. Two things are true instead.
 *
 *   Unaffected business state is CONTINUOUS. No sanctioned stage writes a
 *   fenced row, so a tampered user, an altered payout or an injected postback
 *   moves this digest at whichever boundary it is measured — and none of them
 *   can be blessed by restating the file's sha256, because no caller-supplied
 *   digest authorizes anything. That is the property H1 needed.
 *
 *   The SET of fenced tables legitimately grows. Migrations 42-46 create tables
 *   (`AuthoringPreviewSnapshot`, `StagingAttestation`, …) which, being new and
 *   not stage-owned, enter the fence at POST_MIGRATION as empty tables. The
 *   digest is over the per-table map, so gaining a key changes it. That is
 *   allow-by-default working, not drift, and it is exactly why the expectation
 *   is per state rather than one value reused four times.
 *
 * The three partially stage-owned tables keep every pre-existing row here and
 * remove exactly the rows a sanctioned stage may add. Since CORRECTION-3 those
 * removals are BY ROW ID, taken from the same `PrincipalRowSets` the principal
 * projection is built from, so the two halves cannot select different rows.
 */
export function captureBusinessContinuity(
  db: DatabaseSync,
  filter: BusinessContinuityFilter,
  sets: PrincipalRowSets = resolvePrincipalRowSets(db, filter.principalEmails),
): { digest: string; perTable: Record<string, string> } {
  const mutable = new Set<string>([...STAGE_MUTABLE_TABLES, MIGRATION_TABLE]);
  const perTable: Record<string, string> = {};
  const principalIds = idList(sets.principalUserIds);

  for (const table of tableNames(db)) {
    if (mutable.has(table)) continue;
    const columns = columnNames(db, table).slice().sort();
    if (columns.length === 0) continue;

    const projection = columns.map((column) => `"${column}"`).join(", ");
    let sql = `SELECT ${projection} FROM "${table}"`;
    const params: Array<string | number> = [];

    if (table === "User") {
      sql += ` WHERE "id" NOT IN (${principalIds})`;
    } else if (table === "StaffProfile") {
      sql += ` WHERE "userId" NOT IN (${principalIds})`;
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
 * The marker the overlay writes in front of its non-credential placeholder.
 *
 * Read off the provisioner rather than guessed: `editorial-overlay/import.ts`
 * writes `` `!overlay-provisioned-no-login!${Date.now().toString(36)}` ``.
 */
export const OVERLAY_NO_LOGIN_MARKER = "!overlay-provisioned-no-login!";

/**
 * What a stored credential IS, as a closed set.
 *
 * `unrecognized` is deliberately a CLASS and not an error: a row carrying
 * something this classifier cannot account for must move the fingerprint, not
 * halt the measurement.
 */
export type CredentialClass =
  | "overlay-no-login-placeholder"
  | "bcrypt-login-credential"
  | "absent"
  | "unrecognized";

/**
 * A bcrypt modular-crypt digest: `$2a$`/`$2b$`/`$2y$`, a two-digit cost and 53
 * characters of radix-64 salt+digest. This is what `bcrypt.hash` produces in
 * `src/app/api/auth/register/route.ts` and the only shape `bcrypt.compare` can
 * return true for in `src/app/api/auth/login/route.ts`.
 */
const BCRYPT_DIGEST = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/**
 * Which class a stored credential belongs to.
 *
 * WHY A WHOLE-FORMAT TEST AND NOT A PREFIX (CORRECTION-3, MEDIUM-1). The
 * previous build asked `substr(hash, 1, 30) = marker`, which accepts
 * `!overlay-provisioned-no-login!$2b$10$…` — the marker with a real digest
 * appended. That is a different security object wearing the same label. The
 * placeholder's contract is the marker followed by `Date.now()` in base 36 and
 * NOTHING ELSE, so that is what is checked: the tail must be lowercase base-36,
 * must re-serialise to itself (which rejects leading zeros, padding and mixed
 * case), and must be a plausible epoch-millisecond value. Anchoring the END is
 * the point — nothing may follow the timestamp.
 *
 * THE VALUE NEVER LEAVES THIS FUNCTION. Only the class name is returned, and no
 * caller receives the string it was derived from, so no credential material can
 * reach a digest, a manifest, a log line or a refusal message.
 */
export function classifyCredential(passwordHash: unknown): CredentialClass {
  if (typeof passwordHash !== "string" || passwordHash.length === 0) return "absent";
  if (passwordHash.startsWith(OVERLAY_NO_LOGIN_MARKER)) {
    const tail = passwordHash.slice(OVERLAY_NO_LOGIN_MARKER.length);
    // 36^7 ms lands in 1972 and 36^11 ms far beyond any plausible clock, so the
    // bound is closed at both ends rather than open-ended; the `toString(36)`
    // round trip then rejects anything that is not exactly how the provisioner
    // renders a time.
    if (/^[0-9a-z]{7,11}$/.test(tail)) {
      const millis = Number.parseInt(tail, 36);
      if (Number.isSafeInteger(millis) && millis > 0 && millis.toString(36) === tail) {
        return "overlay-no-login-placeholder";
      }
    }
    return "unrecognized";
  }
  if (BCRYPT_DIGEST.test(passwordHash)) return "bcrypt-login-credential";
  return "unrecognized";
}

export type HistoricalPrincipalState = {
  /** User rows across every pinned class. Cardinality is itself semantic state. */
  userRowCount: number;
  /** StaffProfile rows bound to those users. */
  staffProfileRowCount: number;
  digest: string;
};

/**
 * EVERY row belonging to each pinned principal identity class.
 *
 * WHY A PROJECTION AND NOT THE RAW ROWS. The overlay provisions these accounts
 * itself, and two of the columns it writes cannot be reproduced: `passwordHash`
 * ends in `Date.now().toString(36)` and `StaffProfile.id` is a `cuid()`. A raw
 * digest would therefore differ between the rehearsal and the real run for a
 * database that is CORRECT.
 *
 * WHY EVERY ROW AND NOT ONE (CORRECTION-3, HIGH-1). `User.email` is unique
 * case-SENSITIVELY, so one canonical identity class can legitimately hold more
 * than one row, and each is separately reachable by the login route's exact
 * `findUnique`. The previous build read the class with `get()` — one arbitrary
 * row, with no ORDER BY — while the raw fence removed all of them, so rows 2..N
 * were measured by nothing at all. The class is now read with `all()` over the
 * ids resolved in `resolvePrincipalRowSets`, which is the SAME set the fence
 * removed, and the cardinality is carried beside the digest so a refusal can say
 * the useful number out loud.
 *
 * WHAT IS COMPARED, PER ROW:
 *
 *   cardinality       absent, one and several are three different values. A
 *                     second row in a class can never hide behind the first.
 *   stored spelling   `Editor.One@…` and `editor.one@…` are one canonical
 *                     identity but two login identities, so the exact stored
 *                     form is part of the value.
 *   role, status      `status` is the loginability gate — the overlay writes
 *                     `blocked`, and the login route refuses `blocked` outright.
 *   name              what the evidence rows attribute authorship to.
 *   referralCode      derived from the ref and the overlay code, so reproducible.
 *   credential class  the closed classification above, never the value.
 *                     Replacing the placeholder with a usable digest is exactly
 *                     the escalation this component exists to catch.
 *   emailVerifiedAt   presence only; the timestamp is not reproducible.
 *   staff profile     nested INSIDE its user's projection, so a profile that
 *                     moves to a different represented user changes two rows
 *                     rather than none. `StaffProfile.userId` is unique, so a
 *                     user has at most one, and an extra profile in the class
 *                     therefore shows up as a changed count.
 *
 * WHAT IS NOT COMPARED, AND WHY. `User.id`, `StaffProfile.id`, `createdAt`,
 * `updatedAt` and the placeholder's timestamp tail: all assigned at write time
 * and different on every run. Nothing else is left out.
 *
 * ORDERING. Rows are rendered first and then sorted BY THEIR RENDERED FORM, so
 * the value depends on the set of rows and not on their ids or on the order they
 * were inserted.
 *
 * BOTH PRINCIPAL PATHS ARE REPRESENTED, NEITHER IS SPECIAL-CASED. The importer
 * supports provisioning an absent principal and matching one that already
 * exists (`editorial-overlay/import.ts`, resolution status `provisioned` /
 * `matched`). Because every row is rendered at every stage together with its
 * cardinality, a matched principal present from ENTRY and a provisioned
 * principal appearing only at POST_OVERLAY are simply different values of one
 * measurement, and the reviewed value for each stage comes from the rehearsal.
 */
export function captureHistoricalPrincipalState(
  db: DatabaseSync,
  sets: PrincipalRowSets,
): HistoricalPrincipalState {
  if (sets.identities.length === 0) {
    return { userRowCount: 0, staffProfileRowCount: 0, digest: sha256("no-principals-pinned") };
  }

  const userById = new Map<number, Record<string, unknown>>();
  const profileByUserId = new Map<number, Record<string, unknown>>();

  if (sets.principalUserIds.size > 0) {
    const ids = idList(sets.principalUserIds);
    for (const row of db
      .prepare(
        `SELECT "id" AS id, "email" AS email, "role" AS role, "status" AS status, "name" AS name,
                "referralCode" AS referralCode, "passwordHash" AS passwordHash,
                CASE WHEN "emailVerifiedAt" IS NULL THEN 'no' ELSE 'yes' END AS emailVerified,
                "leaderboardExcluded" AS leaderboardExcluded
           FROM "User" WHERE "id" IN (${ids})`,
      )
      .all() as Array<Record<string, unknown>>) {
      userById.set(row.id as number, row);
    }
    for (const row of db
      .prepare(
        `SELECT "userId" AS userId, "displayName" AS displayName, "staffRole" AS staffRole,
                "permissionVersion" AS permissionVersion
           FROM "StaffProfile" WHERE "userId" IN (${ids})`,
      )
      .all() as Array<Record<string, unknown>>) {
      profileByUserId.set(row.userId as number, row);
    }
  }

  let staffProfileRowCount = 0;
  const lines = sets.identities.map((identity) => {
    const ids = sets.userIdsByIdentity.get(identity) ?? [];
    if (ids.length === 0) return `${identity} users=0 absent`;

    const rendered = ids.map((id) => {
      const row = userById.get(id);
      // Unreachable while the id set and the read come from the same snapshot;
      // rendered as a value rather than thrown so a surprise cannot be silent.
      if (!row) return "row-unreadable";
      const account = [
        cell(row.email),
        cell(row.role),
        cell(row.status),
        cell(row.name),
        cell(row.referralCode),
        cell(row.emailVerified),
        cell(row.leaderboardExcluded),
        ` cred:${classifyCredential(row.passwordHash)}`,
      ].join("");
      const profile = profileByUserId.get(id);
      if (profile) staffProfileRowCount += 1;
      const staffPart = profile
        ? `staff${[cell(profile.displayName), cell(profile.staffRole), cell(profile.permissionVersion)].join("")}`
        : "staff absent";
      return `${account} ${staffPart}`;
    });
    rendered.sort();
    return `${identity} users=${ids.length} ${rendered.join("")}`;
  });

  lines.sort();
  return {
    userRowCount: sets.principalUserIds.size,
    staffProfileRowCount,
    digest: sha256(lines.join("")),
  };
}

/* ------------------------------------------------------------------ *
 * CORRECTION-3 — the ownership partition, as a checkable value
 * ------------------------------------------------------------------ */

export type TableCoverage = {
  total: number;
  /** Rows inside the raw business-continuity digest. */
  fenced: number;
  /** Rows owned by the projection named in `FILTERED_TABLE_STAGE_OWNERS`. */
  specialised: number;
  /** Rows in neither set, and rows in both. Must always be 0. */
  unowned: number;
  ambiguous: number;
};

/**
 * Proof that the two halves of each filtered table PARTITION it.
 *
 * This is the invariant HIGH-1 violated, rendered as numbers the regression
 * suite asserts on every fixture it builds. `fenced` and `specialised` are
 * counted with the same predicates the digests use, so if a future edit makes
 * the two halves disagree, `unowned` or `ambiguous` becomes non-zero and a test
 * fails — instead of a row quietly leaving the fingerprint.
 */
export function captureSemanticCoverage(
  db: DatabaseSync,
  filter: BusinessContinuityFilter,
  sets: PrincipalRowSets = resolvePrincipalRowSets(db, filter.principalEmails),
): Record<string, TableCoverage> {
  const ids = idList(sets.principalUserIds);
  const count = (sql: string, ...params: Array<string | number>): number =>
    (db.prepare(sql).get(...params) as { n: number }).n;

  const watermark = filter.entryMaxAuditLogId;
  // `unowned` and `ambiguous` are derived, not queried: a row belongs to neither
  // half when the two counts fall short of the total, and to both when they
  // exceed it. Asking SQL for `fence AND specialised` would be tautologically
  // zero and would prove nothing.
  const partition = (total: number, fenced: number, specialised: number): TableCoverage => ({
    total,
    fenced,
    specialised,
    unowned: Math.max(0, total - (fenced + specialised)),
    ambiguous: Math.max(0, fenced + specialised - total),
  });

  return {
    User: partition(
      count('SELECT COUNT(*) AS n FROM "User"'),
      count(`SELECT COUNT(*) AS n FROM "User" WHERE "id" NOT IN (${ids})`),
      count(`SELECT COUNT(*) AS n FROM "User" WHERE "id" IN (${ids})`),
    ),
    StaffProfile: partition(
      count('SELECT COUNT(*) AS n FROM "StaffProfile"'),
      count(`SELECT COUNT(*) AS n FROM "StaffProfile" WHERE "userId" NOT IN (${ids})`),
      count(`SELECT COUNT(*) AS n FROM "StaffProfile" WHERE "userId" IN (${ids})`),
    ),
    AuditLog: partition(
      count('SELECT COUNT(*) AS n FROM "AuditLog"'),
      count('SELECT COUNT(*) AS n FROM "AuditLog" WHERE "id" <= ?', watermark),
      count('SELECT COUNT(*) AS n FROM "AuditLog" WHERE "id" > ?', watermark),
    ),
  };
}

/* ------------------------------------------------------------------ *
 * CORRECTION-2 — the audit rows a sanctioned stage may have written
 * ------------------------------------------------------------------ */

/**
 * THE METADATA NORMALISATION REGISTRY (CORRECTION-3, MEDIUM-2).
 *
 * WHAT WAS WRONG. The previous build normalised by naming convention: any key
 * matching `/Id$/` whose value was a number became `"<row-id>"`. That is a
 * wildcard, and a wildcard decides the fate of fields nobody has looked at —
 * including fields that do not exist yet. The audit demonstrated it erasing
 * `targetUserId`, `importActorId`, `curriculumVersionId` and an invented
 * `grantedRoleId` alike, purely because of how they are spelled.
 *
 * THE RULE NOW IS DEFAULT-DENY. Exactly the paths listed here are normalised.
 * Every other field — known or unknown, numeric or not, however it is named —
 * is compared BY VALUE. A metadata field introduced by a future stage is
 * therefore protected the moment it appears, which is the opposite of the
 * previous behaviour.
 *
 * WHAT REPLACES AN ERASED VALUE. Not a marker: a STABLE SEMANTIC IDENTITY
 * resolved from the database. A row id is meaningless across two databases, but
 * the canonical identity of the account it points at is exactly the thing the
 * activation pinned, so resolving it keeps the assertion checkable. Binding a
 * principal to a different account changes the resolved identity and therefore
 * the digest — the previous behaviour hid precisely that.
 *
 * WHEN A VALUE CANNOT BE RESOLVED it is preserved verbatim under an
 * `unresolved:` tag rather than dropped. A legitimate rehearsal never produces
 * one; a row that does is a row that must stay visible.
 *
 * Each entry records: the producing stage, the exact path, why the value is
 * nondeterministic, and what stable value takes its place.
 */
type MetadataNormalisationRule = {
  /** `AuditLog.action` this applies to. Nothing is normalised for other actions. */
  readonly action: string;
  /** Exact path from the metadata root. `[]` denotes every element of an array. */
  readonly path: string;
  /** Why the stored value cannot be compared between two runs. */
  readonly reason: string;
  /** What is compared instead. */
  readonly replacement: "canonical-user-identity";
};

export const EDITORIAL_OVERLAY_AUDIT_ACTION_NAME = "curriculum.editorial-overlay.import";

export const AUDIT_METADATA_NORMALISATIONS: readonly MetadataNormalisationRule[] = [
  {
    action: EDITORIAL_OVERLAY_AUDIT_ACTION_NAME,
    path: "principals[].targetUserId",
    reason:
      "the User row a principal ref resolved to; an autoincrement id assigned when the overlay provisions the account, so it differs between the rehearsal copy and the real target",
    replacement: "canonical-user-identity",
  },
  {
    action: EDITORIAL_OVERLAY_AUDIT_ACTION_NAME,
    path: "importActorId",
    reason:
      "the operator account the import was attributed to, recorded as a row id; the same identity can carry a different id in the rehearsal copy",
    replacement: "canonical-user-identity",
  },
];

/**
 * Canonical JSON with exactly the registered paths replaced.
 *
 * Keys are emitted in sorted order, so two structurally equal objects that were
 * serialised in different key orders produce the same value and no false state
 * change arises from JSON key ordering.
 */
function canonicalAuditMetadata(
  value: unknown,
  path: string,
  normalise: (path: string, value: unknown) => string | null,
): string {
  const replaced = normalise(path, value);
  if (replaced !== null) return replaced;
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalAuditMetadata(entry, `${path}[]`, normalise)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${canonicalAuditMetadata(entry, path.length > 0 ? `${path}.${key}` : key, normalise)}`,
      )
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
 *   metadata                           canonicalised by the registry above:
 *                                      registered paths resolve to a stable
 *                                      identity, EVERYTHING else by value.
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

  // Resolves a row id to the canonical identity of the account it names. Used
  // only for the registered paths below; a value that resolves to nothing keeps
  // its original form so it cannot vanish.
  const userIdentity = db.prepare('SELECT "email" AS email FROM "User" WHERE "id" = ?');
  const resolveUserIdentity = (value: unknown): string => {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return `unresolved:${JSON.stringify(value ?? null)}`;
    }
    const row = userIdentity.get(value) as { email?: unknown } | undefined;
    if (!row || typeof row.email !== "string") return `unresolved:${JSON.stringify(value)}`;
    return `identity:${canonicalPrincipalIdentity(row.email)}`;
  };

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

    const action = typeof row.action === "string" ? row.action : "";
    const registered = new Map(
      AUDIT_METADATA_NORMALISATIONS.filter((rule) => rule.action === action).map((rule) => [rule.path, rule]),
    );
    const normalise = (path: string, value: unknown): string | null => {
      const rule = registered.get(path);
      if (!rule) return null;
      return JSON.stringify(resolveUserIdentity(value));
    };

    return [
      cell(row.action),
      cell(row.entityType),
      cell(row.entity),
      cell(row.actor ?? null),
      cell(row.hasIp),
      cell(row.hasUserAgent),
      ` meta:${canonicalAuditMetadata(metadata, "", normalise)}`,
    ].join("");
  });

  lines.sort();
  return { rowCount: rows.length, digest: sha256(lines.join("")) };
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

  /*
   * CORRECTION-4 — the progression owners package revision 2 materializes.
   *
   * Addressed the way the rest of this registry is: by stable domain identity,
   * never by row id. A level is its `stableCode`, a rubric is its
   * `versionNumber` under its assignment, and a criterion, scale option or
   * rejection reason is its `stableKey`. Auto-increment ids are storage
   * accidents and appear nowhere below, so re-importing the same product data
   * into a fresh database reproduces the same digest.
   *
   * The joins deliberately reach `CurriculumVersion` for the two level-owned
   * tables and stop at `LevelDefinition` for the rubric family, matching
   * `LevelResourceBinding` and `ReportFieldLocalization` respectively. Every
   * curriculum version is covered, not just the successor, so editing an
   * archived version's rubric moves the digest too.
   */
  [
    "LevelCheckpointRequirement",
    `SELECT c."code" || '@v' || c."versionNumber" AS curriculum, l."stableCode" AS level,
            q."integrationCode" AS integrationCode, q."thresholdCurrency" AS thresholdCurrency,
            q."thresholdMinorUnits" AS thresholdMinorUnits
       FROM "LevelCheckpointRequirement" q
       JOIN "LevelDefinition" l ON l."id" = q."levelDefinitionId"
       JOIN "CurriculumVersion" c ON c."id" = l."curriculumVersionId"`,
    ["curriculum", "level", "integrationCode", "thresholdCurrency", "thresholdMinorUnits"],
  ],
  [
    "LevelReportBinding",
    `SELECT c."code" || '@v' || c."versionNumber" AS curriculum, l."stableCode" AS level,
            r."versionNumber" AS assignmentVersion, v."versionNumber" AS rubricVersion,
            b."revision" AS revision
       FROM "LevelReportBinding" b
       JOIN "LevelDefinition" l ON l."id" = b."levelDefinitionId"
       JOIN "CurriculumVersion" c ON c."id" = b."curriculumVersionId"
       LEFT JOIN "ReportAssignmentVersion" r ON r."id" = b."reportAssignmentVersionId"
       LEFT JOIN "ReportRubricVersion" v ON v."id" = b."reportRubricVersionId"`,
    ["curriculum", "level", "assignmentVersion", "rubricVersion", "revision"],
  ],
  [
    "ReportRubricVersion",
    `SELECT l."stableCode" AS level, r."versionNumber" AS assignmentVersion,
            v."versionNumber" AS versionNumber, v."status" AS status, v."changeNotes" AS changeNotes,
            CASE WHEN v."publishedAt" IS NULL THEN 'no' ELSE 'yes' END AS published,
            CASE WHEN v."archivedAt" IS NULL THEN 'no' ELSE 'yes' END AS archived
       FROM "ReportRubricVersion" v
       JOIN "ReportAssignmentVersion" r ON r."id" = v."reportAssignmentVersionId"
       JOIN "LevelDefinition" l ON l."id" = r."levelDefinitionId"`,
    ["level", "assignmentVersion", "versionNumber", "status", "changeNotes", "published", "archived"],
  ],
  [
    "ReportRubricCriterion",
    `SELECT l."stableCode" AS level, v."versionNumber" AS rubricVersion, x."stableKey" AS stableKey,
            x."categoryCode" AS categoryCode, x."sortOrder" AS sortOrder,
            x."commentRequired" AS commentRequired
       FROM "ReportRubricCriterion" x
       JOIN "ReportRubricVersion" v ON v."id" = x."reportRubricVersionId"
       JOIN "ReportAssignmentVersion" r ON r."id" = v."reportAssignmentVersionId"
       JOIN "LevelDefinition" l ON l."id" = r."levelDefinitionId"`,
    ["level", "rubricVersion", "stableKey", "categoryCode", "sortOrder", "commentRequired"],
  ],
  [
    "ReportRubricCriterionLocalization",
    `SELECT l."stableCode" AS level, v."versionNumber" AS rubricVersion, x."stableKey" AS criterionKey,
            y."locale" AS locale, y."title" AS title, y."description" AS description
       FROM "ReportRubricCriterionLocalization" y
       JOIN "ReportRubricCriterion" x ON x."id" = y."reportRubricCriterionId"
       JOIN "ReportRubricVersion" v ON v."id" = x."reportRubricVersionId"
       JOIN "ReportAssignmentVersion" r ON r."id" = v."reportAssignmentVersionId"
       JOIN "LevelDefinition" l ON l."id" = r."levelDefinitionId"`,
    ["level", "rubricVersion", "criterionKey", "locale", "title", "description"],
  ],
  [
    "ReportRubricScaleOption",
    `SELECT l."stableCode" AS level, v."versionNumber" AS rubricVersion, x."stableKey" AS stableKey,
            x."ordinal" AS ordinal
       FROM "ReportRubricScaleOption" x
       JOIN "ReportRubricVersion" v ON v."id" = x."reportRubricVersionId"
       JOIN "ReportAssignmentVersion" r ON r."id" = v."reportAssignmentVersionId"
       JOIN "LevelDefinition" l ON l."id" = r."levelDefinitionId"`,
    ["level", "rubricVersion", "stableKey", "ordinal"],
  ],
  [
    "ReportRubricScaleOptionLocalization",
    `SELECT l."stableCode" AS level, v."versionNumber" AS rubricVersion, x."stableKey" AS optionKey,
            y."locale" AS locale, y."label" AS label, y."description" AS description
       FROM "ReportRubricScaleOptionLocalization" y
       JOIN "ReportRubricScaleOption" x ON x."id" = y."reportRubricScaleOptionId"
       JOIN "ReportRubricVersion" v ON v."id" = x."reportRubricVersionId"
       JOIN "ReportAssignmentVersion" r ON r."id" = v."reportAssignmentVersionId"
       JOIN "LevelDefinition" l ON l."id" = r."levelDefinitionId"`,
    ["level", "rubricVersion", "optionKey", "locale", "label", "description"],
  ],
  [
    "ReportRejectionReason",
    `SELECT l."stableCode" AS level, v."versionNumber" AS rubricVersion, x."stableKey" AS stableKey,
            x."sortOrder" AS sortOrder, x."active" AS active
       FROM "ReportRejectionReason" x
       JOIN "ReportRubricVersion" v ON v."id" = x."reportRubricVersionId"
       JOIN "ReportAssignmentVersion" r ON r."id" = v."reportAssignmentVersionId"
       JOIN "LevelDefinition" l ON l."id" = r."levelDefinitionId"`,
    ["level", "rubricVersion", "stableKey", "sortOrder", "active"],
  ],
  [
    "ReportRejectionReasonLocalization",
    `SELECT l."stableCode" AS level, v."versionNumber" AS rubricVersion, x."stableKey" AS reasonKey,
            y."locale" AS locale, y."title" AS title, y."guidance" AS guidance
       FROM "ReportRejectionReasonLocalization" y
       JOIN "ReportRejectionReason" x ON x."id" = y."reportRejectionReasonId"
       JOIN "ReportRubricVersion" v ON v."id" = x."reportRubricVersionId"
       JOIN "ReportAssignmentVersion" r ON r."id" = v."reportAssignmentVersionId"
       JOIN "LevelDefinition" l ON l."id" = r."levelDefinitionId"`,
    ["level", "rubricVersion", "reasonKey", "locale", "title", "guidance"],
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
    // CORRECTION-3: membership of a principal identity class is decided ONCE and
    // handed to both halves, so the raw fence and the projection cannot select
    // different rows. Read from the same connection and the same instant, so a
    // fingerprint stays one observation rather than several.
    const sets = resolvePrincipalRowSets(db, filter.principalEmails);
    const business = captureBusinessContinuity(db, filter, sets);
    const historicalPrincipals = captureHistoricalPrincipalState(db, sets);
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
        String(historicalPrincipals.userRowCount),
        String(historicalPrincipals.staffProfileRowCount),
        historicalPrincipals.digest,
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
      historicalPrincipals,
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

/**
 * `captureSemanticCoverage` against a database path.
 *
 * The regression suite calls this on every fixture it builds, which is what turns
 * the ownership partition from a claim in a comment into a checked property.
 */
export function readSemanticCoverage(
  absolutePath: string,
  filter: BusinessContinuityFilter,
): Record<string, TableCoverage> {
  const db = open(absolutePath);
  try {
    return captureSemanticCoverage(db, filter);
  } finally {
    db.close();
  }
}

/** The principal row sets against a database path, for tests and diagnostics. */
export function readPrincipalRowSets(
  absolutePath: string,
  principalEmails: readonly string[],
): { identities: readonly string[]; rowCountByIdentity: Record<string, number> } {
  const db = open(absolutePath);
  try {
    const sets = resolvePrincipalRowSets(db, principalEmails);
    const rowCountByIdentity: Record<string, number> = {};
    for (const identity of sets.identities) {
      rowCountByIdentity[identity] = (sets.userIdsByIdentity.get(identity) ?? []).length;
    }
    return { identities: sets.identities, rowCountByIdentity };
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
  //
  // CORRECTION-3 reports the CARDINALITY first. "2 rows exist on an address that
  // should hold 1" is the sentence that names the defect the previous build could
  // not see at all, and an operator can check it by hand.
  if (expected.historicalPrincipals.userRowCount !== actual.historicalPrincipals.userRowCount) {
    drift.push(
      `historical editorial principal rows (expected ${expected.historicalPrincipals.userRowCount}, found ${actual.historicalPrincipals.userRowCount})`,
    );
  } else if (expected.historicalPrincipals.staffProfileRowCount !== actual.historicalPrincipals.staffProfileRowCount) {
    drift.push(
      `historical editorial principal staff profiles (expected ${expected.historicalPrincipals.staffProfileRowCount}, found ${actual.historicalPrincipals.staffProfileRowCount})`,
    );
  } else if (expected.historicalPrincipals.digest !== actual.historicalPrincipals.digest) {
    drift.push(
      "historical editorial principals (stored address, role, status, credential class or staff profile)",
    );
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
