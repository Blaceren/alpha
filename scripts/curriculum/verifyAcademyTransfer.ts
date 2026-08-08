/**
 * PHASE-C CORRECTIONS §18 — prove the one-time Academy → Backend transfer.
 *
 * ============================== WHY THIS EXISTS ==============================
 * Phase C moved curriculum STRUCTURE and the tool/rank/community VOCABULARY into
 * Backend by transferring the values by hand, and then claimed in a source
 * comment that a regression suite pinned them against Academy. It did not. Both
 * halves of the "pin" were Backend-owned, so the copy could drift from its source
 * without a single test failing, and an independent audit had to re-derive the
 * comparison by hand to establish that the values were in fact still exact.
 *
 * This script is that comparison, mechanised. It re-parses Academy's OWN
 * `src/data/curriculum/fixture.ts` — the file the values came from — rebuilds
 * every derived list the way Academy's `buildCurriculum()` does, and diffs the
 * result against Backend's committed copies.
 *
 * ========================= NO RUNTIME DEPENDENCY, EVER =========================
 * The Academy checkout path is an EXPLICIT argument. There is no default, no
 * environment variable, no search of sibling directories and no fallback: a
 * Backend validation gate must never become "works only on a machine that happens
 * to have someone else's repository checked out". Nothing under `src/` imports
 * this file, and the ATA-100 regression suite already asserts that no Backend
 * code path reads the Academy repository at all.
 *
 * ============================== WHAT IT PROVES ==============================
 *   100 levels · 20 modules · 20 practicals · 7 mentor-review practicals
 *   20 checkpoints · 19 tool unlocks · 5 community unlocks · 20 rank transitions
 * plus, per level, title / kind / artifact / mentorReview / module placement, and
 * per checkpoint, threshold / rank / tool / channel.
 *
 * It fails loudly if EITHER side has moved. During the transfer phase that is a
 * genuine signal; once Academy consumes Backend truth through the Phase-D DTO,
 * this script has done its job and can be retired.
 *
 * USAGE
 *   npm run curriculum:verify-academy-transfer -- --academy /srv/ata/repos/academy
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ATA_CHECKPOINTS, ATA_LEVELS, ATA_MODULES } from "@/lib/curriculum/product-ata-100";
import { ATA_PRODUCT_EXPECTATIONS } from "@/lib/curriculum/package/ata-profile";
import {
  COMMUNITY_CHANNELS,
  CURRICULUM_TOOLS,
  RANK_TRANSITIONS,
} from "@/lib/curriculum/product-vocabulary";

/**
 * The digests recorded when the values were transferred.
 *
 * A mismatch is NOT a failure — Academy is allowed to evolve. It is a signal that
 * the comparison below is now checking against a different document than the one
 * the transfer was made from, and the report says so explicitly rather than
 * pretending the digest is a contract.
 */
const TRANSFERRED_FROM = {
  commit: "4c4ced398d2b2a73cdf8d95652b9171b425fdf06",
  files: {
    "src/data/curriculum/fixture.ts": "52dfedf4755bd89019d6b7017d7d39a7d8f43c2c4e8ac8b15c1d1092c01a6232",
    "docs/CURRICULUM_AND_UNLOCKS.md": "51cf7d5b15891819a4af32aa8fb3c194693e278ce7cb1aaa307d89a79486c9f2",
    "les-prog.txt": "758d83a0965cc165dc4a4948dc29ca050c8159351e9b006b4d65c0e0054d830c",
  },
} as const;

/** Academy level kinds → the Backend kinds they became. Total and explicit. */
const KIND_MAP: Record<string, string> = {
  task: "registration",
  "video-test": "video_test",
  report: "report",
  practical: "practical",
  checkpoint: "checkpoint",
};

type Mismatch = { scope: string; key: string; backend: string; academy: string };

/* ------------------------------------------------------------------ *
 * Parsing Academy's fixture, without importing Academy
 * ------------------------------------------------------------------ */

/** The array literal assigned to `name`, balanced-bracket scanned. */
function arrayLiteral(source: string, name: string): string {
  const declaration = source.indexOf(name);
  if (declaration === -1) throw new Error(`Academy fixture has no ${name}`);
  const start = source.indexOf("= [", declaration);
  if (start === -1) throw new Error(`Academy fixture ${name} is not an array literal`);
  let depth = 0;
  for (let index = start + 2; index < source.length; index += 1) {
    if (source[index] === "[") depth += 1;
    else if (source[index] === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(start + 2, index + 1);
    }
  }
  throw new Error(`Academy fixture ${name} is unterminated`);
}

