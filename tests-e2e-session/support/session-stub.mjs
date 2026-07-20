/**
 * Deterministic backend session stub — TEST ONLY.
 *
 * Stands in for the real backend for the API-mode session E2E suite. The real
 * backend has no DEV database or environment yet, and this phase must not start
 * one, so the proxy and session boundary are proved against a stub that
 * implements exactly one route:
 *
 *   GET /api/crm/v1/session
 *
 * Which response it returns is selected by the `ata_test_crm_session_state`
 * cookie. That mechanism lives entirely here, in the harness: production session
 * client code has no test headers, no test query parameters and no knowledge
 * that this file exists.
 *
 * Node standard library only. Binds to loopback. Exits with the suite.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.SESSION_STUB_PORT ?? 3110);
const HOST = "127.0.0.1";
const SESSION_PATH = "/api/crm/v1/session";
const STATE_COOKIE = "ata_test_crm_session_state";

const VALID_SESSION = {
  employeeId: "emp_stub_7f3a9c",
  displayName: "Ирина Соколова",
  role: "support",
  effectivePermissions: ["edit_user_notes"],
  permissionVersion: 3,
  expiresAt: "2099-12-31T23:59:59.000Z",
};

/** role=crm_admin with zero permissions — proves role cannot re-grant locally. */
const ADMIN_NO_PERMISSIONS = {
  ...VALID_SESSION,
  employeeId: "emp_stub_admin",
  displayName: "Админ Без Прав",
  role: "crm_admin",
  effectivePermissions: [],
};

function readStateCookie(header) {
  if (!header) return "authenticated";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === STATE_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return "authenticated";
}

function send(res, status, body) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = createServer((req, res) => {
  // Exactly one route. Everything else is a hard 404 — the stub must not be
  // able to stand in for any backend surface the rewrite does not expose.
  const path = (req.url ?? "").split("?")[0];
  if (req.method !== "GET" || path !== SESSION_PATH) {
    send(res, 404, { error: "not_found" });
    return;
  }

  const state = readStateCookie(req.headers.cookie);

  switch (state) {
    case "unauthenticated":
      send(res, 401, {
        code: "unauthorized",
        messageKey: "errors.session.expired",
        requestId: "req_stub_401",
      });
      return;

    case "forbidden":
      send(res, 403, {
        code: "unauthorized",
        messageKey: "errors.session.no_crm_access",
        requestId: "req_stub_403",
      });
      return;

    case "server_error":
      send(res, 500, { error: "internal" });
      return;

    case "malformed":
      // Structurally valid JSON, invalid contract: unknown role.
      send(res, 200, { ...VALID_SESSION, role: "superadmin" });
      return;

    case "malformed_extra_field":
      // Strict schema must reject an unexpected sensitive field.
      send(res, 200, { ...VALID_SESSION, email: "leaked@example.test" });
      return;

    case "not_json":
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      res.end("<html>not json</html>");
      return;

    case "network_failure":
      // Destroy the socket without a response — a real connection drop.
      req.socket.destroy();
      return;

    case "admin_no_permissions":
      send(res, 200, ADMIN_NO_PERMISSIONS);
      return;

    case "authenticated":
    default:
      send(res, 200, VALID_SESSION);
      return;
  }
});

server.listen(PORT, HOST, () => {
  // Playwright's webServer waits for this port to accept connections.
  console.log(`[session-stub] listening on http://${HOST}:${PORT}${SESSION_PATH}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
