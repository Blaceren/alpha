/**
 * PHASE-C — ATA-100 product profile and canonical converter regression.
 *
 * Covers the product contract (exactly 100 levels, 20 modules, canonical codes,
 * the committed unlock vocabulary, the practical mapping, the gate structure),
 * the determinism of the converter, and the separation between the GENERIC
 * package engine and the ATA profile — in particular that the 4-level approved
 * first slice keeps passing generic validation and is never judged against a
 * hundred-level product contract.
 *
 * In memory only: no database, no network, no live data.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  ATA_CHECKPOINTS,
  ATA_LEVELS,
  ATA_MODULES,
  canonicalLevelCode,
  completionContractFor,
  gateIntegrationCode,
  legacyAcademyLevelCode,
  levelNumberFromLegacyAcademyCode,
} from "@/lib/curriculum/product-ata-100";
import {
  COMMUNITY_CHANNELS,
  CURRICULUM_TOOLS,
  findObsoleteBrand,
  PRODUCT_TOOL_CODES,
  RANK_TRANSITIONS,
} from "@/lib/curriculum/product-vocabulary";
import { isOwnedCompletionPair } from "@/lib/curriculum/completion-pairs";
import { STABLE_CODE_PATTERN } from "@/lib/curriculum/constants";
import {
  ATA_100_PACKAGE_CODE,
  ATA_PRODUCT_EXPECTATIONS,
  isAtaProduct100Package,
  validateAtaProduct100Package,
  validateAtaUnlockVocabulary,
} from "@/lib/curriculum/package/ata-profile";
import { validateCurriculumPackage } from "@/lib/curriculum/package/validate";
import type { CurriculumPackage } from "@/lib/curriculum/package/schema";

const CANONICAL_PATH = "curriculum/packages/ata-v2-canonical-100.draft.json";
const FIRST_SLICE_PATH = "curriculum/packages/ata-v2-first-slice.rev3.approved.json";

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

function loadCanonical(): CurriculumPackage {
  const result = validateCurriculumPackage(JSON.parse(readFileSync(CANONICAL_PATH, "utf8")));
  if (!result.ok) {
    throw new Error(`canonical package failed generic validation: ${JSON.stringify(result.issues.slice(0, 5))}`);
  }
  return result.package;
}

function clone(pkg: CurriculumPackage): CurriculumPackage {
  return JSON.parse(JSON.stringify(pkg)) as CurriculumPackage;
}

function profileCodes(pkg: CurriculumPackage): string[] {
  return validateAtaProduct100Package(pkg).issues.map((item) => item.code);
}

const CANONICAL = loadCanonical();

/* ------------------------------------------------------------------ *
 * 1. The canonical structural source itself
 * ------------------------------------------------------------------ */

check("1 the source declares exactly 100 levels, numbered 1..100 without gaps", () => {
  assert.equal(ATA_LEVELS.length, 100);
  ATA_LEVELS.forEach((level, index) => assert.equal(level.levelNumber, index + 1));
  assert.equal(new Set(ATA_LEVELS.map((l) => l.levelNumber)).size, 100);
});

check("2 the source declares exactly 20 modules that partition 1..100", () => {
  assert.equal(ATA_MODULES.length, 20);
  const covered = new Set<number>();
  for (const item of ATA_MODULES) {
    for (let n = item.startLevel; n <= item.endLevel; n += 1) {
      assert.ok(!covered.has(n), `level ${n} is claimed by two modules`);
      covered.add(n);
    }
  }
  assert.equal(covered.size, 100);
  for (const level of ATA_LEVELS) {
    const owner = ATA_MODULES.find((m) => level.levelNumber >= m.startLevel && level.levelNumber <= m.endLevel);
    assert.equal(level.moduleNumber, owner?.moduleNumber);
  }
});

check("3 every module ends with its checkpoint", () => {
  assert.equal(ATA_CHECKPOINTS.length, 20);
  for (const item of ATA_MODULES) {
    const last = ATA_LEVELS[item.endLevel - 1];
    assert.equal(last.kind, "checkpoint", `module ${item.moduleNumber} must end with a checkpoint`);
    assert.ok(ATA_CHECKPOINTS.some((c) => c.levelNumber === last.levelNumber));
  }
});

