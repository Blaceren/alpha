# Video+test production contract

How a lesson goes from an editorial proposal to an imported platform assessment,
and which file owns each step. Every claim here points at a source artifact — if
a rule is not implemented, it is not in this document.

---

## 1. Why this domain exists separately

Three different things used to be called "the lesson":

| Question | Owner |
|---|---|
| Which levels exist, in what order, with what unlocks? | `src/lib/curriculum/product-ata-100.ts` |
| What does a learner read? | `src/lib/curriculum/content-blocks.ts` (Body v2) |
| What must be said on camera, and what may the test therefore ask? | `src/lib/curriculum/video-production-contract.ts` |

The third had no home. Structure and learner content were correct, but the
per-lesson contract binding a video to its test — four testable takes, four
questions, one-to-one coverage — existed only in an editorial `.docx`. An
independent audit blocked the previous candidate for that: the product's 58 × 4 =
232 relationships were neither present as data nor representable as schema, and
57 proposed question banks were recorded as `MISSING`, which asserts they do not
exist.

---

## 2. The source chain

```
ATA_VIDEO_LESSONS_PRODUCTION_BLUEPRINT_V1.docx      editorial deliverable, NOT committed
        │
        │  scripts/curriculum/extractVideoBlueprint.ts --docx <path>
        ▼
curriculum/canonical/ata-video-production-contracts.v1.json    58 contracts · 232 takes · 232 questions
        │
        │  scripts/curriculum/buildCanonical100.ts
        ▼
curriculum/packages/ata-v2-canonical-100.draft.json            the 100-level DRAFT package
```

**The `.docx` is deliberately not committed.** It is an editorial deliverable,
not application data: a binary blob on the source path cannot be diffed,
reviewed or validated, and a later edit to it would be invisible in review. The
normalized JSON is committed instead and carries the document's sha256, so any
extraction can be re-proved against the exact original.

**Extraction is deterministic.** Same document → byte-identical JSON.
`npm run curriculum:blueprint:check -- --docx <path>` re-extracts and compares
against the committed artifact, so editorial drift fails in review rather than at
import.

**Nothing is rewritten.** Prompts, options and correct answers are transferred
verbatim. The extractor cross-checks the document's two independent statements of
each correct answer (the `✓` marker and the «Правильный ответ:» line) and refuses
a document where they disagree, rather than silently preferring one.

---

## 3. Three state axes, never one enum

The states are independent and move at different times, so they are separate
fields (`video-production-contract.ts`):

| Axis | Values | Answers |
|---|---|---|
| `sourceProvenance` | `SOURCE_BACKED` · `PROPOSED_CANON` | Where did the material come from? |
| `approval` | `AWAITING_APPROVAL` · `APPROVED` | Has product/compliance signed it? |
| `production.script` | `SCRIPT_PENDING` · `SCRIPT_READY` | Is there a full script? |
| `production.video` | `NOT_RECORDED` · `VIDEO_RECORDED` | Has it been shot? |
| `production.qa` | `QA_PENDING` · `QA_PASSED` · `QA_FAILED` | Has QA answered the test from the video alone? |

**L18 is the case that proves the split is necessary.** Its questions already
exist, authored, in Academy's `lesson-fixtures.ts`, so it is `SOURCE_BACKED`. It
is still `AWAITING_APPROVAL` as a platform assessment, and still `NOT_RECORDED`.
A single lifecycle enum would have to lie about two of those three.

**`PLATFORM_IMPORTED` is not on this list.** Whether a bank reached the database
is runtime state. A source artifact that answered `0` would assert something it
cannot observe; one that answered `58` would lie. The metric reports `UNKNOWN`,
and the type says so.

In the package these surface as `pendingApprovals[].classification`:

| Classification | Meaning | Outstanding work |
|---|---|---|
| `MISSING` | nobody has written it | production |
| `PROPOSED` | it exists, awaiting approval | **review** |
| `CONFLICTING` | two accepted sources disagree | **a decision** |

