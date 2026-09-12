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
 * selected by the `ata_test_crm_users_state` cookie, and the accepted Notes v1
 * routes:
 *
 *   GET  /api/crm/v1/users/{singleSegment}/notes
 *   POST /api/crm/v1/users/{singleSegment}/notes
 *
 * selected by `ata_test_crm_notes_state`, with the Notes permission matrix
 * selected by `ata_test_crm_notes_session`. All data below is synthetic. Every
 * other path — including a nested `/notes/{noteId}` and any PUT/PATCH/DELETE —
 * 404s.
 *
 * Node standard library only. Binds to loopback. Exits with the suite.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.SESSION_STUB_PORT ?? 3211);
const HOST = process.env.SESSION_STUB_HOST ?? "127.0.0.1";
const SESSION_PATH = "/api/crm/v1/session";
const USERS_PATH = "/api/crm/v1/users";
const STATE_COOKIE = "ata_test_crm_session_state";
const USERS_STATE_COOKIE = "ata_test_crm_users_state";
const USER_DETAIL_STATE_COOKIE = "ata_test_crm_user_detail_state";
const NOTES_STATE_COOKIE = "ata_test_crm_notes_state";
const NOTES_SESSION_COOKIE = "ata_test_crm_notes_session";
const OWNER_STATE_COOKIE = "ata_test_crm_owner_state";
const OWNER_MUTATION_COOKIE = "ata_test_crm_owner_mutation";
const CANDIDATES_STATE_COOKIE = "ata_test_crm_candidates_state";
const OWNER_SESSION_COOKIE = "ata_test_crm_owner_session";
const OWNER_HISTORY_STATE_COOKIE = "ata_test_crm_owner_history_state";
const OWNER_CANDIDATES_PATH = "/api/crm/v1/owner-candidates";

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
const readNotesStateCookie = (header) => readCookie(header, NOTES_STATE_COOKIE, "populated");
const readNotesSessionCookie = (header) => readCookie(header, NOTES_SESSION_COOKIE, "both");
const readOwnerStateCookie = (header) => readCookie(header, OWNER_STATE_COOKIE, "assigned");
const readOwnerMutationCookie = (header) => readCookie(header, OWNER_MUTATION_COOKIE, "success");
const readCandidatesStateCookie = (header) => readCookie(header, CANDIDATES_STATE_COOKIE, "one_page");
const readOwnerSessionCookie = (header) => readCookie(header, OWNER_SESSION_COOKIE, "assigner");
const readOwnerHistoryStateCookie = (header) =>
  readCookie(header, OWNER_HISTORY_STATE_COOKIE, "three");

/* --------------------------------------------------------- owner sessions */

// Permission fixtures for the Owner matrix. Each is a full valid session that
// differs ONLY in effectivePermissions, so a test proves the affordance follows
// the permission and never the role name.
const OWNER_SESSIONS = {
  assigner: ["assign_owner"],
  no_assign: ["view_user_notes"],
  unrelated: ["reveal_pii", "view_identity_full_email"],
  none: [],
  // OH-1: `view_audit` alone reads Owner History but cannot assign. `assigner`
  // above deliberately holds `assign_owner` WITHOUT `view_audit`, proving a role
  // that may reassign the owner still cannot see the history log.
  viewer: ["view_audit"],
  viewer_and_assigner: ["view_audit", "assign_owner"],
};

/* --------------------------------------------------------- synthetic owner */

// Synthetic owner directory. Deliberately two fields only — no StaffRole, email,
// status or version metadata, exactly like the accepted contract.
const OWNER_ALPHA = { employeeId: "emp_alpha", displayName: "Оператор Альфа" };
const OWNER_BETA = { employeeId: "emp_beta", displayName: "Оператор Бета" };
const OWNER_GAMMA = { employeeId: "emp_gamma", displayName: "Оператор Гамма" };

