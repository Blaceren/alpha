/**
 * AFFILIATE-PLATFORM-V1 §26/§21 — the outbound postback URL template.
 *
 * §26 SAID: RECOVER BEFORE INVENTING. The search was done and recorded: there
 * is no accepted outbound partner-postback contract anywhere in this
 * repository's source or docs, and no outbound HTTP path of any kind existed
 * before this phase. What DOES exist is the INBOUND contract ATA already speaks
 * with Pocket — `GET ...?clickid={click_id}&goal=dep&sum={sumdep}` — a GET with
 * brace-delimited macros, documented in docs/pocket-postbacks.md.
 *
 * So this is that same shape, pointed the other way. Not because affiliate
 * networks conventionally use it (they do), but because the product already
 * speaks it, and a partner integrating with ATA meets one macro convention
 * rather than two.
 *
 * ---------------------------------------------------------------------------
 * A CLOSED VOCABULARY, NOT A TEMPLATING LANGUAGE
 *
 * §26 forbids "an unrestricted arbitrary templating language", and the
 * distinction is precise. There is no expression syntax, no conditional, no
 * function call, no nesting and no default-value operator. There is a fixed set
 * of names, listed below, and each is replaced by exactly one string.
 *
 * AN UNKNOWN MACRO IS A CONFIGURATION REJECTION, NOT A LITERAL. The tempting
 * alternative — leave `{whatever}` alone and ship it — means a partner who
 * typos `{sub_1}` silently receives a literal `{sub_1}` on every conversion for
 * as long as nobody notices. Refusing at configuration time is the only moment
 * anyone is looking.
 *
 * ---------------------------------------------------------------------------
 * SUBSTITUTION CANNOT CHANGE THE SHAPE OF THE URL
 *
 * Every value is `encodeURIComponent`d, so a sub-id containing `&`, `#`, `?`,
 * `/` or `:` becomes text inside one parameter rather than a new parameter, a
 * new path or a new host. And the resolved URL is REPARSED AND REVALIDATED
 * afterwards, so even a defect in that encoding cannot produce a destination
 * the destination guard did not approve.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT AVAILABLE AS A MACRO
 *
 * No learner id, email or name. No Pocket player id, Pocket click id or any
 * provider identifier. No ATA internal row id. No commission or CPA amount —
 * §24 and §51: what ATA pays a partner is settled in the partner console, not
 * announced to whatever server they pointed us at. And no secret of any kind:
 * the signature travels in a header, never in the URL, so a postback URL that
 * ends up in someone's access log carries no credential.
 */

/** The event names a partner sees. The canonical affiliate vocabulary. */
export const POSTBACK_EVENT_NAMES = {
  academy_registration: "reg",
  first_deposit: "dep",
  redeposit: "rdep",
} as const;

export type PostbackEventName = (typeof POSTBACK_EVENT_NAMES)[keyof typeof POSTBACK_EVENT_NAMES];

/**
 * THE CLOSED MACRO VOCABULARY. Adding a name here is a deliberate product act,
 * and every name must be answerable from the conversion row alone.
 */
export const POSTBACK_MACROS = [
  /** `reg` | `dep` | `rdep`. */
  "event",
  /** ATA's own acquisition click id — the 32-character base32 `ataClickId`. */
  "click_id",
  /** The affiliate network's OWN click id, as captured from the link's parameter. */
  "external_click_id",
  "sub1",
  "sub2",
  "sub3",
  "sub4",
  "sub5",
  /** The exact provider amount for `dep`/`rdep`. EMPTY for `reg`, which has none. */
  "amount",
  /** ISO-4217 code, or EMPTY when the provider never stated one. */
  "currency",
  /** The conversion's own time, ISO-8601 UTC. */
  "event_time",
  /** ATA's public conversion id, so a partner can deduplicate and reconcile. */
  "conversion_id",
  /** The campaign code, or empty when the link carries no campaign. */
  "campaign",
  /** The tracking link's public code. */
  "link",
] as const;

export type PostbackMacro = (typeof POSTBACK_MACROS)[number];

export type PostbackTemplateRejection =
  | "empty"
  | "too_long"
  | "unknown_macro"
  | "malformed_macro"
  | "not_absolute"
  | "not_https"
  | "has_credentials"
  | "has_fragment"
  | "has_whitespace"
  | "no_click_context";

