# Vendored fonts

POCKET-REG-SECURITY-CLOSURE-1 (F3/P2). These files exist so `next build` never
depends on a network fetch.

**The defect they close.** `next/font/google` resolves each family at BUILD time
by fetching CSS from `fonts.googleapis.com` and then the `.woff2` files from
`fonts.gstatic.com`. Google rotates those hashed asset URLs, so a build that
succeeded yesterday can fail today with `Failed to fetch <Family> from Google
Fonts` — and Next reports the downstream symptom as an unrelated
`<Html> should not be imported outside of pages/_document` prerender error,
which sends the reader looking in entirely the wrong place. The parent phase hit
exactly that and could only get a green build by reusing an older release's
resolved fonts, which is not a release-engineering state anyone should accept.

**What is here.** The two families the ROOT LAYOUT applies to real served pages,
as variable `woff2` (one file per subset, covering the whole weight axis):

| file | family | axis | subset |
|---|---|---|---|
| `PlusJakartaSans-latin.woff2` | Plus Jakarta Sans | `wght 200..800` | latin |
| `PlusJakartaSans-cyrillic-ext.woff2` | Plus Jakarta Sans | `wght 200..800` | cyrillic-ext |
| `JetBrainsMono-latin.woff2` | JetBrains Mono | `wght 100..800` | latin |
| `JetBrainsMono-cyrillic.woff2` | JetBrains Mono | `wght 100..800` | cyrillic |

The subsets are exactly the ones `layout.tsx` already requested, so the rendered
result is unchanged — this is a sourcing change, not a design change.

**Licensing.** Both families are published under the SIL Open Font License 1.1,
which permits redistribution and bundling. `OFL.txt` carries the licence text.

**Fonts are NOT vendored for `components/design-lab/*`.** Those are internal
design-exploration surfaces, not product, and their remote font imports were
removed rather than replaced — see `15_SOURCE_CORRECTIONS.md` in the phase
package. Vendoring several more families to style pages no learner or operator
reaches would be weight for nothing.

**Updating a font.** Fetch the variable `woff2` for the subset from Google once,
by hand, and commit it. Do not reintroduce `next/font/google` in the root
layout: the whole point is that the build reads these bytes from the repository.