function ownerNameFor(employeeId) {
  if (employeeId === "emp_alpha") return "Оператор Альфа";
  if (employeeId === "emp_beta") return "Оператор Бета";
  if (employeeId === "emp_gamma") return "Оператор Гамма";
  return "Сотрудник";
}

function candidatesPage(state, url) {
  const cursor = url.searchParams.get("cursor");
  if (state === "empty") return { items: [], nextCursor: null };
  if (state === "paged") {
    if (cursor === "cand-2") return { items: [OWNER_BETA], nextCursor: null };
    return { items: [OWNER_ALPHA], nextCursor: "cand-2" };
  }
  if (state === "duplicate") {
    // The second page repeats emp_alpha — the client must dedupe without
    // reordering.
    if (cursor === "cand-2") return { items: [OWNER_ALPHA, OWNER_GAMMA], nextCursor: null };
    return { items: [OWNER_ALPHA, OWNER_BETA], nextCursor: "cand-2" };
  }
  // one_page (default): deterministic backend order.
  return { items: [OWNER_ALPHA, OWNER_BETA, OWNER_GAMMA], nextCursor: null };
}

function handleCandidates(req, res, url) {
  const state = readCandidatesStateCookie(req.headers.cookie);
  switch (state) {
    case "forbidden":
      send(res, 403, { code: "unauthorized", messageKey: "crm.users.owner.forbidden", requestId: "req_stub_cand_403" });
      return;
    case "server_error":
      send(res, 500, { code: "internal", messageKey: "crm.owner_candidates.internal", requestId: "req_stub_cand_500" });
      return;
    case "malformed":
      // Structurally valid JSON, invalid contract: a forbidden StaffRole field.
      send(res, 200, { items: [{ ...OWNER_ALPHA, staffRole: "support" }], nextCursor: null });
      return;
    case "not_json":
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      res.end("<html>not json</html>");
      return;
    case "network_failure":
      req.socket.destroy();
      return;
    case "delayed": {
      const timer = setTimeout(() => send(res, 200, candidatesPage("one_page", url)), 3_000);
      res.on("close", () => clearTimeout(timer));
      return;
    }
    default:
      send(res, 200, candidatesPage(state, url));
      return;
  }
}

function handleOwnerRead(req, res) {
  const state = readOwnerStateCookie(req.headers.cookie);
  switch (state) {
    case "pristine":
      send(res, 200, { owner: null, ownerVersion: 0 });
      return;
    case "unassigned_persisted":
      send(res, 200, { owner: null, ownerVersion: 3 });
      return;
    case "forbidden":
      send(res, 403, { code: "unauthorized", messageKey: "crm.session.not_staff", requestId: "req_stub_owner_403" });
      return;
    case "unauthenticated":
      send(res, 401, { code: "unauthorized", messageKey: "crm.session.unauthenticated", requestId: "req_stub_owner_401" });
      return;
    case "not_found":
      send(res, 404, { code: "not_found", messageKey: "crm.users.owner.not_found", requestId: "req_stub_owner_404" });
      return;
    case "server_error":
      send(res, 500, { code: "internal", messageKey: "crm.users.owner.internal", requestId: "req_stub_owner_500" });
      return;
    case "malformed":
      // 200 whose payload violates the contract: a forbidden ownerId field.
      send(res, 200, { owner: { ...OWNER_ALPHA, ownerId: "emp_leak" }, ownerVersion: 1 });
      return;
    case "not_json":
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      res.end("<html>not json</html>");
      return;
    case "network_failure":
      req.socket.destroy();
      return;
    case "delayed": {
      const timer = setTimeout(() => send(res, 200, { owner: OWNER_ALPHA, ownerVersion: 1 }), 3_000);
      res.on("close", () => clearTimeout(timer));
      return;
    }
    case "assigned":
    default:
      send(res, 200, { owner: OWNER_ALPHA, ownerVersion: 1 });
      return;
  }
}

