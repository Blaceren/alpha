/**
 * PHASE-C CORRECTIONS — the video-production Blueprint regression.
 *
 * WHAT THIS SUITE IS FOR, AND WHAT THE PREVIOUS ONE GOT WRONG
 * The independent audit found the Phase-C suite pinned the artifact's POVERTY as
 * its expectation: it asserted 2/79 editorially complete and 57 assessment banks
 * MISSING, so silently dropping the Blueprint's question banks would have kept
 * every test green while ADDING them would have failed. These tests pin PRODUCT
 * TRUTH instead — 58 contracts, 232 takes, 232 questions, 232 one-to-one
 * mappings, and the approval distinctions that keep proposed from reading as
 * either missing or approved.
 *
 * Runs entirely in memory: no database, no network, no live data, and the
 * Blueprint DOCX itself is NOT required — the committed normalized artifact is
 * the thing under test.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ATA_VIDEO_OPTIONS_PER_QUESTION,
  ATA_VIDEO_QUESTIONS_PER_LESSON,
  ATA_VIDEO_TAKES_PER_LESSON,
  VIDEO_LESSON_SECTION_CODES,
  calculateAssessmentFingerprint,
  calculateContractFingerprint,
  isProductionEvidenceStale,
  isVideoLessonSectionCode,
  parseTakeId,
  parseVideoProductionContracts,
  takeIdFor,
  type VideoProductionContract,
  type VideoProductionContractsFile,
} from "@/lib/curriculum/video-production-contract";
import {
  ataVideoTestLevelNumbers,
  buildAtaVideoLifecycleReport,
  validateAtaVideoContracts,
} from "@/lib/curriculum/package/ata-video-profile";
import { validateCurriculumPackage } from "@/lib/curriculum/package/validate";
import { validateAtaProduct100Package } from "@/lib/curriculum/package/ata-profile";
import { ATA_LEVELS } from "@/lib/curriculum/product-ata-100";
import { MAX_LESSON_QUESTIONS, MIN_LESSON_QUESTIONS } from "@/lib/curriculum/assessment-validation";

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

const CONTRACTS_PATH = "curriculum/canonical/ata-video-production-contracts.v1.json";
const CANONICAL_PATH = "curriculum/packages/ata-v2-canonical-100.draft.json";

const parsedContracts = parseVideoProductionContracts(JSON.parse(readFileSync(CONTRACTS_PATH, "utf8")));
if (!parsedContracts.ok) {
  console.error(`FAIL the contracts artifact does not parse:\n  ${parsedContracts.issues.join("\n  ")}`);
  process.exitCode = 1;
  throw new Error("cannot continue without the contracts artifact");
}
const CONTRACTS: VideoProductionContractsFile = parsedContracts.file;

const CANONICAL_RAW = JSON.parse(readFileSync(CANONICAL_PATH, "utf8"));
const canonicalResult = validateCurriculumPackage(CANONICAL_RAW);
if (!canonicalResult.ok) {
  console.error(`FAIL the canonical package does not validate:\n${JSON.stringify(canonicalResult.issues.slice(0, 5), null, 2)}`);
  process.exitCode = 1;
  throw new Error("cannot continue without a valid canonical package");
}
const CANONICAL = canonicalResult.package;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/* ------------------------------------------------------------------ *
 * 1. The product contract: 58 / 232 / 232 / 232
 * ------------------------------------------------------------------ */

check("1 the Blueprint yields exactly 58 video lesson contracts", () => {
  assert.equal(CONTRACTS.contracts.length, 58);
  assert.equal(CONTRACTS.counts.lessons, 58);
  assert.equal(new Set(CONTRACTS.contracts.map((c) => c.levelNumber)).size, 58);
});

check("2 there are exactly 232 testable takes", () => {
  const takes = CONTRACTS.contracts.flatMap((c) => c.takes);
  assert.equal(takes.length, 232);
  assert.equal(CONTRACTS.counts.takes, 232);
  assert.equal(new Set(takes.map((t) => t.takeId)).size, 232, "every take id is unique across the product");
});