All three set `blocksReadiness`, so relabelling never makes anything shippable.
What changes is that a content plan can tell "write 232 questions" from "review
232 questions".

---

## 4. The workflow

1. **Content contract** — the Blueprint is extracted to
   `ata-video-production-contracts.v1.json`. Every contract is
   `AWAITING_APPROVAL`, whatever its provenance.
2. **Product / content / compliance approval** — a human moves a contract to
   `approval: APPROVED`. Nothing automated may do this; the extractor is
   incapable of emitting it.
3. **Full script** — a writer expands the contract without changing the meaning
   of `T{level}.1–4` or any correct answer. `production.script → SCRIPT_READY`.
4. **Production** — the video is recorded and each take's timecode is recorded in
   `production.takeCoverage`. `production.video → VIDEO_RECORDED`.
5. **QA against the video only** — a reviewer watches the recording and answers
   the test from it alone. `production.qa → QA_PASSED`, and the evidence records
   `reviewedContractVersion` + `reviewedContractFingerprint`.
6. **Platform assessment import** — the approved bank is imported. That step is
   outside this document's artifacts and outside what a package can observe.
7. **Invalidation on semantic change** — see §5.

This mirrors §5 «Передача в продакшен и инженерную команду» of the Blueprint,
which is transferred verbatim into `provenance.productionHandoff`.

---

## 5. Version and fingerprint coherence

The Blueprint states the rule in prose: *«При изменении правильного ответа
редактор обязан обновить видео/сценарий; при изменении видео — повторно проверить
тест.»* Prose cannot enforce it, so there are two fingerprints:

| Fingerprint | Covers | Changing it means |
|---|---|---|
| `assessmentFingerprint` | takes, questions, options, correct answers, take↔question binding | the thing QA answered against has moved |
| `contractFingerprint` | the above **plus** hook, requiredTopics, mainIdea, learningObjective, identity | the meaning the script must deliver has moved |

Consequences, all regression-tested:

- change a **correct answer** or a **take's text** → both fingerprints move → any
  recorded QA is stale and `isProductionEvidenceStale` reports it.
- change an **editorial semantic** (e.g. `mainIdea`) → only `contractFingerprint`
  moves → the questions themselves are intact, but the test needs revalidating
  against the new contract.
- change **production direction** (`targetDuration`, `visualBrief`,
  `productionStructure`, `editorialStopList`, `acceptanceChecklist`) → **neither**
  moves.

That last exclusion is deliberate and is the reason the signal stays usable:
re-timing a lesson from 7–9 to 8–10 minutes, or rewording a shot list, cannot
change which answer is correct. Including them would mark 58 recorded videos
stale for a cosmetic edit, which is how a staleness signal becomes noise nobody
reads.

`approval` and `production` are excluded for a stronger reason: they are facts
*about* the contract, not the contract. Including them would mean approving a
contract changes its fingerprint, instantly invalidating the approval just
recorded.

---

## 6. Learner content vs production metadata

`ContentLocalization.body` carries **only** learner-facing material. The
production contract is a separate artifact and is never automatically projected
into it. Regression-tested: no editorial stop list, acceptance checklist, shot
list, recording instruction or timecode appears in any generated body.

**The takes are not projected either**, and the reason is worth recording. In
this Blueprint the correct option of question *N* restates take *N* almost word
for word, so a converter that listed the four takes in order would publish a 1:1
answer crib for the lesson's own test. An authored lesson will teach that
material properly — that is a human writing prose, not a converter emitting the
answer key. The `teyki` section code stays reserved for that author.

---

## 7. Stable section identity

`UserLessonProgress.completedSections` stores section **codes**, which are
durable learner state. The generated draft therefore uses a **closed vocabulary**
(`VIDEO_LESSON_SECTION_CODES`) drawn from the Blueprint's own «Единый формат
ролика», so a draft anchor survives authoring instead of being renamed by it:

