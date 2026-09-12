# ATA-PREPROD-ACADEMY-EXPERIENCE-COMPLETION-1 — FINAL REPORT

**Verdict: PASSED** · 0 BLOCKER · 0 HIGH · 2026-08-16

---

## A. Accepted baseline (Wave 1 / 2A / 2B)

Carried forward unchanged; nothing below reopened any of it.

| Wave | Accepted |
|---|---|
| 1 | Home = Single Task Field · Path = Learning Spine · Lessons distinct from Path · Notifications/Profile routes · loading/error/not-found · real-browser acceptance · mobile Path · Home/Path consistency |
| 2A | Tools use canonical curriculum progress · fixture learner "Артём" removed from API mode · LEGACY-USER-PROGRESS-COLUMNS-1 CLOSED · `User.level`/`User.xp` remain V1 authority only · no migration 53 |
| 2B | Level Detail integrated into the approved A+B language · one canonical `explainLevelState` across Home/Path/Level Detail · waiting ≠ blocked · report contract audited · report revision semantics resolved |

Entry baseline: academy `f118a6b4`, backend `8a1fe5f0`, crm `49f16ada`, partner `2265f436`, migration 52.

---

## B. Report revision decision and evidence

**OPTION 1 accepted by the human decision-maker: code-level canonical resolution is sufficient.**
`REPORT-REVISION-BROWSER-PROOF = NOT REQUIRED FOR THIS PHASE`.

The conditions that decision was made against all hold:

- Canonical vocabulary confirmed in the Backend: `draft · pending_review · rejected · approved`,
  with `rejected` as the revision-requested state (`report-review.ts` sets
  `status: "rejected"` and returns the level to `in_progress` so the learner can act again).
- Automated coverage retained and **strengthened** — a new named regression,
  `features/report/report-canonical-states.test.ts` (8 tests), asserts all four states hydrate to
  four distinct non-error UI statuses, that `rejected` IS `REVISION_REQUESTED` with no fifth name,
  that only `draft` arrives editable, and that `rejected → begin_correction → resubmit` seeds from
  the learner's existing values and selects resubmit rather than submit.
- No contradictory runtime evidence appeared.
- No report presentation defect found in final acceptance (L3 verified in the browser: approved,
  completed, +500 XP, no stale revision UI).
- **No synthetic learner was created and no historical report was reversed.**

---

## C. Public mentor feedback

The highest-value genuinely missing learner feature, now shipped.

**What was wrong.** Seven levels are `mentor_review` and one is `report_approval`. On all eight the
learner submits and waits for a person. Learner Operations has always carried that person's reply —
a `LearnerOpsMessage` on the case anchored to the learner's own progress row — and the Academy never
showed it. A learner who had been written to saw only "ждёт наставника" and had to go hunting in
Support for a message about the level they were standing on.

**No new messaging backend.** The already-accepted LO learner-visible projection is consumed as-is.

**One backend change, and why it was genuinely necessary.** The learner-facing case projection
carried no anchor, so a client could tell that *some* review had a reply but not *which level* it
belonged to; the only alternative was parsing the subject prose. The canonical **level coordinate**
(`levelNumber`, `stableCode`, `title`) is now projected by a single shared owner,
`lib/learner-ops/learner-projection.ts`, used by both learner routes.

Deliberately **not** projected, and asserted absent:

- the anchor's identity (`userLevelProgressId`, `reportSubmissionId`);
- the anchor's **status** — a `resolved` operational case is not a completion and must never be
  readable as one;
- anything internal — notes, QA, escalations, assignment, queue, priority, reason codes, SLA clocks.

**Public/internal boundary — enforced twice, tested against a poisoned payload.**

| Layer | Defence |
|---|---|
| Backend | `LearnerOpsNote` is a separate table the learner routes never join or name |
| Academy | `toMentorFeedback` is an **allowlist**: it constructs a new object from four named fields and copies nothing else, so a regressed payload cannot leak through |

