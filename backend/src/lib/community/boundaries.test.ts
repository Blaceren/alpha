/**
 * COMMUNITY-V1 — the boundaries, held as SOURCE FACTS rather than behaviour.
 *
 * WHY THIS FILE READS SOURCE INSTEAD OF CALLING FUNCTIONS. "Posting does not
 * award XP" is a claim about everything the module can ever do, not about one
 * code path. A behavioural test proves one call did not write XP; this proves
 * the module cannot express the write at all, which is the property the phase
 * contract actually asks for:
 *
 *   - Community writes do not complete Academy progression
 *   - Community reactions/posts do not alter XP
 *   - no new Community XP economy
 *   - Community never reuses internal Learner Operations records
 *   - Community does not modify Pocket, DEP/RDEP, affiliate or checkpoint state
 *
 * The equivalent trick is already used elsewhere in this repository for exactly
 * this kind of "cannot", and it survives refactors that a mocked call does not.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LIB_DIR = path.join(process.cwd(), "src/lib/community");
const API_DIR = path.join(process.cwd(), "src/app/api/community");

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const SOURCES = [...collect(LIB_DIR), ...collect(API_DIR)].map((file) => ({
  file: path.relative(process.cwd(), file),
  text: readFileSync(file, "utf8"),
}));

/**
 * A Prisma WRITE against a named delegate: `prisma.x.create`, `tx.x.update`,
 * `db.x.upsert`, `deleteMany`, `updateMany`, `createMany`.
 */
function writesTo(text: string, delegate: string): boolean {
  const re = new RegExp(
    `\\.${delegate}\\s*\\.\\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\\b`,
  );
  return re.test(text);
}

describe("Community never writes progression", () => {
  const PROGRESSION_DELEGATES = [
    "userLevelProgress",
    "userCurriculumEnrollment",
    "xPTransaction",
    "xpEvent",
    "userTaskProgress",
    "assessmentAttempt",
    "reportSubmission",
    "checkpointVerificationAttempt",
  ];

  for (const delegate of PROGRESSION_DELEGATES) {
    it(`does not write ${delegate} anywhere in the Community module`, () => {
      const offenders = SOURCES.filter((s) => writesTo(s.text, delegate)).map((s) => s.file);
      expect(offenders).toEqual([]);
    });
  }

  it("does not write User at all — so it cannot touch User.level or User.xp", () => {
    const offenders = SOURCES.filter((s) => writesTo(s.text, "user")).map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it("never names the V1 progress columns", () => {
    // `User.level` is live V1 authority. Community neither reads it as V2
    // authority nor writes it to make the numbers agree.
    for (const source of SOURCES) {
      const code = source.text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code, `${source.file} must not reference user.level`).not.toMatch(/\buser\.level\b/i);
      expect(code, `${source.file} must not reference user.xp`).not.toMatch(/\buser\.xp\b/i);
    }
  });

  it("imports nothing from the curriculum progression owner", () => {
    for (const source of SOURCES) {
      expect(source.text, source.file).not.toMatch(/from "@\/lib\/curriculum\//);
    }
  });
});

describe("Community does not reach into the closed commercial domains", () => {
  const FOREIGN_DELEGATES = [
    "pocketTraderIdentity",
    "pocketProviderEvent",
    "providerIngressEvent",
    "affiliateAttribution",
    "affiliateCommission",
    "affiliateConversionEvent",
    "affiliateCpaQualification",
    "growthEvent",
    "checkpoint",
    "exchangeAccount",
  ];

  for (const delegate of FOREIGN_DELEGATES) {
    it(`never touches ${delegate}`, () => {
      for (const source of SOURCES) {
        expect(source.text, source.file).not.toContain(`.${delegate}.`);
      }
    });
  }
});

describe("Community and the internal operational record stay separate", () => {
  it("never reads a Learner Operations note, case, escalation or QA review", () => {
    for (const source of SOURCES) {
      expect(source.text, source.file).not.toMatch(/\.learnerOps[A-Z]\w*\./);
      expect(source.text, source.file).not.toMatch(/from "@\/lib\/learner-ops\//);
    }
  });

  it("never writes the legacy chat tables", () => {
    // V1 chat keeps working and Community does not reach into it. Two products,
    // two tables, no join.
    for (const delegate of ["chatMessage", "chatChannel", "chatMute", "chatModerationLog"]) {
      const offenders = SOURCES.filter((s) => s.text.includes(`.${delegate}.`)).map((s) => s.file);
      expect(offenders, delegate).toEqual([]);
    }
  });
});

describe("Community emits no financial or performance vocabulary", () => {
  it("has no field, type or literal naming money or trading performance", () => {
    const FORBIDDEN = [
      "balance",
      "deposit",
      "profit",
      "pnl",
      "p&l",
      "payout",
      "commission",
      "leaderboard",
      "winRate",
      "roi",
      "equity",
      "signal",
    ];
    for (const source of SOURCES) {
      const code = source.text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").toLowerCase();
      for (const word of FORBIDDEN) {
        expect(code, `${source.file} must not name "${word}"`).not.toContain(word);
      }
    }
  });
});

describe("every write route resolves access before it writes", () => {
  /**
   * The progression gate lives in the ROUTE, not in the service — the service
   * documents that authority is resolved before it is called, matching the
   * Learner Operations shape. That is a real property and it needs a real
   * guard, because a future write route that forgot the check would compile,
   * pass its own tests, and quietly let a learner post into a space their
   * progression has not opened.
   *
   * Ownership is the other half and it IS enforced inside the service, where a
   * caller cannot skip it.
   */
  const WRITE_ROUTES = SOURCES.filter(
    (s) => s.file.startsWith("src/app/api/community/") && /export async function POST/.test(s.text),
  );

  it("finds the write routes at all", () => {
    expect(WRITE_ROUTES.length).toBeGreaterThanOrEqual(4);
  });

  for (const route of [
    "src/app/api/community/spaces/[spaceCode]/discussions/route.ts",
    "src/app/api/community/discussions/[discussionId]/replies/route.ts",
  ]) {
    it(`${route} checks canWrite before writing`, () => {
      const source = SOURCES.find((s) => s.file === route);
      expect(source, `${route} not found`).toBeDefined();
      expect(source!.text).toContain("resolveCommunityAccess");
      expect(source!.text).toContain("canWrite");
    });
  }

  it("every learner write route resolves access", () => {
    for (const route of WRITE_ROUTES) {
      // The removal route is the exception and is allowed to be: it authorizes
      // on OWNERSHIP, which the service enforces, and a learner may withdraw
      // their own words from a space that has since closed to them.
      if (route.file.endsWith("content/remove/route.ts")) continue;
      expect(route.text, route.file).toContain("resolveCommunityAccess");
    }
  });
});

describe("the staff surface is unreachable from the learner origin", () => {
  it("keeps every learner route out of the CRM namespace", () => {
    const learnerRoutes = collect(API_DIR);
    for (const route of learnerRoutes) {
      expect(route).not.toContain(`${path.sep}crm${path.sep}`);
    }
  });

  it("never calls the moderator gate from a learner route", () => {
    for (const source of SOURCES.filter((s) => s.file.startsWith("src/app/api/community/"))) {
      expect(source.text, source.file).not.toContain("requireCommunityModerator");
    }
  });
});