| Code | Beat |
|---|---|
| `hook` | 0:00–0:20 — the hook |
| `opredelenie` | 0:20–1:20 — definition and bounds |
| `teyki` | 1:20–4:30 — the four takes (authors only; see §6) |
| `stsenarii` | 4:30–6:30 — correct vs mistaken scenario |
| `itog` | final — recap |

A generated draft emits only the sections it has honest material for. What it may
not do is invent a code outside this list.

---

## 8. XP is a PRODUCT decision, and this artifact does not carry it

When this contract was written no accepted source defined an ATA XP schedule, so
every non-gate reward shipped as `xpRewardStatus: "unresolved"`.

Phase F decided it. The schedule lives in
`src/lib/curriculum/product-xp-policy.ts` and is documented in
`docs/ATA_100_CONTENT_ARCHITECTURE.md` §4; the canonical ATA-100 builder reads it
and every level of the canonical draft now declares `xpRewardStatus: "approved"`.

**Nothing about that touches this artifact.** The video production contract is
*editorial* truth — takes, hooks, question banks, section structure. XP is
*runtime product policy*. The Blueprint did not author the schedule and this file
must never be edited to suggest it did; a reward is not a fact about a video.

`PackageLevel.xpRewardStatus` still carries the distinction, and the safe default
is unchanged:

- `approved` — the reward is a real product decision.
- `unresolved` — a placeholder; the decision is outstanding.

Absence still defaults to `unresolved` for non-gate levels, because silence is
not a decision, and an **approved** ATA-100 package still cannot ship with one
(`ATA100_XP_SCHEDULE_UNRESOLVED` is a gap, and gaps block approval).

---

## 9. Future editor contract (Phase G)

No CRM UI is built here. The schema is shaped so one can be built without another
domain redesign. Five distinct surfaces, five distinct owners:

| Surface | Reads / writes | Source of truth | Notes |
|---|---|---|---|
| **A. Learner content** | `PackageLevel.content.localizations[].body` | `content-blocks.ts` | 15 block types, closed union, strict objects. Never contains answers or production notes. |
| **B. Video production contract** | `VideoProductionContract` minus `questions` | `video-production-contract.ts` | hook, requiredTopics, mainIdea, learningObjective, 4 takes, targetDuration, visualBrief, productionStructure, editorialStopList, acceptanceChecklist. Editing any *semantic* field moves `contractFingerprint`. |
| **C. Assessment bank** | `VideoProductionContract.questions` + `PackageLevel.assessment` | `video-production-contract.ts` + `package/schema.ts` | 4 single-choice questions, 4 options, exactly one correct, exactly one `takeId`. Editing moves both fingerprints. |
| **D. Approval state** | `sourceProvenance` (read-only) · `approval` (writable) · `pendingApprovals[]` | `video-production-contract.ts` | Provenance is a fact about the source and is never editable in the tool. Approval is the only writable field, and it is a human act. |
| **E. Production / QA state** | `production.{script,video,qa,takeCoverage}` + `reviewed*` | `video-production-contract.ts` | Writing QA evidence must stamp the current `contractFingerprint`; stale evidence is detectable via `isProductionEvidenceStale`. |

Invariants any editor must preserve, all already enforced in source:

- B and C may never write into A.
- Approving in D must not mutate B or C (it would move the fingerprint and
  invalidate itself).
- Editing B or C must clear or re-stamp E, never leave it silently stale.
- `sourceProvenance` is read-only everywhere.

---

## 10. Commands

```bash
npm run curriculum:blueprint:extract -- --docx /path/to/blueprint.docx
npm run curriculum:blueprint:check   -- --docx /path/to/blueprint.docx
npm run curriculum:canonical100:build
npm run curriculum:canonical100:check
npm run curriculum:verify-academy-transfer -- --academy /path/to/academy
npm run test:regression:curriculum-video-blueprint
```

`--docx` and `--academy` are explicit on purpose and have no default: a Backend
gate must never depend on another repository, or an editorial deliverable,
happening to be present on the machine.