function handleOwnerWrite(req, res) {
  const state = readOwnerMutationCookie(req.headers.cookie);
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 64_000) req.socket.destroy();
  });
  req.on("end", () => {
    let parsed = {};
    try {
      parsed = JSON.parse(raw || "{}");
    } catch {
      parsed = {};
    }
    switch (state) {
      case "conflict":
        send(res, 409, { code: "conflict", messageKey: "crm.users.owner.conflict", requestId: "req_stub_owner_put_409" });
        return;
      case "forbidden":
        send(res, 403, { code: "unauthorized", messageKey: "crm.users.owner.forbidden", requestId: "req_stub_owner_put_403" });
        return;
      case "candidate_404":
        send(res, 404, { code: "not_found", messageKey: "crm.users.owner.candidate_not_found", requestId: "req_stub_owner_put_c404" });
        return;
      case "learner_404":
        send(res, 404, { code: "not_found", messageKey: "crm.users.owner.not_found", requestId: "req_stub_owner_put_l404" });
        return;
      case "unauthenticated":
        send(res, 401, { code: "unauthorized", messageKey: "crm.session.unauthenticated", requestId: "req_stub_owner_put_401" });
        return;
      case "invalid":
        send(res, 400, { code: "invalid_input", messageKey: "crm.users.owner.body_invalid", requestId: "req_stub_owner_put_400" });
        return;
      case "server_error":
        send(res, 500, { code: "internal", messageKey: "crm.users.owner.internal", requestId: "req_stub_owner_put_500" });
        return;
      case "malformed":
        // 200 whose payload violates the contract — must not read as success.
        send(res, 200, { owner: { ...OWNER_ALPHA, ownerId: "emp_leak" }, ownerVersion: 2 });
        return;
      case "success":
      default: {
        // Echo the requested change back as the new state: version advances by
        // one from the expectedVersion the client sent.
        const employeeId = typeof parsed.ownerEmployeeId === "string" ? parsed.ownerEmployeeId : null;
        const version = (Number.isInteger(parsed.expectedVersion) ? parsed.expectedVersion : 0) + 1;
        send(res, 200, {
          owner: employeeId === null ? null : { employeeId, displayName: ownerNameFor(employeeId) },
          ownerVersion: version,
        });
        return;
      }
    }
  });
}

/* --------------------------------------------------- owner history (OH-1) */

// Synthetic owner-history actor and the three transition rows, newest first.
// Deterministic ids and timestamps — no randomness during tests — and no real
// names or emails. `ownerVersion` is the resulting version after the transition.
const OWNER_DELTA = { employeeId: "emp_delta", displayName: "Оператор Дельта" };
const HIST_ASSIGNED = {
  historyId: "hist_1",
  transition: "assigned",
  ownerVersion: 1,
  createdAt: "2026-07-01T09:00:00.000Z",
  actor: OWNER_DELTA,
  previousOwner: null,
  nextOwner: OWNER_ALPHA,
};
const HIST_REASSIGNED = {
  historyId: "hist_2",
  transition: "reassigned",
  ownerVersion: 2,
  createdAt: "2026-07-02T10:30:00.000Z",
  actor: OWNER_DELTA,
  previousOwner: OWNER_ALPHA,
  nextOwner: OWNER_BETA,
};
const HIST_UNASSIGNED = {
  historyId: "hist_3",
  transition: "unassigned",
  ownerVersion: 3,
  createdAt: "2026-07-03T11:45:00.000Z",
  actor: OWNER_DELTA,
  previousOwner: OWNER_BETA,
  nextOwner: null,
};

