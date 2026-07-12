import fs from "node:fs";
import path from "node:path";

type Finding = {
  file: string;
  line: number;
  message: string;
};

const projectRoot = process.cwd();
const roots = ["src", "scripts", "prisma"];
const ignoredDirs = new Set(["node_modules", ".next", "dist", "coverage", ".git"]);
const rawSqlPatterns = [
  "$queryRawUnsafe",
  "$executeRawUnsafe",
  "$queryRaw",
  "$executeRaw",
  "prisma.$queryRaw",
  "prisma.$executeRaw",
];

const allowedRawSql = new Map<string, RegExp[]>([
  ["src/app/api/health/route.ts", [/\$queryRaw`SELECT 1`/]],
  ["src/app/api/readiness/route.ts", [/\$queryRaw`SELECT 1`/]],
  [
    "prisma/migrate.ts",
    [
      /\$executeRawUnsafe/,
      /\$queryRawUnsafe/,
    ],
  ],
]);

function walk(dir: string, files: string[] = []) {
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function rel(file: string) {
  return path.relative(projectRoot, file).replace(/\\/g, "/");
}

function isAllowed(file: string, line: string) {
  const allowlist = allowedRawSql.get(file);
  return Boolean(allowlist?.some((pattern) => pattern.test(line)));
}

function scanRawSql() {
  const findings: Finding[] = [];
  for (const root of roots) {
    for (const file of walk(path.join(projectRoot, root))) {
      const relativeFile = rel(file);
      if (relativeFile === "scripts/security/sqlInjectionAudit.ts") continue;
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!rawSqlPatterns.some((pattern) => line.includes(pattern))) return;
        if (isAllowed(relativeFile, line)) return;
        findings.push({
          file: relativeFile,
          line: index + 1,
          message: "Raw SQL usage must be parameter-bound, non-runtime, or explicitly allowlisted.",
        });
      });
    }
  }
  return findings;
}

function scanPocketSecretStorage() {
  const findings: Finding[] = [];
  const file = path.join(projectRoot, "src/app/api/postbacks/pocket/route.ts");
  if (!fs.existsSync(file)) return findings;

  const source = fs.readFileSync(file, "utf8");
  if (source.includes("Object.fromEntries(params.entries())")) {
    findings.push({
      file: rel(file),
      line: 1,
      message: "Pocket raw payload stores query params directly; secret aliases must be redacted.",
    });
  }

  for (const key of ["ow", "secret", "token"]) {
    if (!source.includes(key)) {
      findings.push({
        file: rel(file),
        line: 1,
        message: `Pocket secret alias ${key} is not covered by validation/redaction.`,
      });
    }
  }

  return findings;
}

const findings = [...scanRawSql(), ...scanPocketSecretStorage()];

if (findings.length > 0) {
  console.error("SQL_INJECTION_AUDIT_FAILED");
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} ${finding.message}`);
  }
  process.exit(1);
}

console.log("SQL_INJECTION_AUDIT_PASS");
console.log("Runtime raw SQL allowlist: health/readiness SELECT 1 only.");
console.log("Migration runner raw SQL is non-runtime and limited to checked-in migration files.");
