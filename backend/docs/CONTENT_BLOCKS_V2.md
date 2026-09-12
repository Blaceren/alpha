# Content Body v2 — `ata.lesson.blocks` (Phase C)

The production content model for `ContentLocalization.body`. Replaces the rigid
v1 shape with a strict, versioned, discriminated block model that content
writers can fill, a validator can check, an admin editor can edit and a renderer
can display without ever executing markup.

| Path | Purpose |
|---|---|
| `src/lib/curriculum/content-safe-text.ts` | the ONE sanitizer contract for every learner-facing string |
| `src/lib/curriculum/content-blocks.ts` | the block catalog and the v2 body schema |
| `src/lib/curriculum/content-body.ts` | format identity, v1/v2 triage, the compatibility reader |
| `src/lib/curriculum/product-vocabulary.ts` | Backend-owned tool / rank / community vocabulary |
| `src/lib/curriculum/package/validate.ts` | generic package validation (asset + tool references) |

## 1. Format identity and versioning

```json
{
  "format": "ata.lesson.blocks",
  "version": 2,
  "sections": [
    { "code": "vvedenie", "title": "Введение", "blocks": [ … ] }
  ]
}
```

`format` and `version` are checked **before** any branch schema, so the four
format-level refusals are always specific:

| Code | When |
|---|---|
| `CONTENT_BODY_NOT_AN_OBJECT` | body is not a JSON object |
| `CONTENT_BODY_FORMAT_UNKNOWN` | `format` is present but is not `ata.lesson.blocks` |
| `CONTENT_BODY_VERSION_UNSUPPORTED` | `format` is correct but `version` is not 2 |
| `CONTENT_BODY_BLOCK_INVALID` | v2 body, but a block or section is malformed |
| `CONTENT_BODY_LEGACY_INVALID` | v1 body that does not satisfy the legacy shape |

A body with **no** `format` key is legacy v1. That is not an open-ended untagged
union: v1 is closed and will never gain a member, every new body must be v2, and
the absence of the tag is itself the discriminator. When the last v1 row has been
converted, the v1 branch can be deleted without touching v2.

### Why sections of blocks, and not a flat block list

`UserLessonProgress.completedSections` stores **section codes**, and
`content-read-progress.ts` validates a learner's saved progress against
`contentBodySectionCodes(body)`. Those codes are durable learner state. A flat
block list would force progress anchors to be derived from heading positions,
which means inserting a heading during an editorial pass silently renumbers
somebody's saved progress. Sections stay first-class so the anchor vocabulary is
explicit and the v1 → v2 projection is anchor-identical.

## 2. No database migration

`ContentLocalization.body` is `JSONB NOT NULL CHECK (json_valid("body"))`
(`prisma/migrations/20260715000000_content_assessment_foundation/migration.sql`).
The column constrains nothing about the shape, so v2 needs no migration and
**Phase C creates no migration file**.

## 3. Backward compatibility

* Every shipped package (`ata-v2-first-slice.*`) still validates, with a
  **byte-identical fingerprint**. Pinned by
  `scripts/regression/curriculumContentBlocksRegression.ts` test 41.
* `normalizeContentBody` projects both formats onto one reading model:

  ```ts
  { sourceFormat, sections: [{ code, title, blocks }], appendix: Block[] }
  ```

  For v1, `sections` keeps its original codes and each section becomes one
  `rich_text` block; `examples`, `commonMistakes`, `glossary`, `nextAction` and
  `riskDisclaimer` become blocks in `appendix`. The appendix is **never**
  progress-anchored — those elements never had section codes, and inventing codes
  for them would let a client claim progress on something no learner ever saw.
* The projection is structural only. v1 text is validated under the slightly more
  permissive `legacy_v1` policy (an https markdown link is legal there), so the
  projected blocks are a reading convenience, not a promotion to v2. Converting a
  v1 body into a **stored** v2 body is a separate, explicit authoring act.
* Migrating a body from v1 to v2 **moves the package fingerprint**. That is
  intended: the content contract changed.

## 4. Text-format policy (deliberate)

Learner text is **plain structured text**, not markup. Structure lives in blocks;
paragraph breaks are `\n\n` and that is the only in-string convention. A renderer
may therefore emit every string as a text node and needs no HTML parser, no
markdown parser and no sanitizer of its own.

Refused in every text-bearing field, both formats:

* HTML-ish tags (`<a …>`, `</script>`) and `on…=` event handlers;
* `javascript:`, `data:`, `vbscript:`, `blob:`, `file:`, `about:`;
* encoded tag openers `&lt;`, `&#60;`, `&#x3c;` — an entity-decoding renderer
  would turn these back into tags, so they are refused at rest;
* C0/C1 control characters and the Unicode bidi overrides U+202A–U+202E,
  U+2066–U+2069.

Refused in **v2 only**: all markdown link and image syntax. v2 has `tool_link`,
`cta` and `download` blocks with validated targets, so prose never needs a link.
v1 keeps its original allowance (https markdown links) so approved content keeps
its meaning.

**Not** refused: a bare `https://` URL in prose (inert as text; renderers must
not auto-link) and a lone `<` as in «риск < 2%».

