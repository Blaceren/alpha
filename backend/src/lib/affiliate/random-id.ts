import crypto from "node:crypto";

/**
 * The single producer of every opaque affiliate identifier in this platform.
 *
 * WHY ONE FUNCTION. AFD-2 shipped a base32 generator for `publicCode`. AFD-3B2
 * needs three more identifiers of exactly the same kind — `ataClickId`,
 * `anonymousVisitorId` and a conversion `eventId` — and writing the encoder four
 * times would give four chances to get the alphabet, the entropy or the bit
 * packing subtly wrong. They all come from here instead.
 *
 * WHY BASE32 AND NOT HEX OR UUID. Lowercase base32 carries 5 bits per character
 * rather than hex's 4, so 160 bits fits in 32 characters that survive being
 * pasted into a URL, read aloud or transcribed with different casing without
 * becoming a second distinct value. A UUID would advertise its version and
 * variant bits and carry only 122 random bits.
 */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/** 20 bytes = 160 bits = 32 base32 characters. The shape every caller uses. */
export const AFFILIATE_ID_BYTES = 20;
export const AFFILIATE_ID_LENGTH = 32;

/** The exact shape an identifier from this module has, for validation. */
export const AFFILIATE_ID_PATTERN = /^[a-z2-7]{32}$/;

/**
 * `crypto.randomBytes` and nothing else: never `Math.random`, never a counter,
 * never a timestamp. A predictable click id would let anyone enumerate another
 * affiliate's traffic, and a predictable visitor id would let anyone forge a
 * journey that a real registration might then consume.
 */
export function randomBase32Id(bytes: number = AFFILIATE_ID_BYTES): string {
  const buffer = crypto.randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let out = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  return out;
}

export function isAffiliateId(value: unknown): value is string {
  return typeof value === "string" && AFFILIATE_ID_PATTERN.test(value);
}
