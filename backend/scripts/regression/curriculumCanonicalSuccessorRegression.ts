/**
 * PHASE-G2 SUCCESSOR ARTIFACT regression.
 *
 * `ata-v2@v3` is published with 58 unbound assessment banks and cannot be
 * repaired in place, so the repair is a SUCCESSOR curriculum version. That made
 * one thing load-bearing that had never been exercised: the canonical builder
 * must be able to produce an artifact for an explicitly chosen curriculum
 * version, deterministically, from source alone — while the importer keeps sole
 * authority over nothing but what the artifact declares.
 *
 *   PART A  the builder's version contract: explicit, validated, defaulted to
 *           the retained v3, and never read from a database, a clock or an
 *           environment variable.
 *   PART B  v3 and v4 are the SAME educational product: identical semantic
 *           payload digest, different canonical fingerprints, and exactly two
 *           differing fields in the whole artifact.
 *   PART C  the importer cannot be talked out of the declared version, and a v4
 *           import beside a published v3 creates a distinct draft successor with
 *           the corrected bindings while leaving v3 untouched.
 *   PART D  a package-only successor still CANNOT be published, and the v3 -> v4
 *           lineage is representable on the existing schema.
 *
 * PART A and PART B touch no database. PART C and PART D build a throwaway
 * SQLite fixture with the shipped migration runner. No live database, no live
 * environment file, no network, no HTTP route.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { calculateFingerprint } from "@/lib/curriculum/package/fingerprint";
import {
  calculateSemanticEquivalenceDigest,
  diffSemanticPayload,
  SUCCESSOR_IDENTITY_KEYS,
} from "@/lib/curriculum/package/successor-equivalence";
import { validateCurriculumPackage } from "@/lib/curriculum/package/validate";
import { validateAtaProduct100Package } from "@/lib/curriculum/package/ata-profile";
import type { CurriculumPackage } from "@/lib/curriculum/package/schema";

const BUILDER = "scripts/curriculum/buildCanonical100.ts";
const V3_PATH = "curriculum/packages/ata-v2-canonical-100.draft.json";
const V4_PATH = "curriculum/packages/ata-v2-canonical-100.v4.draft.json";

/**
 * The accepted v3 artifact identity, pinned.
 *
 * `ata-v2@v3` is live in PREPROD and its fingerprint is quoted by the accepted
 * activation manifest, so a change to either value here is a change to history
 * and must fail this suite rather than be absorbed by it.
 */
const V3_FINGERPRINT = "412449e532bd56fc10f5588900ae67700965207a4b438b9fc6d83c2c5909a882";
const V3_SHA256 = "b55137e139351512741c11a06ec9e043591bb98f83df06bd64901c22bb9595f0";

/** The accepted v4 successor identity, pinned by this phase. */
const V4_FINGERPRINT = "fa9f4f989b62a6947a4a57164eeb04dfd3e0ba008abfd9e923eab875b0c653ac";
const V4_SHA256 = "7477ae2798ca0ab3200f3203c0b2eeafb8fa65b00e4a77e7c05738752ba2b3aa";

/** The version-independent educational payload both versions carry. */
const SEMANTIC_EQUIVALENCE_DIGEST =
  "9a178e104cf4e12384f0aeb28cf8da420bd8c50ef13dfad06e3651b6934e0165";