check("4 the level-kind census matches the committed product", () => {
  const census = ATA_LEVELS.reduce<Record<string, number>>((acc, level) => {
    acc[level.kind] = (acc[level.kind] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(census, { registration: 1, video_test: 58, report: 1, practical: 20, checkpoint: 20 });
  assert.equal(ATA_LEVELS.filter((l) => l.mentorReview).length, ATA_PRODUCT_EXPECTATIONS.mentorReviews);
});

check("5 every canonical stable code is unique and matches the approved grammar", () => {
  const codes = ATA_LEVELS.map(canonicalLevelCode);
  assert.equal(new Set(codes).size, 100);
  for (const [index, code] of codes.entries()) {
    const match = STABLE_CODE_PATTERN.exec(code);
    assert.ok(match, `${code} does not match the approved stable-code grammar`);
    assert.equal(Number(match[1]), index + 1, `${code} embeds the wrong level number`);
  }
});

check("6 the legacy Academy id mapping is total and round-trips", () => {
  for (const level of ATA_LEVELS) {
    const legacy = legacyAcademyLevelCode(level.levelNumber);
    assert.equal(levelNumberFromLegacyAcademyCode(legacy), level.levelNumber);
  }
  assert.equal(levelNumberFromLegacyAcademyCode("level.101"), null);
  assert.equal(levelNumberFromLegacyAcademyCode("level.000"), null);
  assert.equal(levelNumberFromLegacyAcademyCode("v2.l018.x"), null);
});

check("7 the L1–L4 canonical codes are identical to the approved first slice", () => {
  const approved = JSON.parse(readFileSync(FIRST_SLICE_PATH, "utf8")) as {
    modules: Array<{ levels: Array<{ levelCode: string; levelNumber: number; title: string }> }>;
  };
  for (const level of approved.modules.flatMap((m) => m.levels)) {
    const source = ATA_LEVELS[level.levelNumber - 1];
    assert.equal(canonicalLevelCode(source), level.levelCode);
    assert.equal(source.title, level.title);
  }
});

/* ------------------------------------------------------------------ *
 * 2. The completion contract (§3, §4)
 * ------------------------------------------------------------------ */

check("8 every level maps to a completion pair some production owner can complete", () => {
  for (const level of ATA_LEVELS) {
    const contract = completionContractFor(level);
    assert.ok(
      isOwnedCompletionPair(contract.type, contract.completionMethod),
      `level ${level.levelNumber} maps to unowned ${contract.type}:${contract.completionMethod}`,
    );
  }
});

check("9 the practical mapping is exactly 7 mentor_review and 13 lesson:manual", () => {
  const practicals = ATA_LEVELS.filter((l) => l.kind === "practical");
  assert.equal(practicals.length, ATA_PRODUCT_EXPECTATIONS.practicals);
  const mentor = practicals.filter((l) => completionContractFor(l).type === "mentor_review");
  const manual = practicals.filter(
    (l) => completionContractFor(l).type === "lesson" && completionContractFor(l).completionMethod === "manual",
  );
  assert.equal(mentor.length, 7);
  assert.equal(manual.length, 13);
  assert.deepEqual(mentor.map((l) => l.levelNumber), [14, 29, 44, 59, 74, 84, 94]);
  // There is no generic practice owner.
  assert.equal(ATA_LEVELS.filter((l) => completionContractFor(l).type === "practice").length, 0);
});

check("10 L1 stays external_event:pocket_postback and checkpoints stay balance_check", () => {
  const l1 = completionContractFor(ATA_LEVELS[0]);
  assert.deepEqual(l1, { type: "external_event", completionMethod: "pocket_postback" });
  assert.equal(gateIntegrationCode(ATA_LEVELS[0]), "pocket.registration");
  for (const checkpoint of ATA_CHECKPOINTS) {
    const level = ATA_LEVELS[checkpoint.levelNumber - 1];
    assert.deepEqual(completionContractFor(level), {
      type: "financial_checkpoint",
      completionMethod: "balance_check",
    });
    assert.equal(gateIntegrationCode(level), `checkpoint.module-${String(level.moduleNumber).padStart(2, "0")}`);
  }
});

check("11 no staging or attestation vocabulary leaks into curriculum source", () => {
  const source = readFileSync("src/lib/curriculum/product-ata-100.ts", "utf8");
  const artifact = readFileSync(CANONICAL_PATH, "utf8");
  for (const forbidden of ["staging_attested", "StagingAttestation", "attestation"]) {
    assert.ok(!artifact.includes(forbidden), `the package must not mention ${forbidden}`);
  }
  assert.ok(!source.includes("staging_attested"));
});

/* ------------------------------------------------------------------ *
 * 3. Unlock vocabulary (§12)
 * ------------------------------------------------------------------ */

check("12 the unlock vocabulary is internally consistent", () => {
  assert.deepEqual(validateAtaUnlockVocabulary(), []);
  assert.equal(CURRICULUM_TOOLS.length, ATA_PRODUCT_EXPECTATIONS.toolUnlocks);
  assert.equal(COMMUNITY_CHANNELS.length, ATA_PRODUCT_EXPECTATIONS.communityUnlocks);
  assert.equal(RANK_TRANSITIONS.length, ATA_PRODUCT_EXPECTATIONS.checkpoints);
  // The secret tool is referenceable but is NOT a curriculum unlock. Widened to
  // `string[]` on purpose: the literal union already proves it at compile time,
  // and this asserts the same fact for anything built from the runtime values.
  assert.ok(PRODUCT_TOOL_CODES.has("tool.secret"));
  const curriculumToolCodes: string[] = CURRICULUM_TOOLS.map((tool) => tool.code);
  assert.ok(!curriculumToolCodes.includes("tool.secret"));
});

check("13 L4 is the one checkpoint with no tool unlock", () => {
  const withoutTool = ATA_CHECKPOINTS.filter((c) => c.toolCode === null);
  assert.deepEqual(withoutTool.map((c) => c.levelNumber), [4]);
  assert.deepEqual(
    ATA_CHECKPOINTS.filter((c) => c.channelCode !== null).map((c) => c.levelNumber),
    [4, 20, 35, 45, 85],
  );
});

/* ------------------------------------------------------------------ *
 * 4. The generated artifact
 * ------------------------------------------------------------------ */

check("14 the canonical artifact passes generic validation and the ATA profile", () => {
  const result = validateAtaProduct100Package(CANONICAL);
  assert.deepEqual(result.issues, [], JSON.stringify(result.issues.slice(0, 5)));
  assert.ok(result.ok);
});

check("15 the canonical artifact is a DRAFT and is never labelled approved", () => {
  assert.equal(CANONICAL.packageCode, ATA_100_PACKAGE_CODE);
  assert.ok(isAtaProduct100Package(CANONICAL));
  assert.equal(CANONICAL.status, "draft");
  assert.equal(CANONICAL.approval.approvedBy, null);
  assert.equal(CANONICAL.approval.approvedAt, null);
  assert.ok(CANONICAL.pendingApprovals.length > 0, "a draft that hides its gaps is not honest");
});

check("16 the artifact declares exactly 100 levels in 20 modules, 1..100 continuous", () => {
  const levels = CANONICAL.modules.flatMap((m) => m.levels);
  assert.equal(CANONICAL.modules.length, 20);
  assert.equal(levels.length, 100);
  const numbers = levels.map((l) => l.levelNumber).sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 100 }, (_, i) => i + 1));
  assert.equal(new Set(levels.map((l) => l.levelCode)).size, 100);
});

