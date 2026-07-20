/**
 * Types for the Next config module.
 *
 * `next.config.mjs` is plain ESM JavaScript (the Next CLI loads it directly), so
 * it carries no declarations of its own. The rewrite regression tests import the
 * real config rather than a copy — that is the whole point of those tests — and
 * this declaration is what lets them do so under `noImplicitAny`.
 */
declare module "*next.config.mjs" {
  export const SESSION_PATH: string;

  export interface NextRewriteRule {
    source: string;
    destination: string;
  }

  export function buildRewrites(
    envSource?: Record<string, string | undefined>,
  ): NextRewriteRule[];

  const config: unknown;
  export default config;
}
