import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BACKEND_PATHS } from "@/server/backend-client";
import { PROXIED_PATHS } from "../../../next.config.mjs";

/**
 * Source-level security guards for the staff authentication foundation.
 *
 * These assert properties that cannot be proved by exercising behaviour: that a
 * dangerous line is *absent*. A behavioural test can show the happy path is safe
 * today; only a source guard notices when someone adds `localStorage.setItem`
 * next week.
 *
 * Read relative to `process.cwd()`, matching the convention in
 * `api-crm-data-provider.test.ts`.
 */
const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

/**
 * Source with comments removed.
 *
 * Prose legitimately names the things it promises not to do — "no token in
 * localStorage", "the browser never learns CRM_BACKEND_ORIGIN" — and a raw
 * substring scan would flag exactly the documentation that makes the guarantee
 * legible. The same reasoning already governs `api-crm-data-provider.test.ts`,
 * which scans imports rather than whole files for that reason.
 *
 * Block comments and whole-line `//` comments are removed. A trailing comment on
 * a line of code is deliberately NOT removed: keeping it in scope means nobody
 * can hide a forbidden call behind one.
 */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

const readCode = (relative: string) => codeOf(read(relative));

/** Modules that ship to the browser. */
const CLIENT_MODULES = [
  "src/application/api/auth-client.ts",
  "src/features/auth/login-form.tsx",
  "src/features/auth/login-panel.tsx",
  "src/features/auth/sign-out-button.tsx",
  "src/components/crm-shell/session-boundary.tsx",
  "src/components/crm-shell/api-shell.tsx",
  "src/domain/identity/return-path.ts",
  "src/data/contracts/api/auth.ts",
];

/** Server-only modules that may touch the backend origin. */
const SERVER_MODULES = [
  "src/server/backend-client.ts",
  "src/server/set-cookie-bridge.ts",
  "src/server/auth-response.ts",
  "src/app/api/crm/auth/login/route.ts",
  "src/app/api/crm/auth/logout/route.ts",
  "src/app/api/crm/auth/csrf/route.ts",
];

const ALL_AUTH_MODULES = [...CLIENT_MODULES, ...SERVER_MODULES];

describe("no auth token in web storage", () => {
  it("no auth module writes a token to localStorage", () => {
    // The session is an HttpOnly cookie and the CSRF token is module-scoped
    // memory. Neither may be persisted where script can read it back later.
    for (const file of ALL_AUTH_MODULES) {
      expect(readCode(file), file).not.toContain("localStorage");
    }
  });

  it("only the return-path module uses sessionStorage, and only for a path", () => {
    for (const file of ALL_AUTH_MODULES) {
      if (file === "src/domain/identity/return-path.ts") continue;
      expect(readCode(file), file).not.toContain("sessionStorage");
    }
    // And that one module stores a path, never a credential.
    expect(readCode("src/domain/identity/return-path.ts")).not.toMatch(
      /password|csrf|token|Authorization/i,
    );
  });
});

