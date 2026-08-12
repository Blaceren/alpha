/**
 * PHASE-G2 SUCCESSOR — audit-only proof that two curriculum versions carry the
 * SAME educational product.
 *
 * ============================== WHY IT EXISTS ==============================
 * `ata-v2@v3` is published and permanently unrepairable in place, so the fix is
 * a successor version built from the same source. The canonical
 * `contentFingerprint` covers `curriculumVersionNumber` — correctly, because the
 * version IS part of what a package declares — so v3 and v4 necessarily have
 * different fingerprints even when nothing educational changed. That difference
 * is expected, and it is also exactly what makes "nothing educational changed"
 * unprovable from fingerprints alone.
 *
 * This module closes that gap and nothing else. It takes the SAME canonical
 * projection the real fingerprint is taken over, removes exactly one key — the
 * intentional successor identity — and hashes the result with the SAME
 * serialiser. Two packages with the same digest therefore agree on every module,
 * level, ordering, stable code, completion contract, XP value, checkpoint, gate,
 * lesson body, asset, assessment question, answer key, pass percent, report
 * field and pending approval that the canonical projection covers.
 *
 * ========================== WHAT IT IS NOT ==========================
 * It is NOT a package fingerprint and must never be stored, compared or accepted
 * as one. A package's identity is `contentFingerprint`; the importer, the
 * package marker, the drift check and the activation manifest all use that and
 * only that. This digest is deliberately blind to the one field that separates a
 * predecessor from its successor, so treating it as an identity would let v4 be
 * imported where v3 was accepted. It answers one question — "is the educational
 * payload the same?" — for a human reviewing a successor release.
 *
 * Nothing in the runtime, the importer or the publication path calls it.
 */
import { createHash } from "node:crypto";
import {
  canonicalProjection,
  serializeCanonicalProjection,
  type CanonicalJson,
} from "@/lib/curriculum/package/fingerprint";
import type { CurriculumPackage } from "@/lib/curriculum/package/schema";

/**
 * The projection keys a successor release is ALLOWED to change.
 *
 * One key, listed once, so the exclusion can be read and argued with. Adding to
 * this list widens what a "semantically equivalent" successor may silently
 * differ in, which is a product decision and not a refactor — every other
 * difference between two packages must show up as a digest mismatch.
 */
export const SUCCESSOR_IDENTITY_KEYS = ["curriculumVersionNumber"] as const;

/** The canonical projection with the successor identity removed. */
export function semanticPayloadProjection(pkg: CurriculumPackage): CanonicalJson {
  const projection = canonicalProjection(pkg);
  if (projection === null || typeof projection !== "object" || Array.isArray(projection)) {
    throw new Error("canonical projection is not an object");
  }
  const payload: { [key: string]: CanonicalJson } = {};
  for (const [key, value] of Object.entries(projection)) {
    if ((SUCCESSOR_IDENTITY_KEYS as readonly string[]).includes(key)) continue;
    payload[key] = value;
  }
  return payload;
}

/**
 * sha256 of the educational payload, version identity excluded.
 *
 * Equal digests mean the two packages teach, test and grade identically. They do
 * NOT mean the packages are interchangeable — see the module note.
 */
export function calculateSemanticEquivalenceDigest(pkg: CurriculumPackage): string {
  return createHash("sha256")
    .update(serializeCanonicalProjection(semanticPayloadProjection(pkg)), "utf8")
    .digest("hex");
}

/**
 * The projection keys that carry RUNTIME OWNER CONFIGURATION rather than
 * educational content.
 *
 * Added by package revision 2: the level-3 report rubric and the 20 checkpoint
 * thresholds. They are semantic — they decide whether a level can be completed
 * and how much money a checkpoint asks for — so the real fingerprint covers
 * them, and two artifacts that differ here are correctly different artifacts.
 * What they are NOT is educational content: adding a mentor grading standard
 * does not change a lesson, a question, an answer key or a pass percent.
 *
 * `docs/CURRICULUM_SUCCESSOR_ARTIFACT.md` claims v3 and v4 teach identically,
 * and that claim must survive the revision that makes v4 completable. Without
 * this second digest the only available proof would be the successor digest,
 * which now legitimately differs — so "nothing educational changed" would once
 * again be an assertion rather than a computation.
 */
export const RUNTIME_OWNER_KEYS = ["packageRevision", "report.rubric", "gate.requirement"] as const;

