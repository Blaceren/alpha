---
name: ata-anti-generic-ui-review
description: >
  Scoring rubric that decides whether an Alfa Trade Academy UI is distinctive
  enough to ship or is just another generic dashboard. Use this to review, score,
  or "grade" any ATA screen, art direction, or screenshot — always after
  implementation and after ata-visual-qa-loop, and any time the user asks "is this
  good / distinctive / too generic / done?". It produces a 0–100 score across
  weighted criteria, hard automatic-fail conditions (score < 80, no signature
  object, renameable to any SaaS, sidebar+card-grid, identical skeletons, stacked
  mobile, low contrast, etc.), plus objective counts (cards, surface geometries,
  icon dependence, branded objects, hierarchy levels, contrast issues,
  unadapted landing-only patterns).
---

# ATA Anti-Generic UI Review

Score an Alfa Trade Academy screen against the brand. Prerequisites: `ata-brand-language` loaded;
real screenshots produced via `ata-visual-qa-loop` (never review from code or synthetic images);
`design-memory/references/ata-brand/REFERENCE_MANIFEST.md` and the D1A anti-examples
(`design-memory/references/anti-examples/d1a-generic/`) available for comparison.

Base usability/accessibility/responsive facts come from `ui-ux-pro-max` (read-only), but its generic
visual advice (fintech dashboard, dark SaaS, blue admin, KPI cards, glassmorphism, card-grid) is
**ignored** — project-specific ATA rules win.

## Scoring rubric (0–100)

| Criterion | Max | What earns it |
|-----------|----:|---------------|
| Connection to ATA visual DNA | 20 | Deep navy field, luminous line-as-structure, cold blue + green/cyan signal, chaos→system — tied to ≥2 references |
| Structural originality | 15 | Not sidebar+card-grid; a real spatial system of its own |
| Product meaning | 15 | Every element encodes something true about the learning system |
| Typography | 10 | Clear hierarchy, readable body, confident display; no landing low-contrast |
| Signature object | 10 | One memorable branded object with a product function |
| Progression clarity | 10 | The path/spine/artifact makes "where am I + next step" obvious |
| Mobile transformation | 10 | A genuine mobile rethink, not stacked desktop |
| Usability / readability | 10 | Contrast, focus, touch targets, no overflow (ui-ux-pro-max checks) |

## Automatic fail (any one → FAIL, regardless of score)

- Total score below **80**.
- **No signature object.**
- The UI can be **renamed to any other SaaS** without looking wrong.
- Composition is based on **sidebar + card grid**.
- Three directions share **one identical skeleton**.
- **Mobile is a stacked desktop.**
- Body text has **landing-level low contrast**.
- The first viewport has **more than six identical cards**.
- **All surfaces have one shape** (same geometry/radius everywhere).
- Identity is built **only on an icon library**.
- **No direct connection to at least two** prelanding references.
- **Decorative market elements** have no product function.

## Objective counts (report every number)

Count and report, per screen (desktop + mobile):

- number of same-type cards;
- number of distinct surface geometries;
- icon dependence (share of elements whose meaning relies on an icon);
- number of branded objects;
- number of real hierarchy levels;
- contrast problems (list each);
- landing-only patterns transferred without adaptation (cite manifest §C).

## Output format

```
# Anti-Generic Review — <screen> (<viewport>)
Screenshot: <path>

## Scores
Connection to ATA DNA: X/20
Structural originality: X/15
Product meaning: X/15
Typography: X/10
Signature object: X/10
Progression clarity: X/10
Mobile transformation: X/10
Usability/readability: X/10
TOTAL: XX/100

## Automatic-fail check
[list each condition → PASS/FAIL]

## Objective counts
same-type cards: N | surface geometries: N | icon dependence: N% |
branded objects: N | hierarchy levels: N | contrast problems: [...] |
unadapted landing-only: [...]

## Verdict: PASS / FAIL  (FAIL if any auto-fail or total < 80)
## Top fixes (ranked)
```

A score is meaningless without the real screenshot it was computed from — always attach the path.
