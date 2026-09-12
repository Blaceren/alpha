/**
 * THE CANONICAL AUDIT-PACKAGE LEAK SCAN.
 *
 * WHY THIS IS A SHIPPED TOOL AND NOT ANOTHER THROWAWAY SCRIPT. Every audit
 * phase in this product's history has ended by scanning its own package for
 * leaked credentials, and every phase wrote that scanner again. One of those
 * ad-hoc scanners followed a `node_modules` symlink out of the package it was
 * asked about and scanned an entire dependency tree — which is both a wasted
 * hour and, more importantly, a scan whose "0 findings" meant nothing, because
 * nobody could say afterwards what had actually been read. A safety property
 * that has to be re-derived by each author is a safety property that will
 * eventually be forgotten.
 *
 * THE FOUR PROPERTIES THIS ENCODES PERMANENTLY
 *
 *   EXPLICIT PATH      one root, passed in, resolved absolute. There is no
 *                      default, no cwd fallback and no glob. A scanner that can
 *                      be run with no argument is a scanner that will one day
 *                      be run against `/`.
 *
 *   SYMLINK-SAFE       every entry is `lstat`-ed and a symlink is RECORDED AND
 *                      NOT FOLLOWED. This is the exact property whose absence
 *                      caused the incident above. Directories are additionally
 *                      checked to stay under the root after resolution, so a
 *                      hard link or a `..` cannot walk out either.
 *
 *   BOUNDED            hard ceilings on files visited, bytes read per file and
 *                      directory depth. Exceeding one is a LOUD FAILURE, never
 *                      a silent truncation: a scan that quietly stopped early
 *                      and reported "clean" is worse than no scan.
 *
 *   NEVER PRINTS WHAT IT FINDS  a match reports the file, the line number and
 *                      the CLASS of secret. The matched text is never printed,
 *                      never logged and never written to the report — a leak
 *                      report that quotes the leak has republished it.
 *
 * IT DELETES NOTHING. No `rm`, no unlink, no truncate, no quarantine move. It
 * reads and reports; a human decides.
 *
 * USAGE
 *
 *   npx tsx scripts/ops/auditPackageLeakScan.ts /home/ubuntu/audits/<package>
 *
 * Exit 0 = no findings. Exit 1 = findings. Exit 2 = refused to run, or a bound
 * was exceeded. Both non-zero codes mean "do not publish this package yet".
 */
import fs from "node:fs";
import path from "node:path";

/** Ceilings. Generous for an audit package, fatal for a dependency tree. */
export const LIMITS = {
  maxFiles: 2_000,
  maxBytesPerFile: 4 * 1024 * 1024,
  maxDepth: 8,
  maxTotalBytes: 256 * 1024 * 1024,
} as const;

/**
 * Directory names that must never be descended into, even if a package somehow
 * contains one. Belt and braces alongside the symlink rule: `node_modules` was
 * reached through a symlink last time, and it would be just as wrong to scan a
 * real one.
 */
const REFUSED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  "releases",
  "dist",
  "build",
  "coverage",
]);

/** Extensions worth reading. A screenshot cannot leak a password as text. */
const TEXTUAL = new Set([
  ".md",
  ".txt",
  ".json",
  ".log",
  ".csv",
  ".tsv",
  ".yaml",
  ".yml",
  ".conf",
  ".sql",
  ".sh",
  ".ts",
  ".env",
  "",
]);

export type SecretClass =
  | "password_assignment"
  | "password_hash"
  | "authorization_header"
  | "basic_auth_inline"
  | "basic_auth_encoded"
  | "cookie_or_session"
  | "provider_query_secret"
  | "private_key"
  | "email_address";

/**
 * The classes, as patterns. Each one exists because a real audit package could
 * plausibly carry it — not as a generic secret-scanner wishlist.
 *
 * Deliberately NOT included: anything matching high-entropy strings. An audit
 * package is full of sha256 digests, build ids and commit hashes, all of which
 * are meant to be there, and a scanner that cries wolf on every one of them is
 * a scanner whose output gets skimmed.
 */