`lib/learner-ops/mentor-feedback.test.ts` (13 tests) feeds the projector a payload carrying
`internalNote`, `notes`, `qaNote`, `qaScore`, `escalation`, `assignedStaff` (with an internal email),
`authorStaffId`, `priority`, `queue`, `reasonCode`, `slaBreached`, `visibility: "internal_only"` and
asserts none of it — not one substring — survives into the object handed to the component. It also
proves only `staff`-authored messages are carried, that an unknown `authorKind` is not assumed safe,
and that a case is matched on the **canonical stable code only**, never on subject prose or list
position.

**Feedback ≠ approval (§3).** `features/mentor-review/mentor-feedback.tsx` takes the canonical level
state as a prop rather than deriving one, has **no control of any kind** (asserted: zero
button/input/textarea/form/anchor), and renders the decision sentence in the same panel as the reply:

> pending → «Это ответ наставника, а не решение. Проверка ещё не завершена — уровень пока не засчитан.»
> completed → «Работа принята наставником. Уровень завершён.»

While pending it wears the **cold** material (`data-posture="waiting"`, never `done`, never `act`)
and shows no completion, XP or success language.

**Live evidence (learner 73, L14, case LO-000009).** The reply renders in full; the internal note
`MENTOR-NOTE-CANARY-9052 ВНУТРЕННЕЕ…` is **absent from the page**.

**Home (§4)** gets one line — "Наставник ответил… Решение ещё не принято" — and only when the derived
action is already a waiting review. The reply's body is never on Home; Home is not an inbox.

---

## D. Rich lesson integration

**The finding.** The Backend has always published a complete lesson: 5–9 titled sections built from a
15-member block vocabulary. The Academy requested it on every level page and **discarded all of it**,
rendering the one-paragraph `summary` and a "видео: N мин" fact line. 4–12 KB of written lesson per
level reached the browser and none reached the learner.

`features/lesson` (4,716 lines) was inspected before writing anything. Its presentation model is
fixture-era and timeline-anchored (`startSeconds`, simulated media, a frontend
`unlockWatchPercent: 50` completion rule) and has no canonical counterpart; its *structure* —
sections, outline, reading ergonomics — was carried over. No fixture data or fixture styling ships.

### Contract audit (§7)

| Fixture input | Canonical equivalent | Verdict |
|---|---|---|
| level, module, title, sequence | `AcademyLevelSummary` + module | CANONICAL AVAILABLE |
| goal | `learningObjective` + `learningObjectiveExtension` | CANONICAL AVAILABLE |
| sections[].title/body | `body.sections[].code/title/blocks[]` | CANONICAL AVAILABLE (richer) |
| resources | `content.assets[]` via `download`/`video`/`image` blocks | CANONICAL AVAILABLE |
| exercise estimated time | `exercise.estimatedMinutes` | CANONICAL AVAILABLE **per exercise** |
| captions available | assets of kind `subtitles` | DERIVABLE |
| requirements list | `completionMethod` | DERIVABLE (one sentence, not an invented checklist) |
| assessment questions | canonical assessment API (separate owner) | CANONICAL — **not** re-implemented here |
| media.kind "simulated", provisionalNote | — | FIXTURE ONLY — dropped |
| `completionRule.unlockWatchPercent: 50` | — | FIXTURE ONLY — **forbidden by §11**, dropped |
| sections[].startSeconds | — | NOT AVAILABLE (canonical sections are not timeline-anchored) |
| lesson-level reading time, teacher, difficulty, tags, completion % | — | NOT AVAILABLE — **absent, never estimated** |

### The reader

`lib/curriculum/lesson-body.ts` normalizes both stored formats into one reading model, **fail-closed
block by block**: a malformed block is dropped rather than throwing (one bad table must not blank a
lesson), an unknown block type is inert rather than guessed at, an unresolvable or non-https asset
drops its block rather than rendering a broken image, and a ragged table is refused rather than
misaligning every cell after it. If everything drops the result is `null` and the surface shows its
honest "материал недоступен" state.

**Verified against every body published in PREPROD:**

| bodies | v2 | legacy v1 | unreadable | sections | blocks | dropped |
|---|---|---|---|---|---|---|
| 158 | 156 | 2 | **0** | 878 / 878 | 2,638 / 2,638 | **0** |