## 5. Block catalog

Fifteen types. Every block is `z.strictObject` discriminated on `type`; an
unknown type and an unknown property are both hard errors. There is deliberately
no `html`, `embed`, `script`, `iframe` or `custom` block.

| Block | Fields | Notes |
|---|---|---|
| `heading` | `level` (3\|4), `text` | h1 is the level title, h2 the section title |
| `rich_text` | `text` (≤8 000) | `\n\n` = paragraph break |
| `callout` | `variant` (`info`/`key_idea`/`tip`/`warning`/`risk`), `title?`, `body` | `risk` is what satisfies the approved-content disclaimer rule |
| `image` | `assetCode`, `alt`, `caption?` | `alt` required and non-empty |
| `video` | `assetCode`, `title`, `captionsAssetCode` (nullable), `caption?` | captions asset must differ from the video asset |
| `list` | `ordered`, `items[1..30]` | |
| `table` | `caption?`, `headers[1..8]`, `rows[1..40][]` | every row must have one cell per header |
| `example` | `title`, `body` | |
| `common_mistake` | `mistake`, `correction` | |
| `glossary` | `entries[{term, definition}]` | |
| `exercise` | `code`, `title`, `instructions`, `expectedAction`, `estimatedMinutes` | **no completion field of any kind** |
| `tool_link` | `toolCode`, `label`, `context?` | code validated against the product vocabulary |
| `cta` | `action`, `label`, `body?`, `toolCode` | `open_tool` is the only action with a target |
| `divider` | — | |
| `download` | `assetCode`, `label`, `description?` | |

`cta.action` ∈ `next_level`, `open_tool`, `start_assessment`, `open_report`,
`request_mentor_review`, `pocket_registration`. A closed vocabulary, so a CTA can
never smuggle a destination past the navigation the product owns.

Body bounds: 1–30 sections, 1–60 blocks per section, 128 KB total.

### Why there is no quiz block (evaluated, rejected)

An inline quiz needs answer authority to be worth anything, and answer authority
in a content body is refused at two independent layers already:
`content-validation.ts` rejects `correctAnswer` / `correctOptionCodes` /
`isCorrect` anywhere in a stored body, and the learner content route returns the
body verbatim — so any answer key placed there ships to the browser. A quiz block
would therefore be either a **second grading engine** competing with
`AssessmentVersion` (its own authorization, idempotency and audit story), or a
quiz with no answers.

The canonical `AssessmentVersion` engine remains the sole owner of graded,
completion-bearing questions. Educational self-checks are served by `exercise`
(a stated task, completion owned by the level workflow) and `callout`.

## 6. Asset contract

Blocks reference `assetCode`, never a path or a URL. The package validator
resolves each reference against the content version's own asset table:

| Block field | Accepted asset kinds |
|---|---|
| `image.assetCode` | `image`, `chart` |
| `video.assetCode` | `video` |
| `video.captionsAssetCode` | `subtitles` |
| `download.assetCode` | `attachment` |

| Code | When |
|---|---|
| `CONTENT_ASSET_REFERENCE_MISSING` | block names an assetCode the package does not declare |
| `CONTENT_ASSET_REFERENCE_KIND_MISMATCH` | the asset exists but is the wrong kind |
| `CONTENT_ASSET_CODE_DUPLICATE` | two assets share a code within one content version |
| `CONTENT_ASSET_ORDER_DUPLICATE` | two assets share a `sortOrder` |
| `CONTENT_VIDEO_DURATION_REQUIRED` | a video asset exists but `videoDurationSeconds` is null |

Asset URLs must be absolute HTTPS without userinfo, with a well-formed MIME type.
This was previously enforced only on the authoring path; the importer never ran
publication validation, so the package path is now held to the same rule.

**Structural validation is separated from asset availability QA.** Package
validation never opens a socket and never requires the network; whether an object
is actually reachable is a later, separate check.

## 7. Tool vocabulary — the decision

**Backend owns tool, rank and community identity.** `product-vocabulary.ts` is
the source of truth; Academy consumes it through the Phase-D DTO contract below.
Neither repository imports the other at build or run time, and a regression test
(`curriculumAta100Regression.ts` test 39) fails if any Backend file ever imports
or reads a path inside the Academy checkout.

Why this direction: today the catalog lives in Academy's
`tool-catalog.ts`, joined onto `TOOL_UNLOCKS` derived from `CHECKPOINT_ROWS` in a
React fixture — so a tool's identity and its **unlock level** are a side effect of
client display data. Unlock level is progression truth; a package validator must
reject an unknown tool code with no network and no other repository present; and
curriculum structure moved to Backend in this phase, so leaving tool identity
behind would recreate the split source of truth Phase C exists to end.

The rejected alternative was a generated shared vocabulary package copied between
repos through a build contract — a publishing step and a version-skew failure
mode to solve a problem one owner solves for free. If a third consumer ever
appears, this file is what gets published; the contract does not change.

19 curriculum tools (L10 → L100) + `tool.secret` (referral-gated, no unlock
level, not a curriculum unlock). `CONTENT_TOOL_CODE_UNKNOWN` is an error in
drafts too: a tool either exists or it does not.

