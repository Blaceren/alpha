/**
 * PHASE-G0 CORRECTION — the mutation-surface guard.
 *
 * WHY A STATIC GUARD AND NOT A LIST. The BLOCKER the independent audit found was
 * not a bug in any one function: it was a WHOLE SURFACE nobody had connected to
 * the new rules. A handwritten inventory would have exactly the same failure
 * mode as the one that let 30 endpoints drift out of policy — it is correct on
 * the day it is written and silently wrong the first time somebody adds a file.
 *
 * So this suite ENUMERATES the source rather than trusting a list. It walks the
 * modules that write authoring tables and fails when any of them writes a
 * substantive authoring child without going through the shared boundary in
 * `authoring-mutation-guard.ts`.
 *
 * WHAT COUNTS AS SUBSTANTIVE. A write to ContentLocalization, ContentAsset,
 * QuestionDefinition or QuestionLocalization — the rows that decide what a
 * learner reads and is graded against — or to the two aggregate rows themselves.
 * Publication, archival and resource binding are runtime and structural
 * operations and are deliberately OUT of scope here; they are classified in
 * docs/AUTHORING_FOUNDATION.md.
 *
 * NO DATABASE. This suite reads source. It is fast on purpose so it can run in
 * every gate without anyone weighing whether to skip it.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = process.env.REGRESSION_SUMMARY_PATH ?? null;

let passed = 0;
let failed = 0;
const results: Array<{ name: string; ok: boolean; error?: string }> = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    results.push({ name, ok: false, error: message });
    console.error(`FAIL ${name}`);
    console.error(message);
  }
}

/** The child tables whose contents a learner actually sees. */
const SUBSTANTIVE_TABLES = [
  "contentLocalization",
  "contentAsset",
  "questionDefinition",
  "questionLocalization",
] as const;

/** The two aggregate roots. Writes to these are substantive too. */
const AGGREGATE_TABLES = ["contentVersion", "assessmentVersion"] as const;

const WRITE_METHODS = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];

const GUARD_MODULE = "authoring-mutation-guard";
const GUARD_CALLS = ["guardAggregateChildMutation", "guardAggregateSelfMutation"];

/**
 * Modules allowed to write these tables WITHOUT the boundary, each with the
 * reason. Anything not on this list must be guarded, and adding to this list is
 * a deliberate, reviewable act rather than an accident.
 */
const EXEMPT: Record<string, string> = {
  "src/lib/curriculum/package/import.ts":
    "the sealed curriculum package importer — a CLI/bootstrap path with its own " +
    "fingerprint-sealed contract, reachable from no HTTP route (asserted below)",
  "src/lib/curriculum/authoring-lifecycle.ts":
    "the editorial lifecycle itself — it IS the authority the boundary delegates to",
  "src/lib/curriculum/authoring-mutation-guard.ts": "the boundary",
  // PHASE-G1 — the version CLONE.
  //
  // It creates a NEW aggregate and its children in one transaction; it never
  // mutates a child of a version that already had one. G0 states the rule this
  // rests on explicitly: version CREATE is outside the boundary's scope because
  // there is no revision to be stale against until the row exists. The clone is
  // one editorial act, so it is one transaction landing at `revision: 1` — and
  // running it through the child guard would both need a revision that does not
  // exist yet and leave a five-asset copy at revision 6.
  //
  // What keeps it safe is asserted by `curriculumAuthoringStudioRegression`
  // (N1–N3): the SOURCE version is byte-identical afterwards, the copy is
  // `draft` with every approval column NULL, and a cloned production version is
  // UNLINKED rather than inheriting reviewed evidence.
  "src/lib/curriculum/authoring-version-clone.ts":
    "creates a NEW aggregate plus its children atomically at revision 1 — a " +
    "creation, which G0 places outside the boundary; it mutates no existing child",
  // PHASE-G2 — the editorial overlay importer.
  //
  // The boundary exists to make a LIVE editorial mutation safe: it bumps the
  // aggregate's revision and records the actor as the latest substantive author.
  // Both of those are exactly wrong here. This module transports evidence that
  // was produced elsewhere, so it writes the revision the source recorded and
  // preserves the source's authors and timestamps verbatim; running it through
  // `bumpAggregate` would increment a revision nobody edited and stamp the
  // importing operator over the historical author — manufacturing the very
  // provenance the four-eyes model exists to protect.
  //
  // What keeps it safe instead, asserted by `curriculumEditorialOverlay`:
  //   • it only moves rows at the structural baseline (draft, no author, no
  //     submission, no approval); anything already carrying DIFFERENT editorial
  //     truth is a refusal, not an overwrite (F2–F4);
  //   • the whole apply is one transaction that rolls back completely (G1);
  //   • it publishes nothing and binds nothing (E6, J1);
  //   • it is a CLI/bootstrap path reachable from no HTTP route (asserted below).
  "src/lib/curriculum/editorial-overlay/import.ts":
    "the editorial overlay importer — transports historical evidence verbatim, " +
    "so it must NOT bump revisions or restamp authors the way the boundary does; " +
    "reachable from no HTTP route (asserted below)",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, out);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function relative(file: string) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function writeSitesIn(source: string, tables: readonly string[]) {
  const found: string[] = [];
  for (const table of tables) {
    for (const method of WRITE_METHODS) {
      const pattern = new RegExp(`\\b(?:tx|prisma|db|client)\\s*\\.\\s*${table}\\s*\\.\\s*${method}\\s*\\(`, "g");
      if (pattern.test(source)) found.push(`${table}.${method}`);
    }
  }
  return found;
}