Block types live in the real curriculum: `rich_text` 656, `callout` 650, `list` 248,
`common_mistake` 248, `table` 234, `tool_link` 166, `example` 160, `glossary` 104, `cta` 100,
`heading` 48, `exercise` 40. All 40 exercises carry an author-written `estimatedMinutes`.

### Lesson vs Level Detail (§9)

| Surface | Owns |
|---|---|
| **Level Detail** `/lessons/[code]` | state · task context · progression position · the canonical control |
| **Rich lesson** `/lessons/[code]/material` | the written lesson, set for reading · outline · position · one transition back |

The reader carries **no** task control, XP figure, level-parameters table or level pager. Level
Detail's «Материал» became a handoff stating the lesson's real shape ("7 разделов", "прочитано N")
and one quiet link. The one state sentence the reader shows is the **same** `explainLevelState` the
other three surfaces use.

### The transition is authored, not invented (§8, §11)

Every published lesson already ends with a canonical `cta` whose action matches its completion
method — `start_assessment` ×82, `request_mentor_review` ×14, `next_level` ×4. It is rendered as
written and points at `#task` on the level page, where the canonical control lives. A derived
transition appears **only** when a body carries no CTA at all. Frontend navigation is never
progression authority.

### Reading position is the server's

The fixture era kept it in `sessionStorage`, making the browser the authority on how far someone had
read. It is now canonical `UserLessonProgress`: a **different row** from `UserLevelProgress`, written
by a command that refuses unless the level is already `in_progress` and refuses again the moment it
completes, and which never touches the progression row.

This is the **seventh** sanctioned learner write, and `no-write.test.ts` was extended rather than
relaxed. `lesson-progress` moved out of the blanket-forbidden list into its own pinned surface with
new tests asserting: one URL in one surface; the outgoing body is **exactly**
`{expectedRevision, playbackPositionSeconds, completedSections, progressData}` and nothing else; the
surface names no `userId`/`xp`/`completionMethod`/`approve`/`verdict`; and the reader itself issues
no request of its own. **The lesson-media player remains unsanctioned and still performs no I/O.**

---

## E. Assessment / manual / report / checkpoint / L1 regression

Not rewritten — verified in place after the reader landed.

| Component | Result |
|---|---|
| LevelAssessment | wiring unchanged, hosted on the shared task surface |
| LevelManualCompletion | unchanged |
| LevelReport | verified live on L3 (approved, +500 XP, no stale revision UI) |
| LevelMentorReview | verified live on L14 alongside the new feedback panel |
| LevelCheckpoint | verified live on L15 — see §truthfulness below |
| L1 Pocket registration | predicates unchanged |

**Checkpoint truthfulness (L15).** «Условие: Баланс Pocket от $150 · Учитывается только
подтверждённый реальный баланс. Demo не учитывается. · Проверка условия сейчас недоступна. · Пока
проверка недоступна, следующий модуль не открывается. · Прогресс сохранён.» No balance, deposit,
profit or "осталось $X". XP shown as «—», never "+0 XP".

---

## F. XP / completion implementation

Canonical model confirmed against the curriculum, exactly as specified:

| Method | XP | Levels | Total |
|---|---|---|---|
| assessment_pass | 100 | 58 | 5,800 |
| lesson manual | 150 | 13 | 1,950 |
| mentor_review | 250 | 7 | 1,750 |
| report_approval | 500 | 1 | 500 |
| financial_checkpoint | 0 | 20 | 0 |
| external_event | 0 | 1 | 0 |
| **Total** | | **100** | **10,000** |

A finished level said "завершён" in four places and answered "what now?" nowhere. `LevelCompletion`
gives one acknowledgement: the level, the XP the curriculum published for it, the position, and the
next action — from `deriveNextAction`, **the same function Home calls on the same view**, so the two
cannot disagree.

**Completion never inferred (§14).** The panel renders only when canonical state IS `completed`;
asserted to render nothing for `pending_review`, `in_progress`, `available`, `locked`,
`checkpoint_unverified`. Not a successful submission, not a clicked CTA, not a local "done".

