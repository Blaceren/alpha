import * as React from "react";
import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import { MockSessionProvider } from "@/components/crm-shell/session-context";
import type { UserFilters, UserSortField } from "@/data/contracts/CrmDataProvider";
import { useUsersQuery } from "./use-users-query";

const provider = () => new MockCrmDataProvider({ clock: new FixedMockClock(), delayMs: 0 });

// Exposes hook state + actions to the test via refs (no debounce delay).
function Harness({
  onReady,
  providerRef,
}: {
  onReady: (api: ReturnType<typeof useUsersQuery>) => void;
  providerRef: MockCrmDataProvider;
}) {
  const q = useUsersQuery(providerRef, 0);
  React.useEffect(() => {
    onReady(q);
  });
  return (
    <ul>
      {(q.result?.data?.items ?? []).map((u) => (
        <li key={u.id} data-testid="row">
          {u.id}
        </li>
      ))}
    </ul>
  );
}

async function setup() {
  let api!: ReturnType<typeof useUsersQuery>;
  const p = provider();
  render(
    <MockSessionProvider>
      <Harness providerRef={p} onReady={(a) => (api = a)} />
    </MockSessionProvider>,
  );
  await waitFor(() => expect(screen.getAllByTestId("row").length).toBeGreaterThan(0));
  return {
    get api() {
      return api;
    },
    ids: () => screen.queryAllByTestId("row").map((el) => el.textContent),
  };
}

describe("useUsersQuery — search", () => {
  it("searches by display name, masked email and id; supports no-results + reset", async () => {
    const t = await setup();
    await act(async () => t.api.setSearch("Nadia"));
    await waitFor(() => expect(t.ids()).toEqual(["usr_mock_001"]));

    await act(async () => t.api.setSearch("usr_mock_017"));
    await waitFor(() => expect(t.ids()).toEqual(["usr_mock_017"]));

    await act(async () => t.api.setSearch("y***@e***.test"));
    await waitFor(() => expect(t.ids()).toEqual(["usr_mock_017"]));

    await act(async () => t.api.setSearch("zzzzzz"));
    await waitFor(() => expect(t.ids()).toEqual([]));

    await act(async () => t.api.resetFilters());
    await waitFor(() => expect(t.ids().length).toBeGreaterThan(1));
  });
});

describe("useUsersQuery — five dimensions filter independently", () => {
  const cases: { name: string; patch: Partial<UserFilters>; expectAll: (id: string) => boolean }[] = [
    { name: "lifecycle", patch: { lifecycleStage: ["dormant"] }, expectAll: () => true },
    { name: "funding", patch: { fundingStatus: ["checkpoint_grace"] }, expectAll: () => true },
    { name: "engagement", patch: { engagementStatus: ["returned"] }, expectAll: () => true },
    { name: "valueSegment", patch: { valueSegment: ["frequent_repeat_funder"] }, expectAll: () => true },
    { name: "blocker", patch: { blocker: ["support_blocked"] }, expectAll: () => true },
  ];

  for (const c of cases) {
    it(`filters by ${c.name}`, async () => {
      const t = await setup();
      await act(async () => t.api.setFilters(c.patch));
      await waitFor(() => expect(t.ids().length).toBeGreaterThan(0));
      expect(t.ids().every((id) => c.expectAll(id!))).toBe(true);
    });
  }
});

describe("useUsersQuery — compound filters", () => {
  it("funding + engagement", async () => {
    const t = await setup();
    await act(async () => t.api.setFilters({ fundingStatus: ["funded"], engagementStatus: ["active"] }));
    await waitFor(() => expect(t.ids().length).toBeGreaterThan(0));
  });

  it("blocker + owner + lifecycle", async () => {
    const t = await setup();
    await act(async () =>
      t.api.setFilters({ blocker: ["support_blocked"], ownerId: ["emp_sup1"], lifecycleStage: ["at_risk"] }),
    );
    await waitFor(() => expect(t.ids()).toEqual(["usr_mock_026"]));
  });
});

describe("useUsersQuery — registrationStatus filter", () => {
  it("accepts registered / registration_pending / not_registered", async () => {
    const t = await setup();
    await act(async () => t.api.setFilters({ registrationStatus: ["registration_pending"] }));
    await waitFor(() => expect(t.ids()).toEqual(["usr_mock_002"]));

    await act(async () => t.api.setFilters({ registrationStatus: ["not_registered"] }));
    await waitFor(() => expect(t.ids()).toEqual(["usr_mock_001"]));

    await act(async () => t.api.setFilters({ registrationStatus: ["registered"] }));
    await waitFor(() => expect(t.ids().length).toBeGreaterThan(5));
  });
});

describe("useUsersQuery — sorting & pagination", () => {
  it("sorts by displayName and toggles direction", async () => {
    const t = await setup();
    const field: UserSortField = "name";
    await act(async () => t.api.setSort(field));
    await waitFor(() => expect(t.ids().length).toBeGreaterThan(0));
    expect(t.api.state.sort).toEqual({ field: "name", dir: "asc" });
    await act(async () => t.api.setSort(field));
    expect(t.api.state.sort).toEqual({ field: "name", dir: "desc" });
  });

  it("paginates 20 then 50 and resets page after filtering", async () => {
    const t = await setup();
    // default pageSize 20 → 20 rows of 30
    await waitFor(() => expect(t.ids().length).toBe(20));
    await act(async () => t.api.setPageIndex(1));
    await waitFor(() => expect(t.ids().length).toBe(10)); // remaining 10
    await act(async () => t.api.setPageSize(50));
    await waitFor(() => expect(t.ids().length).toBe(30));
    await act(async () => t.api.setPageSize(20));
    await act(async () => t.api.setPageIndex(1));
    await act(async () => t.api.setFilters({ fundingStatus: ["funded"] }));
    // page resets to 0
    await waitFor(() => expect(t.api.state.pageIndex).toBe(0));
  });
});
