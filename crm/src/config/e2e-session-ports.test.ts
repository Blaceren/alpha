import { describe, expect, it } from "vitest";
import {
  BACKEND_PORT_TOKEN,
  DEFAULT_CRM_PORT,
  DEFAULT_STUB_PORT,
  E2EPortPolicyError,
  EMERGENCY_OVERRIDE_ENV,
  FORBIDDEN_PORTS,
  SESSION_E2E,
  resolveSessionE2EConfig,
} from "../../tests-e2e-session/support/e2e-config";

/**
 * Config regression for the session E2E port policy (TB-2 / TB1-F-002).
 * The suite previously hard-coded the live DEV CRM port (3010) and the RI-1
 * candidate backend port (3110); these tests pin the repaired contract.
 */
describe("session E2E port policy", () => {
  it("defaults to safe ports that collide with no runtime", () => {
    const c = resolveSessionE2EConfig({});
    expect(c.crmPort).toBe(3031);
    expect(c.stubPort).toBe(3211);
    expect(DEFAULT_CRM_PORT).toBe(3031);
    expect(DEFAULT_STUB_PORT).toBe(3211);
    expect(FORBIDDEN_PORTS).not.toContain(c.crmPort);
    expect(FORBIDDEN_PORTS).not.toContain(c.stubPort);
  });

  it("binds loopback only", () => {
    expect(resolveSessionE2EConfig({}).host).toBe("127.0.0.1");
    expect(() => resolveSessionE2EConfig({ CRM_E2E_HOST: "0.0.0.0" })).toThrow(E2EPortPolicyError);
    expect(() => resolveSessionE2EConfig({ CRM_E2E_HOST: "::" })).toThrow(E2EPortPolicyError);
  });

  it("honours env overrides", () => {
    const c = resolveSessionE2EConfig({ CRM_E2E_PORT: "3055", CRM_E2E_STUB_PORT: "3256" });
    expect(c.crmPort).toBe(3055);
    expect(c.stubPort).toBe(3256);
    expect(c.baseURL).toBe("http://127.0.0.1:3055");
    expect(c.backendOrigin).toBe("http://127.0.0.1:3256");
  });

  it.each([3100, 3010, 3110, 3020])("rejects live runtime port %i for the CRM server", (port) => {
    expect(() => resolveSessionE2EConfig({ CRM_E2E_PORT: String(port) })).toThrow(E2EPortPolicyError);
  });

  it.each([3100, 3010, 3110, 3020])("rejects live runtime port %i for the stub", (port) => {
    expect(() => resolveSessionE2EConfig({ CRM_E2E_STUB_PORT: String(port) })).toThrow(E2EPortPolicyError);
  });

  it("allows a reserved port only under the explicit emergency override", () => {
    expect(() => resolveSessionE2EConfig({ CRM_E2E_PORT: "3010" })).toThrow();
    const c = resolveSessionE2EConfig({ CRM_E2E_PORT: "3010", [EMERGENCY_OVERRIDE_ENV]: "true" });
    expect(c.crmPort).toBe(3010);
  });

  it("rejects a malformed or out-of-range port", () => {
    for (const bad of ["abc", "-1", "0", "70000", "30.5"]) {
      expect(() => resolveSessionE2EConfig({ CRM_E2E_PORT: bad })).toThrow(E2EPortPolicyError);
    }
  });

  it("rejects identical CRM and stub ports", () => {
    expect(() => resolveSessionE2EConfig({ CRM_E2E_PORT: "3055", CRM_E2E_STUB_PORT: "3055" })).toThrow(
      E2EPortPolicyError,
    );
  });

  it("derives baseURL and backendOrigin from one resolution — they cannot diverge", () => {
    const c = resolveSessionE2EConfig({ CRM_E2E_PORT: "3061", CRM_E2E_STUB_PORT: "3262" });
    expect(c.baseURL).toBe(`http://${c.host}:${c.crmPort}`);
    expect(c.backendOrigin).toBe(`http://${c.host}:${c.stubPort}`);
    expect(c.baseURL).not.toBe(c.backendOrigin);
  });

  it("exposes a leak-canary token that tracks the configured stub port", () => {
    // Guards the defect this repair uncovered: leak assertions used the literal
    // "3110". Had the port moved without them, they would pass vacuously.
    expect(BACKEND_PORT_TOKEN).toBe(String(SESSION_E2E.stubPort));
    expect(SESSION_E2E.backendOrigin).toContain(BACKEND_PORT_TOKEN);
  });
});