**XP motivational only (§13, §15).** A plain figure with a plain label; a level whose canonical
reward is zero shows **no XP line** rather than "+0 XP". Asserted absent: балансе/$/₽/депозит/вывод/
накоплено/до следующего, and поздравля/ура/победа/выигр/приз/награда/джекпот/бонус. No canvas, svg,
video, audio or img; no animation; no counter that counts. The material transition is the whole
celebration — this runs 100 times over a programme.

Live: L14 → «Уровень 14 завершён · Начислено +250 XP · Пройдено 14 из 100 уровней · Модуль
Управление риском». L3 → +500 XP. Home «Опыт 1700 XP» matches the canonical ledger exactly
(8×assessment 800 + 1×manual 150 + 1×mentor 250 + 1×report 500).

---

## G. Return after a pause

No second resume engine: the shared derivation was made **more precise**, not duplicated.

**The defect found.** A report a reviewer returns is set back to `in_progress` — deliberately, so the
learner can act again — which made it indistinguishable from a report never written. Home told a
learner whose report had been read and returned with corrections to «Подготовьте и отправьте отчёт».
`revise-report` had been in the vocabulary since the derivation was written and had **never once been
produced**.

The report owner is now asked, for that one level and only while the learner stands on it — one extra
request on one of a hundred levels, never on an ordinary Home. The operational mirror knows this too
(a rejected report moves its case to `waiting_learner`) and is **deliberately not used**: an
operational status and a progression status are never mapped onto one another.

`lib/curriculum/return-after-pause.test.ts` (16 tests) covers every required state:

| Return state | Answer | Posture |
|---|---|---|
| unfinished lesson | продолжите | act |
| unstarted lesson | пройдите | act |
| started practical | завершите | act |
| report not written | подготовьте и отправьте | act |
| report draft saved | допишите (черновик сохранён) | act |
| report pending | отчёт на проверке | **waiting** |
| **report rejected** | **внесите правки… уровень пока не завершён** | **act** |
| report approved | moves on | — |
| mentor pending | «только после подтверждения» | **waiting** |
| checkpoint unavailable | waiting, never an amount | **waiting** |
| checkpoint not met | blocked, never an amount | blocked |
| external registration pending | ждём партнёра | **waiting** |

Plus: an unreadable report state degrades to the less-specific truthful answer rather than a wrong
one; every canonical situation yields a title and explanation; and a control is either fully present
or fully absent — never a label with nowhere to go (the shape a dead end takes).

---

## H. Automated gates

| Gate | Result |
|---|---|
| Academy typecheck | PASS |
| Academy lint | PASS |
| Academy tests | **1,616 passed / 105 files** |
| Backend typecheck | PASS |
| Backend tests | **282 passed / 20 files** |
| Mentor public/internal boundary | 13 + 5 + 4 tests, PASS |
| Rich lesson canonical-data | 21 + 13 tests, PASS |
| Lesson/task transition | PASS (ctaHref, posture) |
| XP/completion | 14 tests, PASS |
| Return-after-pause | 16 tests, PASS |
| Report state regression | 8 tests, PASS |
| Curriculum write contract | 19 tests, PASS |
| Production build (release env) | PASS — 26 routes, BUILD_ID present |
| Bare-build `ACADEMY_MODE` | unchanged, **parent-identical** — the fail-closed config guard refusing to prerender `/showcase/video-player`. Not candidate-specific; carried. |

---

## I. Release and cutover

Canonical publisher and canonical cutover owner throughout. No manual receipt manipulation.

| Component | Release | BUILD_ID | Tree verification |
|---|---|---|---|
| academy | `6ff93eafd663…` | `uip7eE8GIM4V8wXJdPjqz` | 1024/1024 files |
| backend | `e5214ce40198…` | `NWzkcIVhiVoiHoz7gT-XH` | 1092/1092 files |
| crm | `49f16adad7b4…` (untouched) | — | — |
| partner | `2265f436edf0…` (untouched) | — | — |

