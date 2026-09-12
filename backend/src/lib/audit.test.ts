import { describe, it, expect, vi, beforeEach } from "vitest";

const auditLogCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: {
      create: (...args: unknown[]) => auditLogCreate(...args),
    },
  },
}));

import { createAuditLog, createAuditLogStrict } from "@/lib/audit";

describe("createAuditLog (best-effort)", () => {
  beforeEach(() => {
    auditLogCreate.mockReset();
  });

  it("resolves normally when persistence succeeds", async () => {
    auditLogCreate.mockResolvedValueOnce({ id: "row-1" });

    await expect(
      createAuditLog({ action: "SOME_EVENT", entityType: "TEST", entityId: "1" }),
    ).resolves.toBeUndefined();

    expect(auditLogCreate).toHaveBeenCalledTimes(1);
  });

  it("swallows a persistence failure and does not throw (unchanged existing behavior)", async () => {
    auditLogCreate.mockRejectedValueOnce(new Error("db unavailable"));

    await expect(
      createAuditLog({ action: "SOME_EVENT", entityType: "TEST", entityId: "1" }),
    ).resolves.toBeUndefined();
  });
});

describe("createAuditLogStrict", () => {
  beforeEach(() => {
    auditLogCreate.mockReset();
  });

  it("resolves normally when persistence succeeds", async () => {
    auditLogCreate.mockResolvedValueOnce({ id: "row-1" });

    await expect(
      createAuditLogStrict({ action: "SOME_EVENT", entityType: "TEST", entityId: "1" }),
    ).resolves.toBeUndefined();
  });

  it("rethrows when persistence fails (fail-closed contract)", async () => {
    const dbError = new Error("db unavailable");
    auditLogCreate.mockRejectedValueOnce(dbError);

    await expect(
      createAuditLogStrict({ action: "SOME_EVENT", entityType: "TEST", entityId: "1" }),
    ).rejects.toThrow("db unavailable");
  });
});
