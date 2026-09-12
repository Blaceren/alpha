/**
 * PREPROD ACTIVATION AUTHORIZATION — what the database already contains.
 *
 * Three separate questions, asked at two different boundaries.
 *
 * BEFORE THE STRUCTURAL IMPORT the question is "is this the PREPROD I reviewed".
 * A curriculum that appeared, a binding that moved, a version that was published
 * by somebody else — any of these means the plan was written against a different
 * database than the one in front of us. `captureCurriculumStartingState` reduces
 * that to one fingerprint so a drifted environment is a single comparison rather
 * than a dozen ad-hoc assertions that each have to be remembered.
 *
 * BEFORE THE OVERLAY the question is narrower and sharper: "does the freshly
 * imported target contain ONLY what the structural import put there". This is
 * the activation-side mitigation for two MEDIUM findings the accepted transport
 * audit carried, and it is the reason this module exists at all rather than the
 * overlay importer being trusted to notice:
 *
 *   M-1  SourceAuthorityResolution lookup is slot-based, so an unexpected or
 *        tampered pre-existing SAR row can coexist with the rows the overlay
 *        writes instead of colliding with them. On a clean structural-import
 *        target there should be none, so "none" is asserted rather than assumed.
 *
 *   M-2  review-note identity has an axis the importer does not range over, so a
 *        tampered note can read as an absent one. Same remedy: the expected
 *        baseline on a fresh target is zero, and zero is checked.
 *
 * In both cases the overlay must not be allowed to "heal" state it did not
 * create. An unexpected row is a fact this import has no authority to absorb.
 *
 * M-3 IS HANDLED ELSEWHERE — in `manifest.ts` and `authorize.ts` — because it is
 * about the artifact's self-description rather than the database's contents.
 *
 * EVERYTHING HERE IS READ-ONLY. The connection is opened `readOnly: true`, which
 * is also why these checks can run BEFORE the protected-database guard has been
 * satisfied: reading a database is not the thing the guard exists to prevent.
 */
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { PreprodActivationError } from "./errors";
import { canonicalPrincipalIdentity, resolvePrincipalRowSets } from "./semantic-state";

export type CurriculumVersionIdentity = {
  code: string;
  versionNumber: number;
  status: string;
};

export type CurriculumStartingState = {
  /** Every curriculum version, ordered, as semantic identities. */
  versions: CurriculumVersionIdentity[];
  /** `code@vN` of the single published version, or null when none is published. */
  publishedIdentity: string | null;
  levelDefinitionCount: number;
  moduleDefinitionCount: number;
  levelResourceBindingCount: number;
  contentVersionCount: number;
  assessmentVersionCount: number;
  /** One digest over all of the above. */
  fingerprint: string;
};

export type EditorialBaseline = {
  /** Resolved id of the target curriculum version, or null when it is absent. */
  curriculumVersionId: number | null;
  sourceAuthorityResolutionCount: number;
  editorialReviewNoteCount: number;
  videoProductionVersionCount: number;
  videoProductionAssessmentLinkCount: number;
  approvedContentVersionCount: number;
  approvedAssessmentVersionCount: number;
};

