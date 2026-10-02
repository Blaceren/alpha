# The 30-level program

What it is, where every part of it comes from, what the platform had to learn to
carry it, and how it is operated. Every claim points at a file; a rule that is
not implemented is not in this document.

Owner, 2026-10-02: «следующий этап внедряем первые 30 настоящих уровней, вот
описание того какой должна быть структура уровней». The description is the
document «ALFA TRADE ACADEMY · СОДЕРЖАНИЕ ВОРОНКИ ОБУЧЕНИЯ · УРОВНИ 1–30».

---

## 1. The source chain

```
«Содержание воронки обучения · уровни 1–30»          the owner's document, NOT committed
        │   transcribed once, sha256 recorded in the source file
        ▼
curriculum/canonical/ata-funnel-30.source.json        the program as data: 2 chapters, 6 modules, 30 levels
        │   scripts/curriculum/buildFunnel30.ts        (npm run curriculum:funnel30:build)
        ▼
curriculum/packages/ata-v2-funnel-30.v5.draft.json    package `ata-v2.funnel-30`, curriculum `ata-v2` version 5
```

The build is deterministic — no clock, no randomness — and
`npm run curriculum:funnel30:check` proves the checked-in package is byte-identical
to a build of its source. `scripts/regression/curriculumFunnel30Regression.ts`
(40 checks) walks one learner through it in a disposable database.

**Nothing in a lesson is rewritten.** Titles, descriptions, results, questions,
options, correct answers, the «разбор» of every question and its «пересмотреть с
m:ss» are the document's. Two kinds of text are deliberately NOT carried into
learner copy, and the regression holds the line (`A5b`):

* production status («не начат», «ждёт готовый продукт», «задание не готово»,
  «сюда ложится видео…»);
* requirements on material that does not exist yet (the level-9 «заполненный
  образец»: «в образце обязательно и удачные, и неудачные сделки…»).

## 2. The program

| L | Kind | Pair | XP | Notes |
|---|---|---|---|---|
| 1 | урок | `lesson:lesson` | 50 | no test |
| 2 | урок | `lesson:lesson` | 50 | not produced yet: one line of description |
| 3 | задание | `external_event:pocket_postback` | 0 | the registration level |
| 4–8 | урок | `lesson:assessment_pass` | 100 | 4 questions, all four needed, attempts unlimited |
| 9 | отчёт | `report:formal_check` | 500 | 5 trade records + ≥ 1 refusal; nobody reviews it |
| 10–12 | урок | `lesson:assessment_pass` | 100 | |
| 13 | практика | `lesson:manual` | 150 | |
| 14 | точка сборки | `lesson:manual` | 150 | end of chapter 1 |
| 15–30 | — | `lesson:lesson`, `status: disabled` | 0 (unresolved) | defined, **not open** |

Chapters: 1 «Основы и первые реальные сделки» (modules 1–3), 2 «Чтение графика»
(modules 4–6). Tools open after levels 5, 9, 13, 13, 24, 28.

The XP of a lesson without a test (50) is a default that the owner has been
asked to confirm; the rest follow the published reward model.

## 3. What the platform had to learn