check("3 there are exactly 232 single-choice questions", () => {
  const questions = CONTRACTS.contracts.flatMap((c) => c.questions);
  assert.equal(questions.length, 232);
  assert.equal(CONTRACTS.counts.questions, 232);
  assert.equal(new Set(questions.map((q) => q.questionId)).size, 232);
  for (const question of questions) {
    assert.equal(question.options.length, ATA_VIDEO_OPTIONS_PER_QUESTION);
  }
});

check("4 there are exactly 232 resolved correct answers, one per question", () => {
  const questions = CONTRACTS.contracts.flatMap((c) => c.questions);
  const resolved = questions.filter((q) => q.options.filter((o) => o.correct).length === 1);
  assert.equal(resolved.length, 232);
  assert.equal(CONTRACTS.counts.correctAnswers, 232);
  for (const question of questions) {
    const correct = question.options.find((o) => o.correct);
    assert.ok(correct, `${question.questionId} has no correct option`);
    assert.equal(correct.optionCode, question.correctOptionCode);
  }
});

check("5 there are exactly 232 one-to-one take→question mappings", () => {
  assert.equal(CONTRACTS.counts.takeQuestionMappings, 232);
  let mappings = 0;
  for (const contract of CONTRACTS.contracts) {
    const takeIds = new Set(contract.takes.map((t) => t.takeId));
    const covered = new Map<string, number>();
    for (const question of contract.questions) {
      assert.ok(takeIds.has(question.takeId), `${question.questionId} → unknown ${question.takeId}`);
      covered.set(question.takeId, (covered.get(question.takeId) ?? 0) + 1);
      mappings += 1;
    }
    for (const takeId of takeIds) {
      assert.equal(covered.get(takeId), 1, `${takeId} must be covered exactly once`);
    }
  }
  assert.equal(mappings, 232);
});

check("6 every lesson has exactly 4 takes and exactly 4 questions", () => {
  for (const contract of CONTRACTS.contracts) {
    assert.equal(contract.takes.length, ATA_VIDEO_TAKES_PER_LESSON, `L${contract.levelNumber} takes`);
    assert.equal(contract.questions.length, ATA_VIDEO_QUESTIONS_PER_LESSON, `L${contract.levelNumber} questions`);
  }
});

check("7 take IDs follow T{level}.{1..4} and belong to their own level", () => {
  for (const contract of CONTRACTS.contracts) {
    contract.takes.forEach((take, index) => {
      assert.equal(take.takeId, takeIdFor(contract.levelNumber, index + 1));
      const parsed = parseTakeId(take.takeId);
      assert.ok(parsed);
      assert.equal(parsed.levelNumber, contract.levelNumber);
      assert.equal(parsed.ordinal, index + 1);
    });
  }
});

check("8 contracts attach only to canonical video_test levels, and to all of them", () => {
  const expected = ataVideoTestLevelNumbers();
  assert.equal(expected.length, 58);
  assert.deepEqual(
    CONTRACTS.contracts.map((c) => c.levelNumber).sort((a, b) => a - b),
    [...expected].sort((a, b) => a - b),
  );
  for (const contract of CONTRACTS.contracts) {
    const source = ATA_LEVELS.find((l) => l.levelNumber === contract.levelNumber);
    assert.ok(source);
    assert.equal(source.kind, "video_test", `L${contract.levelNumber} must be a video lesson`);
  }
});

check("9 the structural QA profile accepts the committed artifact", () => {
  assert.deepEqual(validateAtaVideoContracts(CONTRACTS), []);
});

/* ------------------------------------------------------------------ *
 * 2. Structural QA refuses each defect — one mutation apiece
 * ------------------------------------------------------------------ */

