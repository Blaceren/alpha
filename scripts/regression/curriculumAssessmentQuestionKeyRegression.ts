/**
 * The assessment question-key vocabulary, at the PUBLICATION boundary.
 *
 * PHASE-G1 established that `QuestionDefinition.stableKey` carries one of two
 * closed shapes — the lowercase package `questionCode` grammar or an ATA take
 * identifier `T{level}.{1-4}` — and widened the authoring schema accordingly.
 * The publication validator was left behind, so every canonical ATA bank was
 * unpublishable with `ASSESSMENT_QUESTION_KEY_INVALID`. This suite pins both
 * halves of the union and, more importantly, pins that nothing else was let in.
 *
 * The strongest case here is the corpus one: every question key the accepted v4
 * canonical package produces must pass, and the package is read rather than
 * imitated. The rule is that the validator adapts to the accepted artifact, not
 * the artifact to the validator.
 *
 * In memory only: no database, no network, no live data.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ASSESSMENT_QUESTION_KEY_PATTERN,
  MAX_ASSESSMENT_QUESTION_KEY_LENGTH,
  isCanonicalAssessmentQuestionKey,
} from "@/lib/curriculum/stable-code";
import { TAKE_ID_PATTERN } from "@/lib/curriculum/video-production-contract";
import { expectedTakeIdFor, isAtaVideoProfileLevel } from "@/lib/curriculum/authoring-level-profile";
import { updateAssessmentQuestionSchema } from "@/lib/curriculum/assessment-schemas";

const V4_PACKAGE = "curriculum/packages/ata-v2-canonical-100.v4.draft.json";
const V3_PACKAGE = "curriculum/packages/ata-v2-canonical-100.draft.json";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${passed + failed}. ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${passed + failed}. ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

type PackageLevel = {
  levelCode: string;
  levelNumber: number;
  type: string;
  assessment: { questions: Array<{ questionCode: string; questionNumber: number }> } | null;
};

function levelsOf(path: string): PackageLevel[] {
  const pkg = JSON.parse(readFileSync(path, "utf8")) as { modules: Array<{ levels: PackageLevel[] }> };
  return pkg.modules.flatMap((moduleRow) => moduleRow.levels);
}

/* ------------------------------------------------------------------ *
 * the two accepted vocabularies
 * ------------------------------------------------------------------ */

check("a lowercase canonical question code is accepted", () => {
  for (const key of ["ata-v2.l002.q1", "ata-v2.l100.q4", "q1", "a_b-c.d", "level0.q12"]) {
    assert.equal(isCanonicalAssessmentQuestionKey(key), true, key);
  }
});

check("a canonical ATA take id is accepted", () => {
  for (const key of ["T2.1", "T2.4", "T26.3", "T51.2", "T76.4", "T100.1"]) {
    assert.equal(isCanonicalAssessmentQuestionKey(key), true, key);
  }
});

check("the take half is the ACCEPTED pattern, not a local re-statement", () => {
  // If the two ever diverge, a key the authoring schema stores would stop being
  // publishable again — which is the whole defect this closes.
  for (const key of ["T1.1", "T7.3", "T999.4"]) {
    assert.equal(TAKE_ID_PATTERN.test(key), isCanonicalAssessmentQuestionKey(key), key);
  }
});

