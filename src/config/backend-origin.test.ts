import { describe, expect, it } from "vitest";
import { parseBackendOrigin } from "./backend-origin";

describe("parseBackendOrigin — accepted", () => {
  it("accepts the DEV loopback origin", () => {
    expect(parseBackendOrigin("http://127.0.0.1:3110")).toEqual({
      ok: true,
      origin: "http://127.0.0.1:3110",
    });
  });

  it("accepts https", () => {
    expect(parseBackendOrigin("https://crm-backend.internal")).toEqual({
      ok: true,
      origin: "https://crm-backend.internal",
    });
  });

  it("normalizes exactly one trailing slash away", () => {
    // The destination is built as `${origin}${path}`, so a surviving trailing
    // slash would produce `//api/crm/v1/session`.
    expect(parseBackendOrigin("http://127.0.0.1:3110/")).toEqual({
      ok: true,
      origin: "http://127.0.0.1:3110",
    });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseBackendOrigin("  http://127.0.0.1:3110  ")).toEqual({
      ok: true,
      origin: "http://127.0.0.1:3110",
    });
  });
});

describe("parseBackendOrigin — rejected", () => {
  const cases: Array<[string, string | undefined | null, string]> = [
    ["undefined", undefined, "missing"],
    ["null", null, "missing"],
    ["empty string", "", "missing"],
    ["whitespace only", "   ", "missing"],
    ["relative URL", "/api/crm", "not_absolute"],
    ["protocol-relative", "//127.0.0.1:3110", "not_absolute"],
    // A scheme cannot start with a digit, so this fails to parse at all rather
    // than reaching the protocol check.
    ["bare host", "127.0.0.1:3110", "not_absolute"],
    ["bare hostname", "backend.internal", "not_absolute"],
    ["malformed port", "http://127.0.0.1:notaport", "not_absolute"],
    ["ftp", "ftp://127.0.0.1", "unsupported_protocol"],
    ["file", "file:///etc/passwd", "unsupported_protocol"],
    ["javascript", "javascript:alert(1)", "unsupported_protocol"],
    ["credentials", "http://user:pass@127.0.0.1:3110", "has_credentials"],
    ["username only", "http://user@127.0.0.1:3110", "has_credentials"],
    ["query string", "http://127.0.0.1:3110?a=1", "has_query"],
    ["hash", "http://127.0.0.1:3110#x", "has_hash"],
    ["non-root path", "http://127.0.0.1:3110/api", "has_path"],
    ["deep path", "http://127.0.0.1:3110/a/b", "has_path"],
  ];

  it.each(cases)("rejects %s", (_label, input, expected) => {
    const result = parseBackendOrigin(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(expected);
  });
});
