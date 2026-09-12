import { describe, expect, it } from "vitest";
import {
  ACADEMY_E2E,
  AcademyE2EConfigError,
  DEFAULT_PORT,
  EMERGENCY_OVERRIDE_ENV,
  FORBIDDEN_PORTS,
  REUSE_ENV,
  resolveAcademyE2EConfig,
} from "../../e2e/support/e2e-config";

/**
 * Config regression for the Academy E2E port policy (TB-2 / TB1-PORT-02).
 * The suite previously defaulted to port 3100 — the live DEV Backend port —
 * with server reuse enabled whenever CI was unset.
 */
describe("Academy E2E port policy", () => {
  it("defaults to 3040", () => {
    expect(resolveAcademyE2EConfig({}).port).toBe(3040);
    expect(DEFAULT_PORT).toBe(3040);
    expect(FORBIDDEN_PORTS).not.toContain(3040);
  });

  it("defaults reuseExistingServer to false", () => {
    expect(resolveAcademyE2EConfig({}).reuseExistingServer).toBe(false);
    // The old behaviour: reuse whenever CI was unset. It must NOT come back.
    expect(resolveAcademyE2EConfig({ CI: undefined }).reuseExistingServer).toBe(false);
    expect(resolveAcademyE2EConfig({ CI: "" }).reuseExistingServer).toBe(false);
  });

  it("enables reuse only via the explicit test-only variable", () => {
    expect(resolveAcademyE2EConfig({ [REUSE_ENV]: "true" }).reuseExistingServer).toBe(true);
    expect(resolveAcademyE2EConfig({ [REUSE_ENV]: "1" }).reuseExistingServer).toBe(false);
    expect(resolveAcademyE2EConfig({ [REUSE_ENV]: "yes" }).reuseExistingServer).toBe(false);
  });

  it("honours the port override", () => {
    const c = resolveAcademyE2EConfig({ ACADEMY_E2E_PORT: "3045" });
    expect(c.port).toBe(3045);
    expect(c.baseURL).toBe("http://127.0.0.1:3045");
  });

  it.each([3100, 3010, 3110, 3020])("rejects live runtime port %i", (port) => {
    expect(() => resolveAcademyE2EConfig({ ACADEMY_E2E_PORT: String(port) })).toThrow(
      AcademyE2EConfigError,
    );
  });

  it("allows a reserved port only under the explicit emergency override", () => {
    expect(() => resolveAcademyE2EConfig({ ACADEMY_E2E_PORT: "3100" })).toThrow();
    const c = resolveAcademyE2EConfig({
      ACADEMY_E2E_PORT: "3100",
      [EMERGENCY_OVERRIDE_ENV]: "true",
    });
    expect(c.port).toBe(3100);
  });

  it("binds loopback only", () => {
    expect(resolveAcademyE2EConfig({}).host).toBe("127.0.0.1");
    expect(() => resolveAcademyE2EConfig({ ACADEMY_E2E_HOST: "0.0.0.0" })).toThrow(
      AcademyE2EConfigError,
    );
  });

  it("rejects a malformed or out-of-range port", () => {
    for (const bad of ["abc", "-1", "0", "70000", "30.5"]) {
      expect(() => resolveAcademyE2EConfig({ ACADEMY_E2E_PORT: bad })).toThrow(AcademyE2EConfigError);
    }
  });

  it("derives baseURL from the resolved host and port — they cannot diverge", () => {
    const c = resolveAcademyE2EConfig({ ACADEMY_E2E_PORT: "3049" });
    expect(c.baseURL).toBe(`http://${c.host}:${c.port}`);
    expect(ACADEMY_E2E.baseURL).toBe(`http://${ACADEMY_E2E.host}:${ACADEMY_E2E.port}`);
  });
});