export const PATTERNS: ReadonlyArray<readonly [SecretClass, RegExp]> = [
  ["password_assignment", /\b(password|passwd|pwd)\s*[:=]\s*["']?[^\s"',;]{6,}/i],
  ["password_hash", /\$(2[aby]|apr1|argon2[id]{1,2}|scrypt|5|6)\$[^\s"']{6,}/],
  ["authorization_header", /\bauthorization\s*:\s*(bearer|basic|token)\s+\S+/i],
  ["basic_auth_inline", /https?:\/\/[^/\s:@]+:[^/\s@]+@/i],
  ["basic_auth_encoded", /\bBasic\s+[A-Za-z0-9+/]{16,}={0,2}/],
  ["cookie_or_session", /\b(set-cookie|session(_|-)?(token|id|secret)|csrf(_|-)?token)\s*[:=]\s*\S{8,}/i],
  ["provider_query_secret", /[?&](ow|secret|token|apikey|api_key)=[^&\s"']{4,}/i],
  ["private_key", /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ["email_address", /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
];

/**
 * Placeholders an audit package legitimately contains. A finding that is
 * literally the word REDACTED is noise, and noise is how a real finding gets
 * scrolled past.
 */
const ALLOWED = [
  /redacted/i,
  /<[^>]*>/,
  /example\.(com|org|invalid)/i,
  /@ata\.invalid\b/i,
  /REPLACE[-_]/,
  /\bplaceholder\b/i,
  /\bchange-me\b/i,
  /x{6,}/i,
  /\*{4,}/,
];

export type Finding = {
  readonly file: string;
  readonly line: number;
  readonly secretClass: SecretClass;
};

export type ScanResult = {
  readonly root: string;
  readonly filesScanned: number;
  readonly filesSkippedBinary: number;
  readonly symlinksFound: number;
  readonly directoriesRefused: number;
  readonly bytesRead: number;
  readonly findings: readonly Finding[];
};

export class ScanRefused extends Error {}

function assertUnder(root: string, candidate: string): void {
  const rel = path.relative(root, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ScanRefused(`path escapes the scan root: ${candidate}`);
  }
}

/**
 * Walk one directory tree, following nothing.
 *
 * `withFileTypes` on `readdir` reports a symlink AS a symlink — it does not
 * stat through it — which is the `lstat` guarantee this function depends on.
 */
export function scanTree(rootInput: string): ScanResult {
  if (!rootInput || rootInput.trim() === "") {
    throw new ScanRefused("a scan root is required; there is no default");
  }

  const root = path.resolve(rootInput);
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink()) {
    throw new ScanRefused("the scan root itself is a symlink; pass its real path");
  }
  if (!rootStat.isDirectory()) {
    throw new ScanRefused("the scan root is not a directory");
  }
  if (root === "/" || root === path.parse(root).root) {
    throw new ScanRefused("refusing to scan a filesystem root");
  }

  const findings: Finding[] = [];
  let filesScanned = 0;
  let filesSkippedBinary = 0;
  let symlinksFound = 0;
  let directoriesRefused = 0;
  let bytesRead = 0;

  const walk = (dir: string, depth: number): void => {
    if (depth > LIMITS.maxDepth) {
      throw new ScanRefused(`directory depth limit ${LIMITS.maxDepth} exceeded at ${dir}`);
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      assertUnder(root, full);

      // THE RULE THE INCIDENT WAS ABOUT. A symlink is counted and stepped over.
      // It is never stat-ed through, never opened and never descended.
      if (entry.isSymbolicLink()) {
        symlinksFound += 1;
        continue;
      }

      if (entry.isDirectory()) {
        if (REFUSED_DIRECTORIES.has(entry.name)) {
          directoriesRefused += 1;
          continue;
        }
        walk(full, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;

      if (!TEXTUAL.has(path.extname(entry.name).toLowerCase())) {
        filesSkippedBinary += 1;
        continue;
      }

      if (filesScanned >= LIMITS.maxFiles) {
        throw new ScanRefused(
          `file limit ${LIMITS.maxFiles} exceeded — this is not an audit package`,
        );
      }

      const size = fs.lstatSync(full).size;
      if (size > LIMITS.maxBytesPerFile) {
        throw new ScanRefused(`${full} exceeds the ${LIMITS.maxBytesPerFile}-byte per-file limit`);
      }
      bytesRead += size;
      if (bytesRead > LIMITS.maxTotalBytes) {
        throw new ScanRefused(`total byte limit ${LIMITS.maxTotalBytes} exceeded`);
      }

      filesScanned += 1;
      const lines = fs.readFileSync(full, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (ALLOWED.some((allowed) => allowed.test(line))) return;
        for (const [secretClass, pattern] of PATTERNS) {
          if (pattern.test(line)) {
            // The matched text is NOT captured. Location and class only.
            findings.push({ file: path.relative(root, full), line: index + 1, secretClass });
          }
        }
      });
    }
  };

  walk(root, 0);

  return {
    root,
    filesScanned,
    filesSkippedBinary,
    symlinksFound,
    directoriesRefused,
    bytesRead,
    findings,
  };
}

export function formatReport(result: ScanResult): string {
  const byClass = new Map<SecretClass, number>();
  for (const finding of result.findings) {
    byClass.set(finding.secretClass, (byClass.get(finding.secretClass) ?? 0) + 1);
  }

  const lines = [
    "== BOUNDED LEAK SCAN ==",
    `captured: ${new Date().toISOString()}`,
    "",
    "SCOPE — explicit, single root, nothing followed:",
    `  root                 ${result.root}`,
    `  files scanned        ${result.filesScanned}`,
    `  non-textual skipped  ${result.filesSkippedBinary}`,
    `  symlinks NOT followed ${result.symlinksFound}`,
    `  directories refused  ${result.directoriesRefused}  (node_modules, .git, releases, …)`,
    `  bytes read           ${result.bytesRead}`,
    "",
    "FORBIDDEN CLASSES — 0 required for each:",
  ];

  for (const [secretClass] of PATTERNS) {
    lines.push(`  ${secretClass.padEnd(28)} ${byClass.get(secretClass) ?? 0}`);
  }

  lines.push("");
  if (result.findings.length === 0) {
    lines.push("RESULT: 0 findings");
  } else {
    lines.push(`RESULT: ${result.findings.length} finding(s) — location and class only:`);
    for (const finding of result.findings.slice(0, 100)) {
      lines.push(`  ${finding.file}:${finding.line}  ${finding.secretClass}`);
    }
    if (result.findings.length > 100) {
      lines.push(`  … and ${result.findings.length - 100} more`);
    }
  }

  return lines.join("\n");
}

if (process.argv[1] && process.argv[1].endsWith("auditPackageLeakScan.ts")) {
  const root = process.argv[2];
  try {
    const result = scanTree(root);
    console.log(formatReport(result));
    process.exit(result.findings.length === 0 ? 0 : 1);
  } catch (error) {
    // Fail-closed. A scan that could not complete is never a clean scan.
    console.error(
      "SCAN REFUSED:",
      error instanceof Error ? error.message : String(error),
      "\nusage: npx tsx scripts/ops/auditPackageLeakScan.ts <absolute-package-path>",
    );
    process.exit(2);
  }
}
