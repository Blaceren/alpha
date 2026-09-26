---
name: ata-brand-language
description: >
  The visual brand language for Alfa Trade Academy (ATA), derived from the four
  PROVISIONAL prelanding references. Use this whenever designing, proposing,
  reviewing, or discussing ANY Alfa Trade Academy UI — pages, components, color,
  typography, layout, motion, the path/progression, ranks, tools, or Alex Curie —
  even if the user does not say "brand". Load it before art-direction, before any
  React/UI work, and before critiquing an ATA screen. It defines brand essence,
  the chaos→system narrative, signature-motif candidates, and hard anti-patterns
  (no generic dashboard, no card grid, no Lucide-as-identity). It does NOT invent
  final colors or a logo — references are provisional.
---

# ATA Brand Language (provisional)

The official product name is **Alfa Trade Academy**. The wordmark **“Alpha Trade”** on
the reference frames is legacy/provisional and is **never** carried into product UI.

**Sources (provisional):** `design-memory/references/ata-brand/prelanding-desktop-0{1..4}.png`
and `design-memory/references/ata-brand/REFERENCE_MANIFEST.md`. These are a *direction*, not a
final brand book. Do not treat exact colors, sizes, spacing, blur, opacity, or object placement
as final. Extract **principles**, never copy literally. Missing assets:
`design-memory/references/ata-brand/MISSING_BRAND_ASSETS.md`.

Why this exists: the rejected D1A directions
(`design-memory/references/anti-examples/d1a-generic/`) were all one generic AI dashboard. This
skill encodes what actually makes ATA look like ATA so proposals stop drifting to defaults.

## Brand essence

Adult · premium · analytical · composed · directed · atmospheric · calm. Cinematic **only in
milestone areas** (rank-up, checkpoint, unlock). Explicitly **not**: casino, game UI, generic
fintech, enterprise admin dashboard.

## Core narrative

The single metaphor: **a transition from chaotic actions to a legible system.** The user's journey
is **a forming structure**, not a set of cards. Every screen should feel like part of a system
being built, with one clear next step — not a wall of KPI tiles.

## Provisional signature motif candidates (investigate — do not adopt all three)

Grounded in the references; a later art-direction phase must prove which actually works *in the
interface*, not just in a hero.

1. **Luminous Route Trace** — the glowing line (green ascending trace in refs 01–03) becomes a
   *functional* persistent progression object: connects levels, shows the completed path, marks the
   current position, reacts to checkpoints. Never a decorative background chart.
2. **Learning Spine** — the vertical light ray with numbered nodes (ref 04): a vertical axis of
   modules / checkpoints / capabilities with meaningful sequence (01→N). Strong on the Path page and
   on mobile.
3. **Constructed Market Artifact** — an object assembled from lines, data points, and layers
   (the A in refs 02–03): a rank / module / tool artifact with a signal point marking state. Not a
   casino medal, not a giant logo on every screen.

Confirm a motif against **at least two** references before relying on it (see manifest §A).

## Typography

Keep: large, clear statements; a calm text rhythm; technical captions as a **secondary** level; a
confident adult tone. Headlines read easily (see ref 04 — higher contrast than the hero frames).
Do **not** carry over: low-opacity body text, tiny uppercase for important information, excessive
letter-spacing, weak-contrast buttons.

## Materials (provisional — no final HEX here)

Deep navy field; thin borders; controlled *internal* glow; cold, transparent layers; rare
green/cyan signals; **no solid grey card wall.** Depth comes from **several surface types**, not from
blurring every card. Final color tokens stay provisional until the palette is delivered
(`docs/DESIGN_SYSTEM.md`, `MISSING_BRAND_ASSETS.md`); do not invent final hex values.

## Anti-patterns (forbidden — these produced the rejected D1A)

- Dashboard card grid as the layout basis.
- Identical border-radius on every surface.
- A bordered card around every block.
- A generic blue primary button with no tie to the brand system.
- Lucide (or any icon library) as the *primary* visual style / identity.
- Generic hexagonal rank emblem.
- KPI tiles.
- Fake charts / decorative market data with no product function.
- Glow on every card.
- Black background + grey cards.
- One identical sidebar reused across all art directions.
- Giant empty hero with no function.
- Literal copying of the prelanding (atmosphere ≠ copy; see manifest "product ≠ copy" rules).

## How to apply

1. Read `REFERENCE_MANIFEST.md` (Stable / Provisional / Landing-only + the landing→product translations).
2. Design from **Stable visual DNA**; pick **one** provisional idea to test per direction.
3. Commit to a **signature object** with a product function — not an icon set.
4. Run every proposal through `ata-art-direction-gate` and score it with `ata-anti-generic-ui-review`.
5. Never jump from reference analysis straight to React (see `CLAUDE.md` UI workflow).