function codesFor(mutate: (file: VideoProductionContractsFile) => void): string[] {
  const file = clone(CONTRACTS);
  mutate(file);
  return validateAtaVideoContracts(file).map((issue) => issue.code);
}

check("10 a contract on a non-video level is refused", () => {
  const codes = codesFor((file) => {
    // L9 is a practical.
    file.contracts[0].levelNumber = 9;
  });
  assert.ok(codes.includes("ATAVIDEO_CONTRACT_ON_NON_VIDEO_LEVEL"), codes.join(","));
});

check("11 a missing contract is refused", () => {
  const codes = codesFor((file) => void file.contracts.splice(0, 1));
  assert.ok(codes.includes("ATAVIDEO_CONTRACT_MISSING"));
  assert.ok(codes.includes("ATAVIDEO_CONTRACT_COUNT"));
});

check("12 a take id from the wrong level is refused", () => {
  const codes = codesFor((file) => {
    file.contracts[0].takes[0].takeId = "T99.1";
    file.contracts[0].questions[0].takeId = "T99.1";
  });
  assert.ok(codes.includes("ATAVIDEO_TAKE_ID_MISMATCH"));
  assert.ok(codes.includes("ATAVIDEO_TAKE_ID_FOREIGN_LEVEL"));
});

check("13 a take covered twice (and one not at all) is refused", () => {
  const codes = codesFor((file) => {
    file.contracts[0].questions[1].takeId = file.contracts[0].questions[0].takeId;
  });
  assert.ok(codes.includes("ATAVIDEO_TAKE_COVERED_TWICE"), codes.join(","));
  assert.ok(codes.includes("ATAVIDEO_TAKE_NOT_COVERED"), codes.join(","));
});

check("14 a question with no correct option is refused", () => {
  const codes = codesFor((file) => {
    for (const option of file.contracts[0].questions[0].options) option.correct = false;
  });
  assert.ok(codes.includes("ATAVIDEO_CORRECT_ANSWER_UNRESOLVED"));
});

check("15 two correct options are refused", () => {
  const codes = codesFor((file) => {
    for (const option of file.contracts[0].questions[0].options) option.correct = true;
  });
  assert.ok(codes.includes("ATAVIDEO_CORRECT_ANSWER_UNRESOLVED"));
});

check("16 a correctOptionCode that disagrees with the marked option is refused", () => {
  const codes = codesFor((file) => {
    const question = file.contracts[0].questions[0];
    question.correctOptionCode = question.options.find((o) => !o.correct)!.optionCode;
  });
  assert.ok(codes.includes("ATAVIDEO_CORRECT_ANSWER_INCONSISTENT"));
});

check("17 duplicate question ids are refused", () => {
  const codes = codesFor((file) => {
    file.contracts[1].questions[0].questionId = file.contracts[0].questions[0].questionId;
  });
  assert.ok(codes.includes("ATAVIDEO_QUESTION_ID_DUPLICATE"));
});

check("18 duplicate option codes are refused", () => {
  const codes = codesFor((file) => {
    file.contracts[0].questions[0].options[1].optionCode = file.contracts[0].questions[0].options[0].optionCode;
  });
  assert.ok(codes.includes("ATAVIDEO_OPTION_CODE_DUPLICATE"));
});

check("19 an implausible target duration is refused", () => {
  const codes = codesFor((file) => {
    file.contracts[0].targetDuration.minSeconds = 1;
  });
  assert.ok(codes.includes("ATAVIDEO_TARGET_DURATION_INVALID"));
});

check("20 an obsolete brand anywhere in a contract is refused", () => {
  const codes = codesFor((file) => {
    file.contracts[0].questions[0].prompt = "Как устроен TradeQuest?";
  });
  assert.ok(codes.includes("ATAVIDEO_OBSOLETE_BRAND"));
});

check("21 a declared count that disagrees with the contracts is refused", () => {
  const codes = codesFor((file) => void (file.counts.questions = 999));
  assert.ok(codes.includes("ATAVIDEO_DECLARED_COUNT_WRONG"));
});

