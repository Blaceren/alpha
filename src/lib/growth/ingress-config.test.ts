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
  resolveRedepositIdentityPolicy,
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
  });
});

describe("redeposit identity policy", () => {
  it("is unavailable by default, which is why no canonical rdep can be emitted", () => {
    expect(resolveRedepositIdentityPolicy(env())).toEqual({
      kind: "unavailable",
      reason: "provider_event_identity_contract_absent",
    });
  });

  it("becomes available only when an operator names a parameter", () => {
    expect(
      resolveRedepositIdentityPolicy(env({
        POCKET_RDEP_EVENT_ID_PARAM: "transaction_id",
      })),
    ).toEqual({ kind: "available", parameterName: "transaction_id" });
  });

  /**
   * The important refusals. Each of these would produce a key that REPEATS
   * across a player's deposits, silently collapsing real money into one row.
   */
  it.each(["playerid", "clickid", "click_id", "sum", "sumdep", "date_time", "datetime", "date", "goal"])(
    "refuses %s, which is not an event identity",
    (param) => {
      expect(
        resolveRedepositIdentityPolicy(env({
          POCKET_RDEP_EVENT_ID_PARAM: param,
      })).kind,
      ).toBe("unavailable");
    },
  );

  it.each(["ow", "secret", "token"])(
    "refuses %s, which would route the credential into a stored column and a unique index",
    (param) => {
      expect(
        resolveRedepositIdentityPolicy(env({
          POCKET_RDEP_EVENT_ID_PARAM: param,
      })).kind,
      ).toBe("unavailable");
    },
  );

  it.each(["", "   ", "9lives", "has space", "a".repeat(80), "x;y", "-lead", "_lead"])(
    "resolves the malformed value %s to unavailable rather than to a default",
    (param) => {
      expect(
        resolveRedepositIdentityPolicy(env({
          POCKET_RDEP_EVENT_ID_PARAM: param,
      })).kind,
      ).toBe("unavailable");
    },
  );

  /**
   * The configured name is lower-cased and trimmed, matching how
   * `sanitizeProviderQuery` normalises incoming keys. Asserted explicitly
   * because it has a consequence worth knowing: `readProviderEventIdentity`
   * reads the NORMALISED name from the query, so a provider sending an
   * upper-case parameter finds no identity and the delivery falls through to
   * `identity_unresolved` — fail-closed, never a silent mis-key.
   */
  it("normalises the configured parameter name to lower case", () => {
    expect(
      resolveRedepositIdentityPolicy(env({
        POCKET_RDEP_EVENT_ID_PARAM: "  Transaction_ID  ",
      })),
    ).toEqual({ kind: "available", parameterName: "transaction_id" });
  });

  it("refuses a forbidden name however it is cased", () => {
    for (const raw of ["OW", "Ow", "SUM", "PlayerId"]) {
      expect(
        resolveRedepositIdentityPolicy(env({
          POCKET_RDEP_EVENT_ID_PARAM: raw,
      })).kind,
      ).toBe("unavailable");
    }
  });
});
