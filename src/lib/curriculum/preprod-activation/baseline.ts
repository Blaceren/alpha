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
 * The overlay's historical principals must not already exist.
 *
 * The overlay carries authorship and review evidence attributed to G2 historical
 * identities. On a first activation the structural import creates none of them,
 * so finding one means either a previous overlay run got partway through or
 * somebody provisioned an account with a reserved address. Both are states this
 * authorization has no basis to interpret, and re-running an overlay over the
 * first would attach fresh evidence to a half-built principal set.
 */
export function capturePrincipalPresence(
  absolutePath: string,
  emails: readonly string[],
): { present: string[]; absent: string[] } {
  if (emails.length === 0) return { present: [], absent: [] };
  const db = open(absolutePath);
  try {
    const present: string[] = [];
    const absent: string[] = [];
    const statement = db.prepare('SELECT COUNT(*) AS n FROM "User" WHERE lower("email") = lower(?)');
    for (const email of emails) {
      const row = statement.get(email) as { n: number } | undefined;
      if ((row?.n ?? 0) > 0) present.push(email);
      else absent.push(email);
    }
    return { present, absent };
  } finally {
    db.close();
  }
}

export function assertHistoricalPrincipalsAbsent(present: string[]): void {
  if (present.length === 0) return;
  throw new PreprodActivationError(
    "UNEXPECTED_HISTORICAL_PRINCIPAL",
    `the target already contains ${present.length} of the overlay's historical principal(s). A first activation imports into a target that has none; this database has been through a previous overlay run or has accounts on reserved addresses.`,
    { expected: "0 present", actual: `${present.length} present` },
  );
}