check("22 the committed artifact carries no obsolete brand at all", () => {
  const raw = readFileSync(CONTRACTS_PATH, "utf8");
  assert.equal(/tradequest/i.test(raw), false);
});

/* ------------------------------------------------------------------ *
 * 3. Source / approval / production are three axes — §5
 * ------------------------------------------------------------------ */

check("23 L18 is SOURCE_BACKED and the other 57 are PROPOSED_CANON", () => {
  const l18 = CONTRACTS.contracts.find((c) => c.levelNumber === 18);
  assert.ok(l18);
  assert.equal(l18.sourceProvenance, "SOURCE_BACKED");
  assert.match(l18.sourceStatusLabel, /^IMPLEMENTED/);
  const others = CONTRACTS.contracts.filter((c) => c.levelNumber !== 18);
  assert.equal(others.length, 57);
  for (const contract of others) {
    assert.equal(contract.sourceProvenance, "PROPOSED_CANON", `L${contract.levelNumber}`);
  }
});

check("24 source-backed is NOT automatically platform-approved", () => {
  // The exact confusion §5 forbids: L18's questions already exist as authored
  // upstream content, and that says nothing about whether the PLATFORM approved
  // them as an assessment.
  const l18 = CONTRACTS.contracts.find((c) => c.levelNumber === 18)!;
  assert.equal(l18.sourceProvenance, "SOURCE_BACKED");
  assert.equal(l18.approval, "AWAITING_APPROVAL");
});

check("25 the extractor never marks a contract approved", () => {
  for (const contract of CONTRACTS.contracts) {
    assert.equal(contract.approval, "AWAITING_APPROVAL", `L${contract.levelNumber}`);
  }
});

check("26 no contract fabricates script, video, QA or coverage evidence", () => {
  for (const contract of CONTRACTS.contracts) {
    assert.equal(contract.production.script, "SCRIPT_PENDING");
    assert.equal(contract.production.video, "NOT_RECORDED");
    assert.equal(contract.production.qa, "QA_PENDING");
    assert.deepEqual(contract.production.takeCoverage, []);
    assert.equal(contract.production.reviewedContractVersion, null);
    assert.equal(contract.production.reviewedContractFingerprint, null);
    assert.equal(isProductionEvidenceStale(contract), false, "absent evidence is not stale evidence");
  }
});

check("27 the package records PROPOSED banks, and never calls them MISSING", () => {
  const byClassification = new Map<string, number>();
  for (const pending of CANONICAL.pendingApprovals) {
    if (pending.element !== "assessment") continue;
    byClassification.set(pending.classification, (byClassification.get(pending.classification) ?? 0) + 1);
  }
  assert.equal(byClassification.get("MISSING") ?? 0, 0, "no video assessment may be recorded as MISSING");
  assert.equal(byClassification.get("PROPOSED") ?? 0, 57);
  assert.equal(byClassification.get("CONFLICTING") ?? 0, 1);
});

check("28 proposed banks are not published and require approval", () => {
  for (const level of CANONICAL.modules.flatMap((m) => m.levels)) {
    if (!level.assessment) continue;
    if (level.levelNumber === 2) continue; // the one operator-approved bank
    assert.equal(level.assessment.status, "draft", `L${level.levelNumber} must not be published`);
    assert.equal(level.assessment.provenance.approvalRequired, true, `L${level.levelNumber}`);
  }
});

/* ------------------------------------------------------------------ *
 * 4. L2 and L18 reconciliation — §6 / §24
 * ------------------------------------------------------------------ */

check("29 L2's approved bank is preserved byte-for-byte and never overwritten", () => {
  const approved = JSON.parse(readFileSync("curriculum/packages/ata-v2-first-slice.rev3.approved.json", "utf8"));
  const approvedL2 = approved.modules[0].levels[1];
  const canonicalL2 = (CANONICAL_RAW as { modules: Array<{ levels: unknown[] }> }).modules[0].levels[1];
  assert.deepEqual(canonicalL2, approvedL2, "the approved first slice must be carried over unchanged");
});

