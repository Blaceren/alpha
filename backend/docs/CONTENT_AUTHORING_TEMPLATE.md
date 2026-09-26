# Content production template — one level at a time

What a content writer receives, what they hand back, and how a machine checks it.
The goal of this document is that nobody has to ask an engineer what JSON to
write.

Read alongside `docs/CONTENT_BLOCKS_V2.md` (the block catalog) and
`docs/ATA_100_CONTENT_ARCHITECTURE.md` (which level is which kind).

---

## 0. What you are given (do not change any of it)

Everything in this section is already frozen in
`src/lib/curriculum/product-ata-100.ts`. It arrives filled in.

```
LEVEL IDENTITY
  levelNumber          18
  stableCode           v2.l018.podderzhka-i-soprotivlenie
  module               module.04 «Чтение графика»
  title                Поддержка и сопротивление
  kind                 video_test
  completion           lesson : assessment_pass
  xpReward             0
  prerequisite         v2.l017.trend-i-diapazon
```

If you believe a title, a module or a level kind is wrong, raise it — do not edit
it. Changing any of these is a structural change and the validator will refuse
the package.

---

## 1. LEARNER OUTCOME

One sentence, in the learner's language, completing «После этого уровня ты
сможешь…». It becomes `learningObjective`.

* observable — «объяснить», «разметить», «выбрать», not «понимать»;
* no profit promise, no guarantee, no signal, no advice;
* ≤ 1 000 characters, plain text.

---

## 2. LESSON BLOCKS

The body of the level. Written as sections; each section is a list of blocks.

```json
{
  "format": "ata.lesson.blocks",
  "version": 2,
  "sections": [
    {
      "code": "zony",
      "title": "Почему это зоны, а не линии",
      "blocks": [
        { "type": "rich_text", "text": "Первый абзац.\n\nВторой абзац." },
        { "type": "callout", "variant": "key_idea", "title": "", "body": "…" },
        { "type": "list", "ordered": false, "items": ["…", "…"] }
      ]
    }
  ]
}
```

**Section rules**

* `code` is lowercase-kebab, unique within the level, and **permanent**. It is
  saved in learner progress; renaming it after publication loses their place.
* 1–30 sections; 1–60 blocks per section; 128 KB total.
* Order is reading order.

**Writing rules**

* Plain text only. No HTML, no markdown links, no `<`-tags. Structure comes from
  blocks: a heading is a `heading` block, a list is a `list` block, a link is a
  `tool_link` / `cta` / `download` block.
* `\n\n` starts a new paragraph. That is the only in-text convention.
* Available block types: `heading`, `rich_text`, `callout`, `image`, `video`,
  `list`, `table`, `example`, `common_mistake`, `glossary`, `exercise`,
  `tool_link`, `cta`, `divider`, `download`. Full field lists in
  `docs/CONTENT_BLOCKS_V2.md` §5.

**A workable default shape for a lesson**

| Section | Blocks |
|---|---|
| `hook` | `callout` (`key_idea`) — the one idea the level turns on |
| `<theme>` … | `rich_text`, `image`, `list`, `table` — one section per idea |
| `primery` | `example` ×1–3 |
| `oshibki` | `common_mistake` ×1–3 |
| `slovar` | `glossary` (optional) |
| `itog` | `cta`, and a `callout` with `variant: "risk"` |

---

## 3. EXERCISE

Every `practical` level, and any lesson that asks the learner to do something.

```json
{
  "type": "exercise",
  "code": "l019-razmetka",
  "title": "Разметка трёх графиков",
  "instructions": "Что именно сделать, по шагам.",
  "expectedAction": "Наблюдаемое действие, которым уровень считается выполненным.",
  "estimatedMinutes": 30
}
```

`code` is unique within the level. **An exercise block has no completion field of
any kind** — completion comes from the level's own workflow (`lesson:manual`,
mentor review, or report approval), never from content. Do not invent a «отметить
выполненным» field.

---

## 4. ASSESSMENT / REPORT / MENTOR CONTRACT

What you owe depends on the level kind. Nothing else is accepted.

| Kind | You deliver |
|---|---|
| `video_test` (`lesson : assessment_pass`) | lesson blocks **and** an assessment: 4–7 questions, one correct answer each, an explanation per question, and for each question the section it is taught in |
| `practical`, non-mentor (`lesson : manual`) | lesson blocks including an `exercise` block |
| `practical`, mentor-reviewed (`mentor_review : mentor_review`) | practical instructions as lesson blocks + `exercise`, plus what a mentor should look for |
| `report` (`report : report_approval`) | report instructions (≥ 200 characters), the fields the learner fills, and the approval criteria |
| `checkpoint`, `registration` | **nothing**. These are gates; their copy is system copy, and content on them is refused |

