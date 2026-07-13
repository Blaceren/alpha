---
name: ata-art-direction-gate
description: >
  Mandatory gate before ANY React/UI code for Alfa Trade Academy. Use this
  whenever the user asks to build, redesign, prototype, or "start coding" an ATA
  screen (Главная, Путь, урок, tool, rank, etc.), or whenever an art direction is
  being proposed. It forces a complete, written art-direction brief (19 required
  points), at least three STRUCTURALLY different low-fidelity compositions with
  ASCII wireframes, and blocks React until the user explicitly picks a direction
  or asks to merge specific elements. If someone tries to go from reference
  analysis straight to code, this skill is what stops them.
---

# ATA Art-Direction Gate

No Alfa Trade Academy React/UI code may be written until an art direction passes this gate.
First load `ata-brand-language` and read `design-memory/references/ata-brand/REFERENCE_MANIFEST.md`.

Why: the rejected D1A skipped this and produced three renamings of one generic dashboard
(`design-memory/references/anti-examples/d1a-generic/WHY_REJECTED.md`). The gate exists to force a
real point of view *before* implementation, when changing direction is cheap.

## Required brief (all 19 — do not skip any)

For each proposed direction, write:

1. **Product thesis** — what the product is, in one sentence.
2. **Concrete user moment** — the exact situation this screen serves (e.g. "user on level 18, mid-module, one lesson from a checkpoint").
3. **Visual thesis** — the one memorable idea, specific to ATA.
4. **Which part of Stable visual DNA** is used (cite manifest §A).
5. **Which provisional idea** is being tested (cite manifest §B) — exactly one per direction.
6. **Signature object** — the object this direction is remembered by, and its product function.
7. **Spatial composition** — how space is organized (not "sidebar + cards").
8. **Typography strategy** — display/body/utility roles, scale, contrast.
9. **Materials strategy** — surface types, borders, glow, layers (no "every card bordered").
10. **Navigation strategy** — how the user moves; must keep canonical RU labels + routes.
11. **Progression strategy** — how the path/spine/artifact expresses progress functionally.
12. **Alex Curie strategy** — how the mentor is *composed in*, not glued on (media is placeholder).
13. **Motion strategy** — functional vs milestone; what moves and why (see `docs/MOTION_AND_PERFORMANCE.md`).
14. **Mobile transformation** — a genuine mobile rethink, not stacked desktop.
15. **ASCII wireframe** — desktop + mobile, low-fidelity.
16. **How it differs from D1A** — reference specific rejected screenshots.
17. **Why it can't be renamed to another SaaS** — the ATA-specific reason.
18. **Which reference screenshots are used** — cite ≥2 of the four prelanding frames.
19. **Which landing-only decisions are deliberately NOT transferred** (cite manifest §C).

## Minimum three STRUCTURALLY different compositions

Produce at least three low-fidelity compositions. They are **not** different if only:
- the same skeleton is kept;
- cards are rearranged;
- the background changed;
- only the glow changed;
- only the hero size changed;
- the sidebar stayed identical;
- only the amount of whitespace changed.

Structural difference means a different spatial system, a different signature object or its role, a
different navigation/progression geometry — something that changes what the screen fundamentally *is*.

## React is blocked until

- the user **explicitly selects** a direction, **or**
- the user **explicitly asks to merge** specific named elements from named directions.

Until then: ASCII wireframes and written briefs only. After approval, hand off to implementation,
then `webapp-testing` + `ata-visual-qa-loop` + `ata-anti-generic-ui-review`, then
`ui-ux-pro-max` heuristic audit (see `docs/DESIGN_SKILLS_INDEX.md`).

## Output format

```
# Direction <A|B|C> — <name>
1. Product thesis: ...
... (all 19) ...
15. ASCII wireframe:
   Desktop:
   +------------------------------------------+
   | ...                                      |
   +------------------------------------------+
   Mobile:
   +----------------+
   | ...            |
   +----------------+
```

Then a short comparison table across directions and an explicit note: **no winner is selected —
the user chooses.**