check("the two sides agree about takes: what authoring stores, publication accepts", () => {
  // Asked through the real authoring surface rather than a copied regex, so the
  // two cannot drift apart again without this failing.
  const authoringAccepts = (stableKey: string): boolean =>
    updateAssessmentQuestionSchema.safeParse({
      actorId: 1,
      expectedRevision: 1,
      questionDefinitionId: 1,
      patch: { stableKey },
    }).success;

  for (const key of ["T2.1", "T100.4", "T5.5", "t5.1", "T5-1", "TAKE5.1", "Q1", "ABC"]) {
    if (!TAKE_ID_PATTERN.test(key) && !authoringAccepts(key)) continue;
    assert.equal(
      isCanonicalAssessmentQuestionKey(key),
      authoringAccepts(key),
      `authoring and publication disagree about ${key}`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * what is still refused
 * ------------------------------------------------------------------ */

check("arbitrary uppercase is still refused", () => {
  for (const key of ["Q1", "ABC", "ATA-V2.L002.Q1", "Take2.1", "T", "TAKE5.1", "X2.1"]) {
    assert.equal(isCanonicalAssessmentQuestionKey(key), false, key);
  }
});

check("a malformed take id is still refused", () => {
  // Ordinal out of range, level missing, wrong separator, too many parts.
  for (const key of ["T5.5", "T5.0", "T5", "T.1", "T5-1", "T5.1.2", "T1234.1", "T5.10"]) {
    assert.equal(isCanonicalAssessmentQuestionKey(key), false, key);
    assert.equal(TAKE_ID_PATTERN.test(key), false, `${key} must not be a take either`);
  }
});

check("`t5.1` is accepted as a LOWERCASE key, and is still not a take", () => {
  // Worth pinning explicitly, because it looks like a mis-cased take and is not
  // one: it is an ordinary lowercase question code under the pre-existing
  // grammar and was accepted before this correction too. What matters is that
  // the take vocabulary did not acquire a case-insensitive spelling.
  assert.equal(ASSESSMENT_QUESTION_KEY_PATTERN.test("t5.1"), true);
  assert.equal(TAKE_ID_PATTERN.test("t5.1"), false);
  assert.equal(isCanonicalAssessmentQuestionKey("t5.1"), true);
});

check("empty, non-string and over-long keys are refused", () => {
  assert.equal(isCanonicalAssessmentQuestionKey(""), false);
  assert.equal(isCanonicalAssessmentQuestionKey(null), false);
  assert.equal(isCanonicalAssessmentQuestionKey(undefined), false);
  assert.equal(isCanonicalAssessmentQuestionKey(42), false);
  assert.equal(isCanonicalAssessmentQuestionKey("a".repeat(MAX_ASSESSMENT_QUESTION_KEY_LENGTH)), true);
  assert.equal(isCanonicalAssessmentQuestionKey("a".repeat(MAX_ASSESSMENT_QUESTION_KEY_LENGTH + 1)), false);
});

check("whitespace is refused rather than trimmed — no key survives normalisation", () => {
  for (const key of [" T2.1", "T2.1 ", " T2.1 ", "\tT2.1", "T2.1\n", " ata-v2.l002.q1"]) {
    assert.equal(isCanonicalAssessmentQuestionKey(key), false, JSON.stringify(key));
  }
});

check("separator edge cases in the lowercase half are unchanged", () => {
  for (const key of ["a..b", ".a", "a.", "a--b", "-a", "a-", "a__b"]) {
    assert.equal(isCanonicalAssessmentQuestionKey(key), ASSESSMENT_QUESTION_KEY_PATTERN.test(key), key);
  }
  assert.equal(isCanonicalAssessmentQuestionKey("a..b"), false);
});

/* ------------------------------------------------------------------ *
 * the corpus: the accepted artifact must be publishable as it stands
 * ------------------------------------------------------------------ */

for (const [label, path] of [["v4 successor", V4_PACKAGE], ["v3 predecessor", V3_PACKAGE]] as const) {
  check(`every question key the ${label} package persists passes publication validation`, () => {
    const levels = levelsOf(path);
    const banks = levels.filter((level) => level.assessment !== null);
    let persisted = 0;
    const rejected: string[] = [];
    for (const level of banks) {
      const ataVideoBank = isAtaVideoProfileLevel({
        levelNumber: level.levelNumber,
        stableCode: level.levelCode,
        type: level.type,
      });
      for (const question of level.assessment!.questions) {
        // Exactly what `package/import.ts` writes into `stableKey`.
        const stableKey = ataVideoBank
          ? expectedTakeIdFor(level.levelNumber, question.questionNumber)
          : question.questionCode;
        persisted += 1;
        if (!isCanonicalAssessmentQuestionKey(stableKey)) rejected.push(`${level.levelCode}:${stableKey}`);
      }
    }
    assert.equal(banks.length, 58, "the canonical product has 58 assessment banks");
    assert.equal(persisted, 232, "the canonical product persists 232 question rows");
    assert.deepEqual(rejected, [], `these keys would block publication: ${rejected.slice(0, 5).join(", ")}`);
  });

  check(`the ${label} package's own questionCodes are canonical too`, () => {
    const codes = levelsOf(path)
      .filter((level) => level.assessment !== null)
      .flatMap((level) => level.assessment!.questions.map((question) => question.questionCode));
    const bad = codes.filter((code) => !isCanonicalAssessmentQuestionKey(code));
    assert.deepEqual(bad, [], "the package grammar must remain publishable in its own right");
  });
}

check("early, middle and late ATA banks all use the take vocabulary", () => {
  const levels = levelsOf(V4_PACKAGE).filter((level) => level.assessment !== null);
  for (const levelNumber of [2, 26, 51, 76, 98]) {
    const level = levels.find((candidate) => candidate.levelNumber === levelNumber);
    assert.ok(level, `level ${levelNumber} should carry a bank`);
    const keys = level!.assessment!.questions.map((question) =>
      expectedTakeIdFor(level!.levelNumber, question.questionNumber),
    );
    assert.equal(keys.length, 4);
    assert.deepEqual(
      keys,
      [1, 2, 3, 4].map((ordinal) => `T${levelNumber}.${ordinal}`),
    );
    for (const key of keys) assert.equal(isCanonicalAssessmentQuestionKey(key), true, key);
  }
});

console.log(`\nassessment question key regression: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
