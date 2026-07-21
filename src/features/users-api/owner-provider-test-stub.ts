/**
 * Test-only helpers for the three CRM Owner provider methods.
 *
 * Existing Users/Detail/Notes tests predate the Owner slice and build partial
 * `CrmUsersReadCapability` stubs. Now that the Detail workspace mounts the Owner
 * section, those stubs must also satisfy the three owner methods. These helpers
 * keep that addition uniform and honest:
 *
 *   - `pristineOwnerMethods` answers the current-owner read with the pristine
 *     null/version-0 state and refuses candidate/mutation calls — enough for a
 *     Detail test that does not exercise assignment.
 *   - `throwingOwnerMethods` throws on every owner method, for suites (Users
 *     list, Notes-in-isolation) that must never touch owner data at all.
 *
 * This module is imported only by tests.
 */
import type {
  OwnerCandidatesOutcome,
  OwnerMutationOutcome,
  OwnerReadOutcome,
} from "@/application/api/user-owner-client";

export interface OwnerProviderMethods {
  getUserOwner: (userId: string) => Promise<OwnerReadOutcome>;
  listOwnerCandidates: () => Promise<OwnerCandidatesOutcome>;
  setUserOwner: (
    userId: string,
    ownerEmployeeId: string | null,
    expectedVersion: number,
  ) => Promise<OwnerMutationOutcome>;
}

export function pristineOwnerMethods(): OwnerProviderMethods {
  return {
    getUserOwner: async () => ({ status: "success", owner: { owner: null, ownerVersion: 0 } }),
    listOwnerCandidates: async () => ({ status: "forbidden" }),
    setUserOwner: () => {
      throw new Error("this test must not call setUserOwner");
    },
  };
}

export function throwingOwnerMethods(): OwnerProviderMethods {
  return {
    getUserOwner: () => {
      throw new Error("this test must not call getUserOwner");
    },
    listOwnerCandidates: () => {
      throw new Error("this test must not call listOwnerCandidates");
    },
    setUserOwner: () => {
      throw new Error("this test must not call setUserOwner");
    },
  };
}
