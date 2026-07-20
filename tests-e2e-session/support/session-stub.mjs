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
 * It also implements the accepted Users v1 route:
 *
 *   GET /api/crm/v1/users
 *
 * selected by the `ata_test_crm_users_state` cookie. All user data below is
 * synthetic. Every other path 404s.
 *
 * Node standard library only. Binds to loopback. Exits with the suite.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.SESSION_STUB_PORT ?? 3110);
const HOST = "127.0.0.1";
const SESSION_PATH = "/api/crm/v1/session";
const USERS_PATH = "/api/crm/v1/users";
const STATE_COOKIE = "ata_test_crm_session_state";
const USERS_STATE_COOKIE = "ata_test_crm_users_state";
const USER_DETAIL_STATE_COOKIE = "ata_test_crm_user_detail_state";

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

function readCookie(header, cookieName, fallback) {
  if (!header) return fallback;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === cookieName) return decodeURIComponent(rest.join("="));
  }
  return fallback;
}

const readStateCookie = (header) => readCookie(header, STATE_COOKIE, "authenticated");
const readUsersStateCookie = (header) => readCookie(header, USERS_STATE_COOKIE, "populated");
const readUserDetailStateCookie = (header) =>
  readCookie(header, USER_DETAIL_STATE_COOKIE, "active");

/* ------------------------------------------------------- synthetic users v1 */

// Synthetic only. Deliberately shaped like the accepted Users v1 contract and
// containing no field the backend does not return.
function synthUser(index, { visibility }) {
  const n = String(index).padStart(2, "0");
  const local = `learner${n}`;
  return {
    userId: String(1000 + index),
    displayName: `Пользователь ${n}`,
    email:
      visibility === "full"
        ? { value: `${local}@example.test`, visibility: "full" }
        : { value: `${local.slice(0, 1)}***@e***.test`, visibility: "masked" },
    status: index % 5 === 0 ? "blocked" : "active",
    level: (index % 9) + 1,
    emailConfirmed: index % 2 === 0,
    createdAt: new Date(Date.UTC(2026, 0, 1 + index, 12, 0, 0)).toISOString(),
  };
}

function usersPage(state, url) {
  const visibility = state === "full_email" ? "full" : "masked";
  const search = (url.searchParams.get("search") ?? "").trim();
  const cursor = url.searchParams.get("cursor");

  if (state === "empty") return { items: [], nextCursor: null };

  // Display-name search: only "Пользователь 03" matches.
  if (search && !search.includes("@")) {
    const match = /(\d{2})\s*$/.exec(search);
    const index = match ? Number(match[1]) : NaN;
    if (Number.isNaN(index)) return { items: [], nextCursor: null };
    return { items: [synthUser(index, { visibility })], nextCursor: null };
  }

  // Full-email search: matches the one synthetic address.
  if (search.includes("@")) {
    const match = /learner(\d{2})@example\.test/.exec(search);
    if (!match) return { items: [], nextCursor: null };
    return { items: [synthUser(Number(match[1]), { visibility: "full" })], nextCursor: null };
  }

  // Two fixed pages so cursor paging (and going back) is exercised.
  if (cursor === "cursor-page-2") {
    return {
      items: [3, 4, 5].map((i) => synthUser(i, { visibility })),
      nextCursor: null,
    };
  }
  return {
    items: [0, 1, 2].map((i) => synthUser(i, { visibility })),
    nextCursor: "cursor-page-2",
  };
}

/* --------------------------------------------------- synthetic user detail */

// Synthetic only. Shaped exactly like the accepted User Detail v1 contract and
// carrying no field the backend does not return.
function synthDetail(userId, over = {}) {
  return {
    userId: String(userId),
    displayName: "Целевой Пользователь",
    email: { value: "t***@e***.test", visibility: "masked" },
    status: "active",
    level: 7,
    xp: 4242,
    emailConfirmed: true,
    createdAt: "2026-01-01T12:00:00.000Z",
    ...over,
  };
}

let requestCounter = 0;