/** Top-level rows of an array literal. */
function rows(literal: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  let inString = false;
  for (let index = 1; index < literal.length - 1; index += 1) {
    const character = literal[index];
    if (inString) {
      current += character;
      if (character === "\\") {
        current += literal[index + 1];
        index += 1;
      } else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      current += character;
      continue;
    }
    if (character === "[") {
      depth += 1;
      if (depth === 1) {
        current = "";
        continue;
      }
    }
    if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        out.push(current);
        continue;
      }
    }
    if (depth >= 1) current += character;
  }
  return out;
}

/** Top-level comma-separated tokens of one row. */
function tokens(row: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  let inString = false;
  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (inString) {
      current += character;
      if (character === "\\") {
        current += row[index + 1];
        index += 1;
      } else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      current += character;
      continue;
    }
    if (character === "[") depth += 1;
    if (character === "]") depth -= 1;
    if (character === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const unquote = (token: string): string => (token.startsWith('"') ? (JSON.parse(token) as string) : token);

type AcademyLevel = {
  number: number;
  title: string;
  kind: string;
  artifact: string | null;
  mentorReview: boolean;
};

type AcademyCheckpoint = {
  level: number;
  thresholdUsd: number;
  rankCode: string;
  toolCode: string | null;
  toolName: string | null;
  channelCode: string | null;
  channelName: string | null;
};

function parseAcademy(academyRoot: string) {
  const fixturePath = path.join(academyRoot, "src/data/curriculum/fixture.ts");
  const source = readFileSync(fixturePath, "utf8");

  const levels: AcademyLevel[] = rows(arrayLiteral(source, "const LEVEL_ROWS")).map((row) => {
    const parts = tokens(row);
    let artifact: string | null = null;
    let mentorReview = false;
    for (const part of parts.slice(3)) {
      if (part === "true") mentorReview = true;
      else if (part.startsWith('"')) artifact = unquote(part);
    }
    return {
      number: Number(parts[0]),
      title: unquote(parts[1]),
      kind: unquote(parts[2]),
      artifact,
      mentorReview,
    };
  });

  const modules = rows(arrayLiteral(source, "const MODULE_ROWS")).map((row) => {
    const parts = tokens(row);
    return {
      index: Number(parts[0]),
      title: unquote(parts[1]),
      description: unquote(parts[2]),
      startLevel: Number(parts[3]),
      endLevel: Number(parts[4]),
    };
  });

  // CHECKPOINT_ROWS is a Record literal, not an array; each entry is `NN: [...]`.
  const checkpointStart = source.indexOf("const CHECKPOINT_ROWS");
  const checkpointBody = source.slice(checkpointStart, source.indexOf("\n};", checkpointStart));
  const checkpoints: AcademyCheckpoint[] = [];
  for (const match of checkpointBody.matchAll(/^\s*(\d+):\s*\[(.*)\],\s*$/gm)) {
    const level = Number(match[1]);
    const parts = tokens(match[2]);
    const family = unquote(parts[1]);
    const tier = Number(parts[2]);
    const readPair = (token: string | undefined): [string, string] | null =>
      token && token !== "undefined" ? (JSON.parse(token) as [string, string]) : null;
    const tool = readPair(parts[3]);
    const channel = readPair(parts[4]);
    checkpoints.push({
      level,
      thresholdUsd: Number(parts[0]),
      rankCode: `rank.${family}_${tier}`,
      toolCode: tool ? `tool.${tool[0]}` : null,
      toolName: tool ? tool[1] : null,
      channelCode: channel ? `channel.${channel[0]}` : null,
      channelName: channel ? channel[1] : null,
    });
  }

  return { levels, modules, checkpoints };
}

/* ------------------------------------------------------------------ *
 * Compare
 * ------------------------------------------------------------------ */

function compare(academyRoot: string): { mismatches: Mismatch[]; digests: string[] } {
  const mismatches: Mismatch[] = [];
  const add = (scope: string, key: string, backend: unknown, academy: unknown) => {
    mismatches.push({ scope, key, backend: String(backend), academy: String(academy) });
  };

  const digests: string[] = [];
  for (const [relative, expected] of Object.entries(TRANSFERRED_FROM.files)) {
    try {
      const actual = createHash("sha256").update(readFileSync(path.join(academyRoot, relative))).digest("hex");
      digests.push(
        `${actual === expected ? "same" : "MOVED"}  ${relative}\n        transferred-from ${expected}\n        checkout         ${actual}`,
      );
    } catch {
      digests.push(`ABSENT ${relative}`);
    }
  }

  const academy = parseAcademy(academyRoot);

  /* counts */
  const counts: Array<[string, number, number]> = [
    ["levels", ATA_LEVELS.length, academy.levels.length],
    ["modules", ATA_MODULES.length, academy.modules.length],
    ["checkpoints", ATA_CHECKPOINTS.length, academy.checkpoints.length],
    ["practicals", ATA_LEVELS.filter((l) => l.kind === "practical").length, academy.levels.filter((l) => l.kind === "practical").length],
    ["mentorReviewPracticals", ATA_LEVELS.filter((l) => l.mentorReview).length, academy.levels.filter((l) => l.mentorReview).length],
    ["toolUnlocks", CURRICULUM_TOOLS.length, academy.checkpoints.filter((c) => c.toolCode).length],
    ["communityUnlocks", COMMUNITY_CHANNELS.length, academy.checkpoints.filter((c) => c.channelCode).length],
    ["rankTransitions", RANK_TRANSITIONS.length, academy.checkpoints.length],
  ];
  for (const [key, backend, academyCount] of counts) {
    if (backend !== academyCount) add("counts", key, backend, academyCount);
  }
  // The product constants are hand-typed, so they are checked too: a source list
  // and its declared size must not be able to drift together.
  const expectations: Array<[string, number, number]> = [
    ["levels", ATA_PRODUCT_EXPECTATIONS.levels, academy.levels.length],
    ["modules", ATA_PRODUCT_EXPECTATIONS.modules, academy.modules.length],
    ["checkpoints", ATA_PRODUCT_EXPECTATIONS.checkpoints, academy.checkpoints.length],
    ["practicals", ATA_PRODUCT_EXPECTATIONS.practicals, academy.levels.filter((l) => l.kind === "practical").length],
    ["mentorReviews", ATA_PRODUCT_EXPECTATIONS.mentorReviews, academy.levels.filter((l) => l.mentorReview).length],
    ["toolUnlocks", ATA_PRODUCT_EXPECTATIONS.toolUnlocks, academy.checkpoints.filter((c) => c.toolCode).length],
    ["communityUnlocks", ATA_PRODUCT_EXPECTATIONS.communityUnlocks, academy.checkpoints.filter((c) => c.channelCode).length],
  ];
  for (const [key, declared, actual] of expectations) {
    if (declared !== actual) add("declaredConstants", key, declared, actual);
  }

  /* levels */
  for (const academyLevel of academy.levels) {
    const backendLevel = ATA_LEVELS.find((level) => level.levelNumber === academyLevel.number);
    if (!backendLevel) {
      add("levels", `L${academyLevel.number}`, "absent", academyLevel.title);
      continue;
    }
    if (backendLevel.title !== academyLevel.title) add("levels", `L${academyLevel.number}.title`, backendLevel.title, academyLevel.title);
    const mappedKind = KIND_MAP[academyLevel.kind] ?? `?${academyLevel.kind}`;
    if (backendLevel.kind !== mappedKind) add("levels", `L${academyLevel.number}.kind`, backendLevel.kind, `${academyLevel.kind} → ${mappedKind}`);
    if ((backendLevel.artifact ?? null) !== academyLevel.artifact) {
      add("levels", `L${academyLevel.number}.artifact`, backendLevel.artifact, academyLevel.artifact);
    }
    if (backendLevel.mentorReview !== academyLevel.mentorReview) {
      add("levels", `L${academyLevel.number}.mentorReview`, backendLevel.mentorReview, academyLevel.mentorReview);
    }
    const owningModule = academy.modules.find(
      (item) => academyLevel.number >= item.startLevel && academyLevel.number <= item.endLevel,
    );
    if (owningModule && backendLevel.moduleNumber !== owningModule.index) {
      add("levels", `L${academyLevel.number}.module`, backendLevel.moduleNumber, owningModule.index);
    }
  }

  /* modules */
  for (const academyModule of academy.modules) {
    const backendModule = ATA_MODULES.find((item) => item.moduleNumber === academyModule.index);
    if (!backendModule) {
      add("modules", `M${academyModule.index}`, "absent", academyModule.title);
      continue;
    }
    if (backendModule.title !== academyModule.title) add("modules", `M${academyModule.index}.title`, backendModule.title, academyModule.title);
    if (backendModule.description !== academyModule.description) {
      add("modules", `M${academyModule.index}.description`, backendModule.description, academyModule.description);
    }
    if (backendModule.startLevel !== academyModule.startLevel) add("modules", `M${academyModule.index}.startLevel`, backendModule.startLevel, academyModule.startLevel);
    if (backendModule.endLevel !== academyModule.endLevel) add("modules", `M${academyModule.index}.endLevel`, backendModule.endLevel, academyModule.endLevel);
  }

  /* checkpoints and the unlock vocabulary */
  for (const academyCheckpoint of academy.checkpoints) {
    const backendCheckpoint = ATA_CHECKPOINTS.find((item) => item.levelNumber === academyCheckpoint.level);
    if (!backendCheckpoint) {
      add("checkpoints", `L${academyCheckpoint.level}`, "absent", "present");
      continue;
    }
    const key = `L${academyCheckpoint.level}`;
    if (backendCheckpoint.thresholdUsd !== academyCheckpoint.thresholdUsd) add("checkpoints", `${key}.threshold`, backendCheckpoint.thresholdUsd, academyCheckpoint.thresholdUsd);
    if (backendCheckpoint.rankCode !== academyCheckpoint.rankCode) add("checkpoints", `${key}.rank`, backendCheckpoint.rankCode, academyCheckpoint.rankCode);
    if (backendCheckpoint.toolCode !== academyCheckpoint.toolCode) add("checkpoints", `${key}.tool`, backendCheckpoint.toolCode, academyCheckpoint.toolCode);
    if (backendCheckpoint.channelCode !== academyCheckpoint.channelCode) add("checkpoints", `${key}.channel`, backendCheckpoint.channelCode, academyCheckpoint.channelCode);

    if (academyCheckpoint.toolCode) {
      const tool = CURRICULUM_TOOLS.find((item) => item.code === academyCheckpoint.toolCode);
      if (!tool) add("tools", academyCheckpoint.toolCode, "absent", academyCheckpoint.toolName ?? "");
      else {
        if (tool.title !== academyCheckpoint.toolName) add("tools", `${tool.code}.title`, tool.title, academyCheckpoint.toolName);
        if (tool.unlockLevel !== academyCheckpoint.level) add("tools", `${tool.code}.unlockLevel`, tool.unlockLevel, academyCheckpoint.level);
      }
    }
    if (academyCheckpoint.channelCode) {
      const channel = COMMUNITY_CHANNELS.find((item) => item.code === academyCheckpoint.channelCode);
      if (!channel) add("channels", academyCheckpoint.channelCode, "absent", academyCheckpoint.channelName ?? "");
      else {
        if (channel.title !== academyCheckpoint.channelName) add("channels", `${channel.code}.title`, channel.title, academyCheckpoint.channelName);
        if (channel.unlockLevel !== academyCheckpoint.level) add("channels", `${channel.code}.unlockLevel`, channel.unlockLevel, academyCheckpoint.level);
      }
    }
    const rank = RANK_TRANSITIONS.find((item) => item.unlockLevel === academyCheckpoint.level);
    if (!rank) add("ranks", `L${academyCheckpoint.level}`, "absent", academyCheckpoint.rankCode);
    else if (rank.code !== academyCheckpoint.rankCode) add("ranks", `L${academyCheckpoint.level}`, rank.code, academyCheckpoint.rankCode);
  }

  /* Backend must not carry a tool/channel Academy never released. */
  for (const tool of CURRICULUM_TOOLS) {
    if (!academy.checkpoints.some((checkpoint) => checkpoint.toolCode === tool.code)) {
      add("tools", tool.code, "present in Backend", "absent in Academy");
    }
  }
  for (const channel of COMMUNITY_CHANNELS) {
    if (!academy.checkpoints.some((checkpoint) => checkpoint.channelCode === channel.code)) {
      add("channels", channel.code, "present in Backend", "absent in Academy");
    }
  }

  return { mismatches, digests };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function main(): void {
  const args = process.argv.slice(2);
  const index = args.indexOf("--academy");
  if (index === -1 || !args[index + 1]) {
    console.error(
      "usage: verifyAcademyTransfer.ts --academy <path to the accepted Academy checkout>\n" +
        "The path is explicit on purpose: Backend must never depend on another repository being present.",
    );
    process.exitCode = 2;
    return;
  }
  const academyRoot = path.resolve(args[index + 1]);
  const { mismatches, digests } = compare(academyRoot);

  console.log(`academy checkout: ${academyRoot}`);
  console.log(`transferred from: ${TRANSFERRED_FROM.commit}`);
  for (const digest of digests) console.log(`  ${digest}`);
  console.log("");
  console.log(
    `structure: ${ATA_LEVELS.length} levels · ${ATA_MODULES.length} modules · ` +
      `${ATA_LEVELS.filter((l) => l.kind === "practical").length} practicals ` +
      `(${ATA_LEVELS.filter((l) => l.mentorReview).length} mentor-review) · ` +
      `${ATA_CHECKPOINTS.length} checkpoints · ${CURRICULUM_TOOLS.length} tools · ` +
      `${COMMUNITY_CHANNELS.length} channels · ${RANK_TRANSITIONS.length} ranks`,
  );

  if (mismatches.length === 0) {
    console.log("\nTRANSFER VERIFIED: every value matches the accepted Academy source.");
    return;
  }
  console.error(`\nTRANSFER DRIFT: ${mismatches.length} mismatch(es)`);
  for (const mismatch of mismatches.slice(0, 40)) {
    console.error(`  [${mismatch.scope}] ${mismatch.key}\n      backend: ${mismatch.backend}\n      academy: ${mismatch.academy}`);
  }
  process.exitCode = 1;
}

main();

export { compare, parseAcademy, TRANSFERRED_FROM };
