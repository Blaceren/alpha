/**
 * G4-GROWTH §16/§68 — enabling one provider event family must not enable
 * another, and everything defaults OFF.
 */
import { describe, expect, it } from "vitest";
import {
  isPocketDepIngestEnabled,
  isPocketRdepIngestEnabled,
  isPocketRegIngestEnabled,
  readPocketIngressSwitches,
  resolveRedepositCapability,
} from "./ingress-config";

/**
 * A `ProcessEnv` the type checker accepts.
 *
 * `NodeJS.ProcessEnv` requires `NODE_ENV`, so an object literal of only the
 * flags under test is not assignable to it. Spreading a base here keeps the
 * cases readable and avoids an `as unknown as` cast that would also silence a
 * genuine mistake.
 */
function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...overrides } as NodeJS.ProcessEnv;
}

/** A minimally valid Pocket integration, with every family still off. */
const MASTER_ON = env({
  POCKET_POSTBACK_ENABLED: "true",
  POSTBACK_SECRET: "a-sufficiently-long-postback-secret",
});

describe("Pocket ingest switches", () => {
  it("defaults every family to OFF on an empty environment", () => {
    const empty = env();
    expect(isPocketRegIngestEnabled(empty)).toBe(false);
    expect(isPocketDepIngestEnabled(empty)).toBe(false);
    expect(isPocketRdepIngestEnabled(empty)).toBe(false);
  });

  /**
   * The §16 regression. Before this phase, turning the integration on admitted
   * `goal=reg` by itself.
   */
  it("does not enable any family from the master gate alone", () => {
    expect(isPocketRegIngestEnabled(MASTER_ON)).toBe(false);
    expect(isPocketDepIngestEnabled(MASTER_ON)).toBe(false);
    expect(isPocketRdepIngestEnabled(MASTER_ON)).toBe(false);
  });

  it("enables REG without enabling DEP or RDEP", () => {
    const env = { ...MASTER_ON, POCKET_REG_INGEST_ENABLED: "true" };
    expect(isPocketRegIngestEnabled(env)).toBe(true);
    expect(isPocketDepIngestEnabled(env)).toBe(false);
    expect(isPocketRdepIngestEnabled(env)).toBe(false);
  });

  it("enables RDEP ingress without enabling REG or DEP", () => {
    const env = { ...MASTER_ON, POCKET_RDEP_INGEST_ENABLED: "true" };
    expect(isPocketRdepIngestEnabled(env)).toBe(true);
    expect(isPocketRegIngestEnabled(env)).toBe(false);
    expect(isPocketDepIngestEnabled(env)).toBe(false);
  });

  it("requires the accepted first-deposit resolution as well for DEP", () => {
    // `POCKET_FIRST_DEPOSIT_ENABLED` owns the deposit CURRENCY contract and is
    // not replaced. Both are required, which is strictly narrowing.
    const withoutAccepted = { ...MASTER_ON, POCKET_DEP_INGEST_ENABLED: "true" };
    expect(isPocketDepIngestEnabled(withoutAccepted)).toBe(false);

    const both = { ...withoutAccepted, POCKET_FIRST_DEPOSIT_ENABLED: "true" };
    expect(isPocketDepIngestEnabled(both)).toBe(true);
  });

  it("cannot enable a family while the master gate is off", () => {
    const noMaster = env({
      POCKET_REG_INGEST_ENABLED: "true",
      POCKET_DEP_INGEST_ENABLED: "true",
      POCKET_RDEP_INGEST_ENABLED: "true",
      POCKET_FIRST_DEPOSIT_ENABLED: "true",
    });
    expect(isPocketRegIngestEnabled(noMaster)).toBe(false);
    expect(isPocketDepIngestEnabled(noMaster)).toBe(false);
    expect(isPocketRdepIngestEnabled(noMaster)).toBe(false);
  });

  it.each(["TRUE", "1", "yes", "on", "", " true"])(
    "treats %s as OFF — only the exact literal true enables",
    (value) => {
      expect(isPocketRegIngestEnabled({ ...MASTER_ON, POCKET_REG_INGEST_ENABLED: value })).toBe(
        false,
      );
    },
  );

  it("reports every switch in one snapshot for the health surface", () => {
    const switches = readPocketIngressSwitches({ ...MASTER_ON, POCKET_REG_INGEST_ENABLED: "true" });
    expect(switches.masterEnabled).toBe(true);
    expect(switches.regEnabled).toBe(true);
    expect(switches.depEnabled).toBe(false);
    expect(switches.rdepEnabled).toBe(false);
    // RDEP-AVAIL-1. The snapshot carries the CAPABILITY now, not the superseded
    // provider-event-id contract, and it must say why it is off.
    expect(switches.redepositCapability).toEqual({
      kind: "unavailable",
      reason: "redeposit_ingest_disabled",
    });
  });
});

/**
 * RDEP-AVAIL-1 — the redeposit CAPABILITY, which replaced the redeposit
 * IDENTITY POLICY.
 *
 * WHAT WAS HERE BEFORE. Two describe blocks, seventeen assertions, all about
 * `resolveRedepositIdentityPolicy`: that it was "unavailable by default, which
 * is why no canonical rdep can be emitted", that it "becomes available only
 * when an operator names a parameter", that forbidden names were refused, and
 * that a mixed-case name was rejected loudly rather than lower-cased.
 *
 * Every one of those guarded a nomination mechanism for a PROVIDER-ISSUED event
 * id. The accepted product decision removed the mechanism: ATA derives its own
 * deterministic identity, so there is no parameter to name, no forbidden list
 * to enforce, and no casing rule to get wrong. Keeping the tests would have
 * required keeping dead code to satisfy them.
 *
 * WHAT REPLACES THEM is the question that now actually gates counting, tested
 * in both directions — because an availability surface that claims a capability
 * the deployment lacks is the same defect as one that denies a capability it
 * has.
 */
describe("redeposit capability", () => {
  it("is unavailable when Pocket is not integrated at all", () => {
    expect(resolveRedepositCapability(env())).toEqual({
      kind: "unavailable",
      reason: "master_gate_disabled",
    });
  });

  it("is unavailable, and says why, when the master gate is on but RDEP is off", () => {
    expect(resolveRedepositCapability(MASTER_ON)).toEqual({
      kind: "unavailable",
      reason: "redeposit_ingest_disabled",
    });
  });

  it("is available when the master gate and the RDEP family are both on", () => {
    expect(
      resolveRedepositCapability({ ...MASTER_ON, POCKET_RDEP_INGEST_ENABLED: "true" }),
    ).toEqual({ kind: "available" });
  });

  it("never reports the superseded provider-contract reason", () => {
    // The RDEP-AVAIL-1 lock. Pocket issuing no unique deposit id is not a
    // missing capability, and must never again be reported as one.
    for (const e of [env(), MASTER_ON, { ...MASTER_ON, POCKET_RDEP_INGEST_ENABLED: "true" }]) {
      const r = resolveRedepositCapability(e);
      if (r.kind === "unavailable") {
        expect(r.reason as string).not.toBe("provider_event_identity_contract_absent");
      }
    }
  });

  it("cannot be switched on by the RDEP family alone", () => {
    expect(resolveRedepositCapability(env({ POCKET_RDEP_INGEST_ENABLED: "true" })).kind).toBe(
      "unavailable",
    );
  });
});
