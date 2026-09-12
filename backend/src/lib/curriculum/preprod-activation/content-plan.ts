/**
 * PREPROD ACTIVATION AUTHORIZATION — the content activation plan.
 *
 * WHAT THIS IS. After the overlay has been imported, every level carries a
 * reviewed content version that is not yet published. Publishing them is a later
 * stage with its own authorization, and it is IRREVERSIBLE: publishing archives
 * the previous row and moves the level's binding forward atomically, and there
 * is no unpublish. So the sequence is written down and reviewed in advance,
 * one row per level, addressed semantically.
 *
 * WHY IT IS RECOMPUTED RATHER THAN READ. The independent audit found that a
 * plan row could be given a wrong stable code, a wrong version, a wrong mode, or
 * be removed or duplicated outright, and the activation still authorized —
 * because the manifest's digest was pinned and nothing ever checked the plan
 * against reality. A pinned digest proves the file has not changed since it was
 * reviewed; it proves nothing about whether the file was RIGHT.
 *
 * So the plan is derived here from the rehearsed post-overlay database, and
 * `assertContentActivationPlanMatches` compares the manifest's copy against a
 * fresh derivation, row for row, in both directions. A plan that does not
 * describe the target the activation actually produced is refused before the
 * first mutation, not discovered during the publication that cannot be undone.
 *
 * COUNTS ARE DERIVED, NEVER STORED SEPARATELY. The previous schema carried
 * `publishInPlaceCount` and `publishAndMoveBindingCount` next to the rows, which
 * meant a manifest could disagree with itself. They are computed from the rows
 * now, so there is nothing to disagree with.
 */
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { PreprodActivationError } from "./errors";

export const CONTENT_ACTIVATION_MODES = ["PUBLISH_IN_PLACE", "PUBLISH_AND_MOVE_BINDING"] as const;
export type ContentActivationMode = (typeof CONTENT_ACTIVATION_MODES)[number];

export type ContentActivationRow = {
  /** The level, by its stable code. Never a database id. */
  levelStableCode: string;
  levelNumber: number;
  /** The reviewed version this plan will publish. */
  acceptedContentVersionNumber: number;
  /** What the reviewed version's status must be before publication. */
  expectedPreContentStatus: string;
  /** `level@vN` currently bound to the level, or null when nothing is bound. */
  expectedPreBindingIdentity: string | null;
  action: ContentActivationMode;
  /** `level@vN` the binding must name once this row has been published. */
  expectedPostBindingIdentity: string;
};

export type ContentActivationPlan = {
  rows: ContentActivationRow[];
  fingerprint: string;
};

/** Counts are a VIEW of the rows. They are never stored, so they cannot disagree. */
export function summarizeContentActivationPlan(rows: readonly ContentActivationRow[]): {
  total: number;
  publishInPlace: number;
  publishAndMoveBinding: number;
} {
  return {
    total: rows.length,
    publishInPlace: rows.filter((row) => row.action === "PUBLISH_IN_PLACE").length,
    publishAndMoveBinding: rows.filter((row) => row.action === "PUBLISH_AND_MOVE_BINDING").length,
  };
}

function rowLine(row: ContentActivationRow): string {
  return [
    row.levelStableCode,
    String(row.levelNumber),
    String(row.acceptedContentVersionNumber),
    row.expectedPreContentStatus,
    row.expectedPreBindingIdentity ?? "(none)",
    row.action,
    row.expectedPostBindingIdentity,
  ].join("\u0000");
}

export function fingerprintContentActivationPlan(rows: readonly ContentActivationRow[]): string {
  const lines = rows.map(rowLine);
  lines.sort();
  return crypto.createHash("sha256").update(lines.join("\u0001")).digest("hex");
}

/** Canonical order: by level number, then stable code. Deterministic for review. */
export function sortContentActivationRows(rows: readonly ContentActivationRow[]): ContentActivationRow[] {
  return [...rows].sort((left, right) =>
    left.levelNumber === right.levelNumber
      ? left.levelStableCode.localeCompare(right.levelStableCode)
      : left.levelNumber - right.levelNumber,
  );
}

/**
 * Derive the plan from a database that has had the overlay applied.
 *
 * One row per level that carries an approved content version. The accepted
 * version is the highest-numbered approved one; whether publishing it moves the
 * binding follows from whether that version is the one currently bound, which is
 * a fact about the database rather than a mode somebody chose.
 */
