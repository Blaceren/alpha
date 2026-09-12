import { describe, it, expect } from "vitest";
import { categorizeCurrentHttp, categorizeContentHttp } from "@/lib/curriculum/read-errors";

describe("categorizeCurrentHttp", () => {
  it("404 -> FEATURE_DISABLED (disabled feature reads as not activated)", () => {
    expect(categorizeCurrentHttp(404, { error: "NOT_FOUND" }, null).category).toBe("FEATURE_DISABLED");
  });
  it("401 -> UNAUTHENTICATED, 403 -> FORBIDDEN", () => {
    expect(categorizeCurrentHttp(401, {}, null).category).toBe("UNAUTHENTICATED");
    expect(categorizeCurrentHttp(403, {}, null).category).toBe("FORBIDDEN");
  });
  it("409 state-corrupt -> MALFORMED_RESPONSE", () => {
    expect(categorizeCurrentHttp(409, { error: "CURRICULUM_STATE_CORRUPT" }, null).category).toBe("MALFORMED_RESPONSE");
  });
  it("5xx -> BACKEND_UNAVAILABLE (retryable)", () => {
    const e = categorizeCurrentHttp(500, {}, "req-1");
    expect(e.category).toBe("BACKEND_UNAVAILABLE");
    expect(e.retryable).toBe(true);
    expect(e.requestId).toBe("req-1");
  });
});

describe("categorizeContentHttp", () => {
  it("locked -> locked (server-enforced lock)", () => {
    expect(categorizeContentHttp(409, { error: "CONTENT_LEVEL_LOCKED" })).toBe("locked");
  });
  it("not enrolled -> not_enrolled", () => {
    expect(categorizeContentHttp(409, { error: "CONTENT_NOT_ENROLLED" })).toBe("not_enrolled");
  });
  it("not configured -> not_configured", () => {
    expect(categorizeContentHttp(404, { error: "CONTENT_UNAVAILABLE", issues: [{ code: "content_not_configured" }] })).toBe("not_configured");
  });
  it("unsupported level type -> unsupported_type", () => {
    expect(categorizeContentHttp(404, { error: "CONTENT_UNAVAILABLE", issues: [{ code: "unsupported_level_type" }] })).toBe("unsupported_type");
  });
  it("feature disabled -> feature_disabled", () => {
    expect(categorizeContentHttp(404, { error: "NOT_FOUND" })).toBe("feature_disabled");
  });
});