function send(res, status, body) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  requestCounter += 1;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-request-id": `req_stub_${requestCounter}`,
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function handleUsers(req, res, url) {
  const state = readUsersStateCookie(req.headers.cookie);

  switch (state) {
    case "invalid_input":
      send(res, 400, {
        code: "invalid_input",
        messageKey: "crm.users.limit_invalid",
        requestId: "req_stub_users_400",
      });
      return;
    case "unauthenticated":
      send(res, 401, {
        code: "unauthorized",
        messageKey: "crm.session.unauthenticated",
        requestId: "req_stub_users_401",
      });
      return;
    case "forbidden":
      send(res, 403, {
        code: "unauthorized",
        messageKey: "crm.session.not_staff",
        requestId: "req_stub_users_403",
      });
      return;
    case "server_error":
      send(res, 500, { code: "internal", messageKey: "crm.users.internal", requestId: "req_stub_users_500" });
      return;
    case "malformed":
      // Structurally valid JSON, invalid contract: unknown status value.
      send(res, 200, {
        items: [{ ...synthUser(0, { visibility: "masked" }), status: "suspended" }],
        nextCursor: null,
      });
      return;
    case "malformed_extra_field":
      send(res, 200, {
        items: [{ ...synthUser(0, { visibility: "masked" }), ownerId: "emp_leak" }],
        nextCursor: null,
      });
      return;
    case "not_json":
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      res.end("<html>not json</html>");
      return;
    case "network_failure":
      req.socket.destroy();
      return;
    default:
      send(res, 200, usersPage(state, url));
      return;
  }
}

function handleUserDetail(req, res, userId) {
  const state = readUserDetailStateCookie(req.headers.cookie);

  switch (state) {
    case "invalid_input":
      send(res, 400, {
        code: "invalid_input",
        messageKey: "crm.users.detail.user_id_invalid",
        requestId: "req_stub_detail_400",
      });
      return;
    case "unauthenticated":
      send(res, 401, {
        code: "unauthorized",
        messageKey: "crm.session.unauthenticated",
        requestId: "req_stub_detail_401",
      });
      return;
    case "forbidden":
      send(res, 403, {
        code: "unauthorized",
        messageKey: "crm.session.not_staff",
        requestId: "req_stub_detail_403",
      });
      return;
    case "not_found":
    case "staff_hidden":
    case "system_hidden":
      // The backend deliberately answers identically for a nonexistent learner,
      // a staff account and a system account.
      send(res, 404, {
        code: "not_found",
        messageKey: "crm.users.detail.not_found",
        requestId: "req_stub_detail_404",
      });
      return;
    case "server_error":
      send(res, 500, {
        code: "internal",
        messageKey: "crm.users.detail.internal",
        requestId: "req_stub_detail_500",
      });
      return;
    case "malformed":
      send(res, 200, synthDetail(userId, { status: "suspended" }));
      return;
    case "malformed_extra_field":
      send(res, 200, { ...synthDetail(userId), ownerId: "emp_leak" });
      return;
    case "not_json":
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      res.end("<html>not json</html>");
      return;
    case "network_failure":
      req.socket.destroy();
      return;
    case "delayed": {
      // Held open long enough for a test to observe a genuinely in-flight
      // request. The timer is cleared if the client disconnects first, so no
      // handle survives into the next test.
      const timer = setTimeout(() => send(res, 200, synthDetail(userId)), 3_000);
      res.on("close", () => clearTimeout(timer));
      return;
    }
    case "blocked":
      send(res, 200, synthDetail(userId, { status: "blocked" }));
      return;
    case "full_email":
      send(res, 200, synthDetail(userId, {
        email: { value: "target-learner@example.test", visibility: "full" },
      }));
      return;
    case "unconfirmed":
      send(res, 200, synthDetail(userId, { emailConfirmed: false }));
      return;
    case "zero_xp":
      send(res, 200, synthDetail(userId, { xp: 0, level: 1 }));
      return;
    case "active":
    default:
      send(res, 200, synthDetail(userId));
      return;
  }
}

const server = createServer((req, res) => {
  // Exactly two routes. Everything else is a hard 404 — the stub must not be
  // able to stand in for any backend surface the rewrite does not expose.
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const path = url.pathname;

  // Exactly one segment may follow /users/ — nested paths are rejected, so a
  // notes/owner subroute cannot appear to exist even at the stub layer.
  const detailMatch = new RegExp(`^${USERS_PATH}/([^/]+)$`).exec(path);

  if (req.method !== "GET" || (path !== SESSION_PATH && path !== USERS_PATH && !detailMatch)) {
    send(res, 404, { error: "not_found" });
    return;
  }

  if (detailMatch) {
    handleUserDetail(req, res, decodeURIComponent(detailMatch[1]));
    return;
  }

  if (path === USERS_PATH) {
    handleUsers(req, res, url);
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