| The program needs | Where it lives |
|---|---|
| Chapters over modules; the author's kind of a level | migration 61 (`chapterNumber`, `chapterTitle`, `presentationKind`); package schema, importer, read API |
| Levels that are **defined and not open yet** | `LevelDefinition.status = disabled` as a trailing run only — `closed-tail.ts`, publication validation, the resolver. A learner who finishes the last open level stands on the first closed one: `locked`, blocker `definition_inactive`, enrollment still active |
| Tools opened by the version, not by a constant | `LevelToolUnlock` rows; legacy versions were back-filled with 5/10/15/20/25/30 by the migration; `tool-access.ts`, `tools/access.ts` |
| A registration level that is not the first | found by its pair in the learner's own version; a postback before the level is reached binds the identity and completes nothing; `POST /api/exchange/registration/check` settles it once the learner stands there |
| A test that explains a wrong answer | `QuestionDefinition.rewatchFromSeconds`; `submit` returns `review` (wrong answers only, never the key) when the assessment shows explanations |
| A report nobody reviews | pair `report:formal_check`; acceptance is a `ReportReview` row with **no reviewer**, written in the submit transaction (the table's CHECK requires an approved submission to point at a review) |
| A lesson video that can change without a new program version | `LessonMediaAsset` — mutable, keyed by curriculum + level stable code + asset code; merged into the lesson's `assets` as `/media/<storageKey>` |
| Moving a learner to a newer version | `enrollment-move.ts` |

## 4. Operations

All commands run in the Backend release with the Backend's environment. Each one
**plans by default** and writes only with `--apply`.

### 4.1 Activate the program

```
tsx scripts/ops/activateProgramVersion.ts \
  --package curriculum/packages/ata-v2-funnel-30.v5.draft.json \
  --expect-fingerprint <the package's contentFingerprint> \
  --expect-published-version 4 \
  --actor-user-id <an active admin> \
  --backup <a backup of THIS database, taken in the last 30 minutes> --apply
```

It imports the package as a draft and publishes it; the replaced version is
archived. No learner is enrolled, moved or touched — the command counts the
learner tables before and after each step and stops if any of them moved.

From that moment **new registrations get version 5**. Learners already enrolled
stay on the version they are on.

### 4.2 Put a lesson's video on the platform

```
tsx scripts/ops/registerLessonMedia.ts --level 4 --file /abs/lesson-04.mp4 \
  --media-root <the deployment's media directory> [--dry-run]
```

It copies the file to `lessons/<stableCode>/<first 16 hex of its sha256>.<ext>`
under the media root and writes the lesson's one row for that asset. A poster
(`.jpg/.png/.webp`) and captions (`.vtt`) are registered the same way. It never
deletes: a replaced file stays on disk and the command prints its path.

The Academy serves `/media/…` itself, from `ATA_MEDIA_ROOT`, to a learner the
Backend would give that lesson to. The length of an MP4 is read from the file;
no external tool is used.

### 4.3 Move learners to the published program

```
tsx scripts/ops/moveLearnersToPublishedProgram.ts \
  (--user-id 73 [--user-id 74 …] | --all-on-version 4) --reason "…" [--apply]
```

A move supersedes the active enrollment and creates one on the published
version. Completed levels carry over only as a contiguous prefix of levels with
the same stable code, type and completion method — from the 100-level program to
this one that prefix is empty (level 1 is a different lesson), so a moved learner
starts at level 1 with their XP carried as one adjustment. A learner waiting on a
reviewer is not moved.

### 4.4 Open the next levels, or change a published text

A published version is immutable. Both are a **successor version**: edit the
source, build with `--curriculum-version-number 6`, activate it, and move the
learners who should see it (their completed levels carry over, because the
stable codes are the same).

A lesson's **video** is not part of a version and needs none of this (§4.2).

## 5. Rolling back

Before the program is published: redeploy the previous Backend and Academy.
Migration 61 is additive and the previous release ignores what it added.

**After it is published: restore the database backup taken for the activation,
then redeploy the previous releases.** The previous Backend reads a published
version that contains closed levels as corrupt, and does not know
`report:formal_check`, the tool unlock rows or a registration level that is not
the first.

## 6. Not built, and open

* **The deposit transition after level 9** («условие перехода: пополнение
  реального счёта») and the other «контрольные точки». Level 9 completes on the
  formal check of the report alone.
* **Level 9's «заполненный образец»**, the forms and criteria of levels 13 and
  14, the content of levels 2 and 3 — not produced yet.
* **The document's tool descriptions** (section 4) differ from the tools that
  exist: a refusal card, demo and real kept apart, an eight-point plan, an
  editable seven-point checklist, a «gap to the bar» statistic, a list of
  sources instead of a calendar. The existing tools were not changed.
* **Community thresholds** are level numbers (4, 20, 35, …) and now name
  different lessons.
* The document says both «отказы … их число … не требуется» and «минимум один
  отказ»; the report requires one refusal record and allows two more.
