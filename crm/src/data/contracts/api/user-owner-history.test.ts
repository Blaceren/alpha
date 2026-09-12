import { describe, expect, it } from "vitest";
import {
  crmApiOwnerHistoryItemSchema,
  crmApiOwnerHistoryPageSchema,
  crmApiOwnerHistoryErrorSchema,
  CRM_OWNER_TRANSITIONS,
} from "./user-owner-history";

const actor = (over: Record<string, unknown> = {}) => ({
  employeeId: "emp_1",
  displayName: "Нина Ч.",
  ...over,
});

const item = (over: Record<string, unknown> = {}) => ({
  historyId: "h_1",
  transition: "assigned",
  ownerVersion: 1,
  createdAt: "2026-07-20T18:42:00.000Z",
  actor: actor(),
  previousOwner: null,
  nextOwner: actor({ employeeId: "emp_2", displayName: "Пётр О." }),
  ...over,
});

describe("crmApiOwnerHistoryItemSchema — accepts the valid shape", () => {
  it("accepts an assign, reassign and unassign row", () => {
    expect(crmApiOwnerHistoryItemSchema.safeParse(item()).success).toBe(true);
    expect(
      crmApiOwnerHistoryItemSchema.safeParse(
        item({ transition: "reassigned", ownerVersion: 2, previousOwner: actor(), nextOwner: actor({ employeeId: "emp_3", displayName: "Q" }) }),
      ).success,
    ).toBe(true);
    expect(
      crmApiOwnerHistoryItemSchema.safeParse(
        item({ transition: "unassigned", ownerVersion: 3, previousOwner: actor(), nextOwner: null }),
      ).success,
    ).toBe(true);
  });

  it("exposes exactly the three transition kinds", () => {
    expect([...CRM_OWNER_TRANSITIONS]).toEqual(["assigned", "reassigned", "unassigned"]);
  });
});

describe("crmApiOwnerHistoryItemSchema — rejects unsafe or malformed shapes", () => {
  it("rejects any extra field (strict) — no private leak passes validation", () => {
    for (const extra of [
      { email: "a@b.c" },
      { actorStaffId: "emp_1" },
      { previousOwnerId: "emp_1" },
      { nextOwnerId: "emp_2" },
      { ipAddress: "1.2.3.4" },
      { userAgent: "curl" },
      { staffRole: "crm_admin" },
      { reason: "because" },
      { metadata: {} },
      { updatedAt: "2026-07-20T18:42:00.000Z" },
    ]) {
      expect(crmApiOwnerHistoryItemSchema.safeParse(item(extra)).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it("rejects an unknown transition and a non-enum action string", () => {
    expect(crmApiOwnerHistoryItemSchema.safeParse(item({ transition: "deleted" })).success).toBe(false);
    expect(crmApiOwnerHistoryItemSchema.safeParse(item({ transition: "assign" })).success).toBe(false);
  });

  it("rejects a non-positive or non-integer ownerVersion", () => {
    expect(crmApiOwnerHistoryItemSchema.safeParse(item({ ownerVersion: 0 })).success).toBe(false);
    expect(crmApiOwnerHistoryItemSchema.safeParse(item({ ownerVersion: -1 })).success).toBe(false);
    expect(crmApiOwnerHistoryItemSchema.safeParse(item({ ownerVersion: 1.5 })).success).toBe(false);
  });

  it("rejects a non-datetime createdAt", () => {
    expect(crmApiOwnerHistoryItemSchema.safeParse(item({ createdAt: "yesterday" })).success).toBe(false);
  });

  it("rejects a blank-after-trim actor/owner display name", () => {
    expect(crmApiOwnerHistoryItemSchema.safeParse(item({ actor: actor({ displayName: "   " }) })).success).toBe(false);
    expect(crmApiOwnerHistoryItemSchema.safeParse(item({ nextOwner: actor({ displayName: "" }) })).success).toBe(false);
  });

  it("rejects a staff reference carrying an extra field", () => {
    expect(
      crmApiOwnerHistoryItemSchema.safeParse(item({ actor: actor({ staffRole: "support" }) })).success,
    ).toBe(false);
  });
});

describe("crmApiOwnerHistoryPageSchema", () => {
  it("accepts an empty page and a populated page", () => {
    expect(crmApiOwnerHistoryPageSchema.safeParse({ items: [], nextCursor: null }).success).toBe(true);
    expect(crmApiOwnerHistoryPageSchema.safeParse({ items: [item()], nextCursor: "abc" }).success).toBe(true);
  });

  it("rejects a total-count field or any extra key", () => {
    expect(crmApiOwnerHistoryPageSchema.safeParse({ items: [], nextCursor: null, total: 0 }).success).toBe(false);
    expect(crmApiOwnerHistoryPageSchema.safeParse({ items: [], nextCursor: null, totalCount: 0 }).success).toBe(false);
  });

  it("rejects an empty-string cursor (min length 1) — only a real cursor or null", () => {
    expect(crmApiOwnerHistoryPageSchema.safeParse({ items: [], nextCursor: "" }).success).toBe(false);
  });
});

describe("crmApiOwnerHistoryErrorSchema", () => {
  it("accepts the safe envelope and rejects extra keys", () => {
    expect(
      crmApiOwnerHistoryErrorSchema.safeParse({ code: "not_found", messageKey: "x", requestId: "r" }).success,
    ).toBe(true);
    expect(
      crmApiOwnerHistoryErrorSchema.safeParse({ code: "not_found", messageKey: "x", requestId: "r", stack: "y" }).success,
    ).toBe(false);
  });
});
