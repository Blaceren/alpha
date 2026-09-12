/**
 * FDCONF-1 — the STRUCTURAL guard: no surface may read the legacy column again.
 *
 * The behavioural suite next door proves the resolver's precedence is right.
 * This one proves the resolver is the ONLY WAY IN, by scanning the tree for the
 * shape of the defect rather than for its symptoms — the same technique
 * `affiliateRegNoCommissionRegression` uses to prove exactly one function writes
 * partner money.
 *
 * WHY A SOURCE SCAN AND NOT A TYPE. The serializer's required parameter already
 * makes the mistake a compile error THERE. But `/api/me` and `/api/crm/users`
 * build their payloads by hand from a Prisma row, and TypeScript cannot object
 * to `account.firstDepositConfirmed` in a hand-built object — it is a real,
 * correctly-typed boolean. The only thing that can object is a rule that says
 * "not from here".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const COLUMN = "firstDepositConfirmed";

/**
 * READING THE COLUMN OFF A ROW is the defect. A property access — `account
 * .firstDepositConfirmed`, `account?.firstDepositConfirmed`,
 * `user.exchangeAccount.firstDepositConfirmed` — is a surface answering the
 * product question from legacy state.
 *
 * Declaring or emitting a FIELD of the same name is not: `firstDepositConfirmed:
 * firstDeposit.confirmed` is this fix working correctly, and a type declaration
 * describes the column without consulting it. So the rule matches the dot, not
 * the word.
 */
const PROPERTY_READ = /[.?]\s*firstDepositConfirmed\b/;

/**
 * The files permitted to read the raw column off a row, each for a stated
 * reason. A deliberately SHORT list: anything added later is a decision somebody
 * has to defend in review, which is the point.
 */
const PERMITTED = new Set([
  // The resolver itself. It is what consults the legacy evidence, and the only
  // thing that may.
  "src/lib/exchange/first-deposit-truth.ts",
  "src/lib/exchange/first-deposit-truth.test.ts",
  // This file names the column in order to forbid it.
  "src/lib/exchange/first-deposit-read-authority.test.ts",
  // The legacy processor still WRITES it, so the legacy account record survives.
  // Writing is not the defect; reading it as product truth was.
  "src/lib/exchange/postbackProcessor.ts",
  // Client-side view models, whose field is fed BY the resolved server answer
  // and never by a database row.
  "src/lib/api.ts",
  "src/components/DashboardExchangeStatus.tsx",
  "src/components/CrmDashboard.tsx",
  "src/app/exchange/page.tsx",
  "src/app/admin/users/[id]/page.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Comment lines are not code; a comment explaining the retirement is welcome. */
function executableLines(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
}

describe("first deposit read authority", () => {
  const files = walk(path.join(ROOT, "src"));

  it("finds a source tree to scan at all", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("no unlisted file reads the legacy column off a row", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file);
      if (PERMITTED.has(rel)) continue;
      const hits = executableLines(readFileSync(file, "utf8")).filter((line) =>
        PROPERTY_READ.test(line),
      );
      if (hits.length > 0) offenders.push(`${rel}: ${hits[0].trim()}`);
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The specific regression. `serializeExchangeAccount` answered from the row
   * for as long as this platform has existed; if a future edit restores that,
   * every surface silently drifts again at once.
   */
  it("the serializer never answers from the account row", () => {
    const source = readFileSync(
      path.join(ROOT, "src/lib/exchange/account.ts"),
      "utf8",
    );
    expect(executableLines(source).join("\n")).not.toContain(`account.${COLUMN}`);
    expect(source).toContain("firstDeposit.confirmed");
  });

  /**
   * The admin route once wrote `firstDepositConfirmed: depositAmount > 0`, so a
   * staff edit to a deposit TOTAL asserted a first deposit had happened. That is
   * inference from cumulative deposits without canonical event authority.
   */
  it("no route infers a first deposit from a deposit amount", () => {
    for (const file of files) {
      const executable = executableLines(readFileSync(file, "utf8")).join("\n");
      expect(executable).not.toMatch(/firstDepositConfirmed:\s*[^,\n]*depositAmount/);
    }
  });

  /**
   * The forbidden inputs, named individually so a failure says which one came
   * back rather than merely that something did.
   */
  it.each(["balance", "checkpointBalance", "totalDeposits", "depositAmount"])(
    "the resolver never consults %s",
    (field) => {
      const source = executableLines(
        readFileSync(path.join(ROOT, "src/lib/exchange/first-deposit-truth.ts"), "utf8"),
      ).join("\n");
      expect(source).not.toContain(field);
    },
  );
});