describe("the browser never learns the backend origin", () => {
  it("no client module names CRM_BACKEND_ORIGIN or a loopback host", () => {
    for (const file of CLIENT_MODULES) {
      const source = readCode(file);
      expect(source, file).not.toContain("CRM_BACKEND_ORIGIN");
      expect(source, file).not.toContain("127.0.0.1");
      expect(source, file).not.toContain("localhost");
    }
  });

  it("client auth requests use relative paths only", () => {
    const source = read("src/application/api/auth-client.ts");
    // Every fetch target is a constant from the contract module, and each of
    // those is an absolute *path*, never a URL.
    for (const literal of source.match(/"\/api\/[^"]*"/g) ?? []) {
      expect(literal.startsWith('"/')).toBe(true);
    }
    expect(source).not.toMatch(/fetchImpl\(\s*`?https?:/);
  });

  it("the server-only backend client is never imported by a client module", () => {
    for (const file of CLIENT_MODULES) {
      expect(readCode(file), file).not.toContain("@/server/backend-client");
      expect(readCode(file), file).not.toContain("@/config/server-runtime");
    }
  });
});

describe("no credential or secret logging", () => {
  it("no auth module logs anything", () => {
    // A login body contains a password; a forwarded header contains a session.
    // The correct amount of logging in this code path is zero.
    for (const file of ALL_AUTH_MODULES) {
      expect(readCode(file), file).not.toMatch(/console\.(log|info|warn|error|debug|trace)\s*\(/);
    }
  });

  it("no auth module reports a raw exception outward", () => {
    for (const file of ALL_AUTH_MODULES) {
      const source = readCode(file);
      expect(source, file).not.toMatch(/error\.stack/);
      expect(source, file).not.toMatch(/String\(\s*error\s*\)/);
      expect(source, file).not.toMatch(/JSON\.stringify\(\s*error\s*\)/);
    }
  });
});

describe("no client-supplied authority", () => {
  it("the login request body carries exactly email and password", () => {
    const source = readCode("src/application/api/auth-client.ts");
    const body = source.slice(source.indexOf("JSON.stringify({ email"), source.indexOf("signal: timeout.signal"));
    // No role, no employeeId, no permissions, no return path travels with the
    // credentials — the server decides all of those.
    for (const forbidden of ["role", "employeeId", "permission", "staffRole", "isAdmin", "next"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it("the login route reads role and staff status only from the backend", () => {
    const source = readCode("src/app/api/crm/auth/login/route.ts");
    // Staff status comes from a server-side call to the backend session
    // endpoint, never from the submitted body.
    expect(source).toContain("BACKEND_PATHS.session");
    expect(source).not.toMatch(/parsed\.data\.(role|staffRole|permissions)/);
  });
});

describe("deterministic test cookies hold no production authority", () => {
  const TEST_COOKIE_NAMES = [
    "ata_test_crm_session_state",
    "ata_test_crm_users_state",
    "ata_test_crm_user_detail_state",
    "ata_test_crm_notes_state",
    "ata_test_crm_notes_session",
    "ata_test_crm_owner_state",
    "ata_test_crm_owner_session",
    "ata_test_crm_owner_history_state",
  ];

  /** Every shipped source file, excluding tests and the E2E harnesses. */
  function shippedFiles(dir = "src", acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        shippedFiles(rel, acc);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        acc.push(rel);
      }
    }
    return acc;
  }

  it("no shipped source file mentions a deterministic test cookie", () => {
    // The stub that reads these lives in tests-e2e-session/support and is
    // launched only by the Playwright config. Production code must not know the
    // names exist, let alone branch on them.
    const files = shippedFiles();
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) {
      const source = readCode(file);
      for (const cookie of TEST_COOKIE_NAMES) {
        expect(source, `${file} references ${cookie}`).not.toContain(cookie);
      }
      expect(source, `${file} references the test cookie prefix`).not.toContain("ata_test_");
    }
  });

  it("no shipped source file imports the E2E harness", () => {
    for (const file of shippedFiles()) {
      expect(readCode(file), file).not.toContain("tests-e2e");
    }
  });

  it("the bridged cookie allowlist cannot admit a test cookie", () => {
    // Even if a stub tried to set one, the bridge drops any name off the list.
    const source = readCode("src/server/set-cookie-bridge.ts");
    expect(source).not.toContain("ata_test_");
    expect(source).toContain("BRIDGED_COOKIE_NAMES");
  });
});

describe("proxy surface stays explicit", () => {
  it("the rewrite allowlist is unchanged by this phase", () => {
    // Auth is served by route handlers, not rewrites, so the seven reviewed
    // rewrite paths must be exactly as they were. This is what keeps the
    // existing `/users` API mode compatible.
    // MR-1R appended five exact reviewer paths. The seven CRM v1 data paths that
    // CRM-AUTH-1 shipped must remain first and unchanged: auth is still served by
    // route handlers, not rewrites, and existing api-mode Users is untouched.
    expect(PROXIED_PATHS.slice(0, 7)).toEqual([
      "/api/crm/v1/session",
      "/api/crm/v1/users",
      "/api/crm/v1/users/:userId",
      "/api/crm/v1/users/:userId/notes",
      "/api/crm/v1/owner-candidates",
      "/api/crm/v1/users/:userId/owner",
      "/api/crm/v1/users/:userId/owner/history",
    ]);
    // No auth or CSRF route was ever added to the rewrite list.
    for (const forbidden of ["/api/auth/login", "/api/auth/logout", "/api/csrf"]) {
      expect(PROXIED_PATHS).not.toContain(forbidden);
    }
    // Still no wildcard anywhere.
    for (const path of PROXIED_PATHS) {
      expect(path).not.toContain("*");
    }
  });

  it("the server-side backend path list is a closed allowlist", () => {
    const values = Object.values(BACKEND_PATHS);
    expect(values).toHaveLength(4);
    for (const value of values) {
      expect(value).not.toContain("*");
      expect(value).not.toContain(":");
    }
  });

  it("no auth route handler forwards a caller-supplied path or host", () => {
    for (const file of [
      "src/app/api/crm/auth/login/route.ts",
      "src/app/api/crm/auth/logout/route.ts",
      "src/app/api/crm/auth/csrf/route.ts",
    ]) {
      const source = readCode(file);
      // Every call names a constant from the allowlist.
      expect(source, file).toMatch(/path: BACKEND_PATHS\.\w+/);
      expect(source, file).not.toMatch(/path:\s*(request|params|searchParams|body)/);
      expect(source, file).not.toContain("CRM_BACKEND_ORIGIN");
    }
  });
});

describe("auth responses are never cached", () => {
  it("every auth route handler is dynamic and no-store", () => {
    for (const file of [
      "src/app/api/crm/auth/login/route.ts",
      "src/app/api/crm/auth/logout/route.ts",
      "src/app/api/crm/auth/csrf/route.ts",
    ]) {
      const source = read(file);
      // A cached login response would hand one employee's Set-Cookie to the next
      // visitor; a cached CSRF token would defeat double-submit entirely.
      expect(source, file).toContain('export const dynamic = "force-dynamic"');
      expect(source, file).toContain("export const revalidate = 0");
      expect(source, file).toMatch(/no-store/);
    }
  });
});
