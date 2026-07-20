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

/**
 * The capability the users-list application boundary needs — and nothing else.
 * A future slice adds a capability by adding a method here, deliberately.
 */
export interface CrmUsersReadCapability {
  listUsers(input: FetchUsersInput, options?: FetchUsersOptions): Promise<UsersOutcome>;
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
export const API_SUPPORTED_CAPABILITIES = ["listUsers"] as const;
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
   * `fetchImpl` is an injection seam for tests. Production passes nothing and
   * the real client is used, which itself calls only a relative URL.
   */
  constructor(private readonly client: typeof fetchUsers = fetchUsers) {}

  listUsers(input: FetchUsersInput, options?: FetchUsersOptions): Promise<UsersOutcome> {
    assertApiCapability("listUsers");
    return this.client(input, options);
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
export function createApiCrmDataProvider(client?: typeof fetchUsers): ApiCrmDataProvider {
  return new ApiCrmDataProvider(client);
}
