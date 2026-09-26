import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

/**
 * ATA-PROFILE-FOUNDATION-1 — the name rule, the password rule, and the one
 * route that lets a learner change their own password.
 *
 * WHAT IS REAL HERE. A throwaway SQLite file, the real Prisma singleton, the
 * exported route handlers, real `Request` objects, the real CSRF check, the real
 * rate limiter, the real bcrypt, and the real session store. The password-change
 * assertions below are the reason this file uses HTTP rather than unit calls:
 * the thing being proved is not "the handler returns 200", it is that the old
 * token stops resolving and the new one starts, in the same commit as the hash.
 *
 * ONLY TWO BOUNDARIES ARE SUBSTITUTED, and both are unreachable without a
 * browser: `getCurrentUser`, which needs a cookie jar, and `verifyCaptcha`,
 * which needs Cloudflare. Everything they feed runs for real — including CSRF,
 * which is exercised in both directions rather than mocked away.
 */

process.env.CAPTCHA_PROVIDER = "";

type SessionUser = { id: number; role: string; status: string } | null;
const session: { user: SessionUser } = { user: null };

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getCurrentUser: async () => session.user };
});

vi.mock("@/lib/captcha", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, verifyCaptcha: async () => ({ ok: true, outcome: "skipped" }) };
});

let dir: string;
let db: PrismaClient;

const CSRF = "0".repeat(64);

/** A request that satisfies the real double-submit CSRF check. */
function post(url: string, body: unknown, opts: { csrf?: boolean; ip?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.csrf !== false) {
    headers.cookie = `trading_platform_csrf=${CSRF}`;
    headers["x-csrf-token"] = CSRF;
  }
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

async function changePassword(body: unknown, opts?: { csrf?: boolean; ip?: string }) {
  const { POST } = await import("@/app/api/auth/change-password/route");
  const response = await POST(post("http://backend.invalid/api/auth/change-password", body, opts));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, raw: text, response };
}