// GET /api/crm/v1/users/{segment}/owner/history — read-only, view_audit-gated.
// Response selected by `ata_test_crm_owner_history_state`, cursor honoured for
// the paged case. Every branch is no-store with a request id, mirroring the
// backend envelope.
function handleOwnerHistory(req, res, url) {
  const state = readOwnerHistoryStateCookie(req.headers.cookie);
  const cursor = url.searchParams.get("cursor");

  switch (state) {
    case "empty":
      send(res, 200, { items: [], nextCursor: null });
      return;
    case "forbidden":
      send(res, 403, {
        code: "unauthorized",
        messageKey: "crm.users.owner_history.forbidden",
        requestId: "req_stub_hist_403",
      });
      return;
    case "unauthenticated":
      send(res, 401, {
        code: "unauthorized",
        messageKey: "crm.session.unauthenticated",
        requestId: "req_stub_hist_401",
      });
      return;
    case "not_found":
      send(res, 404, {
        code: "not_found",
        messageKey: "crm.users.owner_history.not_found",
        requestId: "req_stub_hist_404",
      });
      return;
    case "server_error":
      send(res, 500, {
        code: "internal",
        messageKey: "crm.users.owner_history.internal",
        requestId: "req_stub_hist_500",
      });
      return;
    case "malformed":
      // A 200 whose item carries a forbidden internal field: the CRM must reject
      // it as malformed rather than render a leaked id.
      send(res, 200, {
        items: [{ ...HIST_ASSIGNED, actorStaffId: "emp_leak" }],
        nextCursor: null,
      });
      return;
    case "paged":
      // Newest-first, split across two pages by ownerVersion keyset. The second
      // page is fetched only when the first cursor is presented.
      if (cursor === "hist-2") {
        send(res, 200, { items: [HIST_ASSIGNED], nextCursor: null });
        return;
      }
      send(res, 200, { items: [HIST_UNASSIGNED, HIST_REASSIGNED], nextCursor: "hist-2" });
      return;
    case "three":
    default:
      send(res, 200, {
        items: [HIST_UNASSIGNED, HIST_REASSIGNED, HIST_ASSIGNED],
        nextCursor: null,
      });
      return;
  }
}

/* --------------------------------------------------------- notes sessions */

// Permission fixtures for the Notes matrix. Each is a full valid session that
// differs ONLY in effectivePermissions, so a test proves the affordance follows
// the permission and never the role name.
const NOTES_SESSIONS = {
  both: ["view_user_notes", "create_user_notes"],
  view_only: ["view_user_notes"],
  create_only: ["create_user_notes"],
  neither: [],
  edit_only: ["edit_user_notes"],
};

/* ------------------------------------------------------- synthetic users v1 */

// A deliberately long owner display name — proves the column/cell wraps and
// keeps its full text without forcing horizontal document overflow.
const LONG_OWNER_NAME =
  "Александра-Валентина Оператор-Куратор Длинноимённая-Двойная";

// Default owner projection for the unfiltered list: an assigned owner, a long
// name, and a `null` (unassigned) row, so the owner column shows every shape.
function defaultOwner(index) {
  if (index === 2 || index === 5) return null;
  if (index === 1 || index === 4) return { displayName: LONG_OWNER_NAME };
  return { displayName: "Оператор Альфа" };
}

// Synthetic only. Deliberately shaped like the accepted Users v1 contract and
// containing no field the backend does not return. `owner` is the current
// owner's displayName only, or null — never an employeeId, ownerVersion,
// StaffRole, email, status or timestamp. When `owner` is omitted the deterministic
// default is used; pass it explicitly to force an assigned/unassigned row.
function synthUser(index, { visibility, owner } = {}) {
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
    owner: owner === undefined ? defaultOwner(index) : owner,
  };
}