**Domain vs display.** `unlockLevel` is domain progression. A `tool_link` or
`cta` block is display only: it unlocks nothing, gates nothing, and removing it
changes nothing about what a learner may reach. Learner access never depends on a
content block.

## 8. Phase D — Academy renderer contract

Academy is **not modified in this phase.** This is what Phase D consumes.

The learner route `GET /api/curriculum/v2/levels/{stableCode}/content?locale=ru`
returns `SafeResolvedContent`. `content.localization.body` is the stored body in
**either** format; Academy must call the equivalent of `normalizeContentBody`
once and render the normalized model:

```ts
type NormalizedContentBody = {
  sourceFormat: "legacy_v1" | "blocks_v2";
  sections: Array<{ code: string; title: string; blocks: ContentBlock[] }>;
  appendix: ContentBlock[];   // v1 only; always [] for v2
};
```

Rules Phase D must honour:

1. **Section codes are progress anchors.** Only `sections[].code` may appear in
   `completedSections`. Nothing in `appendix` is anchorable.
2. **Every string is a text node.** No `dangerouslySetInnerHTML`, no markdown
   pass, no auto-linking. `rich_text` splits on `\n\n` into paragraphs; that is
   the whole of the parsing Academy is allowed to do.
3. **Assets resolve by code** against `content.assets[]` in the same payload.

| Block | Academy DTO | Expected learner component |
|---|---|---|
| `heading` | `{level, text}` | `<h3>`/`<h4>` inside the section |
| `rich_text` | `{text}` | paragraph stack, split on `\n\n` |
| `callout` | `{variant, title, body}` | callout card; `risk` uses the risk treatment |
| `image` | `{assetCode, alt, caption}` | `<figure>` + `<img>`; asset URL joined from `assets[]` |
| `video` | `{assetCode, title, captionsAssetCode, caption}` | lesson player; captions track when present; duration from `content.videoDurationSeconds` |
| `list` | `{ordered, items}` | `<ol>`/`<ul>` |
| `table` | `{caption, headers, rows}` | responsive table, horizontally scrollable |
| `example` | `{title, body}` | example card |
| `common_mistake` | `{mistake, correction}` | two-column mistake/correction card |
| `glossary` | `{entries}` | definition list |
| `exercise` | `{code, title, instructions, expectedAction, estimatedMinutes}` | task panel. **Renders no completion control of its own** — completion comes from the level's own CTA (`lesson:manual`, mentor review request, or report submit) |
| `tool_link` | `{toolCode, label, context}` | link to `/tools/{toolCode}`; shows locked state from the learner's own unlock state, never from the block |
| `cta` | `{action, label, body, toolCode}` | the single next-step button; `action` selects the destination |
| `divider` | — | `<hr>` |
| `download` | `{assetCode, label, description}` | download row; URL joined from `assets[]` |

Legacy-body compatibility: a v1 lesson renders identically to a v2 lesson whose
sections each contain one `rich_text` block, followed by the appendix blocks in
this fixed order — `example*`, `common_mistake*`, `glossary?`, `cta`, `callout
(risk)`.

## 9. Phase G — CRM/admin editor contract

No admin UI is built in this phase. This is what Phase G consumes.

| Block | Editor fields | Preview | Validation surfaced | Asset picker |
|---|---|---|---|---|
| `heading` | select (3/4) + single-line text | inline | length ≤300, plain text | — |
| `rich_text` | multi-line textarea | inline paragraphs | ≤8 000, plain text, no markdown links | — |
| `callout` | variant select, optional title, textarea | inline card | body required | — |
| `image` | asset picker, alt text, caption | thumbnail | alt required non-empty | kinds `image`, `chart` |
| `video` | asset picker, title, captions picker, caption | poster + duration | captions ≠ video; version needs `videoDurationSeconds` | kinds `video`, `subtitles` |
| `list` | ordered toggle, repeatable rows | inline list | 1–30 items | — |
| `table` | header row editor + grid | inline table | every row = one cell per header | — |
| `example` | title, textarea | inline card | both required | — |
| `common_mistake` | two textareas | paired card | both required | — |
| `glossary` | repeatable term/definition | definition list | ≥1 entry | — |
| `exercise` | code, title, instructions, expectedAction, minutes | task panel | code unique in body; **no completion field is offered** | — |
| `tool_link` | tool **select** (never free text), label, context | link chip | code from the vocabulary | — |
| `cta` | action select, label, body, tool select (enabled only for `open_tool`) | button | action/toolCode pairing | — |
| `divider` | — | rule | — | — |
| `download` | asset picker, label, description | file row | label required | kind `attachment` |

Editor-wide rules: sections are reorderable but `code` is **immutable once
published** (it is durable learner progress state); the tool picker is a select
over `CURRICULUM_TOOLS` + `tool.secret`; the asset picker is filtered by the
block's accepted kinds; and the editor must run the same Zod schemas on save
rather than reimplementing validation.

## 10. Tests

```bash
npm run test:regression:curriculum-content-blocks   # 43 checks
npm run test:regression:curriculum-ata100           # 39 checks
```
