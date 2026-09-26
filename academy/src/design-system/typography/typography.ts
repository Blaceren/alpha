/**
 * Typographic scale.
 *
 * Families are applied via CSS variables (--font-display / --font-ui /
 * --font-mono / --font-public-display) and Tailwind font-{display,ui,mono}.
 * This module documents the scale and the role of each family.
 *
 * UNIFIED-DESIGN-V1 rebound all three roles to the accepted brand faces, which
 * are vendored locally and bound in src/styles/fonts.css. The scoped "ATA "
 * prefix is deliberate: the product claims no global right to the installed
 * family names.
 */

export const FONT_ROLES = {
  display: "ATA Manrope — заголовки, ranks, milestones",
  ui: "ATA Manrope — основной UI и тексты",
  mono: "ATA IBM Plex Mono — технические значения и метаданные",
  /**
   * Public Home ONLY. The authenticated product never uses this face; it is the
   * marketing surface's display voice and is bound to --font-public-display.
   */
  publicDisplay: "ATA Source Serif 4 — только Public Home",
} as const;

/** Tailwind class fragments for the provisional type scale. */
export const TYPE_SCALE = {
  displayXl: "font-display text-[2.75rem] leading-[1.05] font-bold tracking-tight",
  displayL: "font-display text-[2rem] leading-[1.1] font-bold tracking-tight",
  h1: "font-display text-[1.75rem] leading-[1.15] font-semibold tracking-tight",
  h2: "font-display text-[1.375rem] leading-[1.2] font-semibold",
  h3: "font-ui text-[1.125rem] leading-[1.3] font-semibold",
  bodyL: "font-ui text-[1.0625rem] leading-[1.55]",
  body: "font-ui text-base leading-[1.5]",
  caption: "font-ui text-sm leading-[1.4]",
  mono: "font-mono text-[0.9375rem] leading-[1.45]",
} as const;

export type TypeScaleKey = keyof typeof TYPE_SCALE;