const dbPath = `/tmp/ata-g2-canonical-successor-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
process.env.DATABASE_URL = dbUrl;
process.env.CURRICULUM_V2_ASSESSMENT_ENABLED = "true";

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${passed + failed}. ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${passed + failed}. ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

type BuilderReport = {
  curriculumCode: string;
  curriculumVersionNumber: number;
  path: string;
  fingerprint: string;
  semanticEquivalenceDigest: string;
  sha256: string;
  bytes: number;
  status: string;
};

/** Run the builder and return its JSON report; throws with stderr on failure. */
function runBuilder(args: string[]): BuilderReport {
  const stdout = execFileSync("npx", ["tsx", BUILDER, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout.slice(stdout.indexOf("{"))) as BuilderReport;
}

/** Run the builder expecting refusal, and return what it said. */
function runBuilderExpectingFailure(args: string[]): { status: number | null; stderr: string } {
  const result = spawnSync("npx", ["tsx", BUILDER, ...args], { encoding: "utf8" });
  return { status: result.status, stderr: `${result.stderr}${result.stdout}` };
}

function load(path: string): CurriculumPackage {
  const result = validateCurriculumPackage(JSON.parse(fs.readFileSync(path, "utf8")));
  if (!result.ok) {
    throw new Error(`${path} failed generic validation: ${JSON.stringify(result.issues.slice(0, 5))}`);
  }
  return result.package;
}

async function main() {
  /* ================================================================== *
   * PART A — the builder's version contract (§17 A, B, E, F, G, H)
   * ================================================================== */

  await check("A. an explicit version 3 reproduces the accepted v3 artifact exactly", () => {
    const report = runBuilder(["--curriculum-version-number", "3", "--check"]);
    assert.equal(report.curriculumVersionNumber, 3);
    assert.equal(report.path, V3_PATH);
    assert.equal(report.fingerprint, V3_FINGERPRINT, "the accepted v3 fingerprint must be reproducible");
    assert.equal(report.sha256, V3_SHA256, "the accepted v3 artifact must be byte-reproducible");
  });

  await check("B. an explicit version 4 declares versionNumber 4 and matches the checked-in successor", () => {
    const report = runBuilder(["--curriculum-version-number", "4", "--check"]);
    assert.equal(report.curriculumVersionNumber, 4);
    assert.equal(report.path, V4_PATH);
    assert.equal(report.fingerprint, V4_FINGERPRINT);
    assert.equal(report.sha256, V4_SHA256);
    assert.equal(load(V4_PATH).curriculumVersionNumber, 4);
  });

  await check("H. an omitted version keeps building v3 and never consults a database", () => {
    const report = runBuilder(["--check"]);
    assert.equal(report.curriculumVersionNumber, 3, "the retained default is the historical contract");
    assert.equal(report.path, V3_PATH, "the default must not move the accepted artifact");
    assert.equal(report.fingerprint, V3_FINGERPRINT);

    // The default is a source constant, and this pins that no future edit can
    // turn it into "whatever the live database happens to hold".
    const source = fs.readFileSync(BUILDER, "utf8");
    assert.match(source, /const DEFAULT_CURRICULUM_VERSION_NUMBER = 3;/);
    for (const forbidden of [
      /PrismaClient/,
      /@prisma\/client/,
      /DATABASE_URL/,
      /process\.env/,
      /\bfetch\(/,
      /node:https?\b/,
      /Date\.now\(\)/,
      /new Date\(\)/,
      /Math\.random/,
    ]) {
      assert.equal(
        forbidden.test(source),
        false,
        `the builder must not reach ${forbidden} to decide what it builds`,
      );
    }
  });

  for (const [label, value] of [
    ["E. version 0", "0"],
    ["F. a negative version", "-1"],
    ["G. a non-integer version", "4.5"],
    ["G. an exponent-form version", "4e0"],
    ["G. a signed version", "+4"],
    ["G. a hexadecimal version", "0x4"],
    ["G. a padded version", " 4 "],
    ["G. a non-numeric version", "four"],
    ["G. an out-of-range version", "10001"],
  ] as const) {
    await check(`${label} (${JSON.stringify(value)}) is refused`, () => {
      const { status, stderr } = runBuilderExpectingFailure(["--curriculum-version-number", value]);
      assert.notEqual(status, 0, "the builder must exit non-zero");
      assert.match(stderr, /--curriculum-version-number/);
      // A refused build writes nothing: the accepted artifacts are still theirs.
      assert.equal(load(V3_PATH).contentFingerprint, V3_FINGERPRINT);
      assert.equal(load(V4_PATH).contentFingerprint, V4_FINGERPRINT);
    });
  }

  await check("a missing value for --curriculum-version-number is refused", () => {
    const { status, stderr } = runBuilderExpectingFailure(["--curriculum-version-number", "--check"]);
    assert.notEqual(status, 0);
    assert.match(stderr, /requires a value/);
  });

  /* ================================================================== *
   * PART B — same product, different release identity (§17 C, D)
   * ================================================================== */

  const v3 = load(V3_PATH);
  const v4 = load(V4_PATH);

  await check("C. the v3 and v4 educational payloads are identical", () => {
    const differences = diffSemanticPayload(v3, v4);
    assert.deepEqual(differences, [], `successor drifted from its predecessor: ${JSON.stringify(differences.slice(0, 5))}`);
    assert.equal(calculateSemanticEquivalenceDigest(v3), SEMANTIC_EQUIVALENCE_DIGEST);
    assert.equal(calculateSemanticEquivalenceDigest(v4), SEMANTIC_EQUIVALENCE_DIGEST);
  });

  await check("C. every version-derived difference is inventoried, and there are no others", () => {
    // The raw artifacts, not the projection: this also covers the fields the
    // canonical projection deliberately excludes.
    const rawV3 = JSON.parse(fs.readFileSync(V3_PATH, "utf8")) as Record<string, unknown>;
    const rawV4 = JSON.parse(fs.readFileSync(V4_PATH, "utf8")) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(rawV3), ...Object.keys(rawV4)])];
    const differing = keys.filter(
      (key) => JSON.stringify(rawV3[key]) !== JSON.stringify(rawV4[key]),
    );
    assert.deepEqual(
      differing.sort(),
      ["contentFingerprint", "curriculumVersionNumber"],
      "a successor may differ ONLY in its declared version and the digest that covers it",
    );
    assert.equal(rawV3.curriculumVersionNumber, 3);
    assert.equal(rawV4.curriculumVersionNumber, 4);
    assert.equal(rawV3.packageCode, rawV4.packageCode);
    assert.equal(rawV3.packageRevision, rawV4.packageRevision);
    assert.equal(rawV3.curriculumCode, rawV4.curriculumCode);
  });

  await check("D. the canonical fingerprints differ, because the fingerprint covers version identity", () => {
    assert.notEqual(v3.contentFingerprint, v4.contentFingerprint);
    assert.equal(calculateFingerprint(v3), V3_FINGERPRINT);
    assert.equal(calculateFingerprint(v4), V4_FINGERPRINT);
    // The difference is caused by the version and by nothing else: re-declaring
    // v4 as v3 reproduces v3's fingerprint exactly.
    assert.equal(calculateFingerprint({ ...v4, curriculumVersionNumber: 3 }), V3_FINGERPRINT);
    assert.deepEqual([...SUCCESSOR_IDENTITY_KEYS], ["curriculumVersionNumber"]);
  });

  await check("the successor still satisfies the ATA-100 product profile", () => {
    const profile = validateAtaProduct100Package(v4);
    assert.deepEqual(profile.issues, []);
    const levels = v4.modules.flatMap((m) => m.levels);
    assert.equal(v4.modules.length, 20);
    assert.equal(levels.length, 100);
    assert.equal(levels.filter((l) => l.content !== null).length, 78);
    assert.equal(levels.filter((l) => l.assessment !== null).length, 58);
    assert.equal(levels.filter((l) => l.completionMethod === "assessment_pass").length, 58);
    assert.equal(levels.filter((l) => l.type === "financial_checkpoint").length, 20);
    assert.equal(levels.filter((l) => l.type === "mentor_review").length, 7);
    assert.equal(levels.filter((l) => l.type === "external_event").length, 1);
    assert.equal(levels.filter((l) => l.type === "report").length, 1);
    assert.equal(levels.filter((l) => l.completionMethod === "manual").length, 13);
    assert.equal(v4.status, "draft", "no builder may ever emit an approved package");
  });

  await check("I. the importer has no way to override the version the artifact declares", () => {
    // Source-level, because this is an architectural boundary rather than a
    // behaviour: the version must reach the database from the package and from
    // nowhere else, so no flag, option or environment variable may exist to
    // retarget an accepted artifact at import time.
    const importer = fs.readFileSync("src/lib/curriculum/package/import.ts", "utf8");
    const cli = fs.readFileSync("scripts/curriculum/importCurriculumPackage.ts", "utf8");
    for (const forbidden of [
      "--override-version",
      "--force-version",
      "--target-version",
      "--bump-version",
      "--curriculum-version-number",
    ]) {
      assert.equal(importer.includes(forbidden), false, `importer must not accept ${forbidden}`);
      assert.equal(cli.includes(forbidden), false, `import CLI must not accept ${forbidden}`);
    }
    // Every `versionNumber` the importer writes or looks up reads it off the
    // package. The lookbehind keeps `code_versionNumber` — the composite unique
    // key's name — from being mistaken for an assignment.
    const assignments = importer.match(/(?<![A-Za-z_])versionNumber: [^,\n]+/g) ?? [];
    assert.ok(assignments.length > 0);
    for (const line of assignments) {
      assert.match(
        line,
        // A nested package path (`level.report.rubric.versionNumber`) is still
        // the package declaring its own version; a local alias or an option is
        // not, and neither matches.
        /^versionNumber: (pkg\.curriculumVersionNumber|level(\.[a-zA-Z]+)+\.versionNumber)/,
        `unexpected version source: ${line}`,
      );
    }
    assert.equal(
      /ImportOptions[\s\S]{0,600}versionNumber/.test(importer),
      false,
      "import options must carry no version at all",
    );
  });

  /* ================================================================== *
   * PART C / D — a disposable database (§17 J, §18, §22, §12, §15)
   * ================================================================== */

  cleanupDb();
  const migrate = spawnSync("npx", ["tsx", "prisma/migrate.ts"], {
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
  });
  if (migrate.status !== 0) {
    console.error(migrate.stderr || migrate.stdout);
    throw new Error("migration runner failed");
  }

  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const { importCurriculumPackage } = await import("../../src/lib/curriculum/package/import");
  const { publishCurriculumVersion } = await import("../../src/lib/curriculum/service");

  const admin = await db.user.create({
    data: {
      email: `successor-admin-${process.pid}@ata.invalid`,
      passwordHash: "x",
      name: "Successor Admin",
      role: "admin",
      status: "active",
    },
  });

  const importPackage = async (path: string) =>
    importCurriculumPackage(JSON.parse(fs.readFileSync(path, "utf8")), { db });

  await check("the predecessor imports with the corrected bindings", async () => {
    const result = await importPackage(V3_PATH);
    assert.equal(result.ok, true, JSON.stringify(result.ok ? {} : result.issues.slice(0, 3)));
    if (!result.ok) return;
    assert.equal(result.summary.outcome, "created");
    assert.equal(result.summary.curriculumVersionNumber, 3);
    assert.equal(result.summary.counts.contentBindings, 78);
    assert.equal(result.summary.counts.assessmentBindings, 58);
  });

  // The live predecessor is PUBLISHED, and that is the state a successor has to
  // be importable beside. Set directly: publishing it through the domain is not
  // what this suite is testing, and the corrected gate would refuse it anyway.
  const v3Row = await db.curriculumVersion.update({
    where: { code_versionNumber: { code: "ata-v2", versionNumber: 3 } },
    data: { status: "published", publishedAt: new Date() },
  });

  const predecessorShape = async () => ({
    version: await db.curriculumVersion.findUniqueOrThrow({ where: { id: v3Row.id } }),
    modules: await db.moduleDefinition.count({ where: { curriculumVersionId: v3Row.id } }),
    levels: await db.levelDefinition.count({ where: { curriculumVersionId: v3Row.id } }),
    content: await db.contentVersion.count({ where: { curriculumVersionId: v3Row.id } }),
    assessments: await db.assessmentVersion.count({ where: { curriculumVersionId: v3Row.id } }),
    bindings: await db.levelResourceBinding.count({ where: { curriculumVersionId: v3Row.id } }),
    questions: await db.questionDefinition.count({
      where: { assessmentVersion: { curriculumVersionId: v3Row.id } },
    }),
  });
  const before = await predecessorShape();

  await check("re-importing the published predecessor is still refused as immutable", async () => {
    const result = await importPackage(V3_PATH);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VERSION_IMMUTABLE");
  });

  let v4Id = 0;
  await check("J. the successor imports as a DISTINCT draft version, not a mutation of v3", async () => {
    const result = await importPackage(V4_PATH);
    assert.equal(result.ok, true, JSON.stringify(result.ok ? {} : result.issues.slice(0, 3)));
    if (!result.ok) return;
    assert.equal(result.summary.outcome, "created");
    assert.equal(result.summary.curriculumVersionNumber, 4);
    assert.equal(result.summary.curriculumVersionStatus, "draft");
    assert.equal(result.summary.fingerprint, V4_FINGERPRINT);

    const rows = await db.curriculumVersion.findMany({ where: { code: "ata-v2" }, orderBy: { versionNumber: "asc" } });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.versionNumber), [3, 4]);
    assert.deepEqual(rows.map((r) => r.status), ["published", "draft"]);
    assert.notEqual(rows[0].id, rows[1].id);
    v4Id = rows[1].id;
  });

  await check("the successor carries the whole product, with 58 assessment bindings", async () => {
    assert.equal(await db.moduleDefinition.count({ where: { curriculumVersionId: v4Id } }), 20);
    assert.equal(await db.levelDefinition.count({ where: { curriculumVersionId: v4Id } }), 100);
    assert.equal(await db.contentVersion.count({ where: { curriculumVersionId: v4Id } }), 78);
    assert.equal(await db.assessmentVersion.count({ where: { curriculumVersionId: v4Id } }), 58);
    assert.equal(
      await db.levelResourceBinding.count({
        where: { curriculumVersionId: v4Id, contentVersionId: { not: null } },
      }),
      78,
    );
    assert.equal(
      await db.levelResourceBinding.count({
        where: { curriculumVersionId: v4Id, assessmentVersionId: { not: null } },
      }),
      58,
    );
    assert.equal(
      await db.levelDefinition.count({
        where: { curriculumVersionId: v4Id, completionMethod: "assessment_pass" },
      }),
      58,
    );
  });

  await check("no successor binding is duplicated, ambiguous or aimed at the wrong level", async () => {
    const bindings = await db.levelResourceBinding.findMany({
      where: { curriculumVersionId: v4Id },
      select: { levelDefinitionId: true, assessmentVersionId: true, contentVersionId: true },
    });
    assert.equal(
      new Set(bindings.map((b) => b.levelDefinitionId)).size,
      bindings.length,
      "a level may hold at most one binding row",
    );

    const bound = await db.levelResourceBinding.findMany({
      where: { curriculumVersionId: v4Id, assessmentVersionId: { not: null } },
      select: { levelDefinitionId: true, assessmentVersion: { select: { levelDefinitionId: true, curriculumVersionId: true } } },
    });
    for (const row of bound) {
      assert.equal(row.assessmentVersion?.levelDefinitionId, row.levelDefinitionId, "assessment bound to a foreign level");
      assert.equal(row.assessmentVersion?.curriculumVersionId, v4Id, "assessment bound across versions");
    }

    const unbound = await db.levelDefinition.count({
      where: {
        curriculumVersionId: v4Id,
        completionMethod: "assessment_pass",
        OR: [{ resourceBinding: { is: null } }, { resourceBinding: { assessmentVersionId: null } }],
      },
    });
    assert.equal(unbound, 0, "the defect this successor exists to repair must not recur");
  });

  await check("importing the successor changed NOTHING about the predecessor", async () => {
    assert.deepEqual(await predecessorShape(), before);
  });

  await check("re-importing the successor is a no-op, not a second version", async () => {
    const result = await importPackage(V4_PATH);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.summary.outcome, "unchanged");
    assert.equal(await db.curriculumVersion.count({ where: { code: "ata-v2" } }), 2);
  });

  await check("§12 a package-only successor is REFUSED publication and stays a draft", async () => {
    await assert.rejects(
      () => publishCurriculumVersion({ curriculumVersionId: v4Id, actorId: admin.id }),
      (error: unknown) => {
        const e = error as { code?: string; issues?: Array<{ code: string }> };
        assert.equal(e.code, "CURRICULUM_INVALID");
        // 57 of the 58 banks ship as drafts; level 2's is the single approved
        // precedent and is already published in the package.
        assert.equal(
          e.issues?.filter((i) => i.code === "LEVEL_ASSESSMENT_NOT_PUBLISHED").length,
          57,
          "the editorial/assessment lifecycle is still a prerequisite",
        );
        return true;
      },
    );
    const after = await db.curriculumVersion.findUniqueOrThrow({ where: { id: v4Id } });
    assert.equal(after.status, "draft");
    assert.equal(after.publishedAt, null);
    assert.equal(
      (await db.curriculumVersion.findUniqueOrThrow({ where: { id: v3Row.id } })).status,
      "published",
      "a refused successor publication must not disturb the predecessor",
    );
  });

  await check("§15 the v3 -> v4 lineage is representable on the existing schema", async () => {
    const predecessors = await db.assessmentVersion.findMany({
      where: { curriculumVersionId: v3Row.id },
      select: { id: true, levelDefinition: { select: { stableCode: true } } },
    });
    const successors = await db.assessmentVersion.findMany({
      where: { curriculumVersionId: v4Id },
      select: { id: true, predecessorVersionId: true, levelDefinition: { select: { stableCode: true } } },
    });
    assert.equal(predecessors.length, 58);
    assert.equal(successors.length, 58);
    assert.equal(
      successors.every((s) => s.predecessorVersionId === null),
      true,
      "the importer must not invent a lineage it was not told about",
    );

    // Every successor bank has exactly one predecessor, found by the stable
    // level code — the identity both versions share — so the descent needs no
    // new column and migration 47 is not required.
    const byCode = new Map(predecessors.map((p) => [p.levelDefinition.stableCode, p.id]));
    for (const successor of successors) {
      const predecessorId = byCode.get(successor.levelDefinition.stableCode);
      assert.ok(predecessorId, `no predecessor for ${successor.levelDefinition.stableCode}`);
      await db.assessmentVersion.update({
        where: { id: successor.id },
        data: { predecessorVersionId: predecessorId },
      });
    }
    assert.equal(
      await db.assessmentVersion.count({
        where: { curriculumVersionId: v4Id, predecessorVersionId: { not: null } },
      }),
      58,
    );

    // ON DELETE RESTRICT: lineage is evidence, so a predecessor with a live
    // successor cannot quietly disappear.
    await assert.rejects(() => db.assessmentVersion.delete({ where: { id: predecessors[0].id } }));
  });

  await db.$disconnect();
  cleanupDb();

  console.log(`\nG2 canonical successor artifact regression: ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

void main().catch((error) => {
  console.error(error);
  cleanupDb();
  process.exitCode = 1;
});