check("17 every pendingApproval references a level that exists", () => {
  const codes = new Set(CANONICAL.modules.flatMap((m) => m.levels).map((l) => l.levelCode));
  for (const pending of CANONICAL.pendingApprovals) {
    assert.ok(codes.has(pending.levelCode), `${pending.levelCode} is not in the package`);
  }
});

check("18 the artifact carries no obsolete product brand", () => {
  const raw = readFileSync(CANONICAL_PATH, "utf8");
  assert.equal(findObsoleteBrand(raw), null);
  assert.equal(/tradequest/i.test(raw), false);
});

check("19 the reported completeness is neither inflated nor deflated", () => {
  const { report } = validateAtaProduct100Package(CANONICAL);
  assert.equal(report.totalLevels, 100);
  assert.equal(report.structurallyCompleteLevels, 100);
  assert.equal(report.structuralCompletenessPercent, 100);
  // This package must not claim more AUTHORED lessons than exist: a question
  // bank is not a written lesson, and importing 232 questions must not make the
  // editorial number jump.
  assert.equal(report.productionReadyLevels, 4);
  assert.equal(report.editorialRequiredLevels, 79);
  assert.equal(report.editoriallyCompleteRequiredLevels, 2);
  assert.ok(report.editorialCompletenessPercent < 5);
  assert.equal(report.byKind.video_test.productionReady, 1);
  assert.equal(report.byKind.practical.productionReady, 0);
});

