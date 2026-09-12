import { describe, it, expect } from "vitest";
import {
  resolveAcademyConfig,
  normalizeBackendOrigin,
  AcademyConfigError,
  type EnvSource,
} from "@/config/academy-config";

const base: EnvSource = {};

describe("resolveAcademyConfig", () => {
  it("api mode requires a Backend origin (fail-closed)", () => {
    expect(() =>
      resolveAcademyConfig({ ACADEMY_MODE: "api" }, { isProduction: false }),
    ).toThrow(AcademyConfigError);
  });

  it("api mode resolves a valid loopback origin", () => {
    const config = resolveAcademyConfig(
      { ACADEMY_MODE: "api", BACKEND_ORIGIN: "http://127.0.0.1:3212" },
      { isProduction: false },
    );
    expect(config).toEqual({
      mode: "api",
      backendOrigin: "http://127.0.0.1:3212",
      requestTimeoutMs: 10_000,
      turnstileSiteKey: null,
    });
  });

  it("fixture mode is explicit and needs no origin", () => {
    const config = resolveAcademyConfig({ ACADEMY_MODE: "fixture" }, { isProduction: true });
    expect(config.mode).toBe("fixture");
    expect(config.backendOrigin).toBeNull();
  });

  it("defaults to fixture in non-production when mode is unset", () => {
    expect(resolveAcademyConfig(base, { isProduction: false }).mode).toBe("fixture");
  });

  it("production does NOT default to fixture (must be explicit)", () => {
    expect(() => resolveAcademyConfig(base, { isProduction: true })).toThrow(AcademyConfigError);
  });

  it("rejects an unknown mode", () => {
    expect(() => resolveAcademyConfig({ ACADEMY_MODE: "live" })).toThrow(AcademyConfigError);
  });

  it("rejects an unsafe non-loopback http origin", () => {
    expect(() =>
      resolveAcademyConfig({ ACADEMY_MODE: "api", BACKEND_ORIGIN: "http://backend.internal" }),
    ).toThrow(AcademyConfigError);
  });

  it("accepts https for a non-loopback origin", () => {
    const config = resolveAcademyConfig({
      ACADEMY_MODE: "api",
      BACKEND_ORIGIN: "https://backend.example.com",
    });
    expect(config.backendOrigin).toBe("https://backend.example.com");
  });

  it("rejects an origin containing credentials", () => {
    expect(() =>
      resolveAcademyConfig({ ACADEMY_MODE: "api", BACKEND_ORIGIN: "http://user:pass@127.0.0.1:3212" }),
    ).toThrow(/credentials/i);
  });

  it("rejects an origin with a query string or fragment", () => {
    expect(() => normalizeBackendOrigin("http://127.0.0.1:3212/?x=1")).toThrow(AcademyConfigError);
    expect(() => normalizeBackendOrigin("http://127.0.0.1:3212/#frag")).toThrow(AcademyConfigError);
  });

  it("rejects an origin with a path", () => {
    expect(() => normalizeBackendOrigin("http://127.0.0.1:3212/api")).toThrow(/path/i);
  });

  it("rejects a malformed origin", () => {
    expect(() => normalizeBackendOrigin("not-a-url")).toThrow(AcademyConfigError);
  });

  it("bounds and validates the request timeout", () => {
    expect(
      resolveAcademyConfig({ ACADEMY_MODE: "fixture", ACADEMY_REQUEST_TIMEOUT_MS: "5000" }).requestTimeoutMs,
    ).toBe(5000);
    expect(() =>
      resolveAcademyConfig({ ACADEMY_MODE: "fixture", ACADEMY_REQUEST_TIMEOUT_MS: "999999" }),
    ).toThrow(AcademyConfigError);
    expect(() =>
      resolveAcademyConfig({ ACADEMY_MODE: "fixture", ACADEMY_REQUEST_TIMEOUT_MS: "abc" }),
    ).toThrow(AcademyConfigError);
  });
});