const sourceFiles = walk(path.join(ROOT, "src"));

check("1 the shared boundary module exists and exports both guards", () => {
  const guard = path.join(ROOT, "src/lib/curriculum/authoring-mutation-guard.ts");
  assert.ok(fs.existsSync(guard), "authoring-mutation-guard.ts must exist");
  const source = fs.readFileSync(guard, "utf8");
  for (const name of GUARD_CALLS) {
    assert.ok(source.includes(`export async function ${name}`), `must export ${name}`);
  }
  assert.ok(source.includes("export const expectedRevisionSchema"), "must export the revision transport");
});

check("2 EVERY module writing a substantive authoring table passes through the boundary", () => {
  const offenders: string[] = [];
  const guarded: string[] = [];
  for (const file of sourceFiles) {
    const rel = relative(file);
    const source = fs.readFileSync(file, "utf8");
    const sites = writeSitesIn(source, [...SUBSTANTIVE_TABLES, ...AGGREGATE_TABLES]);
    if (sites.length === 0) continue;
    if (rel in EXEMPT) continue;
    const importsGuard = source.includes(GUARD_MODULE);
    const callsGuard = GUARD_CALLS.some((name) => source.includes(`${name}(`));
    if (importsGuard && callsGuard) {
      guarded.push(`${rel} [${sites.join(", ")}]`);
    } else {
      offenders.push(
        `${rel} writes ${sites.join(", ")} but does not call the aggregate authoring boundary`,
      );
    }
  }
  console.log(`     guarded writer modules:\n       ${guarded.join("\n       ")}`);
  assert.deepEqual(
    offenders,
    [],
    `UNGUARDED AUTHORING MUTATION PATH(S):\n  ${offenders.join("\n  ")}\n` +
      "Every substantive Content/Assessment write must go through " +
      "guardAggregateChildMutation or guardAggregateSelfMutation. If a new module " +
      "genuinely must not, add it to EXEMPT in this suite with the reason.",
  );
});

check("3 every guarded writer module actually reaches the boundary once per exported command", () => {
  for (const rel of ["src/lib/curriculum/content.ts", "src/lib/curriculum/assessment.ts"]) {
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const calls = GUARD_CALLS.reduce(
      (total, name) => total + (source.match(new RegExp(`\\b${name}\\(`, "g")) ?? []).length,
      0,
    );
    assert.equal(calls, 8, `${rel} must guard exactly its 8 substantive commands, found ${calls}`);
  }
});

check("4 EVERY substantive command schema requires expectedRevision", () => {
  const expected: Record<string, string[]> = {
    "src/lib/curriculum/content-schemas.ts": [
      "updateContentVersionSchema", "deleteContentVersionSchema",
      "createContentLocalizationSchema", "updateContentLocalizationSchema",
      "deleteContentLocalizationSchema", "createContentAssetSchema",
      "updateContentAssetSchema", "deleteContentAssetSchema",
    ],
    "src/lib/curriculum/assessment-schemas.ts": [
      "updateAssessmentVersionSchema", "deleteAssessmentVersionSchema",
      "createAssessmentQuestionSchema", "updateAssessmentQuestionSchema",
      "deleteAssessmentQuestionSchema", "createQuestionLocalizationSchema",
      "updateQuestionLocalizationSchema", "deleteQuestionLocalizationSchema",
    ],
  };
  for (const [rel, names] of Object.entries(expected)) {
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const name of names) {
      const block = new RegExp(`export const ${name} = z\\.strictObject\\(\\{([\\s\\S]*?)\\n\\}\\);`).exec(source);
      assert.ok(block, `${rel}: ${name} not found`);
      assert.ok(
        block[1].includes("expectedRevision"),
        `${rel}: ${name} must require expectedRevision`,
      );
    }
  }
});

check("5 NO code path defaults expectedRevision to the current revision", () => {
  const banned = [
    /expectedRevision\s*[:=]\s*(?:current|existing|row|version|aggregate)\s*\.\s*revision/,
    /expectedRevision\s*\?\?/,
    /expectedRevision\s*\|\|/,
    /expectedRevision\s*=\s*await/,
  ];
  const offenders: string[] = [];
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, "utf8");
    if (!source.includes("expectedRevision")) continue;
    for (const pattern of banned) {
      if (pattern.test(source)) offenders.push(`${relative(file)} matches ${pattern}`);
    }
  }
  assert.deepEqual(offenders, [], `a revision fallback would restore last-write-wins:\n  ${offenders.join("\n  ")}`);
});

