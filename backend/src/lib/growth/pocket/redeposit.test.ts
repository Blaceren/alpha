/**
 * POCKET-DEP-RDEP-1 — redeposit field parsing, and the identity that replaced
 * the provider-event-id contract.
 *
 * WHAT THIS FILE USED TO TEST. Two describe blocks asserted the superseded
 * design: that ATA read a redeposit's identity from a parameter an operator
 * nominated in `POCKET_RDEP_EVENT_ID_PARAM`, ignored any caller-supplied id
 * when no contract was configured, and otherwise "cannot distinguish a retry
 * from a second identical deposit". That premise was rejected — waiting for an
 * identifier Pocket does not publish meant redeposits were never counted — so
 * `readProviderEventIdentity` and `resolveRedepositIdentityPolicy` no longer
 * exist and those tests went with them.
 *
 * WHAT REPLACED IT. ATA derives its own deterministic identity from the
 * authenticated provider attributes. The depth of that contract — 15 assertions
 * covering retries, concurrency, collisions and temporal authority — lives in
 * scripts/regression/redepositDeterministicIdentityRegression.ts, which is the
 * suite to read and to extend. What remains here is the field parsing that
 * still guards the delivery itself, plus a short statement of the accepted
 * identity shape so this file cannot silently drift back to the old model.
 */
import { describe, expect, it } from "vitest";
import { parseRedepositFields } from "./redeposit";
import {
  BUSINESS_ACCEPTED_RDEP_DEDUP_ASSUMPTION,
  deriveRedepositEventKey,
} from "./redeposit-identity";
/**
 * A `ProcessEnv` the type checker accepts — `NodeJS.ProcessEnv` requires
 * `NODE_ENV`, so a bare flag literal is not assignable to it.
 */
function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...overrides } as NodeJS.ProcessEnv;
}

const CLICK = "tq-0123abcd-4567-89ab-cdef-0123456789ab";

function query(overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    goal: "redep",
    clickid: CLICK,
    playerid: "42",
    sum: "25.00",
    ...overrides,
  });
}

describe("redeposit field parsing", () => {
  it("accepts a well-formed delivery", () => {
    expect(parseRedepositFields(query())).toEqual({
      ok: true,
      clickId: CLICK,
      playerId: "42",
      sum: "25.00",
    });
  });

  it("refuses an ambiguous duplicated field rather than picking one", () => {
    const params = query();
    params.append("sum", "9999.00");
    expect(parseRedepositFields(params)).toEqual({ ok: false, reason: "ambiguous_param" });
  });

  it.each([
    ["clickid", "not-a-click-id", "invalid_click_id"],
    ["clickid", "tq-0123abcd", "invalid_click_id"],
    ["playerid", "0", "invalid_player_id"],
    ["playerid", "01", "invalid_player_id"],
    ["playerid", "abc", "invalid_player_id"],
    ["playerid", "-5", "invalid_player_id"],
  ])("refuses %s=%s", (key, value, reason) => {
    expect(parseRedepositFields(query({ [key]: value }))).toEqual({ ok: false, reason });
  });

  it("refuses a missing required field", () => {
    const noSum = query();
    noSum.delete("sum");
    expect(parseRedepositFields(noSum)).toEqual({ ok: false, reason: "missing_sum" });

    const noPlayer = query();
    noPlayer.delete("playerid");
    expect(parseRedepositFields(noPlayer)).toEqual({ ok: false, reason: "missing_player_id" });

    const noClick = query();
    noClick.delete("clickid");
    expect(parseRedepositFields(noClick)).toEqual({ ok: false, reason: "missing_click_id" });
  });
});

describe("the accepted redeposit identity", () => {
  const ok = (r: ReturnType<typeof deriveRedepositEventKey>) => {
    if (!r.ok) throw new Error(`expected a key, got ${r.reason}`);
    return r;
  };

  it("is derived by ATA, from the authenticated provider attributes", () => {
    const r = ok(
      deriveRedepositEventKey({
        pocketPlayerId: "42",
        rawEventTime: "2026-08-14 18:51:17",
        rawAmount: "25.00",
      }),
    );
    expect(r.key).toBe("v1:pocket:redeposit:42:2026-08-14T18:51:17:25.00");
    expect(r.normalisedAmount).toBe("25.00");
  });

  it("excludes clickid — that identifies the journey, not the deposit", () => {
    const r = ok(
      deriveRedepositEventKey({
        pocketPlayerId: "42",
        rawEventTime: "2026-08-14 18:51:17",
        rawAmount: "25.00",
      }),
    );
    expect(r.key).not.toContain(CLICK);
  });

  it("fails closed with no usable event time — DATE_TIME is required", () => {
    // The old model emitted nothing at all without a provider event id. The new
    // one emits nothing without a DATE_TIME, because the key is derived from it.
    const r = deriveRedepositEventKey({
      pocketPlayerId: "42",
      rawEventTime: undefined,
      rawAmount: "25.00",
    });
    expect(r.ok).toBe(false);
  });

  it("names its collision cost out loud rather than implying uniqueness", () => {
    // The old design's objection to (player, time, amount) was real and is not
    // dismissed: two distinct redeposits matching on all three collapse into
    // one. That is an ACCEPTED BUSINESS ASSUMPTION and an ATA-derived identity,
    // never provider-guaranteed uniqueness — and it is what makes retries safe.
    expect(BUSINESS_ACCEPTED_RDEP_DEDUP_ASSUMPTION).toBeTruthy();
    const args = {
      pocketPlayerId: "42",
      rawEventTime: "2026-08-14 18:51:17",
      rawAmount: "25.00",
    } as const;
    expect(ok(deriveRedepositEventKey({ ...args })).key).toBe(
      ok(deriveRedepositEventKey({ ...args })).key,
    );
  });
});
