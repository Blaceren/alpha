import { describe, expect, it } from "vitest";
import { CrmConfigurationError, resolveServerRuntimeConfig } from "./server-runtime";

describe("resolveServerRuntimeConfig — accepted modes", () => {
  it("accepts mock mode", () => {
    expect(resolveServerRuntimeConfig({ CRM_MODE: "mock" })).toEqual({ mode: "mock" });
  });

  it("accepts api mode with a valid origin", () => {
    expect(
      resolveServerRuntimeConfig({
        CRM_MODE: "api",
        CRM_BACKEND_ORIGIN: "http://127.0.0.1:3110",
      }),
    ).toEqual({ mode: "api", backendOrigin: "http://127.0.0.1:3110" });
  });
});

describe("resolveServerRuntimeConfig — fails closed", () => {
  it("rejects a missing CRM_MODE rather than defaulting to mock", () => {
    // The whole point of the contract: no silent fallback to the synthetic
    // dataset when the operator forgot to say which mode this is.
    expect(() => resolveServerRuntimeConfig({})).toThrow(CrmConfigurationError);
  });

  it("rejects an unknown CRM_MODE", () => {
    expect(() => resolveServerRuntimeConfig({ CRM_MODE: "production" })).toThrow(
      CrmConfigurationError,
    );
  });

  it("rejects an empty CRM_MODE", () => {
    expect(() => resolveServerRuntimeConfig({ CRM_MODE: "" })).toThrow(CrmConfigurationError);
  });

  it("is case sensitive", () => {
    expect(() => resolveServerRuntimeConfig({ CRM_MODE: "API" })).toThrow(CrmConfigurationError);
  });

  it("names the offending value without inventing a default", () => {
    expect(() => resolveServerRuntimeConfig({ CRM_MODE: "nope" })).toThrow(/received "nope"/);
    expect(() => resolveServerRuntimeConfig({})).toThrow(/received missing/);
  });
});

describe("resolveServerRuntimeConfig — backend origin coupling", () => {
  it("requires CRM_BACKEND_ORIGIN in api mode", () => {
    expect(() => resolveServerRuntimeConfig({ CRM_MODE: "api" })).toThrow(CrmConfigurationError);
  });

  it("rejects a malformed origin in api mode", () => {
    expect(() =>
      resolveServerRuntimeConfig({ CRM_MODE: "api", CRM_BACKEND_ORIGIN: "not-a-url" }),
    ).toThrow(CrmConfigurationError);
  });

  it("rejects a wildcard-ish origin carrying a path", () => {
    expect(() =>
      resolveServerRuntimeConfig({ CRM_MODE: "api", CRM_BACKEND_ORIGIN: "http://127.0.0.1:3110/api" }),
    ).toThrow(CrmConfigurationError);
  });

  it("does not require CRM_BACKEND_ORIGIN in mock mode", () => {
    expect(resolveServerRuntimeConfig({ CRM_MODE: "mock" })).toEqual({ mode: "mock" });
  });

  it("ignores CRM_BACKEND_ORIGIN entirely in mock mode, even a malformed one", () => {
    // A stale or broken origin left in the environment must not be able to
    // break — or influence — a mock deployment.
    expect(
      resolveServerRuntimeConfig({ CRM_MODE: "mock", CRM_BACKEND_ORIGIN: "javascript:alert(1)" }),
    ).toEqual({ mode: "mock" });
  });

  it("never returns the backend origin in mock mode", () => {
    const config = resolveServerRuntimeConfig({
      CRM_MODE: "mock",
      CRM_BACKEND_ORIGIN: "http://127.0.0.1:3110",
    });
    expect(config).not.toHaveProperty("backendOrigin");
  });
});

describe("browser-owned mode is gone", () => {
  it("ignores NEXT_PUBLIC_CRM_MODE", () => {
    // The old fail-open key must have no effect: a browser-visible value can no
    // longer choose the data boundary.
    expect(() => resolveServerRuntimeConfig({ NEXT_PUBLIC_CRM_MODE: "mock" })).toThrow(
      CrmConfigurationError,
    );
  });

  it("does not let NEXT_PUBLIC_CRM_MODE override a real CRM_MODE", () => {
    expect(
      resolveServerRuntimeConfig({ CRM_MODE: "mock", NEXT_PUBLIC_CRM_MODE: "api" }),
    ).toEqual({ mode: "mock" });
  });
});
