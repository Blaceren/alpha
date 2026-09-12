import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ALLOWED_UNSAFE_FILES,
  PRODUCTION_SCAN_ROOTS,
  classifyRawSqlUsages,
  scanRawSql,
} from "../security/sqlAuditCore";

// Regression for the raw-SQL auditor itself (TB-2 / TB1-F-003). Proves that the
// repaired classifier accepts Prisma's parameter-bound forms, still rejects every
// unsafe form, and fails closed on shapes it cannot parse. No database, no
// network, no server: this reads fixture text and classifies it.

const projectRoot = path.resolve(__dirname, "../..");
const fixturesDir = path.join(projectRoot, "scripts/security/fixtures");

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

function classifyFixture(name: string) {
  const source = fs.readFileSync(path.join(fixturesDir, name), "utf8");
  return classifyRawSqlUsages(source, `scripts/security/fixtures/${name}`);
}

/* ------------------------------------------------------- positive fixtures */

check("1. Prisma tagged template is parameter-bound", () => {
  const usages = classifyFixture("safe-tagged-template.ts");
  assert.equal(usages.length, 2);
  assert.ok(usages.every((u) => u.severity === "safe"), JSON.stringify(usages));
});

check("2. Prisma.sql value with a generic type argument is parameter-bound", () => {
  const usages = classifyFixture("safe-prisma-sql-value.ts");
  assert.equal(usages.length, 2);
  assert.ok(usages.every((u) => u.severity === "safe"), JSON.stringify(usages));
});

check("3. composed Prisma.empty fragment does not break classification", () => {
  const usages = classifyFixture("safe-prisma-sql-value.ts");
  assert.ok(usages.some((u) => u.api === "$queryRaw" && u.severity === "safe"));
  assert.ok(usages.some((u) => u.api === "$executeRaw" && u.severity === "safe"));
});

/* ------------------------------------------------------- negative fixtures */

const REJECTED = [
  ["unsafe-query-raw-unsafe.ts", "$queryRawUnsafe", "unsafe"],
  ["unsafe-execute-raw-unsafe.ts", "$executeRawUnsafe", "unsafe"],
  ["unsafe-prisma-raw.ts", "$queryRaw", "unsafe"],
  ["unsafe-concatenated-sql.ts", "$queryRaw", "unclassified"],
  ["unsafe-untagged-template.ts", "$queryRaw", "unclassified"],
] as const;

for (const [fixture, api, expected] of REJECTED) {
  check(`4. ${fixture} is rejected as ${expected}`, () => {
    const usages = classifyFixture(fixture);
    assert.ok(usages.length > 0, "no usage detected");
    const hit = usages.find((u) => u.api === api);
    assert.ok(hit, `expected a ${api} usage, got ${JSON.stringify(usages)}`);
    assert.equal(hit.severity, expected, JSON.stringify(hit));
    assert.notEqual(hit.severity, "safe");
  });
}

check("5. every unsafe-* fixture yields at least one non-safe usage", () => {
  const files = fs.readdirSync(fixturesDir).filter((f) => f.startsWith("unsafe-"));
  assert.ok(files.length >= 5, `expected >=5 unsafe fixtures, found ${files.length}`);
  for (const file of files) {
    const usages = classifyFixture(file);
    assert.ok(
      usages.some((u) => u.severity !== "safe"),
      `${file} was classified entirely safe`,
    );
  }
});

check("6. every safe-* fixture yields no non-safe usage", () => {
  const files = fs.readdirSync(fixturesDir).filter((f) => f.startsWith("safe-"));
  assert.ok(files.length >= 3, `expected >=3 safe fixtures, found ${files.length}`);
  for (const file of files) {
    const usages = classifyFixture(file);
    assert.ok(
      usages.every((u) => u.severity === "safe"),
      `${file}: ${JSON.stringify(usages)}`,
    );
  }
});

check("6b. a comment merely naming a raw API is not a call site", () => {
  // Regression for a defect these fixtures caught: the classifier matched
  // `$queryRaw` inside prose, reporting a phantom unclassified call site.
  const usages = classifyFixture("safe-comment-mentions-api.ts");
  assert.deepEqual(usages, [], JSON.stringify(usages));
});

/* ------------------------------------------------------------ scan policy */

check("7. production scan scope is src and prisma only — scripts is excluded", () => {
  assert.deepEqual([...PRODUCTION_SCAN_ROOTS], ["src", "prisma"]);
  assert.ok(!PRODUCTION_SCAN_ROOTS.includes("scripts" as never));
});

check("8. unsafe fixtures are invisible to a production scan", () => {
  const findings = scanRawSql(projectRoot);
  assert.ok(
    !findings.some((f) => f.file.includes("scripts/security/fixtures")),
    "fixtures leaked into the production scan",
  );
});

check("9. the migration runner is the only allowlisted unsafe file", () => {
  assert.deepEqual([...ALLOWED_UNSAFE_FILES.keys()], ["prisma/migrate.ts"]);
});

check("10. an unsafe sample IS reported when scanned as production code", () => {
  // The same text the auditor ignores under scripts/ must fail when it sits in a
  // scanned root. This is the guard against the scan policy silently widening.
  const source = fs.readFileSync(path.join(fixturesDir, "unsafe-query-raw-unsafe.ts"), "utf8");
  const usages = classifyRawSqlUsages(source, "src/lib/pretend-production.ts");
  assert.ok(usages.some((u) => u.severity === "unsafe"), JSON.stringify(usages));
});

check("11. allowlisting is per-file and does not leak to other files", () => {
  const source = fs.readFileSync(path.join(fixturesDir, "unsafe-execute-raw-unsafe.ts"), "utf8");
  const allowed = classifyRawSqlUsages(source, "prisma/migrate.ts");
  const notAllowed = classifyRawSqlUsages(source, "prisma/other.ts");
  assert.equal(allowed[0]?.severity, "safe");
  assert.equal(notAllowed[0]?.severity, "unsafe");
});

/* ------------------------------------------------------------ live source */

check("12. current production source has no unsafe or unclassified raw SQL", () => {
  const findings = scanRawSql(projectRoot);
  assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
});

check("13. the three Curriculum V2 Prisma.sql sites classify as safe", () => {
  for (const file of ["src/lib/curriculum/completion.ts", "src/lib/curriculum/xp.ts"]) {
    const source = fs.readFileSync(path.join(projectRoot, file), "utf8");
    const usages = classifyRawSqlUsages(source, file);
    assert.ok(usages.length > 0, `${file} produced no usages`);
    assert.ok(usages.every((u) => u.severity === "safe"), `${file}: ${JSON.stringify(usages)}`);
  }
});

check("14. health and readiness tagged templates classify as safe", () => {
  for (const file of ["src/app/api/health/route.ts", "src/app/api/readiness/route.ts"]) {
    const source = fs.readFileSync(path.join(projectRoot, file), "utf8");
    const usages = classifyRawSqlUsages(source, file);
    assert.equal(usages.length, 1);
    assert.equal(usages[0].severity, "safe");
  }
});

console.log(`\nsql audit regression: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
