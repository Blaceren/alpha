import {
  ALLOWED_UNSAFE_FILES,
  PRODUCTION_SCAN_ROOTS,
  scanPocketSecretStorage,
  scanRawSql,
} from "./sqlAuditCore";

/**
 * Raw-SQL and Pocket-secret audit CLI.
 *
 * All classification logic lives in `sqlAuditCore.ts` so it can be exercised by
 * `scripts/regression/sqlAuditRegression.ts` against safe and unsafe fixtures.
 * This file only resolves the project root, runs the scans and reports.
 */
const projectRoot = process.cwd();

const findings = [
  ...scanRawSql(projectRoot),
  ...scanPocketSecretStorage(projectRoot),
];

if (findings.length > 0) {
  console.error("SQL_INJECTION_AUDIT_FAILED");
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} ${finding.message}`);
  }
  process.exit(1);
}

console.log("SQL_INJECTION_AUDIT_PASS");
console.log(`Scanned production roots: ${PRODUCTION_SCAN_ROOTS.join(", ")}.`);
console.log(
  "Accepted as parameter-bound: Prisma tagged templates and Prisma.sql values. " +
    "$queryRawUnsafe/$executeRawUnsafe, Prisma.raw() and string-built SQL are rejected.",
);
for (const [file, justification] of ALLOWED_UNSAFE_FILES) {
  console.log(`Allowlisted non-runtime raw SQL: ${file} — ${justification}.`);
}
console.log(
  "scripts/ is out of scope: regression suites and fixtures build SQL deliberately " +
    "and are not request-reachable. Runtime code paths live under src/ and prisma/.",
);
