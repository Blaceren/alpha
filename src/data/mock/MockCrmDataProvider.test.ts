import { describe, expect, it } from "vitest";
import { MockCrmDataProvider } from "./MockCrmDataProvider";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";

const ctx: CrmContext = {
  actorId: "emp_mock_admin",
  role: "crm_admin",
  now: new Date().toISOString(),
};

describe("MockCrmDataProvider", () => {
  it("returns synthetic users on the happy path", async () => {
    const provider = new MockCrmDataProvider();
    const res = await provider.searchUsers(ctx, {});
    expect(res.status).toBe("ok");
    expect(res.error).toBeNull();
    expect(res.data?.items.length).toBeGreaterThan(0);
  });

  it("surfaces a discriminated CrmError in error mode", async () => {
    const provider = new MockCrmDataProvider({ errorMode: true });
    const res = await provider.searchUsers(ctx, {});
    expect(res.status).toBe("error");
    expect(res.data).toBeNull();
    expect(res.error?.code).toBe("upstream_unavailable");
    expect(res.error?.retriable).toBe(true);
  });

  it("returns not_found for an unknown user", async () => {
    const provider = new MockCrmDataProvider();
    const res = await provider.getUserById(ctx, { userId: "does_not_exist" });
    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("not_found");
    expect(res.error?.retriable).toBe(false);
  });

  it("returns empty (not error) for unimplemented collections", async () => {
    const provider = new MockCrmDataProvider();
    const res = await provider.getUserTasks(ctx, { userId: "usr_mock_001" });
    expect(res.status).toBe("empty");
    expect(res.data?.items).toEqual([]);
  });
});