`.next/cache` absent · `.next-cache-seed` absent · academy 933 MiB, backend 208 MiB (dominated by
`node_modules`, consistent with prior releases).

**Backend changed only because public mentor feedback genuinely required a missing safe learner
projection** — the existing LO projection could not be consumed as-is, because it named no level.
CRM and Partner untouched.

---

## J. Real-browser acceptance

Live PREPROD, real authenticated learner session (learner 73 `lo-learner-mentor`), post-cutover.
Report-learner login was **not** required and was not requested.

| Surface | Result |
|---|---|
| Home | one dominant Action Field · «Модуль 3 · уровень 15 из 100» · checkpoint waiting with a **quiet** control · 1700 XP · 14/100 |
| Path | Learning Spine intact · module rail · «14 из 100 уровней завершено» · same state sentences as Level Detail |
| Lessons | distinct from Path, and says so: «Структура программы и следующий шаг живут на странице «Путь»» |
| L13 ordinary lesson | reader renders; outline, sections, blocks |
| L14 mentor review | completion moment + **public mentor feedback** + decision sentence; internal note absent |
| L15 checkpoint | truthful, no balance language, XP «—» |
| L3 report | approved, +500 XP, no stale revision UI, no feedback panel (no public reply exists) |
| Rich lesson | 7 sections, callouts, glossary, table with caption, worked example, exercise «≈40 мин», tool link, authored CTA |
| Tools | canonical — Trading Journal open (L10), Risk Calculator «Откроется на уровне 15»; no fixture identity |
| Notifications | resolves, 1 unread |
| Profile | learning data only |

**Learner 73 was not mutated.** `UserLessonProgress` holds 2 rows, both from 2026-07-30 for users 35
and 37 — nothing was written during acceptance.

---

## K. Visual QA

Viewports 1440×900, 1024×768 and 390×844. The repository's Playwright screenshot specs are
fixture-mode (`?scenario=`) and do not exercise the API-mode product, so live measurement against the
authenticated session was used for the API surfaces.

| Surface | 1440×900 | 1024×768 | 390×844 |
|---|---|---|---|
| Home | ✓ | ✓ overflow 0 | ✓ overflow 0 |
| Path | ✓ | ✓ overflow 0 | ✓ overflow 0 |
| Level Detail | ✓ | — | ✓ overflow 0 |
| Rich lesson | ✓ | ✓ overflow 0 | ✓ overflow 0 |
| Checkpoint | ✓ | — | ✓ overflow 0 |
| Tools | ✓ | — | ✓ overflow 0 |

**§24 acceptance questions — all confirmed.** Home still reads as one dominant Action Field; Path
still reads as the Learning Spine; Level Detail no longer feels like another app; the rich lesson
belongs to the same product (deep navy, the same two ink levels, one functional cyan, no card wall,
no LMS chrome); mentor feedback is clearly feedback, not completion; task components are not
fixture-era islands; checkpoint remains truthful; Tools remain canonical; mobile is first-class.
Art direction was not reopened — only execution was corrected.

---

## L. Mobile and accessibility

**Mobile 390×844**, measured at a genuine layout viewport:

- horizontal overflow **0** on Home, Path, Level Detail, checkpoint, Tools and the rich lesson;
- reading column 322px with 16px body type (the ≤640px breakpoint fires);
- the wide comparison table **scrolls inside its own box** (client 320 / scroll 420), never the page;
- task control full-width at 50px tall; long Russian copy wraps with `overflow-wrap: break-word`.

**Accessibility**, on the reader (the largest new surface):

- exactly one `h1`; sections are `h2`; block headings `h3`/`h4` — no skipped levels;
- **31 interactive elements, 0 without an accessible name**;
- **0 targets under 24px** (after the correction in §O);
- keyboard navigation verified with real Tab presses; focus visible as `solid 2px rgb(79,224,192)`;
- all outline anchors resolve to real section ids; table headers `th[scope="col"]`;
- landmarks: `main`, `article`, labelled `nav` («Содержание урока»).

No separate certification project was started.

---

## M. Cross-surface reconciliation

For learner 73, checked against the canonical API and the database:

