import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const expectedVersion = "0.1.0-beta.1";
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string };

const requiredDocs = [
  "CHANGELOG.md",
  "README.md",
  "docs/version.md",
  "docs/mvp-status.md",
  "docs/release-candidate.md",
  "docs/code-freeze-policy.md",
  "docs/bugfix-policy.md",
  "docs/closed-testing-handoff.md",
  "docs/closed-beta-runbook.md",
  "docs/closed-beta-test-plan.md",
  "docs/test-accounts.md",
  "docs/qa-checklist.md",
  "docs/demo-script.md",
  "docs/mvp-limitations.md",
  "docs/bug-report-template.md",
  "docs/regression-checklist.md",
  "docs/backup-restore.md",
];

const requiredText: Array<[string, string]> = [
  ["docs/version.md", expectedVersion],
  ["docs/version.md", "bugfix-only"],
  ["docs/mvp-status.md", "Closed Testing MVP"],
  ["docs/mvp-status.md", "Not production-grade"],
  ["docs/release-candidate.md", "Code freeze"],
  ["docs/closed-beta-runbook.md", "db:backup"],
  ["docs/closed-testing-handoff.md", "verify:rc"],
  ["docs/mvp-limitations.md", "real Pocket provider"],
  ["docs/bugfix-policy.md", "new product features"],
  ["docs/code-freeze-policy.md", "bugfix-only"],
  ["docs/bug-report-template.md", "Severity"],
  ["docs/regression-checklist.md", "Backup/restore"],
];

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const failures: string[] = [];

if (pkg.version !== expectedVersion) {
  failures.push(`package.json version is ${pkg.version}, expected ${expectedVersion}`);
}

for (const relativePath of requiredDocs) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    failures.push(`missing required doc: ${relativePath}`);
  }
}

for (const [relativePath, marker] of requiredText) {
  if (fs.existsSync(path.join(root, relativePath)) && !read(relativePath).includes(marker)) {
    failures.push(`${relativePath} does not include marker: ${marker}`);
  }
}

if (failures.length > 0) {
  console.error("RELEASE_DOCS_CHECK_FAILED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`RELEASE_DOCS_CHECK_DONE: ${requiredDocs.length} docs checked for ${expectedVersion}`);