check("19a the lifecycle matrix pins PRODUCT TRUTH, not today's poverty", () => {
  // These are the assertions the previous suite lacked: it pinned "57 banks are
  // missing", so dropping the Blueprint would pass and importing it would fail.
  // Pinning the product contract instead makes silent data loss a test failure.
  const { report } = validateAtaProduct100Package(CANONICAL);
  const lifecycle = report.lifecycle;
  assert.equal(lifecycle.structureReady, true);
  assert.equal(lifecycle.videoLessons, 58);
  assert.equal(lifecycle.testBanksPresent, 58);
  assert.equal(lifecycle.questionsPresent, 232);
  assert.equal(lifecycle.correctAnswersPresent, 232);
  assert.equal(lifecycle.takeMappingsPresent, 232);
  assert.equal(lifecycle.missingTestBanks, 0);
  // Proposal and approval stay separate in both directions.
  assert.equal(lifecycle.proposedTestBanks, 57);
  assert.equal(lifecycle.sourceBackedTestBanks, 1);
  assert.equal(lifecycle.platformApprovedTestBanks, 1);
  assert.notEqual(lifecycle.platformApprovedTestBanks, 58);
  // Production reality is zero and import is unknowable from source.
  assert.equal(lifecycle.platformImported, "UNKNOWN");
  assert.equal(lifecycle.productionReadyLevels, 4);
});

check("20 every generated content body uses the v2 block format", () => {
  const { report } = validateAtaProduct100Package(CANONICAL);
  assert.equal(report.blocksV2ContentLevels, 77);
  // The one exception is the approved level 2, which stays legacy v1 untouched.
  const l2 = CANONICAL.modules[0].levels[1];
  assert.ok(l2.content);
  assert.equal("format" in l2.content.localizations[0].body, false);
});

check("21 levels 1–4 are carried over from the approved slice, XP overlay aside", () => {
  const approved = JSON.parse(readFileSync(FIRST_SLICE_PATH, "utf8")) as {
    modules: Array<{ levels: Array<Record<string, unknown>> }>;
  };
  const canonicalRaw = JSON.parse(readFileSync(CANONICAL_PATH, "utf8")) as {
    modules: Array<{ levels: Array<Record<string, unknown>> }>;
  };
  /*
   * PHASE-F. The approved slice predates the XP decision: it declares zero on
   * every level and carries no `xpRewardStatus`. The canonical 100 applies the
   * approved product schedule as an OVERLAY, so those two fields — and ONLY
   * those two — legitimately differ. Everything editorial is still carried
   * across character for character, which is what this check is for.
   */
  const OVERLAID = new Set(["xpReward", "xpRewardStatus"]);
  for (let index = 0; index < 4; index += 1) {
    const carried = canonicalRaw.modules[0].levels[index];
    const source = approved.modules[0].levels[index];
    const strippedCarried = Object.fromEntries(
      Object.entries(carried).filter(([key]) => !OVERLAID.has(key)),
    );
    const strippedSource = Object.fromEntries(
      Object.entries(source).filter(([key]) => !OVERLAID.has(key)),
    );
    assert.deepEqual(strippedCarried, strippedSource);
    // The historical artifact itself is untouched.
    assert.equal(source.xpReward, 0);
    assert.equal(source.xpRewardStatus, undefined);
    // …and the overlay is the approved schedule, not a copy of the placeholder.
    assert.equal(carried.xpRewardStatus, "approved");
  }
  const overlaid = canonicalRaw.modules[0].levels.slice(0, 4).map((level) => level.xpReward);
  assert.deepEqual(overlaid, [0, 100, 500, 0], "L1 gate, L2 lesson, L3 report, L4 gate");
});

/* ------------------------------------------------------------------ *
 * 5. Profile refusals — one mutation each
 * ------------------------------------------------------------------ */

