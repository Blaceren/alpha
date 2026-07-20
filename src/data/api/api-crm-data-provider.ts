/**
 * ApiCrmDataProvider — the production data boundary.
 *
 * It implements exactly ONE capability: the Users v1 list read. It deliberately
 * does NOT implement the broad `CrmDataProvider` interface. That interface was
 * shaped by the mock product (Today, User 360, notes, owner, audit, segments,
 * queues), and claiming to implement it would mean writing methods that either
 * lie or throw. Narrowing by capability makes the unsupported operations
 * unreachable at compile time rather than merely guarded at runtime.
 *
 * This module never imports MockCrmDataProvider, never touches mock fixtures and
 * never constructs a mock `UserSummary`.
 */
import {
  fetchUsers,
  type FetchUsersInput,
  type FetchUsersOptions,
  type UsersOutcome,
} from "@/application/api/users-client";
import {
  fetchUserDetail,
  type FetchUserDetailOptions,
  type UserDetailOutcome,
} from "@/application/api/user-detail-client";

/**
 * The capabilities the production application boundary needs — and nothing
 * else. A future slice adds a capability by adding a method here, deliberately.
 */
export interface CrmUsersReadCapability {
  listUsers(input: FetchUsersInput, options?: FetchUsersOptions): Promise<UsersOutcome>;
  getUserDetail(userId: string, options?: FetchUserDetailOptions): Promise<UserDetailOutcome>;
}

/**
 * Thrown when something reaches for a capability this provider does not have.
 * Used by `assertApiCapability` so an unsupported operation fails loudly rather
 * than quietly returning empty, mock-compatible data — an empty list would look
 * like "this learner has no notes" instead of "notes are not connected yet".
 */
export class UnsupportedApiCapability extends Error {
  constructor(readonly capability: string) {
    super(
      `CRM capability "${capability}" is not available in api mode. ` +
        "Only the Users v1 list read is connected; every other CRM data API " +
        "arrives in a later phase.",
    );
    this.name = "UnsupportedApiCapability";
  }
}

/** The capabilities that exist in api mode. Everything else fails closed. */
export const API_SUPPORTED_CAPABILITIES = ["listUsers", "getUserDetail"] as const;
export type ApiSupportedCapability = (typeof API_SUPPORTED_CAPABILITIES)[number];

/**
 * Fail-closed guard for any code path that might reach for CRM data in api
 * mode. The narrow interface already prevents this statically; this is the
 * runtime backstop and the thing tests assert against.
 */
export function assertApiCapability(capability: string): asserts capability is ApiSupportedCapability {
  if (!(API_SUPPORTED_CAPABILITIES as readonly string[]).includes(capability)) {
    throw new UnsupportedApiCapability(capability);
  }
}

export class ApiCrmDataProvider implements CrmUsersReadCapability {
  /**
   * The clients are injection seams for tests. Production passes nothing and
   * the real clients are used, each of which calls only a relative URL.
   */
  constructor(
    private readonly listClient: typeof fetchUsers = fetchUsers,
    private readonly detailClient: typeof fetchUserDetail = fetchUserDetail,
  ) {}

  listUsers(input: FetchUsersInput, options?: FetchUsersOptions): Promise<UsersOutcome> {
    assertApiCapability("listUsers");
    return this.listClient(input, options);
  }

  getUserDetail(userId: string, options?: FetchUserDetailOptions): Promise<UserDetailOutcome> {
    assertApiCapability("getUserDetail");
    return this.detailClient(userId, options);
  }
}

/**
 * The single construction point for the production provider.
 *
 * It takes no session argument on purpose — the provider carries no identity.
 * Authorization travels with the same-origin cookie and is decided by the
 * backend. What the caller must guarantee is *when* this is constructed: only
 * beneath a validated session boundary, which is enforced structurally because
 * the only caller is rendered inside `SessionBoundary`'s authenticated branch.
 */
export function createApiCrmDataProvider(
  listClient?: typeof fetchUsers,
  detailClient?: typeof fetchUserDetail,
): ApiCrmDataProvider {
  return new ApiCrmDataProvider(listClient, detailClient);
}
