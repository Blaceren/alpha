import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

/**
 * ACCOUNT RECOVERY — the password reset, the confirmation of an address and its
 * change, proved over HTTP.
 *
 * WHAT IS REAL HERE. A throwaway SQLite file, the real Prisma singleton, the
 * exported route handlers, real `Request` objects, the real CSRF check, the
 * real rate limiter, the real bcrypt, the real session table and the real
 * templates. A reset is not "the handler returned 200": it is that the old
 * password stops working, the session that was open stops resolving, the link
 * cannot be used twice, and the message that left carries a link whose token
 * is nowhere in the database.
 *
 * THREE BOUNDARIES ARE SUBSTITUTED: `getCurrentUser` (needs a cookie jar),
 * `verifyCaptcha` (needs Cloudflare) and the mail transport, which collects
 * messages in memory instead of delivering them — the configuration that
 * selects it is the real one.
 */

type SessionUser = { id: number; role: string; status: string; emailVerifiedAt?: Date | null } | null;
const session: { user: SessionUser } = { user: null };
const captcha: { ok: boolean; seen: { purpose?: string; surface?: string | null }[] } = { ok: true, seen: [] };

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getCurrentUser: async () => session.user };
});

vi.mock("@/lib/captcha", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    verifyCaptcha: async (input: { purpose: string; surface?: { name: string } | null }) => {
      captcha.seen.push({ purpose: input.purpose, surface: input.surface?.name ?? null });
      return captcha.ok
        ? { ok: true, outcome: "success", provider: "turnstile" }
        : { ok: false, outcome: "invalid_token", code: "CAPTCHA_FAILED", status: 400, message: "Проверка не пройдена.", renewToken: true };
    },
  };
});

const ORIGIN = "https://academy.example.invalid";
const MAIL_ENV = {
  ATA_ENVIRONMENT: "dev",
  MAIL_TRANSPORT: "outbox",
  MAIL_FROM: "Alfa Trade Academy <no-reply@example.invalid>",
  MAIL_OUTBOX_DIR: "/nonexistent/never-written-by-this-test",
  PUBLIC_APP_URL: ORIGIN,
} as const;

function mailOn() {
  Object.assign(process.env, MAIL_ENV);
}
function mailOff() {
  for (const key of Object.keys(MAIL_ENV)) delete process.env[key];
}

type Sent = { kind: string; to: string; subject: string; text: string; html: string };
const sent: Sent[] = [];

let dir: string;
let db: PrismaClient;
let ipCounter = 0;
const CSRF = "0".repeat(64);

/** Every request gets its own address unless a test is about the address. */
function nextIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 250}`;
}

function request(method: string, url: string, body: unknown, opts: { csrf?: boolean; ip?: string; surface?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.ip ?? nextIp() };
  if (opts.csrf) {
    headers.cookie = `trading_platform_csrf=${CSRF}`;
    headers["x-csrf-token"] = CSRF;
  }
  if (opts.surface) headers["x-ata-auth-surface"] = opts.surface;
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function call(handler: (request: Request) => Promise<Response>, req: Request) {
  const response = await handler(req);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function settle() {
  const { settleDetachedWork } = await import("@/lib/account/background");
  await settleDetachedWork();
}

async function makeUser(email: string, password: string, extra: Record<string, unknown> = {}) {
  return db.user.create({
    data: { email, name: "Тестовое имя", passwordHash: await bcrypt.hash(password, 10), role: "user", level: 1, ...extra },
  });
}

function tokenFrom(message: Sent, path: string) {
  const match = new RegExp(`${ORIGIN.replace(/\./g, "\\.")}${path}#token=([A-Za-z0-9_%-]+)`).exec(message.text);
  expect(match, `no ${path} link in the message`).not.toBeNull();
  return decodeURIComponent(match![1]!);
}

async function requestReset(email: string, opts: { ip?: string } = {}) {
  const { POST } = await import("@/app/api/auth/password-reset/request/route");
  const result = await call(POST, request("POST", "http://backend.invalid/api/auth/password-reset/request", { email, captchaToken: "t" }, { ...opts, surface: "academy_password_reset" }));
  await settle();
  return result;
}