check("22 a duplicate level number is refused", () => {
  const pkg = clone(CANONICAL);
  pkg.modules[1].levels[0].levelNumber = 4;
  assert.ok(profileCodes(pkg).includes("ATA100_LEVEL_NUMBER_DUPLICATE"));
});

check("23 a gap in 1..100 is refused", () => {
  const pkg = clone(CANONICAL);
  pkg.modules[1].levels.splice(0, 1);
  const codes = profileCodes(pkg);
  assert.ok(codes.includes("ATA100_LEVEL_NUMBER_GAP"));
  assert.ok(codes.includes("ATA100_LEVEL_COUNT"));
});

check("24 a 101st level is refused", () => {
  const pkg = clone(CANONICAL);
  const extra = JSON.parse(JSON.stringify(pkg.modules[19].levels[4]));
  extra.levelNumber = 101;
  extra.levelCode = "v2.l101.dopolnitelnyy";
  pkg.modules[19].levels.push(extra);
  const codes = profileCodes(pkg);
  assert.ok(codes.includes("ATA100_LEVEL_COUNT"));
  assert.ok(codes.includes("ATA100_LEVEL_NUMBER_OUT_OF_RANGE"));
});

check("25 a stableCode that disagrees with the canonical source is refused", () => {
  const pkg = clone(CANONICAL);
  pkg.modules[3].levels[2].levelCode = "v2.l018.drugoy-slug";
  assert.ok(profileCodes(pkg).includes("ATA100_STABLE_CODE_MISMATCH"));
});

check("26 a module mismatch is refused", () => {
  const pkg = clone(CANONICAL);
  pkg.modules[2].moduleCode = "module.99";
  const codes = profileCodes(pkg);
  assert.ok(codes.includes("ATA100_MODULE_CODE_MISMATCH"));
  assert.ok(codes.includes("ATA100_LEVEL_MODULE_MISMATCH"));
});

check("27 a practical routed to the wrong completion owner is refused", () => {
  const pkg = clone(CANONICAL);
  // Level 14 is one of the 7 mentor-reviewed practicals.
  const level = pkg.modules.flatMap((m) => m.levels).find((l) => l.levelNumber === 14);
  assert.ok(level);
  level.type = "lesson";
  level.completionMethod = "manual";
  const codes = profileCodes(pkg);
  assert.ok(codes.includes("ATA100_COMPLETION_CONTRACT_MISMATCH"));
  assert.ok(codes.includes("ATA100_PRACTICAL_MAPPING_MISMATCH"));
});

check("28 a gate that awards XP is refused", () => {
  const pkg = clone(CANONICAL);
  const checkpoint = pkg.modules.flatMap((m) => m.levels).find((l) => l.levelNumber === 10);
  assert.ok(checkpoint);
  checkpoint.xpReward = 50;
  assert.ok(profileCodes(pkg).includes("ATA100_GATE_XP_NONZERO"));
  // And the GENERIC validator refuses it independently, from the completion owner.
  const generic = validateCurriculumPackage(pkg);
  assert.equal(generic.ok, false);
  assert.ok(!generic.ok && generic.issues.some((i) => i.code === "LEVEL_GATE_REWARD_UNSUPPORTED"));
});

check("29 a checkpoint routed to the wrong module integration is refused", () => {
  const pkg = clone(CANONICAL);
  const checkpoint = pkg.modules.flatMap((m) => m.levels).find((l) => l.levelNumber === 10);
  assert.ok(checkpoint?.gate);
  checkpoint.gate.integrationCode = "checkpoint.module-07";
  assert.ok(profileCodes(pkg).includes("ATA100_GATE_INTEGRATION_MISMATCH"));
});

check("30 a broken progression chain is refused", () => {
  const pkg = clone(CANONICAL);
  const level = pkg.modules.flatMap((m) => m.levels).find((l) => l.levelNumber === 30);
  assert.ok(level);
  level.prerequisiteLevelCodes = [];
  assert.ok(profileCodes(pkg).includes("ATA100_PROGRESSION_MISMATCH"));
});

check("31 a title that drifts from the canonical source is refused", () => {
  const pkg = clone(CANONICAL);
  pkg.modules[0].levels[1].title = "Как устроен TradeQuest";
  assert.ok(profileCodes(pkg).includes("ATA100_TITLE_MISMATCH"));
});

