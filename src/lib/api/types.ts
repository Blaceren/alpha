/**
 * Wire DTOs for the Backend auth contract and narrow runtime type guards.
 *
 * We do not add a schema-validation dependency for CI-1; these explicit guards
 * validate exactly the fields the Academy consumes and nothing more.
 */

/** Subset of Backend `toPublicUser` output the Academy is willing to read. */
export type BackendPublicUser = {
  id: number;
  name: string;
  role: string;
  status?: string | null;
  // Backend also returns `email`, `level`, `xp`. They are intentionally NOT in
  // this consumed type: email is PII the auth foundation does not need, and
  // level/xp are progression authority (out of scope for CI-1).
};

export type BackendSessionResponse = {
  user: BackendPublicUser | null;
};

export type BackendCsrfResponse = {
  csrfToken: string;
};

export type BackendLoginResponse = {
  user: BackendPublicUser;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isBackendPublicUser(value: unknown): value is BackendPublicUser {
  if (!isObject(value)) return false;
  if (typeof value.id !== "number" || !Number.isFinite(value.id)) return false;
  if (typeof value.name !== "string") return false;
  if (typeof value.role !== "string") return false;
  if (
    value.status !== undefined &&
    value.status !== null &&
    typeof value.status !== "string"
  ) {
    return false;
  }
  return true;
}

export function isBackendSessionResponse(value: unknown): value is BackendSessionResponse {
  if (!isObject(value)) return false;
  if (!("user" in value)) return false;
  const user = value.user;
  return user === null || isBackendPublicUser(user);
}

export function isBackendLoginResponse(value: unknown): value is BackendLoginResponse {
  return isObject(value) && "user" in value && isBackendPublicUser(value.user);
}

export function isBackendCsrfResponse(value: unknown): value is BackendCsrfResponse {
  return isObject(value) && typeof value.csrfToken === "string" && value.csrfToken.length > 0;
}
