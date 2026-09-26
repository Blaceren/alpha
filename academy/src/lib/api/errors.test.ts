import { describe, it, expect } from "vitest";
import { normalizeHttpError, makeError } from "@/lib/api/errors";

describe("normalizeHttpError", () => {
  it("maps 401 to UNAUTHENTICATED by default", () => {
    expect(normalizeHttpError({ status: 401 }).category).toBe("UNAUTHENTICATED");
  });

  it("maps 401 on login to INVALID_CREDENTIALS", () => {
    expect(normalizeHttpError({ status: 401, isLogin: true }).category).toBe("INVALID_CREDENTIALS");
  });

  it("maps 403 to FORBIDDEN and preserves a code-like error", () => {
    const e = normalizeHttpError({ status: 403, body: { error: "ACCOUNT_BLOCKED" } });
    expect(e.category).toBe("FORBIDDEN");
    expect(e.code).toBe("ACCOUNT_BLOCKED");
  });

  it("does not leak a human error string as a code", () => {
    const e = normalizeHttpError({ status: 401, body: { error: "Неверный email или пароль" } });
    expect(e.code).toBeNull();
  });

  it("maps 400/422 to VALIDATION_ERROR", () => {
    expect(normalizeHttpError({ status: 400 }).category).toBe("VALIDATION_ERROR");
    expect(normalizeHttpError({ status: 422 }).category).toBe("VALIDATION_ERROR");
  });

  it("maps 409 to CONFLICT", () => {
    expect(normalizeHttpError({ status: 409 }).category).toBe("CONFLICT");
  });

  it("maps 429 to RATE_LIMITED (retryable)", () => {
    const e = normalizeHttpError({ status: 429 });
    expect(e.category).toBe("RATE_LIMITED");
    expect(e.retryable).toBe(true);
  });

  it("maps 5xx to BACKEND_UNAVAILABLE (retryable)", () => {
    const e = normalizeHttpError({ status: 503 });
    expect(e.category).toBe("BACKEND_UNAVAILABLE");
    expect(e.retryable).toBe(true);
  });

  it("preserves the request id", () => {
    expect(normalizeHttpError({ status: 500, requestId: "req-123" }).requestId).toBe("req-123");
  });

  it("every error has a stable message key and never leaks a status-free UNKNOWN as retryable", () => {
    const e = makeError("UNKNOWN_ERROR");
    expect(e.messageKey).toBe("auth.error.unknown");
    expect(e.retryable).toBe(false);
  });
});