async function confirmReset(token: string, newPassword: string) {
  const { POST } = await import("@/app/api/auth/password-reset/confirm/route");
  return call(POST, request("POST", "http://backend.invalid/api/auth/password-reset/confirm", { token, newPassword }));
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ata-account-"));
  const url = `file:${dir}/test.db`;
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  process.env.DATABASE_URL = url;
  db = new PrismaClient({ datasources: { db: { url } } });
  const { setMailTransportForTests } = await import("@/lib/mail/transport");
  setMailTransportForTests({
    name: "memory",
    async send(message) {
      sent.push({ ...message });
    },
  });
}, 180_000);

afterAll(async () => {
  const { setMailTransportForTests } = await import("@/lib/mail/transport");
  setMailTransportForTests(null);
  mailOff();
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  sent.length = 0;
  captcha.ok = true;
  captcha.seen.length = 0;
  session.user = null;
  mailOn();
});

/* ------------------------------------------------------------------ config */

describe("mail configuration — disabled unless all of it is right", () => {
  it("is disabled when nothing is set, and that is not an error", async () => {
    const { resolveMailConfig, isMailEnabled } = await import("@/lib/mail/config");
    expect(resolveMailConfig({} as NodeJS.ProcessEnv)).toEqual({ kind: "disabled" });
    expect(isMailEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("refuses every half-configured state by name", async () => {
    const { resolveMailConfig } = await import("@/lib/mail/config");
    const base = { ...MAIL_ENV } as Record<string, string>;
    const reason = (env: Record<string, string | undefined>) => {
      const result = resolveMailConfig(env as NodeJS.ProcessEnv);
      return result.kind === "invalid" ? result.reason : result.kind;
    };
    expect(reason({ ...base, MAIL_TRANSPORT: "smtp" })).toBe("transport_unrecognised");
    expect(reason({ ...base, MAIL_TRANSPORT: " outbox" })).toBe("transport_unrecognised");
    expect(reason({ ...base, MAIL_FROM: undefined })).toBe("from_absent");
    expect(reason({ ...base, MAIL_FROM: "not an address" })).toBe("from_malformed");
    expect(reason({ ...base, MAIL_FROM: "A <a@b.c>\r\nBcc: x@y.z" })).toBe("from_malformed");
    expect(reason({ ...base, PUBLIC_APP_URL: undefined })).toBe("public_origin_absent");
    expect(reason({ ...base, ATA_ENVIRONMENT: "staging" })).toBe("outbox_outside_dev");
    expect(reason({ ...base, ATA_ENVIRONMENT: "production" })).toBe("outbox_outside_dev");
    expect(reason({ ...base, MAIL_OUTBOX_DIR: undefined })).toBe("outbox_dir_absent");
    expect(reason({ ...base, MAIL_OUTBOX_DIR: "relative/dir" })).toBe("outbox_dir_not_absolute");
    expect(reason(base)).toBe("configured");
  });

  it("reads the sender's address out of either form", async () => {
    const { parseMailFrom } = await import("@/lib/mail/config");
    expect(parseMailFrom("no-reply@example.invalid")?.address).toBe("no-reply@example.invalid");
    expect(parseMailFrom("Alfa Trade Academy <no-reply@example.invalid>")?.address).toBe("no-reply@example.invalid");
    expect(parseMailFrom("<no-reply@example.invalid>")).toBeNull();
    expect(parseMailFrom("")).toBeNull();
  });

  it("makes a half-configured mail a startup error and absent mail none", async () => {
    const { validateRuntimeEnv } = await import("@/lib/env");
    const withMail = validateRuntimeEnv({ ...process.env, MAIL_FROM: "" } as NodeJS.ProcessEnv);
    expect(withMail.errors).toContain("MAIL_FROM is required when MAIL_TRANSPORT is set");
    const without = { ...process.env } as Record<string, string | undefined>;
    for (const key of ["MAIL_TRANSPORT", "MAIL_FROM", "MAIL_OUTBOX_DIR"]) delete without[key];
    expect(validateRuntimeEnv(without as NodeJS.ProcessEnv).errors.filter((e) => e.includes("MAIL_"))).toEqual([]);
  });

  it("tells the Academy the truth about what it can do", async () => {
    const { GET } = await import("@/app/api/auth/capabilities/route");
    const on = await (await GET()).json();
    expect(on).toEqual({ capabilities: { passwordRecovery: true, emailVerification: true, emailChange: true } });
    mailOff();
    const off = await (await GET()).json();
    expect(off).toEqual({ capabilities: { passwordRecovery: false, emailVerification: false, emailChange: false } });
  });
});

/* --------------------------------------------------------------- templates */

describe("the messages", () => {
  it("say the same thing in text and HTML, carry the link, and escape the name", async () => {
    const t = await import("@/lib/mail/templates");
    const link = `${ORIGIN}/reset-password#token=abc`;
    const message = t.passwordResetMessage({ to: "a@example.invalid", name: `<b>"Имя"</b>`, link, minutes: 60 });
    expect(message.kind).toBe("password_reset");
    expect(message.text).toContain(link);
    expect(message.html).toContain("https://academy.example.invalid/reset-password#token=abc");
    expect(message.html).not.toContain("<b>");
    expect(message.html).toContain("&lt;b&gt;");
    expect(message.text).toContain("60 минут");
  });

  it("never name the trading environment, money or the learner's progress", async () => {
    const t = await import("@/lib/mail/templates");
    const all = [
      t.verifyEmailMessage({ to: "a@example.invalid", name: "Имя", link: "https://x.invalid/#token=1" }),
      t.passwordResetMessage({ to: "a@example.invalid", name: "Имя", link: "https://x.invalid/#token=1", minutes: 60 }),
      t.passwordChangedMessage({ to: "a@example.invalid", name: "Имя" }),
      t.emailChangeConfirmMessage({ to: "a@example.invalid", name: "Имя", link: "https://x.invalid/#token=1" }),
      t.emailChangeNoticeMessage({ to: "a@example.invalid", name: "Имя", newEmail: "new.address@example.invalid" }),
      t.emailChangedMessage({ to: "a@example.invalid", name: "Имя", newEmail: "new.address@example.invalid" }),
    ];
    for (const message of all) {
      const everything = `${message.subject}\n${message.text}\n${message.html}`;
      expect(everything).not.toMatch(/pocket|депозит|баланс|уровен|\$\d|парол[ья] [^\s]+:/i);
      expect(message.subject).toContain("Alfa Trade Academy");
    }
    // A notice to the OLD address shows the new one masked, never in full.
    expect(all[4]!.text).toContain("ne***@example.invalid");
    expect(all[4]!.text).not.toContain("new.address@example.invalid");
  });

  it("masks an address so it can be recognised and not copied", async () => {
    const { maskEmail } = await import("@/lib/mail/templates");
    expect(maskEmail("ivan.petrov@example.invalid")).toBe("iv***@example.invalid");
    expect(maskEmail("a@example.invalid")).toBe("a***@example.invalid");
    expect(maskEmail("nonsense")).toBe("***");
  });
});

/* ------------------------------------------------------------------ tokens */

describe("a link's token", () => {
  it("is stored only as a hash, works once, and retires the one before it", async () => {
    const { issueAccountActionToken, consumeAccountActionToken, hashAccountToken } = await import("@/lib/account/tokens");
    const user = await makeUser("tokens@example.invalid", "Password-1");
    const first = await db.$transaction((tx) => issueAccountActionToken(tx, { userId: user.id, kind: "password_reset" }));
    const second = await db.$transaction((tx) => issueAccountActionToken(tx, { userId: user.id, kind: "password_reset" }));
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const rows = await db.accountActionToken.findMany({ where: { userId: user.id } });
    expect(rows.map((row) => row.tokenHash).sort()).toEqual([hashAccountToken(first), hashAccountToken(second)].sort());
    expect(JSON.stringify(rows)).not.toContain(first);

    // The first link was retired by the second.
    expect(await db.$transaction((tx) => consumeAccountActionToken(tx, first, "password_reset"))).toBeNull();
    // The wrong kind is not this link.
    expect(await db.$transaction((tx) => consumeAccountActionToken(tx, second, "email_change"))).toBeNull();
    expect(await db.$transaction((tx) => consumeAccountActionToken(tx, second, "password_reset"))).toEqual({ userId: user.id, newEmail: null });
    expect(await db.$transaction((tx) => consumeAccountActionToken(tx, second, "password_reset"))).toBeNull();
  });

  it("is refused by shape before the database is asked", async () => {
    const { consumeAccountActionToken } = await import("@/lib/account/tokens");
    for (const bad of ["", "short", "a".repeat(44), "a".repeat(42) + "!", 42, null, undefined]) {
      expect(await db.$transaction((tx) => consumeAccountActionToken(tx, bad, "password_reset"))).toBeNull();
    }
  });

  it("is checked by the table itself: kind, hash shape, and newEmail exactly for a change", () => {
    const sql = readFileSync(join(process.cwd(), "prisma/migrations/20261001120000_account_action_token/migration.sql"), "utf8");
    // The runner splits on every semicolon, comments included.
    expect(sql.split("\n").filter((line) => line.startsWith("--") && line.includes(";"))).toEqual([]);
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec('CREATE TABLE "User" ("id" INTEGER PRIMARY KEY);INSERT INTO "User" VALUES (1);');
    sqlite.exec(sql);
    const insert = (kind: string, hash: string, newEmail: string | null) =>
      sqlite.prepare('INSERT INTO "AccountActionToken" ("id","userId","kind","tokenHash","newEmail","expiresAt") VALUES (?,?,?,?,?,?)').run(`${kind}-${hash.slice(0, 4)}-${String(newEmail)}`, 1, kind, hash, newEmail, 1);
    const good = "a".repeat(64);
    expect(() => insert("password_reset", "zz", null)).toThrow(/CHECK/);
    expect(() => insert("password_reset", "A".repeat(64), null)).toThrow(/CHECK/);
    expect(() => insert("something_else", good, null)).toThrow(/CHECK/);
    expect(() => insert("password_reset", good, "x@example.invalid")).toThrow(/CHECK/);
    expect(() => insert("email_change", "b".repeat(64), null)).toThrow(/CHECK/);
    expect(() => insert("email_change", "c".repeat(64), "x@example.invalid")).not.toThrow();
    expect(() => insert("password_reset", good, null)).not.toThrow();
    expect(() => insert("password_reset", good, null)).toThrow(/UNIQUE/);
    sqlite.close();
  });
});

/* ---------------------------------------------------------- password reset */

describe("password reset — the request says nothing about the address", () => {
  it("is refused where no mail can be sent, and promises nothing", async () => {
    mailOff();
    await makeUser("nomail@example.invalid", "Password-1");
    const result = await requestReset("nomail@example.invalid");
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("RECOVERY_UNAVAILABLE");
    expect(sent).toEqual([]);
    expect(await db.accountActionToken.count({ where: { kind: "password_reset", user: { email: "nomail@example.invalid" } } })).toBe(0);
  });

  it("answers the same for a known, an unknown and a blocked address — and mails only the first", async () => {
    await makeUser("known@example.invalid", "Password-1");
    await makeUser("blocked@example.invalid", "Password-1", { status: "blocked" });
    const known = await requestReset("Known@Example.invalid");
    const unknown = await requestReset("nobody@example.invalid");
    const blocked = await requestReset("blocked@example.invalid");
    expect([known, unknown, blocked].map((r) => [r.status, r.body])).toEqual([[200, { ok: true }], [200, { ok: true }], [200, { ok: true }]]);
    expect(sent.map((m) => [m.kind, m.to])).toEqual([["password_reset", "known@example.invalid"]]);
    // The challenge is the recovery surface's, in every environment.
    expect(captcha.seen.every((seen) => seen.purpose === "recovery" && seen.surface === "academy_password_reset")).toBe(true);
  });

  it("is verified by the challenge before anything is looked up", async () => {
    await makeUser("challenged@example.invalid", "Password-1");
    captcha.ok = false;
    const result = await requestReset("challenged@example.invalid");
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("CAPTCHA_FAILED");
    expect(sent).toEqual([]);
  });

  it("cannot be used to flood one mailbox: three messages an hour, whoever asks", async () => {
    await makeUser("flood@example.invalid", "Password-1");
    for (let i = 0; i < 5; i += 1) expect((await requestReset("flood@example.invalid")).status).toBe(200);
    expect(sent.filter((m) => m.to === "flood@example.invalid")).toHaveLength(3);
  });

  it("limits one network address", async () => {
    const ip = "203.0.113.77";
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) statuses.push((await requestReset(`nobody-${i}@example.invalid`, { ip })).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429]);
  });
});

describe("password reset — the link", () => {
  it("sets the password, closes every session, confirms the address, and works once", async () => {
    const user = await makeUser("reset@example.invalid", "Old-password-1");
    await db.userSession.create({ data: { userId: user.id, tokenHash: "f".repeat(64), expiresAt: new Date(Date.now() + 3_600_000) } });
    await requestReset("reset@example.invalid");
    const token = tokenFrom(sent[0]!, "/reset-password");
    // The token in the message is nowhere in the database.
    expect(JSON.stringify(await db.accountActionToken.findMany({ where: { userId: user.id } }))).not.toContain(token);

    const tooShort = await confirmReset(token, "123");
    expect(tooShort.status).toBe(400);

    const done = await confirmReset(token, "New-password-2");
    expect(done).toEqual({ status: 200, body: { ok: true } });

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare("New-password-2", after.passwordHash)).toBe(true);
    expect(await bcrypt.compare("Old-password-1", after.passwordHash)).toBe(false);
    expect(after.emailVerifiedAt).not.toBeNull();
    expect(await db.userSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(sent.map((m) => m.kind)).toEqual(["password_reset", "password_changed"]);

    const again = await confirmReset(token, "Third-password-3");
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("INVALID_TOKEN");
    expect(await bcrypt.compare("New-password-2", (await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash)).toBe(true);
  });

  it("answers one way for an unknown, a malformed and an expired link", async () => {
    const user = await makeUser("expired@example.invalid", "Old-password-1");
    await requestReset("expired@example.invalid");
    const token = tokenFrom(sent[0]!, "/reset-password");
    await db.accountActionToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const answers = [await confirmReset(token, "New-password-2"), await confirmReset("A".repeat(43), "New-password-2"), await confirmReset("nonsense", "New-password-2")];
    expect(answers.map((a) => [a.status, a.body.error])).toEqual([[400, "INVALID_TOKEN"], [400, "INVALID_TOKEN"], [400, "INVALID_TOKEN"]]);
    expect(await bcrypt.compare("Old-password-1", (await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash)).toBe(true);
  });

  it("leaves only the newest link working", async () => {
    await makeUser("twice@example.invalid", "Old-password-1");
    await requestReset("twice@example.invalid");
    await requestReset("twice@example.invalid");
    const [first, second] = sent.filter((m) => m.kind === "password_reset").map((m) => tokenFrom(m, "/reset-password"));
    expect((await confirmReset(first!, "New-password-2")).status).toBe(400);
    expect((await confirmReset(second!, "New-password-2")).status).toBe(200);
  });
});

/* ------------------------------------------------------------ verification */

describe("confirming the address", () => {
  async function resend(user: NonNullable<SessionUser>, opts: { csrf?: boolean } = { csrf: true }) {
    session.user = user;
    const { POST } = await import("@/app/api/auth/resend-verification/route");
    return call(POST, request("POST", "http://backend.invalid/api/auth/resend-verification", {}, opts));
  }

  it("sends the message again, and the link confirms the address", async () => {
    const user = await makeUser("verify@example.invalid", "Password-1");
    const result = await resend({ id: user.id, role: "user", status: "active", emailVerifiedAt: null });
    expect(result).toEqual({ status: 200, body: { ok: true, sent: true } });
    expect(sent.map((m) => [m.kind, m.to])).toEqual([["verify_email", "verify@example.invalid"]]);

    const token = tokenFrom(sent[0]!, "/verify-email");
    const { POST } = await import("@/app/api/auth/verify-email/route");
    expect((await call(POST, request("POST", "http://backend.invalid/api/auth/verify-email", { token }))).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
    expect((await call(POST, request("POST", "http://backend.invalid/api/auth/verify-email", { token }))).status).toBe(400);
  });

  it("does not pretend where no mail can be sent, and needs the CSRF token", async () => {
    const user = await makeUser("verify-off@example.invalid", "Password-1");
    const principal = { id: user.id, role: "user", status: "active", emailVerifiedAt: null };
    expect((await resend(principal, { csrf: false })).status).toBe(403);
    mailOff();
    const result = await resend(principal);
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("VERIFICATION_UNAVAILABLE");
    expect(sent).toEqual([]);
  });

  it("says so when the address is already confirmed", async () => {
    const user = await makeUser("verified@example.invalid", "Password-1", { emailVerifiedAt: new Date() });
    const result = await resend({ id: user.id, role: "user", status: "active", emailVerifiedAt: new Date() });
    expect(result.body).toEqual({ ok: true, alreadyVerified: true });
    expect(sent).toEqual([]);
  });
});

/* ------------------------------------------------------------ email change */

describe("changing the address", () => {
  async function ask(userId: number, body: unknown, opts: { csrf?: boolean } = { csrf: true }) {
    session.user = { id: userId, role: "user", status: "active" };
    const { POST } = await import("@/app/api/me/email-change/route");
    return call(POST, request("POST", "http://backend.invalid/api/me/email-change", body, opts));
  }
  async function cancel(userId: number) {
    session.user = { id: userId, role: "user", status: "active" };
    const { POST } = await import("@/app/api/me/email-change/cancel/route");
    return call(POST, request("POST", "http://backend.invalid/api/me/email-change/cancel", {}, { csrf: true }));
  }
  async function confirm(token: string) {
    const { POST } = await import("@/app/api/auth/email-change/confirm/route");
    return call(POST, request("POST", "http://backend.invalid/api/auth/email-change/confirm", { token }));
  }

  it("takes the current password, a session alone is not enough", async () => {
    const user = await makeUser("owner@example.invalid", "Password-1");
    expect((await ask(user.id, { newEmail: "new@example.invalid", currentPassword: "Password-1" }, { csrf: false })).status).toBe(403);
    const wrong = await ask(user.id, { newEmail: "new@example.invalid", currentPassword: "not-it" });
    expect([wrong.status, wrong.body.error]).toEqual([400, "INVALID_PASSWORD"]);
    const same = await ask(user.id, { newEmail: "owner@example.invalid", currentPassword: "Password-1" });
    expect([same.status, same.body.error]).toEqual([400, "SAME_EMAIL"]);
    session.user = null;
    const { POST } = await import("@/app/api/me/email-change/route");
    expect((await call(POST, request("POST", "http://backend.invalid/api/me/email-change", { newEmail: "new@example.invalid", currentPassword: "Password-1" }, { csrf: true }))).status).toBe(401);
    expect(sent).toEqual([]);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).pendingEmail).toBeNull();
  });

  it("changes nothing until the new mailbox answers, and tells the old one twice", async () => {
    const user = await makeUser("before@example.invalid", "Password-1");
    const asked = await ask(user.id, { newEmail: "After@Example.invalid", currentPassword: "Password-1" });
    expect(asked).toEqual({ status: 200, body: { ok: true, pendingEmail: "after@example.invalid" } });
    expect(sent.map((m) => [m.kind, m.to])).toEqual([
      ["email_change_confirm", "after@example.invalid"],
      ["email_change_notice", "before@example.invalid"],
    ]);

    const pending = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect([pending.email, pending.pendingEmail, pending.emailVerifiedAt]).toEqual(["before@example.invalid", "after@example.invalid", null]);

    const token = tokenFrom(sent[0]!, "/confirm-email");
    expect(await confirm(token)).toEqual({ status: 200, body: { ok: true } });
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect([after.email, after.pendingEmail]).toEqual(["after@example.invalid", null]);
    expect(after.emailVerifiedAt).not.toBeNull();
    expect(sent.map((m) => [m.kind, m.to]).at(-1)).toEqual(["email_changed", "before@example.invalid"]);
    expect((await confirm(token)).status).toBe(400);
  });

  it("refuses an address another account holds or is waiting for", async () => {
    await makeUser("taken@example.invalid", "Password-1");
    const waiting = await makeUser("waiting@example.invalid", "Password-1");
    await ask(waiting.id, { newEmail: "wanted@example.invalid", currentPassword: "Password-1" });
    const user = await makeUser("asker@example.invalid", "Password-1");
    const taken = await ask(user.id, { newEmail: "taken@example.invalid", currentPassword: "Password-1" });
    const wanted = await ask(user.id, { newEmail: "wanted@example.invalid", currentPassword: "Password-1" });
    expect([taken.status, taken.body.error, wanted.status, wanted.body.error]).toEqual([409, "EMAIL_IN_USE", 409, "EMAIL_IN_USE"]);
  });

  it("a cancelled request leaves its link dead", async () => {
    const user = await makeUser("cancel@example.invalid", "Password-1");
    await ask(user.id, { newEmail: "cancelled@example.invalid", currentPassword: "Password-1" });
    const token = tokenFrom(sent[0]!, "/confirm-email");
    expect((await cancel(user.id)).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).pendingEmail).toBeNull();
    expect((await confirm(token)).status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe("cancel@example.invalid");
  });

  it("a second request retires the first link", async () => {
    const user = await makeUser("replace@example.invalid", "Password-1");
    await ask(user.id, { newEmail: "first@example.invalid", currentPassword: "Password-1" });
    await ask(user.id, { newEmail: "second@example.invalid", currentPassword: "Password-1" });
    const confirms = sent.filter((m) => m.kind === "email_change_confirm").map((m) => tokenFrom(m, "/confirm-email"));
    expect((await confirm(confirms[0]!)).status).toBe(400);
    expect((await confirm(confirms[1]!)).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe("second@example.invalid");
  });

  it("gives way when another account took the address before the link was opened", async () => {
    const user = await makeUser("slow@example.invalid", "Password-1");
    await ask(user.id, { newEmail: "contested@example.invalid", currentPassword: "Password-1" });
    const token = tokenFrom(sent[0]!, "/confirm-email");
    await db.user.update({ where: { id: user.id }, data: { pendingEmail: null } });
    await makeUser("contested@example.invalid", "Password-1");
    await db.user.update({ where: { id: user.id }, data: { pendingEmail: "contested@example.invalid" } }).catch(() => undefined);
    const result = await confirm(token);
    expect(result.status === 409 || result.status === 400).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe("slow@example.invalid");
  });

  it("cannot be asked for where no mail can be sent", async () => {
    mailOff();
    const user = await makeUser("nochannel@example.invalid", "Password-1");
    const result = await ask(user.id, { newEmail: "other@example.invalid", currentPassword: "Password-1" });
    expect([result.status, result.body.error]).toEqual([503, "MAIL_UNAVAILABLE"]);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).pendingEmail).toBeNull();
  });

  it("is what the profile reads: the address, its state, and what can be done", async () => {
    const user = await makeUser("account@example.invalid", "Password-1");
    const { GET } = await import("@/app/api/me/account/route");
    session.user = null;
    expect((await GET(request("GET", "http://backend.invalid/api/me/account", undefined))).status).toBe(401);
    session.user = { id: user.id, role: "user", status: "active" };
    await ask(user.id, { newEmail: "account-next@example.invalid", currentPassword: "Password-1" });
    const body = await (await GET(request("GET", "http://backend.invalid/api/me/account", undefined))).json();
    expect(body).toEqual({
      account: { email: "account@example.invalid", emailVerified: false, pendingEmail: "account-next@example.invalid" },
      capabilities: { passwordRecovery: true, emailVerification: true, emailChange: true },
    });
    // Three fields about the address and nothing else about the account.
    expect(Object.keys(body.account).sort()).toEqual(["email", "emailVerified", "pendingEmail"]);
  });

  it("is no longer something PATCH /api/me does", async () => {
    const user = await makeUser("patch@example.invalid", "Password-1");
    session.user = { id: user.id, role: "user", status: "active" };
    const { PATCH } = await import("@/app/api/me/route");
    const withEmail = await call(PATCH, request("PATCH", "http://backend.invalid/api/me", { email: "sneaky@example.invalid" }, { csrf: true }));
    expect(withEmail.status).toBe(400);
    const both = await call(PATCH, request("PATCH", "http://backend.invalid/api/me", { name: "Новое имя", email: "sneaky@example.invalid" }, { csrf: true }));
    expect(both.status).toBe(400);
    const nameOnly = await call(PATCH, request("PATCH", "http://backend.invalid/api/me", { name: "Новое имя" }, { csrf: true }));
    expect(nameOnly.status).toBe(200);
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect([after.name, after.pendingEmail]).toEqual(["Новое имя", null]);
  });
});

/* -------------------------------------------------------------- the audit */

describe("what the audit keeps", () => {
  it("names the kind of message and never an address, a link or a token", async () => {
    await makeUser("audited@example.invalid", "Password-1");
    await requestReset("audited@example.invalid");
    const token = tokenFrom(sent[0]!, "/reset-password");
    const rows = await db.auditLog.findMany({ where: { action: { in: ["MAIL_SENT", "MAIL_SEND_FAILED", "AUTH_PASSWORD_RESET_REQUESTED"] } } });
    const dump = JSON.stringify(rows);
    expect(dump).toContain("password_reset");
    expect(dump).not.toContain("audited@example.invalid");
    expect(dump).not.toContain(token);
    expect(dump).not.toContain("#token=");
  });
});