check("6 the sealed package importer is reachable from NO HTTP route", () => {
  const routes = walk(path.join(ROOT, "src/app"));
  const offenders = routes.filter((file) =>
    fs.readFileSync(file, "utf8").includes("curriculum/package/import"),
  );
  assert.deepEqual(offenders.map(relative), [], "the importer must stay a CLI/bootstrap path");
});

/*
 * PHASE-G2 CORRECTION-1. The overlay importer's EXEMPT entry says it is reachable
 * from no HTTP route; before this check that was a claim in a comment rather than
 * a fact anyone verified, and the exemption is what lets that one module write
 * approval evidence without bumping a revision or restamping an author. It now
 * matters more, not less: since the correction the same module also writes learner
 * payload. So the claim is asserted — from the route tree, and from the whole
 * `src` tree, because a server module that re-exported it would put the exempt
 * primitive one import away from a route.
 */
check("6b the EXEMPT editorial-overlay importer is reachable from NO HTTP route", () => {
  const OVERLAY_IMPORT = "curriculum/editorial-overlay/import";
  const routeOffenders = walk(path.join(ROOT, "src/app")).filter((file) =>
    fs.readFileSync(file, "utf8").includes(OVERLAY_IMPORT),
  );
  assert.deepEqual(
    routeOffenders.map(relative),
    [],
    "the editorial overlay importer must stay a CLI/bootstrap path",
  );

  const reExporters = sourceFiles
    .filter((file) => relative(file) !== "src/lib/curriculum/editorial-overlay/import.ts")
    .filter((file) => fs.readFileSync(file, "utf8").includes(OVERLAY_IMPORT));
  assert.deepEqual(
    reExporters.map(relative),
    [],
    "nothing under src/ may re-export the exempt historical-import primitive",
  );

  // And the exemption itself must stay one named file, never a directory or a
  // prefix that a future module could quietly fall under.
  assert.ok(
    "src/lib/curriculum/editorial-overlay/import.ts" in EXEMPT,
    "the overlay importer must be exempt by exact path",
  );
  const overlayExemptions = Object.keys(EXEMPT).filter((key) => key.includes("editorial-overlay"));
  assert.deepEqual(
    overlayExemptions,
    ["src/lib/curriculum/editorial-overlay/import.ts"],
    "exactly one editorial-overlay module may be exempt",
  );
});

check("7 no authoring route accepts a server-authority field from the caller", () => {
  const forbidden = [
    "actorId", "approvedBy", "approvedAt", "submittedBy", "publishedAt",
    "contractFingerprint", "assessmentFingerprint", "lastAuthoredById", "editorialState",
  ];
  const routeModule = fs.readFileSync(path.join(ROOT, "src/lib/curriculum/phase4-admin-routes.ts"), "utf8");
  // Every route body schema is derived by OMITTING actorId, so the only
  // occurrences may be inside an `.omit({ ... })` or as the server-supplied
  // `gate.actorId`. Anything else would be a caller-shaped authority field.
  const suspicious: string[] = [];
  for (const field of forbidden) {
    const pattern = new RegExp(`\\b${field}\\b`, "g");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(routeModule)) !== null) {
      const line = routeModule.slice(
        routeModule.lastIndexOf("\n", match.index) + 1,
        routeModule.indexOf("\n", match.index),
      );
      const legitimate =
        line.includes(".omit({") ||
        line.includes("gate.actorId") ||
        line.trimStart().startsWith("*") ||
        line.trimStart().startsWith("//");
      if (!legitimate) suspicious.push(`${field}: ${line.trim().slice(0, 140)}`);
    }
  }
  assert.deepEqual(suspicious, [], `caller-shaped authority field(s):\n  ${suspicious.join("\n  ")}`);
});

check("8 there is exactly ONE assessment fingerprint implementation", () => {
  const impls: string[] = [];
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, "utf8");
    if (/export function calculate(Assessment|Contract)Fingerprint/.test(source)) impls.push(relative(file));
  }
  assert.deepEqual(impls, ["src/lib/curriculum/video-production-contract.ts"], "one accepted module only");
  const projection = fs.readFileSync(
    path.join(ROOT, "src/lib/curriculum/authoring-assessment-projection.ts"),
    "utf8",
  );
  assert.ok(!/createHash|sha256|digest\(/.test(projection), "the projection must hash nothing itself");
  const coherence = fs.readFileSync(
    path.join(ROOT, "src/lib/curriculum/video-production-coherence.ts"),
    "utf8",
  );
  assert.ok(!/createHash|sha256|digest\(/.test(coherence), "the coherence reader must hash nothing itself");
});

console.log(`\nPHASE-G0 CORRECTION authoring surface guard: ${passed} passed, ${failed} failed`);
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ passed, failed, results }, null, 2));
if (failed > 0) process.exitCode = 1;
