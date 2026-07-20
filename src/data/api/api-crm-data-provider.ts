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
import {
  createUserNote,
  fetchUserNotes,
  type FetchUserNotesInput,
  type FetchUserNotesOptions,
  type NoteCreateOutcome,
  type NotesListOutcome,
} from "@/application/api/user-notes-client";

/**
 * The capabilities the production application boundary needs — and nothing
 * else. A future slice adds a capability by adding a method here, deliberately.
 */
export interface CrmUsersReadCapability {
  listUsers(input: FetchUsersInput, options?: FetchUsersOptions): Promise<UsersOutcome>;
  getUserDetail(userId: string, options?: FetchUserDetailOptions): Promise<UserDetailOutcome>;
  listUserNotes(
    userId: string,
    input?: FetchUserNotesInput,
    options?: FetchUserNotesOptions,
  ): Promise<NotesListOutcome>;
  /**
   * The first production WRITE capability, added narrowly and deliberately.
   * It appends one immutable note and nothing else — it is NOT a foothold for
   * the broad mock mutation provider, which stays unavailable in api mode.
   */
  createUserNote(
    userId: string,
    body: string,
    options?: FetchUserNotesOptions,
  ): Promise<NoteCreateOutcome>;
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
        "Only the Users v1 list, user detail and immutable user notes are " +
        "connected; every other CRM data API arrives in a later phase.",
    );
    this.name = "UnsupportedApiCapability";
  }
}

/** The capabilities that exist in api mode. Everything else fails closed. */
export const API_SUPPORTED_CAPABILITIES = [
  "listUsers",
  "getUserDetail",
  "listUserNotes",
  "createUserNote",
] as const;
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
    private readonly notesListClient: typeof fetchUserNotes = fetchUserNotes,
    private readonly noteCreateClient: typeof createUserNote = createUserNote,
  ) {}

  listUsers(input: FetchUsersInput, options?: FetchUsersOptions): Promise<UsersOutcome> {
    assertApiCapability("listUsers");
    return this.listClient(input, options);
  }

  getUserDetail(userId: string, options?: FetchUserDetailOptions): Promise<UserDetailOutcome> {
    assertApiCapability("getUserDetail");
    return this.detailClient(userId, options);
  }

  listUserNotes(
    userId: string,
    input: FetchUserNotesInput = {},
    options?: FetchUserNotesOptions,
  ): Promise<NotesListOutcome> {
    assertApiCapability("listUserNotes");
    return this.notesListClient(userId, input, options);
  }

  createUserNote(
    userId: string,
    body: string,
    options?: FetchUserNotesOptions,
  ): Promise<NoteCreateOutcome> {
    assertApiCapability("createUserNote");
    return this.noteCreateClient(userId, body, options);
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
  notesListClient?: typeof fetchUserNotes,
  noteCreateClient?: typeof createUserNote,
): ApiCrmDataProvider {
  return new ApiCrmDataProvider(listClient, detailClient, notesListClient, noteCreateClient);
}
