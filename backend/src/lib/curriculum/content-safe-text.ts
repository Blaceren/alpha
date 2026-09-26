/**
 * PHASE-C — the ONE sanitizer contract for every learner-facing text field.
 *
 * WHY THIS FILE EXISTS
 * Before Phase C the anti-XSS rules lived as two private regexes inside
 * `content-schemas.ts`, which is the DB authoring path. The PACKAGE path
 * (`package/schema.ts`) declared its content text as a bare
 * `z.string().trim().min(1).max(n)` and the importer never called
 * `validateContentPublication`, so a package could carry `<script>` in a lesson
 * section, be imported, and only be refused later at publication — if anything
 * refused it at all. Content Body v2 multiplies the number of text-bearing
 * fields by roughly ten, so "each schema writes its own regex" was the design
 * that had to go first.
 *
 * Every text-bearing field in the platform — v1 body, v2 blocks, package
 * content, localizations — now derives from the primitives here. There is one
 * policy, one place to strengthen it, and one place to test it.
 *
 * THE TEXT-FORMAT POLICY (deliberate, §9)
 * Learner text is PLAIN STRUCTURED TEXT, not markup. Structure is carried by the
 * block model (`content-blocks.ts`), never by characters inside a string:
 * headings are `heading` blocks, lists are `list` blocks, links are `tool_link`,
 * `cta` or `download` blocks with a validated target. A renderer is therefore
 * allowed to emit these strings as TEXT NODES and nothing else; it must never
 * need an HTML parser, a markdown parser or a sanitizer of its own.
 *
 * Paragraph breaks are the single exception and are expressed as `\n\n`. That is
 * a text convention, not a markup language: it cannot express a link, an
 * element, an attribute or a script.
 *
 * WHAT IS REFUSED, AND WHY EACH ONE
 *  - HTML-ish tags (`<a …>`, `</script>`) — the direct injection vector.
 *  - `on…=` — the event-handler vector that survives tag stripping.
 *  - `javascript:` / `data:` / `vbscript:` / `blob:` / `file:` / `about:` —
 *    every scheme that executes or exfiltrates when placed in an href.
 *  - `&lt;`, `&#60;`, `&#x3c;` — an encoded `<`. A renderer that ever decodes
 *    entities (a markdown pass, a legacy CMS import, a copy through an HTML
 *    editor) turns these back into tags, so they are refused at rest rather than
 *    trusted to stay encoded.
 *  - C0/C1 control characters, and the Unicode bidi overrides U+202A–U+202E and
 *    U+2066–U+2069 — invisible reordering that lets stored text render as
 *    something other than what a reviewer approved.
 *
 * WHAT IS DELIBERATELY NOT REFUSED
 *  - Bare `https://` URLs in prose. They are inert as text, and banning `://`
 *    would false-positive on legitimate lesson prose that names an address.
 *    Renderers must not auto-link; the block model provides real link blocks.
 *  - `<` on its own (as in «риск < 2%»). Only tag-shaped and entity-encoded
 *    forms are refused, so ordinary prose is never rejected for using the
 *    mathematical symbol.
 *
 * V1 COMPATIBILITY
 * The legacy body format keeps its ORIGINAL markdown-link rule (an https
 * markdown link is legal in v1 and always was); v2 refuses markdown link and
 * image syntax outright, because v2 has real blocks for both. The hardening
 * added above (entities, control characters, extra schemes) applies to BOTH
 * formats: it is a strengthening, and the shipped approved packages contain
 * none of those sequences, so nothing already approved changes meaning.
 */
import { z } from "zod";

/** Tag-shaped markup, event handlers, and executable/exfiltrating URI schemes. */
export const UNSAFE_MARKUP_PATTERN =
  /<\/?[a-z][^>]*>|\bon[a-z]+\s*=|(?:javascript|data|vbscript|blob|file|about)\s*:/i;

/** An encoded `<`. Refused at rest so a decoding renderer cannot resurrect a tag. */
export const ENCODED_TAG_OPENER_PATTERN = /&(?:lt\b|#0*60\b|#x0*3c\b)/i;

/** C0/C1 controls (except \t \n \r) plus the Unicode bidi override range. */
export const UNSAFE_CONTROL_PATTERN = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u202A-\\u202E\\u2066-\\u2069]",
);

/** v1 rule, unchanged: a markdown link is legal only when it targets https. */
export const NON_HTTPS_MARKDOWN_LINK_PATTERN = /\]\((?!https:\/\/)[^)]+\)/i;

/** v2 rule: markdown link AND image syntax are refused outright — blocks own links. */
export const ANY_MARKDOWN_LINK_PATTERN = /!?\[[^\]]*\]\([^)]*\)/;

export type TextPolicy = "legacy_v1" | "blocks_v2";

/** The shared floor both policies enforce. */
function violatesSharedPolicy(value: string): boolean {
  return (
    UNSAFE_MARKUP_PATTERN.test(value) ||
    ENCODED_TAG_OPENER_PATTERN.test(value) ||
    UNSAFE_CONTROL_PATTERN.test(value)
  );
}

/** Is this string safe to store and to render as a text node under `policy`? */
export function isSafeText(value: string, policy: TextPolicy): boolean {
  if (violatesSharedPolicy(value)) return false;
  return policy === "blocks_v2"
    ? !ANY_MARKDOWN_LINK_PATTERN.test(value)
    : !NON_HTTPS_MARKDOWN_LINK_PATTERN.test(value);
}

/**
 * The single human-readable refusal. Never echoes the offending value: a
 * validation message travels into logs and admin UIs, and repeating an
 * injection payload there is how a content check becomes an injection vector.
 */
export function describeUnsafeText(label: string): string {
  return `${label} must be plain text: HTML, event handlers, non-https URI schemes, encoded tag openers, control characters and markdown links are not allowed`;
}

/** Required plain text: trimmed, non-empty, bounded, policy-clean. */
export function safeText(max: number, label: string, policy: TextPolicy = "blocks_v2") {
  return z
    .string()
    .trim()
    .min(1, `${label} must not be empty`)
    .max(max, `${label} is too long`)
    .refine((value) => isSafeText(value, policy), describeUnsafeText(label));
}

/** Optional plain text: may be empty; when present it obeys the same policy. */
export function optionalSafeText(max: number, label: string, policy: TextPolicy = "blocks_v2") {
  return z
    .string()
    .trim()
    .max(max, `${label} is too long`)
    .refine(
      (value) => value.length === 0 || isSafeText(value, policy),
      describeUnsafeText(label),
    );
}

/**
 * Stable content identifiers (section codes, block codes, asset codes).
 * Lowercase kebab only: no dots, no separators that could carry path or URL
 * meaning, and no case folding, so two stored codes can never collide.
 */
export const STABLE_CONTENT_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function stableContentCode(max = 64) {
  return z.string().trim().max(max).regex(STABLE_CONTENT_CODE_PATTERN);
}

export function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
