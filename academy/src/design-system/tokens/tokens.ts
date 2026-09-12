/**
 * Typed references to the provisional semantic design tokens.
 * The single source of truth for *values* is src/styles/tokens.css.
 * This module lets TypeScript code reference tokens by name without hardcoding
 * hex values, and documents the full token surface for the design system.
 */

export const SEMANTIC_TOKENS = [
  "background-base",
  "background-deep",
  "surface-primary",
  "surface-secondary",
  "surface-elevated",
  "surface-interactive",
  "border-subtle",
  "border-default",
  "text-primary",
  "text-secondary",
  "text-muted",
  "accent-primary",
  "accent-secondary",
  "success",
  "warning",
  "danger",
  "info",
  "locked",
  "completed",
  "active",
  "suspended",
  "focus-ring",
  "overlay",
  "path-line",
  "path-glow",
] as const;

export type SemanticToken = (typeof SEMANTIC_TOKENS)[number];

/** Resolve a token to its CSS `var(--token)` reference. */
export function token(name: SemanticToken): string {
  return `var(--${name})`;
}

/**
 * The token VALUES are no longer placeholders.
 *
 * They now derive from the accepted unified-design brand foundation
 * (ATA-Integration 560a0f3011c153422575701e846da9c125cd3c79 —
 * packages/brand/foundations/raw-brand.css and selected-neutral.css), replacing
 * the provisional Phase D1B navy/teal ramp this flag was guarding.
 *
 * The flag is kept rather than deleted because callers may still be reading it;
 * it now answers `false`, which is the truthful answer.
 */
export const TOKENS_ARE_PROVISIONAL = false;
