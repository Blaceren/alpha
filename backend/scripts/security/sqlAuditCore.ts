import fs from "node:fs";
import path from "node:path";

/**
 * Raw-SQL audit core.
 *
 * Split out of `sqlInjectionAudit.ts` so the classifier can be exercised by a
 * regression suite against fixtures. This module has no side effects: it never
 * exits, never writes and never scans unless asked.
 *
 * WHAT CHANGED AND WHY (TB-2 / TB1-F-003)
 * ---------------------------------------
 * The previous scanner matched raw-API tokens line-by-line and accepted a usage
 * only if it appeared in a two-entry allowlist. That allowlist predated
 * Curriculum V2, so three legitimate `Prisma.sql` call sites were reported as
 * findings, and because `scripts/` was in scope another 219 findings came from
 * test code that is not a runtime attack surface. The audit therefore always
 * exited 1 and had stopped being a usable signal.
 *
 * This version classifies each call site instead of pattern-matching a line:
 *
 *   $queryRaw`...`                 tagged template  -> SAFE  (Prisma binds ${})
 *   $queryRaw<T>(Prisma.sql`...`)  Prisma.sql value -> SAFE  (Prisma binds ${})
 *   $queryRawUnsafe / $executeRawUnsafe             -> UNSAFE unless allowlisted
 *   $queryRaw(anythingElse)                         -> UNCLASSIFIED -> reported
 *
 * The unsafe APIs are still rejected outright, string-built SQL is still
 * rejected, and anything the classifier cannot parse is reported rather than
 * assumed safe — the scanner fails closed.
 */

export type Severity = "safe" | "unsafe" | "unclassified";

export type Finding = {
  file: string;
  line: number;
  message: string;
};

export type Usage = {
  file: string;
  line: number;
  api: string;
  severity: Severity;
  reason: string;
};

/**
 * Directories scanned for runtime raw SQL. `scripts/` is deliberately absent:
 * regression suites, fixtures and this auditor itself construct SQL on purpose
 * and are not reachable by a request. Keeping them in scope produced 219
 * findings that trained readers to ignore the tool.
 */
export const PRODUCTION_SCAN_ROOTS = ["src", "prisma"] as const;

/** Never descended into, in any root. */
export const IGNORED_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "coverage",
  ".git",
]);

/**
 * Non-runtime raw SQL that is accepted with justification. `prisma/migrate.ts`
 * is the migration runner: it executes checked-in migration files at deploy
 * time, never in response to a request, and cannot use `Prisma.sql` because the
 * statements are read from disk as text.
 */
export const ALLOWED_UNSAFE_FILES = new Map<string, string>([
  [
    "prisma/migrate.ts",
    "migration runner: executes checked-in migration SQL, non-runtime, no request-derived input",
  ],
]);

const RAW_API_RE = /\$(queryRaw|executeRaw)(Unsafe)?/g;

/**
 * Blank out `//` and block comments, replacing each removed character with a
 * space so every byte offset and line number is preserved.
 *
 * Without this the scanner matches raw-API names inside prose — a comment that
 * merely mentions `$queryRaw` was reported as an unclassified call site. String
 * and template literals are skipped so a `//` inside a URL or SQL string is not
 * mistaken for a comment.
 *
 * Failure direction is deliberate: if this ever mis-tracks a literal it can only
 * blank real code, which downgrades a call site to `unclassified` (reported), and
 * never upgrades anything to `safe`.
 */
export function stripCommentsPreservingOffsets(source: string): string {
  const out = source.split("");
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      let end = i;
      while (end < source.length && source[end] !== "\n") end += 1;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === quote) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    i += 1;
  }

  return out.join("");
}

/**
 * Skip a balanced `<...>` type-argument list. Returns the index just past it,
 * or null when the brackets do not balance within the window (fail closed).
 */
function skipTypeArguments(source: string, start: number): number | null {
  if (source[start] !== "<") return start;
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "<") depth += 1;
    else if (ch === ">") {
      depth -= 1;
      if (depth === 0) return i + 1;
    } else if (ch === ";" || ch === "\n") {
      // A statement or line break inside type arguments means this is not a
      // type-argument list at all — refuse to guess.
      if (depth > 0 && ch === ";") return null;
    }
  }
  return null;
}

function skipWhitespace(source: string, start: number): number {
  let i = start;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  return i;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/).length;
}

/**
 * Classify every raw-SQL call site in one file's source text.
 * Pure: takes text, returns classifications.
 */