export function deriveContentActivationPlan(
  absolutePath: string,
  target: { code: string; versionNumber: number },
): ContentActivationPlan {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(absolutePath, { readOnly: true });
  } catch (error) {
    throw new PreprodActivationError(
      "TARGET_UNREADABLE",
      `cannot derive the content activation plan from ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const rows = db
      .prepare(
        `SELECT l."stableCode"     AS levelStableCode,
                l."levelNumber"    AS levelNumber,
                cv."versionNumber" AS acceptedContentVersionNumber,
                cv."status"        AS expectedPreContentStatus,
                (SELECT b_cv."versionNumber"
                   FROM "LevelResourceBinding" b
                   JOIN "ContentVersion" b_cv ON b_cv."id" = b."contentVersionId"
                  WHERE b."levelDefinitionId" = l."id") AS boundVersionNumber
           FROM "ContentVersion" cv
           JOIN "LevelDefinition" l   ON l."id"  = cv."levelDefinitionId"
           JOIN "CurriculumVersion" c ON c."id"  = cv."curriculumVersionId"
          WHERE c."code" = ? AND c."versionNumber" = ?
            AND cv."editorialState" = 'approved'
            AND cv."versionNumber" = (
                  SELECT MAX(inner_cv."versionNumber")
                    FROM "ContentVersion" inner_cv
                   WHERE inner_cv."levelDefinitionId" = cv."levelDefinitionId"
                     AND inner_cv."editorialState" = 'approved')`,
      )
      .all(target.code, target.versionNumber) as Array<{
      levelStableCode: string;
      levelNumber: number;
      acceptedContentVersionNumber: number;
      expectedPreContentStatus: string;
      boundVersionNumber: number | null;
    }>;

    const plan = sortContentActivationRows(
      rows.map((row) => {
        const accepted = `${row.levelStableCode}@v${row.acceptedContentVersionNumber}`;
        const bound =
          row.boundVersionNumber === null || row.boundVersionNumber === undefined
            ? null
            : `${row.levelStableCode}@v${row.boundVersionNumber}`;
        return {
          levelStableCode: row.levelStableCode,
          levelNumber: row.levelNumber,
          acceptedContentVersionNumber: row.acceptedContentVersionNumber,
          expectedPreContentStatus: row.expectedPreContentStatus,
          expectedPreBindingIdentity: bound,
          action: bound === accepted ? ("PUBLISH_IN_PLACE" as const) : ("PUBLISH_AND_MOVE_BINDING" as const),
          expectedPostBindingIdentity: accepted,
        };
      }),
    );

    return { rows: plan, fingerprint: fingerprintContentActivationPlan(plan) };
  } finally {
    db.close();
  }
}

/**
 * Compare the manifest's plan against a fresh derivation, both ways.
 *
 * Every failure mode the audit demonstrated is a difference this function sees:
 * a wrong stable code or level number produces a row the derivation does not
 * have AND a missing row it does; a wrong version, mode, pre-state or binding
 * expectation produces a field mismatch on a row present in both; a removed row
 * is missing; an extra or duplicated row is unmatched.
 */
export function assertContentActivationPlanMatches(
  declared: readonly ContentActivationRow[],
  derived: readonly ContentActivationRow[],
): void {
  const key = (row: ContentActivationRow): string => `${row.levelStableCode}@v${row.acceptedContentVersionNumber}`;

  const seen = new Set<string>();
  for (const row of declared) {
    const id = key(row);
    if (seen.has(id)) {
      throw new PreprodActivationError(
        "CONTENT_PLAN_MISMATCH",
        `the content activation plan lists ${id} more than once. Each level's accepted content version is published exactly once.`,
        { expected: "one row per accepted content version", actual: `duplicate ${id}` },
      );
    }
    seen.add(id);
  }

  const derivedByKey = new Map(derived.map((row) => [key(row), row]));
  const declaredByKey = new Map(declared.map((row) => [key(row), row]));

  const extra = declared.filter((row) => !derivedByKey.has(key(row))).map(key);
  if (extra.length > 0) {
    throw new PreprodActivationError(
      "CONTENT_PLAN_MISMATCH",
      `the content activation plan names ${extra.length} content version(s) the transported curriculum does not contain: ${extra.slice(0, 5).join(", ")}. Every row must correspond to a real approved content candidate.`,
      { expected: "rows derived from the target", actual: extra.slice(0, 5).join(", ") },
    );
  }

  const missing = derived.filter((row) => !declaredByKey.has(key(row))).map(key);
  if (missing.length > 0) {
    throw new PreprodActivationError(
      "CONTENT_PLAN_MISMATCH",
      `the content activation plan omits ${missing.length} approved content version(s) the transported curriculum does contain: ${missing.slice(0, 5).join(", ")}. A publication sequence with a hole in it is not reviewable.`,
      { expected: missing.slice(0, 5).join(", "), actual: "absent from the plan" },
    );
  }

  for (const row of declared) {
    const expected = derivedByKey.get(key(row));
    if (!expected) continue; // already reported above
    const fields: Array<[keyof ContentActivationRow, string]> = [
      ["levelNumber", "level number"],
      ["expectedPreContentStatus", "expected pre-publication content status"],
      ["expectedPreBindingIdentity", "expected pre-publication binding"],
      ["action", "activation mode"],
      ["expectedPostBindingIdentity", "expected post-publication binding"],
    ];
    for (const [field, label] of fields) {
      if (row[field] !== expected[field]) {
        throw new PreprodActivationError(
          "CONTENT_PLAN_MISMATCH",
          `the content activation plan states the wrong ${label} for ${key(row)}. This plan drives an irreversible publication sequence and is checked against the transported target, not taken on trust.`,
          { expected: String(expected[field]), actual: String(row[field]) },
        );
      }
    }
  }

  const declaredFingerprint = fingerprintContentActivationPlan(declared);
  const derivedFingerprint = fingerprintContentActivationPlan(derived);
  if (declaredFingerprint !== derivedFingerprint) {
    throw new PreprodActivationError(
      "CONTENT_PLAN_MISMATCH",
      "the content activation plan does not fingerprint to the plan derived from the transported target",
      { expected: derivedFingerprint, actual: declaredFingerprint },
    );
  }
}