function open(absolutePath: string): DatabaseSync {
  try {
    return new DatabaseSync(absolutePath, { readOnly: true });
  } catch (error) {
    throw new PreprodActivationError(
      "TARGET_UNREADABLE",
      `cannot read curriculum state from ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function count(db: DatabaseSync, sql: string, params: Array<string | number> = []): number {
  const row = db.prepare(sql).get(...params) as { n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * Reduce the whole pre-activation curriculum surface to one comparable value.
 *
 * SEMANTIC KEYS, NOT ROW IDS. Everything recorded here is addressed by
 * `code@vN`, never by autoincrement id: ids are an artifact of insertion order
 * and would make a fingerprint that changes for reasons nobody cares about while
 * staying equal for some that they do.
 */
export function captureCurriculumStartingState(absolutePath: string): CurriculumStartingState {
  const db = open(absolutePath);
  try {
    const versions = (
      db
        .prepare(
          'SELECT "code" AS code, "versionNumber" AS versionNumber, "status" AS status FROM "CurriculumVersion" ORDER BY "code", "versionNumber"',
        )
        .all() as Array<{ code: string; versionNumber: number; status: string }>
    ).map((row) => ({ code: row.code, versionNumber: row.versionNumber, status: row.status }));

    const published = versions.filter((version) => version.status === "published");
    const publishedIdentity =
      published.length === 1 ? `${published[0].code}@v${published[0].versionNumber}` : null;

    const state: Omit<CurriculumStartingState, "fingerprint"> = {
      versions,
      publishedIdentity,
      levelDefinitionCount: count(db, 'SELECT COUNT(*) AS n FROM "LevelDefinition"'),
      moduleDefinitionCount: count(db, 'SELECT COUNT(*) AS n FROM "ModuleDefinition"'),
      levelResourceBindingCount: count(db, 'SELECT COUNT(*) AS n FROM "LevelResourceBinding"'),
      contentVersionCount: count(db, 'SELECT COUNT(*) AS n FROM "ContentVersion"'),
      assessmentVersionCount: count(db, 'SELECT COUNT(*) AS n FROM "AssessmentVersion"'),
    };

    return { ...state, fingerprint: fingerprintStartingState(state) };
  } finally {
    db.close();
  }
}

export function fingerprintStartingState(
  state: Omit<CurriculumStartingState, "fingerprint">,
): string {
  const canonical = JSON.stringify({
    versions: state.versions.map((v) => `${v.code}@v${v.versionNumber}:${v.status}`),
    publishedIdentity: state.publishedIdentity,
    levelDefinitionCount: state.levelDefinitionCount,
    moduleDefinitionCount: state.moduleDefinitionCount,
    levelResourceBindingCount: state.levelResourceBindingCount,
    contentVersionCount: state.contentVersionCount,
    assessmentVersionCount: state.assessmentVersionCount,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function assertStartingStateMatches(expected: string, actual: CurriculumStartingState): void {
  if (expected === actual.fingerprint) return;
  throw new PreprodActivationError(
    "CURRICULUM_STARTING_STATE_MISMATCH",
    `the curriculum starting state is not the one this manifest was reviewed against (now: ${actual.versions.length} version(s), published=${actual.publishedIdentity ?? "none"}, bindings=${actual.levelResourceBindingCount}). Something changed PREPROD since preparation.`,
    { expected, actual: actual.fingerprint },
  );
}

/**
 * Refuse a target that already contains the curriculum the structural import is
 * about to create.
 *
 * A second copy is not an idempotent no-op here: the package importer would be
 * writing into a version somebody else made, and the overlay would then attach
 * reviewed evidence to rows this activation never transported.
 */
export function assertTargetCurriculumAbsent(
  state: CurriculumStartingState,
  target: { code: string; versionNumber: number },
): void {
  const existing = state.versions.find(
    (version) => version.code === target.code && version.versionNumber === target.versionNumber,
  );
  if (!existing) return;
  throw new PreprodActivationError(
    "CURRICULUM_STARTING_STATE_MISMATCH",
    `the structural import target ${target.code}@v${target.versionNumber} already exists in this database with status ${existing.status}. A first activation must import into an absent target.`,
    { expected: "absent", actual: existing.status },
  );
}

/**
 * Count the editorial surface attached to one curriculum version.
 *
 * Scoped to the TARGET curriculum on purpose. Pre-existing editorial state on
 * some other, unrelated curriculum is not this activation's business; state on
 * the version the overlay is about to write to very much is.
 */
export function captureEditorialBaseline(
  absolutePath: string,
  target: { code: string; versionNumber: number },
): EditorialBaseline {
  const db = open(absolutePath);
  try {
    const version = db
      .prepare(
        'SELECT "id" AS id FROM "CurriculumVersion" WHERE "code" = ? AND "versionNumber" = ?',
      )
      .get(target.code, target.versionNumber) as { id: number } | undefined;

    if (!version) {
      return {
        curriculumVersionId: null,
        sourceAuthorityResolutionCount: 0,
        editorialReviewNoteCount: 0,
        videoProductionVersionCount: 0,
        videoProductionAssessmentLinkCount: 0,
        approvedContentVersionCount: 0,
        approvedAssessmentVersionCount: 0,
      };
    }

    const id = version.id;
    return {
      curriculumVersionId: id,
      sourceAuthorityResolutionCount: count(
        db,
        'SELECT COUNT(*) AS n FROM "SourceAuthorityResolution" WHERE "curriculumVersionId" = ?',
        [id],
      ),
      // Notes hang off content, assessment or video rows rather than off the
      // curriculum directly, so the scope is expressed through those.
      editorialReviewNoteCount: count(
        db,
        `SELECT COUNT(*) AS n FROM "EditorialReviewNote" n
         WHERE n."contentVersionId" IN (
                 SELECT cv."id" FROM "ContentVersion" cv
                 JOIN "LevelDefinition" ld ON ld."id" = cv."levelDefinitionId"
                 WHERE ld."curriculumVersionId" = ?)
            OR n."assessmentVersionId" IN (
                 SELECT av."id" FROM "AssessmentVersion" av
                 JOIN "LevelDefinition" ld ON ld."id" = av."levelDefinitionId"
                 WHERE ld."curriculumVersionId" = ?)
            OR n."videoProductionVersionId" IN (
                 SELECT vp."id" FROM "VideoProductionVersion" vp
                 WHERE vp."curriculumVersionId" = ?)`,
        [id, id, id],
      ),
      videoProductionVersionCount: count(
        db,
        'SELECT COUNT(*) AS n FROM "VideoProductionVersion" WHERE "curriculumVersionId" = ?',
        [id],
      ),
      videoProductionAssessmentLinkCount: count(
        db,
        `SELECT COUNT(*) AS n FROM "VideoProductionAssessmentLink" l
         WHERE l."videoProductionVersionId" IN (
           SELECT vp."id" FROM "VideoProductionVersion" vp WHERE vp."curriculumVersionId" = ?)`,
        [id],
      ),
      approvedContentVersionCount: count(
        db,
        `SELECT COUNT(*) AS n FROM "ContentVersion" cv
         JOIN "LevelDefinition" ld ON ld."id" = cv."levelDefinitionId"
         WHERE ld."curriculumVersionId" = ? AND cv."editorialState" = 'approved'`,
        [id],
      ),
      approvedAssessmentVersionCount: count(
        db,
        `SELECT COUNT(*) AS n FROM "AssessmentVersion" av
         JOIN "LevelDefinition" ld ON ld."id" = av."levelDefinitionId"
         WHERE ld."curriculumVersionId" = ? AND av."editorialState" = 'approved'`,
        [id],
      ),
    };
  } finally {
    db.close();
  }
}

/**
 * Every field must equal the reviewed expectation exactly.
 *
 * Not "at most", not "at least". An overlay is authorized against a specific
 * target shape, and both directions of surprise matter: extra rows mean
 * something wrote to the target, missing rows mean the structural import did not
 * produce what the plan assumed.
 */
export function assertEditorialBaselineMatches(
  expected: EditorialBaseline,
  actual: EditorialBaseline,
): void {
  if (expected.sourceAuthorityResolutionCount !== actual.sourceAuthorityResolutionCount) {
    throw new PreprodActivationError(
      "UNEXPECTED_SOURCE_AUTHORITY",
      `the structural-import target carries ${actual.sourceAuthorityResolutionCount} SourceAuthorityResolution row(s) where the reviewed baseline is ${expected.sourceAuthorityResolutionCount}. Overlay import is refused: slot-addressed authority rows this activation did not create must not be absorbed by it.`,
      {
        expected: String(expected.sourceAuthorityResolutionCount),
        actual: String(actual.sourceAuthorityResolutionCount),
      },
    );
  }
  if (expected.editorialReviewNoteCount !== actual.editorialReviewNoteCount) {
    throw new PreprodActivationError(
      "UNEXPECTED_REVIEW_NOTE",
      `the structural-import target carries ${actual.editorialReviewNoteCount} EditorialReviewNote row(s) where the reviewed baseline is ${expected.editorialReviewNoteCount}. Overlay import is refused: note identity has an axis the importer does not range over, so an unexpected note cannot be told from an absent one.`,
      {
        expected: String(expected.editorialReviewNoteCount),
        actual: String(actual.editorialReviewNoteCount),
      },
    );
  }
  const others: Array<[keyof EditorialBaseline, string]> = [
    ["videoProductionVersionCount", "VideoProductionVersion"],
    ["videoProductionAssessmentLinkCount", "VideoProductionAssessmentLink"],
    ["approvedContentVersionCount", "approved ContentVersion"],
    ["approvedAssessmentVersionCount", "approved AssessmentVersion"],
  ];
  for (const [key, label] of others) {
    if (expected[key] !== actual[key]) {
      throw new PreprodActivationError(
        "UNEXPECTED_EDITORIAL_STATE",
        `the structural-import target carries ${String(actual[key])} ${label} row(s) where the reviewed baseline is ${String(expected[key])}. The target must contain only what the structural package produced.`,
        { expected: String(expected[key]), actual: String(actual[key]) },
      );
    }
  }
}

/**
 * Where each of the overlay's historical principals stands on the target.
 *
 * The overlay carries authorship and review evidence attributed to G2 historical
 * identities. On a FIRST activation the structural import creates none of them,
 * so this used to require absence outright.
 *
 * CORRECTION-5. That is right for a first activation and wrong for a successor.
 * `User` and `StaffProfile` carry no `curriculumVersionId`: a historical
 * principal is an ENVIRONMENT identity, not a curriculum-version-owned row, and
 * `User.email` is unique — so publishing a successor curriculum into an
 * environment a previous overlay has already provisioned MUST reuse the same
 * identity rather than mint a second account. Requiring absence made every
 * successor overlay permanently unauthorizable, while the importer had always
 * handled the case correctly.
 *
 * So absence is no longer the question. The question is which of three states
 * each declared principal is in, and the answer is fail-closed: anything that is
 * not "absent and creatable" or "present and exactly compatible" is refused.
 *
 * THE PREDICATE IS THE IMPORTER'S, NOT A SECOND OPINION. `editorial-overlay/
 * import.ts` already decides compatibility on `role`, the `StaffProfile`'s
 * `staffRole`, and — for a `process` identity — that the account cannot log in.
 * Re-deriving those rules here would be a second equivalence rule that could
 * drift from the first, which is the defect CORRECTION-3 closed for identity
 * folding. They are restated in one place, with the same fields and the same
 * refusal reasons, and `curriculum-overlay-principal-reuse` pins that the two
 * agree case by case.
 */
export function capturePrincipalPresence(
  absolutePath: string,
  emails: readonly string[],
): { present: string[]; absent: string[]; rowCountByIdentity: Record<string, number> } {
  if (emails.length === 0) return { present: [], absent: [], rowCountByIdentity: {} };
  const db = open(absolutePath);
  try {
    // CORRECTION-3: membership comes from `resolvePrincipalRowSets`, the same
    // decision the fence and the principal projection use. This function used to
    // ask SQL `lower("email") = lower(?)`, which is a THIRD equivalence rule —
    // ASCII-only folding, where the artifact contract and the fingerprint both
    // use the JavaScript rule. One rule, one place, no drift.
    const sets = resolvePrincipalRowSets(db, emails);
    const present: string[] = [];
    const absent: string[] = [];
    const rowCountByIdentity: Record<string, number> = {};
    for (const identity of sets.identities) {
      const count = (sets.userIdsByIdentity.get(identity) ?? []).length;
      rowCountByIdentity[identity] = count;
      if (count > 0) present.push(identity);
      else absent.push(identity);
    }
    return { present, absent, rowCountByIdentity };
  } finally {
    db.close();
  }
}

/** What an overlay declares about one historical principal. */
export type HistoricalPrincipalDeclaration = {
  readonly ref: string;
  readonly kind: "process" | "human";
  readonly role: string;
  readonly staffRole: string | null;
  readonly provisionIfMissing: boolean;
};

/**
 * `CREATE` the overlay may mint it · `REUSE_EXACT` an identical identity already
 * exists · `REFUSE_CONFLICT` anything else. There is no fourth answer, and no
 * answer repairs the target.
 */
export type HistoricalPrincipalDisposition = "CREATE" | "REUSE_EXACT" | "REFUSE_CONFLICT";

export type HistoricalPrincipalClassification = {
  readonly ref: string;
  readonly identity: string;
  readonly disposition: HistoricalPrincipalDisposition;
  /** The row a `REUSE_EXACT` will bind to, or the single row a conflict is about. */
  readonly matchedUserId: number | null;
  readonly rowCount: number;
  readonly conflicts: readonly string[];
};

export function classifyHistoricalPrincipals(
  absolutePath: string,
  declared: readonly HistoricalPrincipalDeclaration[],
): HistoricalPrincipalClassification[] {
  if (declared.length === 0) return [];
  const db = open(absolutePath);
  try {
    const sets = resolvePrincipalRowSets(
      db,
      declared.map((principal) => principal.ref),
    );
    const out: HistoricalPrincipalClassification[] = [];

    for (const principal of declared) {
      const identity = canonicalPrincipalIdentity(principal.ref);
      const userIds = sets.userIdsByIdentity.get(identity) ?? [];
      const base = { ref: principal.ref, identity, rowCount: userIds.length };

      if (userIds.length === 0) {
        // Absent. Creatable only if the ARTIFACT says so; the run-time
        // `--allow-principal-provisioning` switch is the importer's to check.
        out.push(
          principal.provisionIfMissing
            ? { ...base, disposition: "CREATE", matchedUserId: null, conflicts: [] }
            : {
                ...base,
                disposition: "REFUSE_CONFLICT",
                matchedUserId: null,
                conflicts: ["principal is absent and this overlay does not permit provisioning it"],
              },
        );
        continue;
      }

      if (userIds.length > 1) {
        // AMBIGUITY IS A REFUSAL, NOT A CHOICE. `User.email` is unique only
        // case-sensitively, so one canonical identity can hold several rows.
        // Picking one would be guessing which account authored 78 reviews.
        out.push({
          ...base,
          disposition: "REFUSE_CONFLICT",
          matchedUserId: null,
          conflicts: [
            `${userIds.length} accounts share this canonical identity (ids ${userIds.join(", ")}); the principal a reviewed approval belongs to cannot be guessed`,
          ],
        });
        continue;
      }

      const [userId] = userIds;
      const row = db
        .prepare('SELECT "role" AS role, "status" AS status FROM "User" WHERE "id" = ?')
        .get(userId) as { role?: unknown; status?: unknown } | undefined;
      const staff = db
        .prepare('SELECT "staffRole" AS staffRole FROM "StaffProfile" WHERE "userId" = ?')
        .all(userId) as Array<{ staffRole?: unknown }>;

      const conflicts: string[] = [];
      const targetRole = typeof row?.role === "string" ? row.role : null;
      const targetStatus = typeof row?.status === "string" ? row.status : null;

      if (staff.length > 1) {
        conflicts.push(`the account holds ${staff.length} StaffProfile rows; exactly one is expected`);
      }
      const targetStaffRole = staff.length === 1 && typeof staff[0].staffRole === "string" ? staff[0].staffRole : null;

      // The importer's three rules, restated. Address equality is not identity
      // equality: an account that reuses the address with a different role is a
      // DIFFERENT principal, and binding a reviewer's approvals to it is exactly
      // the misattribution the design exists to prevent.
      if (targetStaffRole !== principal.staffRole) {
        conflicts.push(`staffRole ${targetStaffRole ?? "<none>"} != ${principal.staffRole ?? "<none>"}`);
      }
      if (targetRole !== principal.role) {
        conflicts.push(`role ${targetRole ?? "<none>"} != ${principal.role}`);
      }
      // A historical PROCESS identity names a role in a review that must never
      // be able to act. An account at the same address that can still log in is
      // a different thing entirely — very possibly a real person. Refuse; never
      // demote the account to make it fit.
      if (principal.kind === "process" && targetStatus !== "blocked") {
        conflicts.push(
          `target account is ${targetStatus ?? "<unknown>"} and therefore loginable, but the overlay declares a non-loginable historical process identity`,
        );
      }

      out.push({
        ...base,
        disposition: conflicts.length === 0 ? "REUSE_EXACT" : "REFUSE_CONFLICT",
        matchedUserId: userId,
        conflicts,
      });
    }
    return out;
  } finally {
    db.close();
  }
}

/**
 * Refuse the activation if any declared principal is in a state this
 * authorization has no basis to interpret.
 *
 * The error code is unchanged on purpose. `UNEXPECTED_HISTORICAL_PRINCIPAL` still
 * means "the target's principal state is not what the reviewed overlay
 * describes" — what changed is that an exactly compatible existing identity is
 * no longer one of those states.
 */
export function assertHistoricalPrincipalsAuthorized(
  classifications: readonly HistoricalPrincipalClassification[],
): void {
  const refused = classifications.filter((entry) => entry.disposition === "REFUSE_CONFLICT");
  if (refused.length === 0) return;
  const detail = refused
    .map((entry) => `${entry.identity} (${entry.rowCount} row(s): ${entry.conflicts.join("; ")})`)
    .join(", ");
  throw new PreprodActivationError(
    "UNEXPECTED_HISTORICAL_PRINCIPAL",
    `${refused.length} of the overlay's historical principal(s) are in a state this activation cannot interpret: ${detail}. An exactly compatible existing identity is reused; anything else is refused rather than repaired.`,
    {
      expected: "each declared principal absent-and-creatable, or present-and-exactly-compatible",
      actual: `${refused.length} in conflict`,
    },
  );
}