function usersPage(state, url) {
  const visibility = state === "full_email" ? "full" : "masked";
  const search = (url.searchParams.get("search") ?? "").trim();
  const owner = url.searchParams.get("owner"); // null | "mine" | "unassigned"
  const cursor = url.searchParams.get("cursor");

  if (state === "empty") return { items: [], nextCursor: null };

  // Owner-filter result sets (no active search). `mine` returns a small book all
  // owned by the session actor; `unassigned` returns only `null`-owner rows.
  if (!search) {
    if (owner === "mine") {
      return {
        items: [
          synthUser(0, { visibility, owner: { displayName: "Ирина Соколова" } }),
          synthUser(3, { visibility, owner: { displayName: "Ирина Соколова" } }),
        ],
        nextCursor: null,
      };
    }
    if (owner === "unassigned") {
      return {
        items: [
          synthUser(2, { visibility, owner: null }),
          synthUser(5, { visibility, owner: null }),
        ],
        nextCursor: null,
      };
    }
  }

  // Display-name search: only "Пользователь NN" matches. Composes with an owner
  // filter by AND — `unassigned` + a search matching an owned row yields nothing.
  if (search && !search.includes("@")) {
    const match = /(\d{2})\s*$/.exec(search);
    const index = match ? Number(match[1]) : NaN;
    if (Number.isNaN(index)) return { items: [], nextCursor: null };
    if (owner === "unassigned" && !(index === 2 || index === 5)) {
      return { items: [], nextCursor: null };
    }
    if (owner === "mine" && !(index === 0 || index === 3)) {
      return { items: [], nextCursor: null };
    }
    const ownerOverride =
      owner === "unassigned"
        ? null
        : owner === "mine"
          ? { displayName: "Ирина Соколова" }
          : undefined;
    return { items: [synthUser(index, { visibility, owner: ownerOverride })], nextCursor: null };
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

/* --------------------------------------------------------- synthetic notes */

// Synthetic only. Shaped exactly like the accepted Notes v1 contract: four
// fields, no employeeId, no authorId, no email, no visibility, no pinned.
function synthNote(index, over = {}) {
  return {
    noteId: `note_stub_${index}`,
    body: `Заметка номер ${index}`,
    authorDisplayName: "Нина Чмиль",
    createdAt: new Date(Date.UTC(2026, 6, 20, 18, 42 - index, 0)).toISOString(),
    ...over,
  };
}

function notesPage(state, url) {
  const cursor = url.searchParams.get("cursor");

  if (state === "empty") return { items: [], nextCursor: null };

  if (state === "same_timestamp") {
    // Identical createdAt across rows: proves the client preserves the server's
    // order rather than re-sorting by timestamp.
    const at = "2026-07-20T18:42:00.000Z";
    return {
      items: [1, 2, 3].map((i) => synthNote(i, { createdAt: at, body: `Одновременная ${i}` })),
      nextCursor: null,
    };
  }

  if (state === "long_note") {
    return {
      items: [
        synthNote(1, {
          body:
            "Очень длинная заметка без пробелов: " +
            "ААААААААААААААААААААААААААААААААААААААААААААААААААААААААААААААААААААААА" +
            " https://example.test/" + "x".repeat(300),
        }),
      ],
      nextCursor: null,
    };
  }

  if (state === "html_text") {
    return {
      items: [synthNote(1, { body: "<script>window.__ataNotesPwned = true;</script> **не разметка**" })],
      nextCursor: null,
    };
  }

  if (state === "multiline") {
    return {
      items: [synthNote(1, { body: "первая строка\nвторая строка\tс табом" })],
      nextCursor: null,
    };
  }

  if (state === "duplicate_page") {
    // The second page repeats a noteId from the first — the client must not
    // render it twice, and must not reorder anything to achieve that.
    if (cursor === "notes-cursor-2") {
      return { items: [synthNote(1), synthNote(3)], nextCursor: null };
    }
    return { items: [synthNote(1), synthNote(2)], nextCursor: "notes-cursor-2" };
  }

  if (state === "paged") {
    if (cursor === "notes-cursor-2") {
      return { items: [synthNote(3), synthNote(4)], nextCursor: null };
    }
    return { items: [synthNote(1), synthNote(2)], nextCursor: "notes-cursor-2" };
  }

  return { items: [synthNote(1), synthNote(2)], nextCursor: null };
}

function handleNotesList(req, res, url) {
  const state = readNotesStateCookie(req.headers.cookie);

  switch (state) {
    case "invalid_input":
      send(res, 400, {
        code: "invalid_input",
        messageKey: "crm.users.notes.limit_invalid",
        requestId: "req_stub_notes_400",
      });
      return;
    case "unauthenticated":
      send(res, 401, {
        code: "unauthorized",
        messageKey: "crm.session.unauthenticated",
        requestId: "req_stub_notes_401",
      });
      return;
    case "forbidden_list":
      send(res, 403, {
        code: "unauthorized",
        messageKey: "crm.users.notes.forbidden",
        requestId: "req_stub_notes_403",
      });
      return;
    case "not_found":
      send(res, 404, {
        code: "not_found",
        messageKey: "crm.users.notes.not_found",
        requestId: "req_stub_notes_404",
      });
      return;
    case "server_error_list":
      send(res, 500, {
        code: "internal",
        messageKey: "crm.users.notes.internal",
        requestId: "req_stub_notes_500",
      });
      return;
    case "malformed_list":
      // Structurally valid JSON, invalid contract: a forbidden author field.
      send(res, 200, { items: [{ ...synthNote(1), employeeId: "emp_leak" }], nextCursor: null });
      return;
    case "not_json":
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      res.end("<html>not json</html>");
      return;
    case "network_failure":
      req.socket.destroy();
      return;
    case "delayed_list": {
      const timer = setTimeout(() => send(res, 200, notesPage("populated", url)), 3_000);
      res.on("close", () => clearTimeout(timer));
      return;
    }
    default:
      send(res, 200, notesPage(state, url));
      return;
  }
}

function handleNotesCreate(req, res) {
  const state = readNotesStateCookie(req.headers.cookie);

  // The body is read and discarded except for the echo below: the stub proves
  // the CLIENT sent a normalized body, it does not re-implement validation.
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 64_000) req.socket.destroy();
  });
  req.on("end", () => {
    let parsed = {};
    try {
      parsed = JSON.parse(raw || "{}");
    } catch {
      parsed = {};
    }

    switch (state) {
      case "forbidden_create":
        send(res, 403, {
          code: "unauthorized",
          messageKey: "crm.users.notes.forbidden",
          requestId: "req_stub_notes_create_403",
        });
        return;
      case "invalid_create":
        send(res, 400, {
          code: "invalid_input",
          messageKey: "crm.users.notes.body_invalid",
          requestId: "req_stub_notes_create_400",
        });
        return;
      case "unauthenticated_create":
        send(res, 401, {
          code: "unauthorized",
          messageKey: "crm.session.unauthenticated",
          requestId: "req_stub_notes_create_401",
        });
        return;
      case "not_found_create":
        send(res, 404, {
          code: "not_found",
          messageKey: "crm.users.notes.not_found",
          requestId: "req_stub_notes_create_404",
        });
        return;
      case "server_error_create":
        send(res, 500, {
          code: "internal",
          messageKey: "crm.users.notes.internal",
          requestId: "req_stub_notes_create_500",
        });
        return;
      case "malformed_create":
        // 201 whose payload violates the contract — must not clear the draft.
        send(res, 201, { ...synthNote(9), authorId: "emp_leak" });
        return;
      case "unexpected_200_create":
        // A 200 is NOT a create. The client must treat it as malformed.
        send(res, 200, synthNote(9));
        return;
      case "delayed_create": {
        const timer = setTimeout(
          () => send(res, 201, synthNote(9, { body: String(parsed.body ?? "") })),
          2_000,
        );
        res.on("close", () => clearTimeout(timer));
        return;
      }
      default:
        // Echo the received body so a test can prove the CLIENT normalized it
        // (trimmed, CRLF collapsed) before sending.
        send(res, 201, synthNote(9, { body: String(parsed.body ?? "") }));
        return;
    }
  });
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
    case "owner_malformed":
      // 200 whose OWNER payload violates the contract: a blank displayName.
      send(res, 200, {
        items: [synthUser(0, { visibility: "masked", owner: { displayName: "   " } })],
        nextCursor: null,
      });
      return;
    case "owner_extra_field":
      // 200 whose owner object carries a forbidden employeeId — strict rejects.
      send(res, 200, {
        items: [
          {
            ...synthUser(0, { visibility: "masked" }),
            owner: { displayName: "Оператор Альфа", employeeId: "emp_leak" },
          },
        ],
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
    case "delayed": {
      // Held open long enough to observe a genuinely in-flight owner-filter
      // request; cleared if the client disconnects first.
      const timer = setTimeout(() => send(res, 200, usersPage("populated", url)), 3_000);
      res.on("close", () => clearTimeout(timer));
      return;
    }
    default: {
      // The canonical frontend only ever sends owner=mine or owner=unassigned.
      // owner=all, an employee id, `assigned` or any other value is a contract
      // violation the frontend must never emit — answer 400 so a test proves the
      // omission (an `all` request that carried a param would fail here).
      const owner = url.searchParams.get("owner");
      if (owner !== null && owner !== "mine" && owner !== "unassigned") {
        send(res, 400, {
          code: "invalid_input",
          messageKey: "crm.users.owner_filter_invalid",
          requestId: "req_stub_users_owner_400",
        });
        return;
      }
      send(res, 200, usersPage(state, url));
      return;
    }
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

  // Exactly one segment, then a terminal `/notes`. `/notes/extra` and
  // `/notes/{noteId}` do not match and therefore 404 at the stub too.
  const notesMatch = new RegExp(`^${USERS_PATH}/([^/]+)/notes$`).exec(path);

  // Exactly one segment, then a terminal `/owner`. `/owner/extra` and
  // `/owner/{employeeId}` do not match and 404 at the stub. `/owner/history` is
  // its own reviewed terminal path, matched separately below.
  const ownerMatch = new RegExp(`^${USERS_PATH}/([^/]+)/owner$`).exec(path);

  // Exactly one segment, then a terminal `/owner/history`. A child beneath it
  // (`/owner/history/{id}`) does not match and 404s at the stub too.
  const ownerHistoryMatch = new RegExp(`^${USERS_PATH}/([^/]+)/owner/history$`).exec(path);

  // The flat owner-candidates directory has no child: `/owner-candidates/extra`
  // does not match and 404s at the stub too.
  if (path === OWNER_CANDIDATES_PATH) {
    if (req.method === "GET") {
      handleCandidates(req, res, url);
      return;
    }
    send(res, 404, { error: "not_found" });
    return;
  }

  if (ownerHistoryMatch) {
    // Owner History (OH-1) is read-only: only GET exists. Everything else 404s.
    if (req.method === "GET") {
      handleOwnerHistory(req, res, url);
      return;
    }
    send(res, 404, { error: "not_found" });
    return;
  }

  if (ownerMatch) {
    // Owner v1 exposes exactly GET and PUT. POST/PATCH/DELETE 404.
    if (req.method === "GET") {
      handleOwnerRead(req, res);
      return;
    }
    if (req.method === "PUT") {
      handleOwnerWrite(req, res);
      return;
    }
    send(res, 404, { error: "not_found" });
    return;
  }

  if (notesMatch) {
    // Notes v1 is append-only: only GET and POST exist. PUT/PATCH/DELETE 404.
    if (req.method === "GET") {
      handleNotesList(req, res, url);
      return;
    }
    if (req.method === "POST") {
      handleNotesCreate(req, res);
      return;
    }
    send(res, 404, { error: "not_found" });
    return;
  }

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

    case "notes_matrix": {
      // Same role for every case — only effectivePermissions differ, so a test
      // proves the Notes affordances follow the permission, not the role.
      const which = readNotesSessionCookie(req.headers.cookie);
      send(res, 200, {
        ...VALID_SESSION,
        effectivePermissions: NOTES_SESSIONS[which] ?? NOTES_SESSIONS.both,
      });
      return;
    }

    case "owner_matrix": {
      // Same role for every case — only effectivePermissions differ, so a test
      // proves the Owner affordances follow the permission, not the role.
      const which = readOwnerSessionCookie(req.headers.cookie);
      send(res, 200, {
        ...VALID_SESSION,
        effectivePermissions: OWNER_SESSIONS[which] ?? OWNER_SESSIONS.assigner,
      });
      return;
    }

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
