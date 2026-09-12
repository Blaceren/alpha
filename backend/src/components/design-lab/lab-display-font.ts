/**
 * POCKET-REG-SECURITY-CLOSURE-1 (F3/P2) — design-lab display fonts, with no
 * build-time network fetch.
 *
 * WHAT THIS REPLACES. Ten `components/design-lab/*` files each called
 * `next/font/google` (`Unbounded`, `Golos_Text`) to obtain a display face and
 * exposed it to their stylesheets as a CSS custom property. Every one of those
 * calls made `next build` fetch CSS from `fonts.googleapis.com` and hashed
 * `.woff2` files from `fonts.gstatic.com`. Google rotates those URLs, so the
 * whole production build — API routes included — was hostage to a remote asset
 * host while styling pages no learner or operator ever reaches.
 *
 * WHY REMOVED RATHER THAN VENDORED. `design-lab` and the `showcase` routes are
 * internal design exploration, not product. The two families the ROOT LAYOUT
 * applies to real served pages ARE vendored (`src/app/fonts/`), because there
 * the rendered result matters. Shipping several more font binaries to preserve
 * the exact typeface of an internal mood board would be weight for nothing.
 *
 * THE SHAPE IS DELIBERATELY IDENTICAL. Each export still exposes `.variable`,
 * so the call sites and their stylesheets are unchanged: they still write
 * `className={... ${labDisplay.variable}}` and still read
 * `font-family: var(--tqv2-display), ...`. The custom property now resolves to
 * the vendored body face and then the platform stack, which is exactly what the
 * stylesheets already declared as their fallback.
 *
 * If a design decision ever needs one of these faces back for a PRODUCT
 * surface, vendor it into `src/app/fonts/` — do not reintroduce
 * `next/font/google`.
 */

/** The CSS class that binds a lab display variable to the vendored stack. */
export type LabDisplayFont = { readonly variable: string };

/**
 * `--font-lab-a` — was `Unbounded`.
 * `--font-lab-c` — was `Golos_Text`.
 * `--tqv2-display`, `--v7-display`, `--tqv3-display` — were `Unbounded`.
 *
 * All five resolve through `lab-display-font.css`, which sets each property to
 * `var(--font-sans)` with a platform fallback.
 */
export const labDisplayA: LabDisplayFont = { variable: "lab-display-a" };
export const labDisplayC: LabDisplayFont = { variable: "lab-display-c" };
export const labDisplayTqv2: LabDisplayFont = { variable: "lab-display-tqv2" };
export const labDisplayV7: LabDisplayFont = { variable: "lab-display-v7" };
export const labDisplayV3: LabDisplayFont = { variable: "lab-display-v3" };