/* ------------------------------------------------------------------ *
 * 6. Editorial gaps are gaps, not structural failures
 * ------------------------------------------------------------------ */

check("32 unwritten lesson content is an editorial GAP in a draft, never an issue", () => {
  const result = validateAtaProduct100Package(CANONICAL);
  assert.equal(result.issues.length, 0);
  assert.ok(result.gaps.length > 0);
  assert.ok(result.gaps.some((gap) => gap.code === "ATA100_CONTENT_NOT_AUTHORED"));
  assert.ok(result.ok, "a draft with editorial gaps and no structural issues is OK");

  // The assessment banks are NO LONGER a gap of this kind, and this assertion is
  // the tripwire that keeps them from silently becoming one again. The previous
  // revision of this suite asserted `ATA100_ASSESSMENT_MISSING` was present,
  // which pinned the artifact's poverty as the expectation: dropping all 232
  // Blueprint questions would have kept it green.
  assert.equal(
    result.gaps.some((gap) => gap.code === "ATA100_ASSESSMENT_MISSING"),
    false,
    "every video lesson now carries its question bank; a MISSING gap would mean the Blueprint import regressed",
  );
});

check("32a the XP schedule is APPROVED, complete, and sums to 10 000", () => {
  const draft = validateAtaProduct100Package(CANONICAL);
  /*
   * PHASE-F replaces the Phase-C expectation, which was that all 79 non-gate
   * rewards were undeclared placeholders. The product decision now exists, so
   * the honest assertion is the opposite one: no level is unresolved, and the
   * schedule is exactly the approved one.
   */
  assert.deepEqual(
    draft.gaps.filter((gap) => gap.code === "ATA100_XP_SCHEDULE_UNRESOLVED"),
    [],
    "no ATA level carries a placeholder reward any more",
  );
  assert.deepEqual(
    draft.issues.filter((item) => item.code.startsWith("ATA100_XP")),
    [],
  );
  assert.equal(draft.report.lifecycle.xpTotalReward, 10_000);
  assert.equal(draft.report.lifecycle.xpScheduleMatchesPolicy, true);

  // …and the release gate still exists: an APPROVED package that claimed a
  // different schedule is refused outright.
  const tampered = clone(CANONICAL);
  const lesson = tampered.modules
    .flatMap((m: { levels: Array<Record<string, unknown>> }) => m.levels)
    .find((l: Record<string, unknown>) => l.type === "lesson" && l.completionMethod === "assessment_pass");
  assert.ok(lesson);
  lesson.xpReward = 10;
  const result = validateAtaProduct100Package(tampered);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((item) => item.code === "ATA100_XP_REWARD_MISMATCH"));
});

check("32b every level's reward status is approved; a gate may not claim unresolved", () => {
  const { report } = validateAtaProduct100Package(CANONICAL);
  assert.equal(report.lifecycle.xpApprovedLevels, 100);
  assert.equal(report.lifecycle.xpUnresolvedLevels, 0);

  const pkg = clone(CANONICAL);
  const checkpoint = pkg.modules.flatMap((m) => m.levels).find((l) => l.levelNumber === 10);
  assert.ok(checkpoint);
  checkpoint.xpRewardStatus = "unresolved";
  assert.ok(profileCodes(pkg).includes("ATA100_GATE_XP_STATUS_INVALID"));
});

check("33 the same package would NOT be OK if it claimed to be approved", () => {
  const pkg = clone(CANONICAL);
  pkg.status = "approved";
  const result = validateAtaProduct100Package(pkg);
  assert.equal(result.ok, false, "an approved ATA-100 package may not carry editorial gaps");
});

/* ------------------------------------------------------------------ *
 * 7. Generic vs profile separation (§21, §22)
 * ------------------------------------------------------------------ */

check("34 the 4-level approved first slice still passes GENERIC validation", () => {
  const result = validateCurriculumPackage(JSON.parse(readFileSync(FIRST_SLICE_PATH, "utf8")));
  assert.ok(result.ok, JSON.stringify(result.ok ? [] : result.issues.slice(0, 5)));
  assert.deepEqual(result.warnings, []);
});

