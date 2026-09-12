import { describe, it, expect } from "vitest";
import {
  deriveTrustedClientIp,
  isIpLiteral,
  FORWARDED_CLIENT_IP_HEADERS,
  TRUSTED_CLIENT_IP_HEADER,
  UNTRUSTED_FORWARDING_HEADERS,
} from "@/server/proxy/client-ip";

function withHeaders(headers: Record<string, string>): Request {
  return new Request("http://academy.test/api/backend/auth/register", {
    method: "POST",
    headers,
  });
}

describe("isIpLiteral", () => {
  it("accepts IPv4", () => {
    for (const ip of ["1.2.3.4", "127.0.0.1", "255.255.255.255", "0.0.0.0"]) {
      expect(isIpLiteral(ip), ip).toBe(true);
    }
  });

  it("accepts IPv6", () => {
    for (const ip of ["::1", "2001:db8::1", "fe80::1", "2001:0db8:0000:0000:0000:0000:0000:0001"]) {
      expect(isIpLiteral(ip), ip).toBe(true);
    }
  });

  it("rejects malformed, oversized and non-address values", () => {
    for (const value of [
      "",
      "not-an-ip",
      "1.2.3",
      "1.2.3.4.5",
      "256.1.1.1",
      "01.2.3.4", // leading zero
      "1.2.3.4 ",
      "2001:db8::1::2", // two compression groups
      "gggg::1",
      "evil.example.com",
      "1.2.3.4; rm -rf /",
      "a".repeat(46),
    ]) {
      expect(isIpLiteral(value), value).toBe(false);
    }
  });
});

describe("deriveTrustedClientIp", () => {
  it("returns the ingress-stamped x-real-ip", () => {
    expect(deriveTrustedClientIp(withHeaders({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("unwraps a bracketed IPv6 form", () => {
    expect(deriveTrustedClientIp(withHeaders({ "x-real-ip": "[2001:db8::1]" }))).toBe("2001:db8::1");
  });

  it("returns null when the ingress stamped nothing", () => {
    expect(deriveTrustedClientIp(withHeaders({}))).toBeNull();
  });

  it("returns null for a malformed value rather than forwarding it", () => {
    expect(deriveTrustedClientIp(withHeaders({ "x-real-ip": "not-an-ip" }))).toBeNull();
    expect(deriveTrustedClientIp(withHeaders({ "x-real-ip": "   " }))).toBeNull();
  });

  it("refuses a smuggled chain in the single-address header", () => {
    // x-real-ip is defined to hold ONE address. A comma means someone is trying
    // to make us pick an element — we take none.
    expect(deriveTrustedClientIp(withHeaders({ "x-real-ip": "1.1.1.1, 2.2.2.2" }))).toBeNull();
  });

  it("IGNORES a spoofed x-forwarded-for entirely", () => {
    // This is the rate-limit bypass the module exists to prevent: nginx appends
    // to X-Forwarded-For, so its first element is attacker-controlled.
    const request = withHeaders({
      "x-forwarded-for": "9.9.9.9, 203.0.113.7",
      "x-real-ip": "203.0.113.7",
    });
    expect(deriveTrustedClientIp(request)).toBe("203.0.113.7");
  });

  it("does not fall back to any client-controlled forwarding header", () => {
    for (const header of UNTRUSTED_FORWARDING_HEADERS) {
      const request = withHeaders({ [header]: "9.9.9.9" });
      expect(deriveTrustedClientIp(request), header).toBeNull();
    }
  });

  it("pins the trusted header name the ingress stamps", () => {
    expect(TRUSTED_CLIENT_IP_HEADER).toBe("x-real-ip");
  });

  it("writes the address under both names Backend consults, x-forwarded-for first", () => {
    expect([...FORWARDED_CLIENT_IP_HEADERS]).toEqual(["x-forwarded-for", "x-real-ip"]);
  });
});
