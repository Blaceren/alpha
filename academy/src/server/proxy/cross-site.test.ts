import { describe, expect, it } from "vitest";
import { isCrossSiteRequest } from "@/server/proxy/cross-site";

const at = (headers: Record<string, string>) =>
  new Request("http://127.0.0.1:3050/api/backend/auth/login", { method: "POST", headers });

/* 2026-10-07 audit: another site's page must not be able to sign this browser
   in to an account of its choosing. */
describe("isCrossSiteRequest", () => {
  it("trusts what a current browser says about where the request came from", () => {
    expect(isCrossSiteRequest(at({ "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isCrossSiteRequest(at({ "sec-fetch-site": "none" }))).toBe(false);
    expect(isCrossSiteRequest(at({ "sec-fetch-site": "cross-site" }))).toBe(true);
    // Another host of the same domain (the CRM, the partner console) has no business here either.
    expect(isCrossSiteRequest(at({ "sec-fetch-site": "same-site" }))).toBe(true);
  });

  it("falls back to Origin against the host the request was addressed to", () => {
    expect(isCrossSiteRequest(at({ host: "preprod.alfatrade.media", origin: "https://preprod.alfatrade.media" }))).toBe(false);
    expect(isCrossSiteRequest(at({ host: "preprod.alfatrade.media", origin: "https://evil.example" }))).toBe(true);
    expect(isCrossSiteRequest(at({ host: "preprod.alfatrade.media", origin: "null" }))).toBe(true);
    expect(isCrossSiteRequest(at({ host: "preprod.alfatrade.media", origin: "not a url" }))).toBe(true);
  });

  it("does not judge a request that is not a browser page's (no Sec-Fetch-Site, no Origin)", () => {
    expect(isCrossSiteRequest(at({}))).toBe(false);
  });
});
