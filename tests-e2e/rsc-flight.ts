/**
 * Next 15 / React 19 inline the RSC flight stream into bootstrap scripts
 * (`self.__next_f.push([...])`). Inside those script string literals React writes
 * its row pointers as `\"$<hex>\"` — `\"$8f\"`, `\"$90\"`, `\"$91\"` — a counter that
 * grows with payload size.
 *
 * That namespace collides with the currency needles the privacy specs scan for
 * ("$90", "$70", "$80", "$88"…): once a payload is large enough to allocate row
 * 0x90, `html.includes("$90")` is true even though no amount was ever rendered.
 * Under Next 14 the dev payload never reached that row, so the collision is new.
 *
 * The strip is anchored on the backslash-escaped quoting that only occurs inside
 * a script string literal, so it removes React's row pointers and nothing else:
 *
 *   - a rendered amount is DOM text — `<span ...>$90</span>` — unescaped, untouched;
 *   - an attribute value is `title="$90"` — unescaped, untouched;
 *   - a real `$`-leading string inside the payload is flight-escaped to `$$90`,
 *     which does not match `$<hex>` and so still trips `not.toContain("$90")`.
 *
 * The scan therefore keeps full coverage of every real string in the document —
 * props, aria/title attributes and serialized payload data. It is narrower, not
 * weaker. The specs' `innerText` assertions remain the primary leak check.
 */
export function stripFlightRowRefs(html: string): string {
  return html.replace(/\\"\$[0-9a-f]{1,6}\\"/g, '\\"<flight-row-ref>\\"');
}