export function classifyRawSqlUsages(rawSource: string, file: string): Usage[] {
  const usages: Usage[] = [];
  // Comments are prose, not call sites. Offsets are preserved so reported line
  // numbers still point at the real source.
  const source = stripCommentsPreservingOffsets(rawSource);
  RAW_API_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = RAW_API_RE.exec(source)) !== null) {
    const api = match[0];
    const isUnsafeApi = Boolean(match[2]);
    const line = lineOf(source, match.index);
    const after = match.index + api.length;

    if (isUnsafeApi) {
      const justification = ALLOWED_UNSAFE_FILES.get(file);
      usages.push({
        file,
        line,
        api,
        severity: justification ? "safe" : "unsafe",
        reason: justification
          ? `allowlisted non-runtime usage: ${justification}`
          : `${api} bypasses parameter binding and must not be used in runtime code`,
      });
      continue;
    }

    const afterTypes = skipTypeArguments(source, after);
    if (afterTypes === null) {
      usages.push({
        file,
        line,
        api,
        severity: "unclassified",
        reason: "unbalanced type arguments — call shape could not be parsed",
      });
      continue;
    }

    const cursor = skipWhitespace(source, afterTypes);
    const ch = source[cursor];

    // `$queryRaw`SELECT 1`` — Prisma tagged template, interpolations are bound.
    if (ch === "`") {
      usages.push({
        file,
        line,
        api,
        severity: "safe",
        reason: "Prisma tagged template — interpolations are parameter-bound",
      });
      continue;
    }

    if (ch === "(") {
      const argStart = skipWhitespace(source, cursor + 1);
      const argument = source.slice(argStart, argStart + 40);
      // `Prisma.sql`...`` (optionally composed with Prisma.join/Prisma.empty)
      // is Prisma's parameterised-SQL builder.
      if (/^Prisma\.(sql`|join\(|empty\b|raw\()/.test(argument)) {
        if (/^Prisma\.raw\(/.test(argument)) {
          usages.push({
            file,
            line,
            api,
            severity: "unsafe",
            reason: "Prisma.raw() injects unescaped SQL text and is not parameter-bound",
          });
          continue;
        }
        usages.push({
          file,
          line,
          api,
          severity: "safe",
          reason: "Prisma.sql value — interpolations are parameter-bound",
        });
        continue;
      }

      usages.push({
        file,
        line,
        api,
        severity: "unclassified",
        reason:
          "raw SQL argument is not a Prisma.sql value — string-built or variable SQL is not parameter-bound",
      });
      continue;
    }

    usages.push({
      file,
      line,
      api,
      severity: "unclassified",
      reason: "raw SQL call shape could not be classified",
    });
  }

  return usages;
}

export function walk(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

function toRelative(projectRoot: string, file: string) {
  return path.relative(projectRoot, file).replace(/\\/g, "/");
}

/** Scan the production roots and return only the usages that are not safe. */
export function scanRawSql(
  projectRoot: string,
  roots: readonly string[] = PRODUCTION_SCAN_ROOTS,
): Finding[] {
  const findings: Finding[] = [];
  for (const root of roots) {
    for (const file of walk(path.join(projectRoot, root))) {
      const relativeFile = toRelative(projectRoot, file);
      const source = fs.readFileSync(file, "utf8");
      for (const usage of classifyRawSqlUsages(source, relativeFile)) {
        if (usage.severity === "safe") continue;
        findings.push({
          file: usage.file,
          line: usage.line,
          message: `[${usage.severity}] ${usage.api}: ${usage.reason}`,
        });
      }
    }
  }
  return findings;
}

/**
 * Pocket secret-alias redaction check. Behaviour is unchanged from the previous
 * auditor — this phase does not touch Pocket postback code or its contract.
 */
export function scanPocketSecretStorage(projectRoot: string): Finding[] {
  const findings: Finding[] = [];
  const file = path.join(projectRoot, "src/app/api/postbacks/pocket/route.ts");
  if (!fs.existsSync(file)) return findings;

  const source = fs.readFileSync(file, "utf8");
  if (source.includes("Object.fromEntries(params.entries())")) {
    findings.push({
      file: toRelative(projectRoot, file),
      line: 1,
      message: "Pocket raw payload stores query params directly; secret aliases must be redacted.",
    });
  }

  for (const key of ["ow", "secret", "token"]) {
    if (!source.includes(key)) {
      findings.push({
        file: toRelative(projectRoot, file),
        line: 1,
        message: `Pocket secret alias ${key} is not covered by validation/redaction.`,
      });
    }
  }

  return findings;
}