| Fact | Home | Path | Level Detail | Rich lesson | DB |
|---|---|---|---|---|---|
| current level | 15 | 15 | — | — | 15 |
| L14 state | — | Завершён | Завершён | Уровень завершён. | `completed` |
| next action | checkpoint waiting | Проверка недоступна | checkpoint waiting | — | verification unavailable |
| waiting vs blocked | waiting (quiet CTA) | waiting | waiting (quiet CTA) | — | — |
| XP | 1700 | — | +250 (L14) | — | 1700 ledger |
| progress | 14/100 | 14/100 | 14/100 | — | 14 completed |

No inconsistency was hidden in presentation. The one that existed was fixed in the **shared owner**
(§O), not patched per-surface.

---

## N. Deep product review

1. **Next step within seconds?** Yes — one Action Field, one sentence, one control.
2. **Where am I in 20 modules / 100 levels?** Yes — coordinate on Home, spine on Path, "14 из 100" on three surfaces.
3. **Do the four surfaces agree?** Yes — one `deriveNextAction`, one `explainLevelState`.
4. **Waiting ≠ blocked?** Yes — separate postures, separate materials, quiet vs no control.
5. **Feedback ≠ approval?** Yes — enforced in the component, the copy and the tests.
6. **Does lesson content feel like learning?** Yes — 7 sections of real teaching with worked examples, a glossary, common mistakes and a real exercise; not a wrapper around progression.
7. **Report revision truthful without a rejected fixture?** Yes — canonical vocabulary and the revision presentation are asserted by a named regression; Home now distinguishes a returned report.
8. **Checkpoint mistakable for a balance/deposit/profit?** No — the requirement is named, the learner's money never is.
9. **Are Tools unlocks real?** Yes — canonical progress; Risk Calculator correctly still locked at level 15.
10. **XP motivational only?** Yes — it gates nothing and is never a currency.
11. **Can a returning learner resume?** Yes — most specific truthful action per state, including the returned report.
12. **Dead ends?** None found — every situation yields a title, an explanation, and a control that is either fully present or fully absent.
13. **Fixture identities/data visible in API mode?** None — no "Артём", no fixture body, no fixture styling.
14. **Mobile coherent?** Yes — zero overflow across six surfaces, tables isolated, targets sized.

---

## O. Findings and consolidated correction

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | **HIGH** | Backend release `03f981a1` shipped a `.next` built **before** the source edit. The publisher's artifact gate proves an artifact is a *production build that serves*; it does not prove it was built *from the committed tree*. The feature silently did nothing in the browser. | Rebuilt, re-published as `e5214ce4`, cut over, verified in the live API response. Tooling gap recorded in Q. |
| 2 | **MEDIUM** | Completion moment lit the cyan control regardless of the derived posture. Finishing L14 does not make L15 actionable — Home showed the same action with a quiet control. One screen promised what the next withheld. | Control now follows the derived posture; verified live (`data-posture="waiting"`, transparent background). Tests added. |
| 3 | **MEDIUM** | A published lesson body is static text, so its authored CTA («Отправить план на проверку») remained the page's one lit control after the mentor approved the level. | Link kept (it goes to the task surface, where the real state is); emphasis now follows canonical posture. Tests added. |
| 4 | **MEDIUM** | Home could not distinguish a returned report from an unwritten one — see §G. | `revise-report` now produced from a canonical report-state read. 16 tests. |
| 5 | **LOW** | Reader's back link 17px and end-of-lesson exits 23px — under the 24px minimum target size. | Given their own padding and min-height; re-measured at 29px/31px, 0 targets under 24px. |
| 6 | **LOW** | Notifications labels a `mentor_review` case reply as «Ответ поддержки». | Backend-owned pre-existing surface, truthful, outside this phase's changed scope. Documented, not fixed. |

Findings 2, 3 and 5 were fixed **together** in two consolidated releases with full gates and bounded
re-acceptance — not one release per finding.

---

## P. Compact closed-phase regression