/**
 * The canonical projection with version identity, package revision and the
 * runtime owner configuration removed.
 *
 * Owner keys are stripped AT THEIR EXACT POSITIONS — `report.rubric` and
 * `gate.requirement` under a level — rather than by deleting every key with
 * those names wherever it appears. A blanket name filter would silently start
 * excluding an unrelated future field that happened to be called `requirement`,
 * which is how a digest quietly stops covering something.
 */
export function educationalPayloadProjection(pkg: CurriculumPackage): CanonicalJson {
  const payload = semanticPayloadProjection(pkg);
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("semantic payload projection is not an object");
  }
  const record = { ...(payload as Record<string, CanonicalJson>) };
  delete record.packageRevision;

  const modules = record.modules;
  if (!Array.isArray(modules)) throw new Error("canonical projection has no modules array");
  record.modules = modules.map((moduleValue) => {
    if (moduleValue === null || typeof moduleValue !== "object" || Array.isArray(moduleValue)) return moduleValue;
    const moduleRecord = { ...(moduleValue as Record<string, CanonicalJson>) };
    const levels = moduleRecord.levels;
    if (!Array.isArray(levels)) return moduleRecord;
    moduleRecord.levels = levels.map((levelValue) => {
      if (levelValue === null || typeof levelValue !== "object" || Array.isArray(levelValue)) return levelValue;
      const levelRecord = { ...(levelValue as Record<string, CanonicalJson>) };
      levelRecord.report = withoutKey(levelRecord.report, "rubric");
      levelRecord.gate = withoutKey(levelRecord.gate, "requirement");
      return levelRecord;
    });
    return moduleRecord;
  });
  return record;
}

function withoutKey(value: CanonicalJson, key: string): CanonicalJson {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, CanonicalJson>) };
  delete record[key];
  return record;
}

/**
 * sha256 of the EDUCATIONAL payload alone.
 *
 * Equal digests mean the two packages teach, test and grade identically even if
 * one of them carries progression-owner configuration the other could not
 * express. Like the successor digest it is audit-only and is never an identity.
 */
export function calculateEducationalPayloadDigest(pkg: CurriculumPackage): string {
  return createHash("sha256")
    .update(serializeCanonicalProjection(educationalPayloadProjection(pkg)), "utf8")
    .digest("hex");
}

export type SemanticDifference = {
  /** Dotted path into the canonical projection, e.g. `modules[2].levels[7].xpReward`. */
  path: string;
  left: CanonicalJson;
  right: CanonicalJson;
};

/**
 * Every place two packages' educational payloads disagree.
 *
 * The digest answers yes/no; this answers "where", so a failed equivalence check
 * names the level and field instead of two hex strings. Version identity is
 * excluded here too, so a clean successor returns an empty list.
 */
export function diffSemanticPayload(
  left: CurriculumPackage,
  right: CurriculumPackage,
  limit = 200,
): SemanticDifference[] {
  const differences: SemanticDifference[] = [];
  walk(semanticPayloadProjection(left), semanticPayloadProjection(right), "", differences, limit);
  return differences;
}

function walk(
  left: CanonicalJson,
  right: CanonicalJson,
  path: string,
  out: SemanticDifference[],
  limit: number,
): void {
  if (out.length >= limit) return;
  const leftIsObject = left !== null && typeof left === "object" && !Array.isArray(left);
  const rightIsObject = right !== null && typeof right === "object" && !Array.isArray(right);

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      out.push({ path: `${path}.length`, left: left.length, right: right.length });
      return;
    }
    for (let index = 0; index < left.length; index += 1) {
      walk(left[index], right[index], `${path}[${index}]`, out, limit);
    }
    return;
  }

  if (leftIsObject && rightIsObject) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
    for (const key of keys) {
      const child = path ? `${path}.${key}` : key;
      const leftHas = Object.hasOwn(left, key);
      const rightHas = Object.hasOwn(right, key);
      if (!leftHas || !rightHas) {
        out.push({
          path: child,
          left: leftHas ? (left as Record<string, CanonicalJson>)[key] : null,
          right: rightHas ? (right as Record<string, CanonicalJson>)[key] : null,
        });
        continue;
      }
      walk(
        (left as Record<string, CanonicalJson>)[key],
        (right as Record<string, CanonicalJson>)[key],
        child,
        out,
        limit,
      );
    }
    return;
  }

  if (serializeCanonicalProjection(left) !== serializeCanonicalProjection(right)) {
    out.push({ path: path || "<root>", left, right });
  }
}