export const POSTBACK_TEMPLATE_MAX_LENGTH = 2048;

/** Anything between braces. Deliberately greedy-free and newline-free. */
const MACRO_PATTERN = /\{([^{}]*)\}/g;

/**
 * Validate a template a partner supplied.
 *
 * IT IS VALIDATED AS A URL WITH THE MACROS STILL IN IT, using a placeholder
 * substitution, because `new URL()` on a raw template can be fooled: a macro in
 * the host position would make the destination depend on runtime data. Checking
 * the substituted form is what proves the HOST IS FIXED.
 *
 * A TEMPLATE MUST CARRY SOME CLICK CONTEXT. A postback with no `{click_id}` and
 * no `{external_click_id}` cannot be matched to anything by the receiver, so it
 * is a delivery that will always be discarded — better refused at configuration
 * than sent forever.
 */
export function validatePostbackTemplate(
  raw: string,
): { ok: true; template: string } | { ok: false; reason: PostbackTemplateRejection } {
  const template = raw.trim();
  if (template === "") return { ok: false, reason: "empty" };
  if (template.length > POSTBACK_TEMPLATE_MAX_LENGTH) return { ok: false, reason: "too_long" };
  if (/\s/.test(template)) return { ok: false, reason: "has_whitespace" };

  // Every brace pair must name a known macro. An unmatched `{` or `}` is
  // caught by the leftover check below rather than by the pattern alone.
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  MACRO_PATTERN.lastIndex = 0;
  while ((match = MACRO_PATTERN.exec(template)) !== null) {
    const name = match[1];
    if (!(POSTBACK_MACROS as readonly string[]).includes(name)) {
      return { ok: false, reason: "unknown_macro" };
    }
    seen.add(name);
  }

  // A stray brace that no macro consumed. `https://x/?a={sub1` and
  // `https://x/?a=}` both land here.
  const withoutMacros = template.replace(MACRO_PATTERN, "");
  if (withoutMacros.includes("{") || withoutMacros.includes("}")) {
    return { ok: false, reason: "malformed_macro" };
  }

  if (!seen.has("click_id") && !seen.has("external_click_id")) {
    return { ok: false, reason: "no_click_context" };
  }

  // Substitute a benign placeholder so the URL parses. If a macro sat in the
  // scheme or the host, the parse below sees the placeholder there and the
  // host-shape checks reject it.
  const probe = template.replace(MACRO_PATTERN, "x");

  let url: URL;
  try {
    url = new URL(probe);
  } catch {
    return { ok: false, reason: "not_absolute" };
  }

  if (url.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "has_credentials" };
  if (url.hash !== "") return { ok: false, reason: "has_fragment" };

  // THE HOST MUST BE FIXED. If the raw template's host section contained a
  // macro, the probe's host differs from the raw one at that position — the
  // cheapest exact test is that the raw template, truncated at the first `/`
  // after the scheme, contains no brace at all.
  const authorityEnd = template.indexOf("/", "https://".length);
  const authority = authorityEnd === -1 ? template : template.slice(0, authorityEnd);
  if (authority.includes("{") || authority.includes("}")) {
    return { ok: false, reason: "malformed_macro" };
  }

  return { ok: true, template };
}

/** The facts one conversion can answer. Every field is already ATA-owned. */
export type PostbackMacroValues = Readonly<Record<PostbackMacro, string>>;

/**
 * Substitute the closed vocabulary into a validated template.
 *
 * EVERY VALUE IS PERCENT-ENCODED. A sub-id of `a&b=c` becomes `a%26b%3Dc` and
 * stays one parameter value. An absent value becomes the EMPTY STRING, never
 * the literal `null`, never `undefined`, and never the macro left in place —
 * a partner receiving `sub1=` knows there was no sub1, and a partner receiving
 * `sub1=undefined` has been told a lie about their own data.
 */
export function renderPostbackTemplate(template: string, values: PostbackMacroValues): string {
  return template.replace(MACRO_PATTERN, (_whole, name: string) => {
    const value = values[name as PostbackMacro];
    return encodeURIComponent(value ?? "");
  });
}