| Check | Result |
|---|---|
| Wave-1 Home semantics | unchanged |
| Wave-1 Path | unchanged |
| Lessons distinct from Path | intact (states it in copy) |
| Notifications / Profile reachable | yes |
| Support reachable | yes |
| Tools canonical | yes — L10 open, L15 locked |
| LEGACY-USER-PROGRESS-COLUMNS-1 boundary | intact — `User.level=1`, `User.xp=0` for learner 73 while canonical XP is 1700 |
| LO public/internal separation | intact — internal note absent from the rendered page |
| LO state does not complete progression | intact — LO has no write path to `UserLevelProgress`; L14 completed by the canonical mentor owner (`mentor_completion` XP present) |
| Pocket identities | unchanged |
| Checkpoint provenance | preserved — 20 checkpoints, 0 XP |
| Affiliate commercial records | unchanged (Partner untouched) |
| Users 66 / 67 | unchanged (`createdAt == updatedAt`, pre-phase) |
| Migration | **52** — no migration 53 |
| Database integrity | **ok** |
| FK violations | **0** |
| Rollback receipts | all four resolve |

---

## Q. Remaining non-blocking items

1. **Publisher provenance gap (tooling, not this candidate).** `publish-release.sh` verifies the
   staged tree against git and proves the artifact is a serving production build, but does not tie
   the artifact to the tree it ships beside. A release can therefore carry correct source and a
   stale `.next`. Caught here only because the feature visibly did nothing. Worth a build-provenance
   stamp; out of scope for an Academy phase.
2. **Notifications wording** — finding 6 above.
3. **Reading-progress controls not exercised in a browser.** `canTrackReading` requires a `lesson`
   level in `in_progress`; learner 73 has none (14 complete, L15 is a checkpoint). Covered by unit
   tests and the pinned write contract. Creating one would have meant mutating learner state, which
   §21 forbids — the same principle as the waived rejected-report screenshot.
4. **Backend release `03f981a1`** remains on disk as academy's… (backend's) rollback target. It is a
   healthy, serving release running the parent's code; it is not the current release.

---

## R. Final releases and receipts

| Component | Current release | BUILD_ID | Rollback receipt | Service |
|---|---|---|---|---|
| academy | `6ff93eafd6634b7f746e000ff7c958812c5a1783` | `uip7eE8GIM4V8wXJdPjqz` | `99b2b72f…` RESOLVES | active |
| backend | `e5214ce40198ba2e70866def13177d70048bea9f` | `NWzkcIVhiVoiHoz7gT-XH` | `03f981a1…` RESOLVES | active |
| crm | `49f16adad7b4910907e97807f4c67296fa3569a2` | — | `d181d331…` RESOLVES | active |
| partner | `2265f436edf08380261369599e2d9a61b81582c5` | — | `68ade762…` RESOLVES | active |

Migration 52 · integrity ok · FK violations 0.

---

## S. Final verdict

| Condition | Result |
|---|---|
| 0 BLOCKER | ✅ |
| 0 HIGH | ✅ (finding 1 found **and** resolved within the phase) |
| Home PASSED | ✅ |
| Path PASSED | ✅ |
| Lessons distinct | ✅ |
| Level Detail integrated | ✅ |
| Rich lesson connected to canonical API | ✅ 158/158 bodies, 0 dropped |
| assessment / manual practical canonical | ✅ |
| report canonical | ✅ |
| report revision semantics truthfully resolved | ✅ |
| rejected browser screenshot not required | ✅ per explicit human decision |
| mentor public feedback visible without becoming approval | ✅ |
| checkpoint truthful | ✅ |
| L1 truthful | ✅ |
| Tools canonical | ✅ |
| XP canonical | ✅ 10,000 total |
| return-after-pause precise | ✅ |
| legacy `User.level`/`xp` boundary enforced | ✅ |
| mobile usable | ✅ |
| accessibility basics clean | ✅ |
| no fixture authority in API mode | ✅ |
| no frontend progression authority | ✅ |
| no closed-phase regression | ✅ |
| release + rollback receipts healthy | ✅ |

# ATA-PREPROD-ACADEMY-EXPERIENCE-COMPLETION-1 — FINAL VERDICT = **PASSED**
