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

/**
 * Backend `POST /api/auth/register` 201 body (AFD-3A).
 *
 * The owner also returns `verification.devToken` when email verification is
 * required AND `NODE_ENV !== "production"`. It is deliberately absent from this
 * consumed type: it is a credential-grade value, the Academy has no legitimate
 * use for it, and reading it would risk it reaching the browser or a log.
 */
export type BackendRegisterResponse = {
  user: BackendPublicUser;
  verification: {
    /**
     * `true` when Backend requires email verification before login. Backend
     * issues the session cookie only when this is `false`, so it is the single
     * authoritative signal for what the success state may claim.
     */
    required: boolean;
  };
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

export function isBackendRegisterResponse(value: unknown): value is BackendRegisterResponse {
  if (!isObject(value)) return false;
  if (!("user" in value) || !isBackendPublicUser(value.user)) return false;
  const verification = value.verification;
  if (!isObject(verification)) return false;
  return typeof verification.required === "boolean";
}

export function isBackendCsrfResponse(value: unknown): value is BackendCsrfResponse {
  return isObject(value) && typeof value.csrfToken === "string" && value.csrfToken.length > 0;
}