check("30 the L2 disagreement is recorded as an explicit SOURCE CONFLICT", () => {
  const l2Conflicts = CONTRACTS.sourceConflicts.filter((c) => c.levelNumber === 2);
  assert.ok(l2Conflicts.length > 0, "the L2 disagreement must be recorded, not resolved silently");
  for (const conflict of l2Conflicts) {
    assert.notEqual(conflict.blueprintValue, conflict.otherValue);
    assert.match(conflict.otherSource, /first-slice/);
  }
  // And it must surface in the package too, without claiming the approved
  // content is unusable.
  const pending = CANONICAL.pendingApprovals.filter(
    (p) => p.levelCode.includes("l002") && p.classification === "CONFLICTING",
  );
  assert.equal(pending.length, 1);
  assert.equal(pending[0].blocksReadiness, false);
});

check("31 an L2 conflict does not silently rewrite the Blueprint proposal either", () => {
  const l2 = CONTRACTS.contracts.find((c) => c.levelNumber === 2)!;
  assert.equal(l2.questions.length, 4);
  assert.equal(l2.sourceProvenance, "PROPOSED_CANON");
  // Both banks cover the same four takes; that is why they are comparable at all.
  assert.deepEqual(l2.questions.map((q) => q.takeId), ["T2.1", "T2.2", "T2.3", "T2.4"]);
});

check("32 L18 is never recorded as MISSING", () => {
  const pending = CANONICAL.pendingApprovals.filter((p) => p.levelCode.includes("l018"));
  const assessmentPending = pending.filter((p) => p.element === "assessment");
  assert.equal(assessmentPending.length, 1);
  assert.equal(assessmentPending[0].classification, "PROPOSED");
  assert.notEqual(assessmentPending[0].classification, "MISSING");
});

check("33 L18's package bank carries its source-backed provenance", () => {
  const l18 = CANONICAL.modules.flatMap((m) => m.levels).find((l) => l.levelNumber === 18);
  assert.ok(l18?.assessment);
  assert.equal(l18.assessment.questions.length, 4);
  assert.equal(l18.assessment.provenance.confidence, "high", "reproduced from an authored source");
  assert.equal(l18.assessment.provenance.approvalRequired, true, "still not platform-approved");
  assert.deepEqual(
    l18.assessment.questions.map((q) => q.lessonTakeawayRef),
    ["T18.1", "T18.2", "T18.3", "T18.4"],
  );
});

/* ------------------------------------------------------------------ *
 * 5. Version / fingerprint coherence — §7
 * ------------------------------------------------------------------ */

const sample = (): VideoProductionContract => clone(CONTRACTS.contracts.find((c) => c.levelNumber === 18)!);

check("34 the contract fingerprint is deterministic", () => {
  const a = sample();
  const b = sample();
  assert.equal(calculateContractFingerprint(a), calculateContractFingerprint(b));
  assert.equal(calculateAssessmentFingerprint(a), calculateAssessmentFingerprint(b));
});

check("35 changing a take's text changes BOTH fingerprints", () => {
  const before = sample();
  const after = sample();
  after.takes[2].text = `${after.takes[2].text} Дополнение.`;
  assert.notEqual(calculateAssessmentFingerprint(before), calculateAssessmentFingerprint(after));
  assert.notEqual(calculateContractFingerprint(before), calculateContractFingerprint(after));
});

check("36 changing the correct answer changes BOTH fingerprints", () => {
  const before = sample();
  const after = sample();
  const question = after.questions[0];
  const wrong = question.options.find((o) => !o.correct)!;
  for (const option of question.options) option.correct = option.optionCode === wrong.optionCode;
  question.correctOptionCode = wrong.optionCode;
  assert.notEqual(calculateAssessmentFingerprint(before), calculateAssessmentFingerprint(after));
  assert.notEqual(calculateContractFingerprint(before), calculateContractFingerprint(after));
});

