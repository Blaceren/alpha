/**
 * COMMUNITY-V1 (Academy) — the boundaries this surface must not cross, held as
 * SOURCE FACTS.
 *
 * The same technique the Backend module uses, and for the same reason: "the
 * Academy does not re-derive access" and "no staff route is reachable from the
 * learner origin" are claims about everything this code can ever do, not about
 * one render.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function collect(dir: string, filter: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full, filter));
    else if (filter(entry.name)) out.push(full);
  }
  return out;
}

const isSource = (name: string) =>
  (name.endsWith(".ts") || name.endsWith(".tsx")) && !name.includes(".test.");

const FEATURE = collect(path.join(process.cwd(), "src/features/community"), isSource);
const CLIENT = collect(path.join(process.cwd(), "src/lib/community"), isSource);
const PROXY_ROUTES = collect(path.join(process.cwd(), "src/app/api/backend/community"), isSource);

const ALL = [...FEATURE, ...CLIENT, ...PROXY_ROUTES].map((file) => ({
  file: path.relative(process.cwd(), file),
  text: readFileSync(file, "utf8"),
}));

const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("the Academy does not re-derive Community access", () => {
  it("names no space code and no unlock level anywhere in the client surface", () => {
    // The five space codes and their thresholds live in exactly one place: the
    // database, read by one Backend resolver. A copy here would be a second
    // gating rule that drifts silently the first time one of them changes.
    for (const source of ALL) {
      const body = code(source.text);
      expect(body, source.file).not.toContain("channel.start_questions");
      expect(body, source.file).not.toContain("channel.chart_review");
      expect(body, source.file).not.toContain("channel.advanced_circle");
      expect(body, source.file).not.toMatch(/readFromLevel|writeFromLevel/);
    }
  });

  it("never compares a level to decide access", () => {
    for (const source of ALL) {
      const body = code(source.text);
      expect(body, source.file).not.toMatch(/completedLevels\s*[<>]=?/);
      expect(body, source.file).not.toMatch(/level\s*[<>]=?\s*\d/);
    }
  });

  it("never reads the legacy V1 progress columns", () => {
    for (const source of ALL) {
      const body = code(source.text);
      expect(body, source.file).not.toMatch(/\.xp\b/);
      expect(body, source.file).not.toMatch(/user\.level\b/i);
    }
  });
});

describe("no staff surface is reachable from the learner origin", () => {
  it("no Community file names the CRM moderation path", () => {
    for (const source of ALL) {
      expect(source.text, source.file).not.toContain("/api/crm/");
      expect(source.text, source.file).not.toContain("community_moderate");
      expect(source.text, source.file).not.toContain("moderation");
    }
  });

  it("every proxy route is under /api/backend/community and none under crm", () => {
    for (const route of PROXY_ROUTES) {
      expect(route).toContain(path.join("api", "backend", "community"));
      expect(route).not.toContain(`${path.sep}crm${path.sep}`);
    }
  });
});

describe("learner-authored text is never rendered as markup", () => {
  it("uses no dangerouslySetInnerHTML and imports no markdown renderer", () => {
    // Comments are stripped first: this file asserts what the CODE does, and a
    // comment explaining why the escape hatch is not used would otherwise fail
    // the test that proves it is not used.
    for (const source of ALL) {
      const body = code(source.text);
      expect(body, source.file).not.toContain("dangerouslySetInnerHTML");
      expect(body, source.file).not.toMatch(/from "(react-)?markdown/);
      expect(body, source.file).not.toMatch(/innerHTML/);
      expect(body, source.file).not.toContain("sanitize");
    }
  });
});

describe("Community shows no financial or performance vocabulary", () => {
  it("names no money, no P&L and no leaderboard", () => {
    const FORBIDDEN = ["balance", "deposit", "profit", "pnl", "payout", "leaderboard", "winrate", "депозит", "баланс", "прибыл"];
    for (const source of ALL) {
      const body = code(source.text).toLowerCase();
      for (const word of FORBIDDEN) {
        expect(body, `${source.file} must not name "${word}"`).not.toContain(word);
      }
    }
  });

  it("never renders XP or a rank as social standing", () => {
    for (const source of ALL) {
      const body = code(source.text);
      expect(body, source.file).not.toMatch(/\bXP\b/);
      expect(body, source.file).not.toMatch(/ранг|rank/i);
    }
  });
});
