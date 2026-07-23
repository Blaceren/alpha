/**
 * Shared auth constants (safe for both server and client bundles).
 * The session cookie is httpOnly — this name is used only for presence checks
 * in the middleware/guard and for forwarding, never to read the token value.
 */
export const SESSION_COOKIE_NAME = "trading_platform_session";

/** Header set by middleware so the server guard knows the requested path. */
export const PATHNAME_HEADER = "x-academy-pathname";
