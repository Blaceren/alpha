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

/** Provisional flag — visual values are placeholders until prelanding assets. */
export const TOKENS_ARE_PROVISIONAL = true;
