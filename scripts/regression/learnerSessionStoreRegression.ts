/**
 * H-7 — the learner session store, exercised against a real database.
 *
 * Every case below runs on an ISOLATED SQLite file created for this process and
 * deleted at the end. The live PREPROD database is never opened, never migrated
 * and never written to, and no real login or logout is performed.
 *
 * The matrix is the one the product decision names: one active session per
 * user, the newest login wins, logout revokes on the server, and every failure
 * mode is closed rather than open.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dbPath = `/tmp/ata-session-store-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

async function main() {
  cleanup();
  process.env.DATABASE_URL = dbUrl;

  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  assert.equal(migration.status, 0, `migration failed:\n${migration.stdout}\n${migration.stderr}`);

  const { prisma } = await import("../../src/lib/prisma");
  const session = await import("../../src/lib/session");

  const user = await prisma.user.create({
    data: { email: `s${process.pid}@example.test`, passwordHash: "x", name: "S", role: "user" },
  });
  const other = await prisma.user.create({
    data: { email: `o${process.pid}@example.test`, passwordHash: "x", name: "O", role: "user" },
  });

  // ---------------------------------------------------------------- issuance
  let firstToken = "";
  await check("1. a first login creates exactly one live server-side session", async () => {
    firstToken = await session.issueSession(user.id);
    const live = await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } });
    assert.equal(live, 1);
    const resolved = await session.resolveSession(firstToken);
    assert.equal(resolved?.userId, user.id);
    assert.equal(resolved?.role, "user");
  });

  await check("2. the raw token is nowhere in the database — only its hash", async () => {
    const rows = await prisma.userSession.findMany({ where: { userId: user.id } });
    for (const row of rows) {
      assert.notEqual(row.tokenHash, firstToken, "the raw token was stored");
      assert.equal(row.tokenHash, createHash("sha256").update(firstToken, "utf8").digest("hex"));
    }
    // And no column anywhere holds it.
    const dump = JSON.stringify(rows);
    assert.ok(!dump.includes(firstToken), "the raw token appears in the row");
  });

  let secondToken = "";
  await check("3. a second login revokes the first", async () => {
    secondToken = await session.issueSession(user.id);
    assert.notEqual(secondToken, firstToken);
    const live = await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } });
    assert.equal(live, 1, "two sessions survived a second login");
  });

  await check("4. the first token no longer authenticates", async () => {
    assert.equal(await session.resolveSession(firstToken), null);
  });

  await check("5. the second token does", async () => {
    assert.equal((await session.resolveSession(secondToken))?.userId, user.id);
  });

  // ------------------------------------------------------------------ logout
  await check("6. logout revokes the session on the server", async () => {
    await session.revokeSession(secondToken);
    assert.equal(await session.resolveSession(secondToken), null);
    const live = await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } });
    assert.equal(live, 0);
  });

  await check("7. logging out again is safe", async () => {
    await session.revokeSession(secondToken);
    await session.revokeSession("a-token-that-never-existed");
    await session.revokeSession(undefined);
  });

  await check("8. a token copied before logout does not work after it", async () => {
    const copied = await session.issueSession(user.id);
    assert.ok(await session.resolveSession(copied));
    await session.revokeSession(copied);
    assert.equal(await session.resolveSession(copied), null);
  });

  // ------------------------------------------------------------- concurrency
  await check("9. concurrent logins leave exactly one live session", async () => {
    const tokens = await Promise.all([
      session.issueSession(other.id),
      session.issueSession(other.id),
      session.issueSession(other.id),
      session.issueSession(other.id),
    ]);
    const live = await prisma.userSession.count({ where: { userId: other.id, revokedAt: null } });
    assert.equal(live, 1, `four concurrent logins left ${live} live sessions`);
    const working = [];
    for (const token of tokens) if (await session.resolveSession(token)) working.push(token);
    assert.equal(working.length, 1, "more than one token still authenticates");
  });

  // ----------------------------------------------------------- failure modes
  await check("10. an expired session fails closed", async () => {
    const token = await session.issueSession(user.id);
    await prisma.userSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    assert.equal(await session.resolveSession(token), null);
  });

  await check("11. malformed, random and empty tokens fail closed", async () => {
    for (const bad of ["", "   ", "not-a-token", "a".repeat(4096), "1.user.999.deadbeef"]) {
      assert.equal(await session.resolveSession(bad), null, `accepted ${bad.slice(0, 20)}`);
    }
    assert.equal(await session.resolveSession(undefined), null);
    assert.equal(await session.resolveSession(null), null);
  });

  await check("12. a legacy stateless HMAC token is rejected", async () => {
    // The exact shape the old implementation issued.
    const legacy = `${user.id}.user.${Date.now() + 60_000}.` + "0".repeat(64);
    assert.equal(await session.resolveSession(legacy), null);
  });

  await check("13. a deleted session is unknown, not trusted", async () => {
    const token = await session.issueSession(user.id);
    await prisma.userSession.deleteMany({ where: { userId: user.id } });
    assert.equal(await session.resolveSession(token), null);
  });

  await check("14. a blocked user's live session stops resolving", async () => {
    const token = await session.issueSession(user.id);
    assert.ok(await session.resolveSession(token));
    await prisma.user.update({ where: { id: user.id }, data: { status: "blocked" } });
    assert.equal(await session.resolveSession(token), null, "a blocked account kept its session");
    await prisma.user.update({ where: { id: user.id }, data: { status: "active" } });
  });

  await check("15. a role change takes effect without re-issuing the session", async () => {
    const token = await session.issueSession(user.id);
    assert.equal((await session.resolveSession(token))?.role, "user");
    await prisma.user.update({ where: { id: user.id }, data: { role: "admin" } });
    assert.equal((await session.resolveSession(token))?.role, "admin", "the stale role survived");
    await prisma.user.update({ where: { id: user.id }, data: { role: "user" } });
    assert.equal((await session.resolveSession(token))?.role, "user");
  });

  await check("16. revoking every session for a user works", async () => {
    await session.issueSession(user.id);
    await session.revokeAllSessionsForUser(user.id);
    const live = await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } });
    assert.equal(live, 0);
  });

  await check("17. one user's login does not touch another's session", async () => {
    const mine = await session.issueSession(user.id);
    const theirs = await session.issueSession(other.id);
    await session.issueSession(user.id);
    assert.equal(await session.resolveSession(mine), null, "my old token survived my new login");
    assert.ok(await session.resolveSession(theirs), "their session was revoked by my login");
  });

  // ------------------------------------------------------------ cookie shape
  await check("18. the cookie carries every __Host- invariant", () => {
    const o = session.sessionCookieOptions;
    assert.equal(session.SESSION_COOKIE_NAME, "__Host-trading_platform_session");
    assert.equal(o.httpOnly, true);
    assert.equal(o.secure, true, "secure must be unconditional for a __Host- cookie");
    assert.equal(o.sameSite, "strict");
    assert.equal(o.path, "/");
    assert.ok(!("domain" in o), "a __Host- cookie must carry no Domain");
  });

  await check("19. the legacy cookie is cleared on the terms it was set on", () => {
    const o = session.clearedLegacySessionCookieOptions;
    assert.equal(session.LEGACY_SESSION_COOKIE_NAME, "trading_platform_session");
    assert.equal(o.maxAge, 0);
    assert.equal(o.path, "/");
    assert.equal(o.httpOnly, true);
  });

  await check("20. the additive table is the only schema change, and rollback-safe", async () => {
    const tables: Array<{ name: string }> = await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='UserSession'",
    );
    assert.equal(tables.length, 1);
    // A Backend built before this migration never queries it, so its presence
    // is inert on rollback. Proved by the shape: no other table references it.
    const refs: Array<{ sql: string }> = await prisma.$queryRawUnsafe(
      "SELECT sql FROM sqlite_master WHERE sql LIKE '%UserSession%' AND name != 'UserSession'",
    );
    /* Its own indexes are part of this migration. What must not exist is another
       TABLE holding a foreign key into it — that is what would make a rollback
       unsafe, because an old Backend would then be missing a table something
       else points at. */
    const foreign = refs.filter((r) => r.sql.trimStart().toUpperCase().startsWith("CREATE TABLE"));
    assert.deepEqual(foreign, [], "another table depends on UserSession");
  });

  /* ------------------------------------------------------------ the wiring
     Everything above drives the store directly. That is the right way to test
     what a session IS, and it cannot see whether the ROUTES call any of it — a
     mutation battery proved exactly that by deleting the revoke from logout and
     the legacy clear from login, and watching twenty passing cases stay green.

     These read the route sources. They are wiring assertions, not behavioural
     ones, and they are here because the handlers cannot be invoked from a
     script: `readSessionToken()` reads `next/headers`, which needs a request
     context this process does not have. What they catch is the deletion. */
  const source = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  await check("21. logout revokes on the server, not just in the browser", () => {
    const code = source("src/app/api/auth/logout/route.ts");
    assert.ok(/^\s*await revokeSession\(/m.test(code), "logout does not call revokeSession");
    assert.ok(code.includes("clearedSessionCookieOptions"), "logout does not clear the session cookie");
    assert.ok(code.includes("LEGACY_SESSION_COOKIE_NAME"), "logout does not clear the legacy cookie");
  });

  await check("22. login issues a server-side session and expires the legacy cookie", () => {
    const code = source("src/app/api/auth/login/route.ts");
    assert.ok(/await issueSession\(/.test(code), "login does not call issueSession");
    assert.ok(!/createSessionToken/.test(code), "login still mints a stateless token");
    assert.ok(
      /^\s*response\.cookies\.set\(LEGACY_SESSION_COOKIE_NAME, "", clearedLegacySessionCookieOptions\);/m.test(code),
      "login does not expire the legacy cookie",
    );
  });

  await check("23. register issues one too, and no route mints a stateless token", () => {
    assert.ok(/await issueSession\(/.test(source("src/app/api/auth/register/route.ts")));
    for (const rel of [
      "src/app/api/auth/login/route.ts",
      "src/app/api/auth/register/route.ts",
      "src/lib/session.ts",
      "src/middleware.ts",
    ]) {
      assert.ok(!/createSessionToken|verifySessionToken/.test(source(rel)), `${rel} still has the old verifier`);
    }
  });

  await check("24. the middleware holds no secret and verifies nothing itself", () => {
    const code = source("src/middleware.ts");
    assert.ok(!/crypto\.subtle/.test(code), "the middleware still signs");
    assert.ok(!/SESSION_SECRET|getSessionSecret/.test(code), "the middleware still holds the secret");
    assert.ok(/session-status/.test(code), "the middleware does not ask the Backend");
    assert.ok(/session\.blocked/.test(code) && /canAccessRoute/.test(code), "the middleware lost a check");
  });

  await prisma.$disconnect();
}

main()
  .catch((error) => {
    console.error(error);
    failed += 1;
  })
  .finally(() => {
    cleanup();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  });