check("37 changing an option's text changes BOTH fingerprints", () => {
  const before = sample();
  const after = sample();
  after.questions[1].options[3].text = "Совершенно другой вариант ответа.";
  assert.notEqual(calculateAssessmentFingerprint(before), calculateAssessmentFingerprint(after));
  assert.notEqual(calculateContractFingerprint(before), calculateContractFingerprint(after));
});

check("38 an editorial semantic change moves the CONTRACT fingerprint only", () => {
  // The assessment did not move, so the questions themselves are still valid —
  // but the meaning the script must deliver did, so the test needs revalidation
  // against the new contract. The two fingerprints say exactly that.
  const before = sample();
  const after = sample();
  after.mainIdea = "Совершенно другая главная мысль урока.";
  assert.equal(calculateAssessmentFingerprint(before), calculateAssessmentFingerprint(after));
  assert.notEqual(calculateContractFingerprint(before), calculateContractFingerprint(after));
});

check("39 production direction is DELIBERATELY excluded from both fingerprints", () => {
  const before = sample();
  const after = sample();
  after.targetDuration = { label: "12–14 минут", minSeconds: 720, maxSeconds: 840 };
  after.visualBrief = ["Совершенно другой шот-лист"];
  after.acceptanceChecklist = ["Другой чек-лист приёмки"];
  after.editorialStopList = ["Другой стоп-лист"];
  assert.equal(calculateAssessmentFingerprint(before), calculateAssessmentFingerprint(after));
  assert.equal(
    calculateContractFingerprint(before),
    calculateContractFingerprint(after),
    "re-timing a lesson must not mark 58 recorded videos stale",
  );
});

check("40 approval and production state are excluded from the fingerprint", () => {
  const before = sample();
  const after = sample();
  after.approval = "APPROVED";
  after.production.script = "SCRIPT_READY";
  assert.equal(calculateContractFingerprint(before), calculateContractFingerprint(after), "approving a contract must not invalidate the approval");
});

check("41 stale QA evidence is detectable", () => {
  const contract = sample();
  contract.production.video = "VIDEO_RECORDED";
  contract.production.qa = "QA_PASSED";
  contract.production.reviewedContractVersion = contract.contractVersion;
  contract.production.reviewedContractFingerprint = calculateContractFingerprint(contract);
  contract.production.takeCoverage = contract.takes.map((take, index) => ({
    takeId: take.takeId,
    atSeconds: 60 * (index + 1),
  }));
  assert.equal(isProductionEvidenceStale(contract), false, "evidence matching its contract is current");

  // Now the editor changes a correct answer, exactly as §7 describes.
  const question = contract.questions[0];
  const wrong = question.options.find((o) => !o.correct)!;
  for (const option of question.options) option.correct = option.optionCode === wrong.optionCode;
  question.correctOptionCode = wrong.optionCode;
  assert.equal(isProductionEvidenceStale(contract), true, "a changed answer key must invalidate the recorded QA");
  assert.ok(
    validateAtaVideoContracts({ ...CONTRACTS, contracts: [contract] })
      .map((i) => i.code)
      .includes("ATAVIDEO_PRODUCTION_EVIDENCE_STALE"),
  );
});

check("42 QA evidence with no reviewed fingerprint at all is stale", () => {
  const contract = sample();
  contract.production.qa = "QA_PASSED";
  assert.equal(isProductionEvidenceStale(contract), true);
});

/* ------------------------------------------------------------------ *
 * 6. Production metadata must not reach learner content — §8
 * ------------------------------------------------------------------ */