async function makeUser(email: string, password: string, name = "Тестовое имя") {
  return db.user.create({
    data: { email, name, passwordHash: await bcrypt.hash(password, 10), role: "user", level: 1 },
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ata-profile-"));
  const url = `file:${dir}/test.db`;
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  process.env.DATABASE_URL = url;
  db = new PrismaClient({ datasources: { db: { url } } });
}, 180_000);

afterAll(async () => {
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/* THE NAME RULE LIVES IN ITS OWN FILE.
   It is the one rule that differs between the deployment bridge and the final
   contract, so asserting it here would mean this matrix had to be edited twice
   for a reason that has nothing to do with what it tests. See
   registration-name-contract.test.ts. */

/* -------------------------------------------------------- the password rule */

describe("a password is long enough or it is not", () => {
  const parse = async (password: string) => {
    const { registerSchema } = await import("@/lib/validation");
    return registerSchema.safeParse({ email: "a@b.invalid", name: "Имя", password });
  };

  it("refuses five", async () => {
    expect((await parse("abcde")).success).toBe(false);
  });

  it("accepts six lowercase letters", async () => {
    expect((await parse("abcdef")).success).toBe(true);
  });

  it("accepts six digits", async () => {
    expect((await parse("123456")).success).toBe(true);
  });

  it("requires no uppercase, no digit and no symbol", async () => {
    for (const password of ["parolь", "пароль", "aaaaaa", "      "]) {
      expect((await parse(password)).success, password).toBe(true);
    }
  });

  it("never trims or normalises the value", async () => {
    const parsed = await parse("  abcd  ");
    expect(parsed.success && parsed.data.password).toBe("  abcd  ");
  });

  it("keeps the login contract it extends", async () => {
    const { loginSchema } = await import("@/lib/validation");
    expect(loginSchema.safeParse({ email: "A@B.INVALID", password: "abcde" }).success).toBe(false);
    const ok = loginSchema.safeParse({ email: "  A@B.invalid ", password: "abcdef" });
    expect(ok.success && ok.data.email).toBe("a@b.invalid");
  });
});

/* ------------------------------------------------- changing your own password */

describe("changing your own password", () => {
  it("refuses anyone without a session", async () => {
    session.user = null;
    const result = await changePassword({ currentPassword: "abcdef", newPassword: "ghijkl" });
    expect(result.status).toBe(401);
  });

  it("refuses a request whose CSRF token does not match", async () => {
    const user = await makeUser("csrf@b.invalid", "abcdef");
    session.user = { id: user.id, role: "user", status: "active" };
    const result = await changePassword(
      { currentPassword: "abcdef", newPassword: "ghijkl" },
      { csrf: false },
    );
    expect(result.status).toBe(403);
    expect(await db.user.findUnique({ where: { id: user.id } }).then((u) => u!.passwordHash))
      .toBe(user.passwordHash);
  });

  it("refuses a wrong current password, in words that say nothing about the account", async () => {
    const user = await makeUser("wrong@b.invalid", "abcdef");
    session.user = { id: user.id, role: "user", status: "active" };
    const result = await changePassword({ currentPassword: "not-it", newPassword: "ghijkl" });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("INVALID_CURRENT_PASSWORD");
    expect(result.body.message).toBe("Текущий пароль указан неверно.");
    const after = await db.user.findUnique({ where: { id: user.id } });
    expect(after!.passwordHash).toBe(user.passwordHash);
  });

  it("refuses a new password of five", async () => {
    const user = await makeUser("short@b.invalid", "abcdef");
    session.user = { id: user.id, role: "user", status: "active" };
    const result = await changePassword({ currentPassword: "abcdef", newPassword: "abcde" });
    expect(result.status).toBe(400);
    const after = await db.user.findUnique({ where: { id: user.id } });
    expect(after!.passwordHash).toBe(user.passwordHash);
  });

  it("accepts six, rotates the session, and leaves the old token dead", async () => {
    const { issueSession, resolveSession, SESSION_COOKIE_NAME } = await import("@/lib/session");
    const user = await makeUser("ok@b.invalid", "abcdef");
    session.user = { id: user.id, role: "user", status: "active" };

    const oldToken = await issueSession(user.id);
    expect(await resolveSession(oldToken)).not.toBeNull();

    const result = await changePassword({ currentPassword: "abcdef", newPassword: "ghijkl" });
    expect(result.status).toBe(200);

    // The hash moved, the old password is gone, the new one works.
    const after = await db.user.findUnique({ where: { id: user.id } });
    expect(after!.passwordHash).not.toBe(user.passwordHash);
    expect(await bcrypt.compare("abcdef", after!.passwordHash)).toBe(false);
    expect(await bcrypt.compare("ghijkl", after!.passwordHash)).toBe(true);

    // The token the browser arrived with no longer resolves...
    expect(await resolveSession(oldToken)).toBeNull();

    // ...and the response carries one that does.
    const setCookie = result.response.cookies.get(SESSION_COOKIE_NAME);
    expect(setCookie, "the response must carry a replacement session cookie").toBeTruthy();
    expect(setCookie!.value).not.toBe(oldToken);
    expect(await resolveSession(setCookie!.value)).not.toBeNull();

    // Exactly one live row, and the old one is revoked rather than deleted.
    const rows = await db.userSession.findMany({ where: { userId: user.id } });
    expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1);
    expect(rows.filter((r) => r.revokedAt !== null).length).toBeGreaterThanOrEqual(1);
  });

  it("re-entering the same password is allowed and still rotates", async () => {
    const { issueSession, resolveSession } = await import("@/lib/session");
    const user = await makeUser("same@b.invalid", "abcdef");
    session.user = { id: user.id, role: "user", status: "active" };
    const oldToken = await issueSession(user.id);

    const result = await changePassword({ currentPassword: "abcdef", newPassword: "abcdef" });
    expect(result.status).toBe(200);
    expect(await resolveSession(oldToken)).toBeNull();
  });

  it("touches nobody else", async () => {
    const victim = await makeUser("victim@b.invalid", "victimpass");
    const actor = await makeUser("actor@b.invalid", "abcdef");
    const { issueSession, resolveSession } = await import("@/lib/session");
    const victimToken = await issueSession(victim.id);

    session.user = { id: actor.id, role: "user", status: "active" };
    expect((await changePassword({ currentPassword: "abcdef", newPassword: "ghijkl" })).status).toBe(200);

    const after = await db.user.findUnique({ where: { id: victim.id } });
    expect(after!.passwordHash).toBe(victim.passwordHash);
    expect(await resolveSession(victimToken)).not.toBeNull();
  });

  it("puts no password, hash or token anywhere a reader can see", async () => {
    const user = await makeUser("quiet@b.invalid", "abcdef");
    session.user = { id: user.id, role: "user", status: "active" };
    const result = await changePassword({ currentPassword: "abcdef", newPassword: "secret-value" });
    expect(result.status).toBe(200);

    for (const forbidden of ["abcdef", "secret-value", "passwordHash", "tokenHash", "$2a$", "$2b$"]) {
      expect(result.raw, `response body leaked ${forbidden}`).not.toContain(forbidden);
    }
    expect(Object.keys(result.body)).toEqual(["ok"]);

    const audits = await db.auditLog.findMany({ where: { userId: user.id } });
    expect(audits.length).toBeGreaterThan(0);
    for (const entry of audits) {
      const serialised = JSON.stringify(entry);
      for (const forbidden of ["abcdef", "secret-value", "$2a$", "$2b$"]) {
        expect(serialised, `audit leaked ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("rate limits repeated attempts", async () => {
    const user = await makeUser("burst@b.invalid", "abcdef");
    session.user = { id: user.id, role: "user", status: "active" };
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      statuses.push((await changePassword({ currentPassword: "nope", newPassword: "ghijkl" })).status);
    }
    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(2);
  });
});

/* ------------------------------------------------------------- atomicity */

describe("the hash and the session are one commit", () => {
  it("a failure inside the rotation leaves both the password and the session as they were", async () => {
    const { issueSession, issueSessionWithin, resolveSession } = await import("@/lib/session");
    const user = await makeUser("atomic@b.invalid", "abcdef");
    const token = await issueSession(user.id);

    const newHash = await bcrypt.hash("ghijkl", 10);
    await expect(
      issueSessionWithin(user.id, async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
        throw new Error("rotation failed after the password write");
      }),
    ).rejects.toThrow("rotation failed");

    // Neither half survived.
    const after = await db.user.findUnique({ where: { id: user.id } });
    expect(await bcrypt.compare("abcdef", after!.passwordHash)).toBe(true);
    expect(await bcrypt.compare("ghijkl", after!.passwordHash)).toBe(false);
    expect(await resolveSession(token), "the old session must survive a failed rotation").not.toBeNull();
  });
});
