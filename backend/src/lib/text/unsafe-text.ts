/**
 * MARKUP THAT COULD RUN — NOT TEXT THAT LOOKS LIKE A COMPARISON (2026-10-04,
 * launch audit).
 *
 * One screen for every place a learner's or a reviewer's prose is stored: the
 * support desk, the report fields, the report review. It refuses what turns a
 * stored string into stored XSS in some renderer — a tag, an inline event
 * handler, a `javascript:` URL, a `data:` URI — and nothing else.
 *
 * The screen it replaces refused anything from «<» plus a letter to the next
 * «>», which is how traders write conditions: «цена<EMA20, RSI>70» was refused
 * as markup, the support desk answered «Что-то пошло не так», and the level 9
 * report said «заполнены не все обязательные поля». A tag is now what an HTML
 * parser would take for one: a name, then attributes in attribute syntax
 * (Latin names, optional values), then «>».
 *
 * Every renderer the product has escapes text anyway (React on both sides);
 * this is the second line, not the first.
 */
export const UNSAFE_TEXT =
  /<\/?[a-z][a-z0-9-]*(?:\s+[a-z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>|\bon[a-z]+\s*=|javascript\s*:|\bdata:[a-z]+\/[a-z0-9.+-]+[;,]/i;