check("43 no editorial stop list, checklist or shot list is in any learner body", () => {
  const bodies = JSON.stringify(
    CANONICAL.modules.flatMap((m) => m.levels).map((l) => l.content?.localizations.map((x) => x.body) ?? []),
  );
  for (const contract of CONTRACTS.contracts) {
    for (const item of [...contract.editorialStopList, ...contract.acceptanceChecklist, ...contract.visualBrief]) {
      assert.equal(bodies.includes(item), false, `production metadata leaked into a learner body: «${item.slice(0, 50)}»`);
    }
    for (const step of contract.productionStructure) {
      // The 0:00–0:20 step IS the hook: the Blueprint's «Единый формат ролика»
      // defines the opening beat as the hook line itself, so the same sentence
      // is legitimately both a recording instruction and the learner's opening
      // callout. Every OTHER step is pure direction to the crew and must not
      // reach a learner.
      if (step.instruction === contract.hook) continue;
      assert.equal(
        bodies.includes(step.instruction),
        false,
        `a recording instruction leaked into a learner body: «${step.instruction.slice(0, 50)}»`,
      );
    }
  }
});

check("44 the learner body carries no timecode markers", () => {
  const bodies = JSON.stringify(
    CANONICAL.modules.flatMap((m) => m.levels).map((l) => l.content?.localizations.map((x) => x.body) ?? []),
  );
  assert.equal(/\d:\d{2}[–-]\d:\d{2}/.test(bodies), false, "recording timecodes are production metadata");
});

/**
 * A CONVERTER must never publish the answer key; an AUTHOR teaching the same
 * material later is a different thing entirely.
 *
 * In this Blueprint the correct option of question N restates take N almost
 * word for word, so any mechanical projection of the takes into a generated body
 * ships a 1:1 crib for the lesson's own test. This test guards the generated
 * bodies specifically — it is why `buildDraftBody` does not emit a `teyki`
 * section.
 */