Assessment questions live in the assessment definition, never in a content block.
There is no inline quiz — the one assessment engine owns every graded question.

---

## 5. XP

You do not choose it. `xpReward` is set by the curriculum, and gates are always 0.
If a level's reward looks wrong, raise it as a product question.

---

## 6. TOOL / UNLOCK CONTEXT

If the level relates to a tool, link it:

```json
{ "type": "tool_link", "toolCode": "tool.chart_markup", "label": "Chart Markup Tool", "context": "Разметка выполняется здесь." }
```

* `toolCode` must come from the canonical vocabulary
  (`src/lib/curriculum/product-vocabulary.ts`, 19 tools + `tool.secret`). An
  unknown code is rejected.
* A tool link **does not unlock anything**. If the learner has not reached the
  unlock level, the product shows it locked; you never write "разблокировано".
* Never state a checkpoint threshold as the learner's own balance, and never
  imply the product can see it.

---

## 7. ASSET REQUIREMENTS

List every image, chart, video, subtitle file and download the level needs. Each
gets an `assetCode` (lowercase-kebab, unique in the level) and blocks reference
that code — never a path, never a URL.

| Need | Asset kind | Block field |
|---|---|---|
| screenshot, diagram | `image` or `chart` | `image.assetCode` |
| lesson video | `video` | `video.assetCode` |
| subtitles | `subtitles` | `video.captionsAssetCode` |
| template, checklist PDF | `attachment` | `download.assetCode` |

* Every meaningful image needs **non-empty `alt`** describing what it shows.
* A video level must declare `videoDurationSeconds` on the content version.
* Asset URLs are absolute HTTPS, filled in by whoever publishes the file.
* Package validation does not download anything — a missing file is a separate
  availability check, not a schema error.

---

## 8. RISK DISCLAIMER

Every level with lesson content ends with a risk callout:

```json
{ "type": "callout", "variant": "risk", "title": "", "body": "…" }
```

An approved package without one is refused (`CONTENT_RISK_DISCLAIMER_MISSING`).
Content must never promise profit, guarantee a result, give a buy/sell signal,
pressure a deposit, or present fabricated market data.

---

## 9. DEFINITION OF CONTENT COMPLETE

A level is complete when **all** of the following hold. Everything marked
*(machine)* is checked by
`npm run curriculum:canonical100:check` and the package validator.

- [ ] `learningObjective` written, observable, ≤1 000 chars *(machine: non-empty, plain text)*
- [ ] lesson blocks written; ≥ 1 200 characters of teaching text *(machine)*
- [ ] section codes stable, unique, lowercase-kebab *(machine)*
- [ ] risk callout present *(machine)*
- [ ] no `TODO`, `TBD`, `FIXME`, `PLACEHOLDER`, `lorem ipsum`, «заглушка», «в разработке», «скоро будет», «готовится» *(machine)*
- [ ] no «TradeQuest» anywhere — the product is **Alfa Trade Academy** *(machine)*
- [ ] no HTML, no markdown links, no non-https URI schemes *(machine)*
- [ ] every `assetCode` declared, of the right kind, with alt text where needed *(machine)*
- [ ] every `toolCode` in the canonical vocabulary *(machine)*
- [ ] assessment 4–7 questions where the kind requires one *(machine)*
- [ ] report instructions ≥ 200 characters where the kind requires them *(machine)*
- [ ] content `status: "published"` and the level's `pendingApprovals` entry removed *(machine)*
- [ ] provenance set to the real approval, `approvalRequired: false` *(machine)*
- [ ] reviewed by a human for accuracy, tone and compliance *(not machine — never skip)*

When every box is ticked for every level, the package can be promoted from
`draft` to `approved`. The validator refuses the promotion until then, which is
the point.

---

## 10. Working loop

```bash
# 1. edit the level's content
# 2. rebuild the canonical draft artifact
npm run curriculum:canonical100:build

# 3. validate — no database needed
npm run curriculum:package:import -- --package curriculum/packages/ata-v2-canonical-100.draft.json --validate-only --json

# 4. the contract tests
npm run test:regression:curriculum-content-blocks
npm run test:regression:curriculum-ata100
```

The build output prints `structuralCompletenessPercent`,
`editorialCompletenessPercent` and `productionReadyLevels` — that is the
production tracker, and it is deliberately not flattering.