check("35 the generic engine never imposes the ATA 100-level contract", () => {
  const slice = validateCurriculumPackage(JSON.parse(readFileSync(FIRST_SLICE_PATH, "utf8")));
  assert.ok(slice.ok);
  assert.equal(slice.package.modules.flatMap((m) => m.levels).length, 4);
  // And the slice never claims to be the whole product, so nothing would apply
  // the profile to it by accident.
  assert.equal(isAtaProduct100Package(slice.package), false);
  // The profile, applied deliberately, does refuse it — which is the point of
  // keeping the two layers apart.
  const profile = validateAtaProduct100Package(slice.package);
  assert.ok(profile.issues.some((i) => i.code === "ATA100_LEVEL_COUNT"));
});

/* ------------------------------------------------------------------ *
 * 8. Converter determinism (§25)
 * ------------------------------------------------------------------ */

function runBuilder(args: string[]): string {
  return execFileSync("npx", ["tsx", "scripts/curriculum/buildCanonical100.ts", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

check("36 the converter is deterministic: --check passes against the checked-in artifact", () => {
  const output = runBuilder(["--check"]);
  assert.ok(output.includes("matches its inputs"), output);
});

check("37 two consecutive builds produce the identical fingerprint", () => {
  const first = JSON.parse(runBuilder(["--check"]).split("\n").slice(1).join("\n")) as { fingerprint: string; sha256: string };
  const second = JSON.parse(runBuilder(["--check"]).split("\n").slice(1).join("\n")) as { fingerprint: string; sha256: string };
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.fingerprint, CANONICAL.contentFingerprint);
});

check("38 the converter reads no other repository", () => {
  const source = readFileSync("scripts/curriculum/buildCanonical100.ts", "utf8");
  assert.equal(source.includes("/srv/ata/repos/academy"), false);
  assert.equal(/require\(["'].*academy/.test(source), false);
  assert.equal(/from ["'].*\/academy/.test(source), false);
});

const ACADEMY_REACH = String.raw`(from\s*['"][^'"]*academy|require\(\s*['"][^'"]*academy|import\(\s*['"][^'"]*academy|read[A-Za-z]*\([^)]*academy)`;

check("39 NOTHING in src/ can import or read the Academy repository", () => {
  // Naming Academy in a provenance comment is REQUIRED — that is how a
  // transferred value stays auditable. What must never exist is a code path that
  // imports, resolves or opens a file inside the other repository, which would
  // turn a Backend runtime or validation gate into a dependency on someone
  // else's checkout. For `src/` the rule is absolute and has no exceptions.
  const grep = spawnSync("grep", ["-rnE", ACADEMY_REACH, "src"], { encoding: "utf8" });
  assert.equal(grep.stdout.trim(), "", `Academy is reachable from src/:\n${grep.stdout}`);
  assert.equal(grep.status, 1, "grep should have found no matches");
});

check("39a the ONLY script that may reach Academy is the dev/audit transfer verifier", () => {
  // CORRECTIONS §17/§18 added a verifier that re-derives Academy's structure to
  // prove the one-time transfer is still exact. It is allowed to read Academy —
  // that is its entire purpose — and it is constrained instead: dev/audit only,
  // an EXPLICIT `--academy` path with no default and no fallback, and unreachable
  // from `src/`. This test pins that the exception stays exactly one file wide.
  const grep = spawnSync(
    "grep",
    ["-rlE", "--exclude=curriculumAta100Regression.ts", ACADEMY_REACH, "scripts"],
    { encoding: "utf8" },
  );
  const files = grep.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  assert.deepEqual(files, ["scripts/curriculum/verifyAcademyTransfer.ts"], `unexpected Academy readers:\n${files.join("\n")}`);

  const verifier = readFileSync("scripts/curriculum/verifyAcademyTransfer.ts", "utf8");
  assert.ok(verifier.includes('args.indexOf("--academy")'), "the path must come from an explicit argument");
  assert.equal(
    /process\.env\.[A-Z_]*ACADEMY/.test(verifier),
    false,
    "no environment-variable fallback may reintroduce an implicit dependency",
  );
  assert.equal(
    /["'`]\/srv\/ata\/repos\/academy["'`]/.test(verifier.replace(/^\s*\*.*$/gm, "")),
    false,
    "no hard-coded Academy path outside documentation",
  );
});

console.log(`\nATA-100 profile and converter regression: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