check("45 no correct-answer text is mechanically projected into learner content", () => {
  const bodies = JSON.stringify(
    CANONICAL.modules.flatMap((m) => m.levels).map((l) => l.content?.localizations.map((x) => x.body) ?? []),
  );
  for (const contract of CONTRACTS.contracts) {
    for (const question of contract.questions) {
      const correct = question.options.find((o) => o.correct)!;
      assert.equal(bodies.includes(correct.text), false, `an answer key leaked into learner content at L${contract.levelNumber}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * 7. Stable section identity — §22
 * ------------------------------------------------------------------ */

check("46 every generated section code is from the closed stable vocabulary", () => {
  for (const level of CANONICAL.modules.flatMap((m) => m.levels)) {
    if (level.levelNumber <= 4) continue; // approved slice keeps its own codes
    for (const localization of level.content?.localizations ?? []) {
      const body = localization.body as { format?: string; sections: Array<{ code: string }> };
      if (!body.format) continue;
      for (const section of body.sections) {
        assert.ok(
          isVideoLessonSectionCode(section.code),
          `L${level.levelNumber} uses section code «${section.code}» outside the stable vocabulary ${VIDEO_LESSON_SECTION_CODES.join("/")}`,
        );
      }
    }
  }
});

/* ------------------------------------------------------------------ *
 * 8. The package carries the product, not a schema shell — §9 / §13
 * ------------------------------------------------------------------ */

check("47 the canonical package contains 58 banks, 232 questions, 232 answers, 232 mappings", () => {
  const { report } = validateAtaProduct100Package(CANONICAL);
  assert.equal(report.lifecycle.videoLessons, 58);
  assert.equal(report.lifecycle.testBanksPresent, 58);
  assert.equal(report.lifecycle.questionsPresent, 232);
  assert.equal(report.lifecycle.correctAnswersPresent, 232);
  assert.equal(report.lifecycle.takeMappingsPresent, 232);
  assert.equal(report.lifecycle.missingTestBanks, 0, "«schema supports 232 but only 4 are present» was the blocker");
});

check("48 the lifecycle matrix never adds PROPOSED into APPROVED", () => {
  const { report } = validateAtaProduct100Package(CANONICAL);
  assert.equal(report.lifecycle.proposedTestBanks, 57);
  assert.equal(report.lifecycle.sourceBackedTestBanks, 1);
  assert.equal(report.lifecycle.platformApprovedTestBanks, 1, "only level 2 is operator-approved");
  assert.notEqual(report.lifecycle.platformApprovedTestBanks, 58);
  // 57 proposed + 1 approved must never be summed into "58 approved".
  assert.ok(report.lifecycle.proposedTestBanks + report.lifecycle.platformApprovedTestBanks === 58);
});

check("49 production reality is reported as zero, and import as UNKNOWN", () => {
  const video = buildAtaVideoLifecycleReport(CONTRACTS);
  assert.equal(video.finalScriptsReady, 0);
  assert.equal(video.videosRecorded, 0);
  assert.equal(video.videoQaPassed, 0);
  assert.equal(video.staleProductionEvidence, 0);
  assert.equal(video.platformImported, "UNKNOWN", "a source artifact cannot observe runtime import state");
  assert.equal(video.videoContractsAvailable, 58);
  assert.equal(video.takesAvailable, 232);
  assert.equal(video.questionsAvailable, 232);
});

check("50 every package bank stays inside the generic question bounds", () => {
  for (const level of CANONICAL.modules.flatMap((m) => m.levels)) {
    if (!level.assessment) continue;
    assert.ok(level.assessment.questions.length >= MIN_LESSON_QUESTIONS);
    assert.ok(level.assessment.questions.length <= MAX_LESSON_QUESTIONS);
  }
});

check("51 generic curriculum validation stays generic: 4/4 is not imposed on it", () => {
  // The approved 4-level slice has one lesson with 4 questions and no takes at
  // all; the generic engine must keep accepting it, and must not acquire the ATA
  // video profile's opinions.
  const slice = validateCurriculumPackage(
    JSON.parse(readFileSync("curriculum/packages/ata-v2-first-slice.rev3.approved.json", "utf8")),
  );
  assert.ok(slice.ok, JSON.stringify(slice.ok ? [] : slice.issues.slice(0, 5)));
  assert.deepEqual(slice.warnings, []);
});

/* ------------------------------------------------------------------ *
 * 9. Determinism of the normalized source — §2
 * ------------------------------------------------------------------ */

check("52 the committed artifact re-serializes byte-identically", () => {
  const raw = readFileSync(CONTRACTS_PATH, "utf8");
  assert.equal(`${JSON.stringify(JSON.parse(raw), null, 2)}\n`, raw, "the artifact must be canonically serialized");
});

check("53 the artifact records the source document and its checksum", () => {
  assert.match(CONTRACTS.provenance.sourceDocument, /BLUEPRINT/i);
  assert.match(CONTRACTS.provenance.sourceDocumentSha256, /^[0-9a-f]{64}$/);
  assert.ok(CONTRACTS.provenance.sourceTitle.length > 0);
  assert.ok(CONTRACTS.provenance.sourceVersion.length > 0);
  assert.equal(CONTRACTS.extractionFormatVersion, 1);
  assert.ok(CONTRACTS.provenance.productionHandoff.length >= 5, "the handoff section must be transferred");
  assert.ok(CONTRACTS.provenance.globalEditorialConstraints.length >= 5);
});

check("54 the artifact reconciles its declared source commit with the accepted reference", () => {
  assert.ok(CONTRACTS.provenance.declaredSourceCommit.length > 0);
  assert.match(CONTRACTS.provenance.acceptedAcademyReference, /^4c4ced39/);
  assert.ok(
    CONTRACTS.provenance.sourceCommitReconciliation.includes(CONTRACTS.provenance.declaredSourceCommit),
    "the reconciliation must name the commit it reconciles",
  );
});

console.log(`\nvideo-production Blueprint regression: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
