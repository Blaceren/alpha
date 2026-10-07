/**
 * H-7 — the learner session store, exercised against a real database.
 *
 * Every case below runs on an ISOLATED SQLite file created for this process and
 * deleted at the end. The live PREPROD database is never opened, never migrated
 * and never written to, and no real login or logout is performed.
 *
 * The matrix is the one the product decision names: TWO live sessions per user
 * since 2026-10-07 (H-7 held one) — a third sign-in closes the session unused
 * the longest — a password change rotates to one, logout revokes on the server,
 * and every failure mode is closed rather than open.
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
  await check("3. a second login runs alongside the first — two live sessions (owner 2026-10-07)", async () => {
    secondToken = await session.issueSession(user.id);
    assert.notEqual(secondToken, firstToken);
    const live = await prisma.userSession.findMany({ where: { userId: user.id, revokedAt: null } });
    assert.equal(live.length, 2, "a second login did not keep the first");
    assert.deepEqual(live.map((row) => row.slot).sort(), [0, 1], "the two live sessions do not hold the two slots");
  });

  await check("4. the first token still authenticates", async () => {
    assert.equal((await session.resolveSession(firstToken))?.userId, user.id);
  });

  await check("5. the second token does", async () => {
    assert.equal((await session.resolveSession(secondToken))?.userId, user.id);
  });

  let thirdToken = "";
  await check("5a. a third login closes the session unused the longest, and only that one", async () => {
    // The first was used a minute ago, the second an hour ago: the second goes.
    const rows = await prisma.userSession.findMany({ where: { userId: user.id, revokedAt: null }, orderBy: { createdAt: "asc" } });
    await prisma.userSession.update({ where: { id: rows[0]!.id }, data: { lastSeenAt: new Date(Date.now() - 60_000) } });
    await prisma.userSession.update({ where: { id: rows[1]!.id }, data: { lastSeenAt: new Date(Date.now() - 3_600_000) } });
    const evicted: string[] = [];
    thirdToken = await session.issueSession(user.id, { onEvicted: (id) => evicted.push(id) });
    assert.deepEqual(evicted, [rows[1]!.id], "the wrong session was closed, or none was reported");
    assert.equal(await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } }), 2);
    assert.equal((await session.resolveSession(firstToken))?.userId, user.id, "the recently used session was closed");
    assert.equal(await session.resolveSession(secondToken), null, "the session unused the longest survived");
    assert.equal((await session.resolveSession(thirdToken))?.userId, user.id);
  });

  await check("5b. a session's id and its last use: resolve names the row, a touch records the use", async () => {
    const resolved = await session.resolveSession(thirdToken);
    const row = await prisma.userSession.findUnique({ where: { id: resolved!.sessionId } });
    assert.equal(row?.userId, user.id);
    await prisma.userSession.update({ where: { id: row!.id }, data: { lastSeenAt: new Date(Date.now() - 3_600_000) } });
    await session.resolveSession(thirdToken);
    const untouched = await prisma.userSession.findUnique({ where: { id: row!.id } });
    assert.ok(Date.now() - untouched!.lastSeenAt!.getTime() > 3_000_000, "a read without touch wrote");
    await session.resolveSession(thirdToken, { touch: true });
    const touched = await prisma.userSession.findUnique({ where: { id: row!.id } });
    assert.ok(Date.now() - touched!.lastSeenAt!.getTime() < 60_000, "a touch did not record the use");
  });

  await check("5c. the list shows the user's live sessions only, most recently used first, without tokens", async () => {
    const list = await session.listLiveSessions(user.id);
    assert.equal(list.length, 2);
    assert.ok(list[0]!.lastSeenAt.getTime() >= list[1]!.lastSeenAt.getTime());
    const dump = JSON.stringify(list);
    assert.ok(!dump.includes("tokenHash") && !dump.includes(thirdToken) && !dump.includes(firstToken));
    assert.deepEqual(await session.listLiveSessions(other.id), []);
  });

  await check("5d. a session is closed from the other one — and nobody else's can be", async () => {
    const mine = await session.listLiveSessions(user.id);
    const currentId = (await session.resolveSession(thirdToken))!.sessionId;
    const target = mine.find((row) => row.id !== currentId)!;
    assert.equal(await session.revokeUserSession(other.id, target.id), false, "another user closed my session");
    assert.equal(await session.revokeUserSession(user.id, target.id), true);
    assert.equal(await session.revokeUserSession(user.id, target.id), false, "closing twice reported a change");
    assert.equal(await session.revokeUserSession(user.id, "c0000000000000000000000000"), false);
    assert.equal((await session.listLiveSessions(user.id)).length, 1);
  });

  await check("5e. a rotation (password change) ends every other session and leaves this browser's", async () => {
    const before = await session.issueSession(user.id);
    assert.equal(await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } }), 2);
    const rotated = await session.issueSessionWithin(user.id, undefined, { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0" });
    assert.equal(await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } }), 1);
    assert.equal(await session.resolveSession(before), null);
    assert.equal(await session.resolveSession(thirdToken), null);
    assert.equal((await session.resolveSession(rotated))?.userId, user.id);
    thirdToken = rotated;
  });

  await check("5f. the browser's description is kept clean and short, and only when given", async () => {
    await session.revokeAllSessionsForUser(user.id);
    const long = `Mozilla/5.0\u0000\n${"x".repeat(1000)}`;
    const token = await session.issueSession(user.id, { userAgent: long });
    const row = await prisma.userSession.findUnique({ where: { id: (await session.resolveSession(token))!.sessionId } });
    assert.ok(row!.userAgent!.length <= 400, "the description was not cut");
    assert.ok(!/[\u0000-\u001f]/.test(row!.userAgent!), "control characters were kept");
    const bare = await session.issueSession(user.id);
    const bareRow = await prisma.userSession.findUnique({ where: { id: (await session.resolveSession(bare))!.sessionId } });
    assert.equal(bareRow!.userAgent, null);
    await session.revokeSession(token);
    thirdToken = bare;
  });

  // ------------------------------------------------------------------ logout
  await check("6. logout revokes the session on the server", async () => {
    await session.revokeSession(thirdToken);
    assert.equal(await session.resolveSession(thirdToken), null);
    const live = await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } });
    assert.equal(live, 0);
  });

  await check("7. logging out again is safe", async () => {
    await session.revokeSession(thirdToken);
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
  await check("9. concurrent logins leave exactly two live sessions", async () => {
    const tokens = await Promise.all([
      session.issueSession(other.id),
      session.issueSession(other.id),
      session.issueSession(other.id),
      session.issueSession(other.id),
    ]);
    const live = await prisma.userSession.count({ where: { userId: other.id, revokedAt: null } });
    assert.equal(live, 2, `four concurrent logins left ${live} live sessions`);
    const working = [];
    for (const token of tokens) if (await session.resolveSession(token)) working.push(token);
    assert.equal(working.length, 2, `${working.length} tokens still authenticate, not two`);
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

  await check("17. one user's logins do not touch another's sessions", async () => {
    await session.revokeAllSessionsForUser(user.id);
    const mine = await session.issueSession(user.id);
    await prisma.userSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { lastSeenAt: new Date(Date.now() - 3_600_000) },
    });
    const theirs = await session.issueSession(other.id);
    await session.issueSession(user.id);
    assert.ok(await session.resolveSession(mine), "my second login closed my first");
    await session.issueSession(user.id);
    assert.equal(await session.resolveSession(mine), null, "my third login kept the session unused the longest");
    assert.ok(await session.resolveSession(theirs), "their session was revoked by my logins");
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

  /* -------------------------------------------- the database's own invariant
     Everything above proves the APPLICATION keeps at most two sessions live. That is not
     the same as the invariant holding: any other writer can insert a row without
     going through issueSession. These prove the database refuses it. */

  await check("25. the database itself rejects a third live session", async () => {
    await prisma.userSession.deleteMany({ where: { userId: user.id } });
    await session.issueSession(user.id);
    await session.issueSession(user.id);
    // Straight past issueSession, exactly as a script or an incident would —
    // into either slot, and into a slot that does not exist.
    for (const slot of [0, 1, 2]) {
      let rejected = false;
      try {
        await prisma.userSession.create({
          data: { userId: user.id, tokenHash: `bypass-${slot}-${Date.now()}`, expiresAt: new Date(Date.now() + 60_000), slot },
        });
      } catch {
        rejected = true;
      }
      assert.equal(rejected, true, `the database allowed a third live session in slot ${slot}`);
    }
    const live = await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } });
    assert.equal(live, 2);
  });

  await check("26. one revoked plus one live is allowed", async () => {
    await prisma.userSession.deleteMany({ where: { userId: user.id } });
    await prisma.userSession.create({
      data: { userId: user.id, tokenHash: `rev-${Date.now()}`, expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() },
    });
    await session.issueSession(user.id);
    assert.equal(await prisma.userSession.count({ where: { userId: user.id } }), 2);
    assert.equal(await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } }), 1);
  });

  await check("27. many revoked rows are allowed — history is not the constraint", async () => {
    await prisma.userSession.deleteMany({ where: { userId: user.id } });
    for (let i = 0; i < 5; i += 1) {
      await prisma.userSession.create({
        data: { userId: user.id, tokenHash: `old-${i}-${Date.now()}`, expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() },
      });
    }
    await session.issueSession(user.id);
    assert.equal(await prisma.userSession.count({ where: { userId: user.id } }), 6);
    assert.equal(await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } }), 1);
  });

  await check("28. the index exists, is unique over (userId, slot), and is partial — and H-7's is gone", async () => {
    const rows: Array<{ sql: string | null }> = await prisma.$queryRawUnsafe(
      "SELECT sql FROM sqlite_master WHERE type='index' AND name='UserSession_userId_slot_active_key'",
    );
    assert.equal(rows.length, 1, "the partial unique index is missing");
    const sql = (rows[0]?.sql ?? "").toUpperCase();
    assert.ok(sql.includes("UNIQUE"), "the index is not unique");
    assert.ok(sql.includes('"USERID"') && sql.includes('"SLOT"'), "the index is not over (userId, slot)");
    assert.ok(sql.includes("WHERE"), "the index is not partial — it would forbid revoked history");
    assert.ok(sql.includes("REVOKEDAT") && sql.includes("NULL"));
    const old: Array<{ name: string }> = await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='UserSession_userId_active_key'",
    );
    assert.deepEqual(old, [], "the one-session index is still in force");
  });

  await check("29. concurrent logins still leave exactly two live rows, now with the index in force", async () => {
    await prisma.userSession.deleteMany({ where: { userId: other.id } });
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => session.issueSession(other.id)),
    );
    /* NONE of them may fail. The index makes one writer lose the race, and
       issueSession retries — so a learner who double-clicks Sign in gets a
       session, not a 500. A rejection here means the retry stopped working. */
    const rejected = results.filter((r) => r.status === "rejected");
    assert.deepEqual(
      rejected.map((r) => String((r as PromiseRejectedResult).reason).slice(0, 120)),
      [],
      "a concurrent login failed instead of retrying",
    );
    const live = await prisma.userSession.count({ where: { userId: other.id, revokedAt: null } });
    assert.equal(live, 2, `six concurrent logins left ${live} live rows`);
    const tokens = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    let working = 0;
    for (const token of tokens) if (await session.resolveSession(token)) working += 1;
    assert.equal(working, 2, `${working} tokens still authenticate`);
  });

  await check("37. a failed issue throws — it never hands back an unpersisted token", async () => {
    /* The retry loop exists so a lost race does not become a 500. It must not
       become the opposite: a login that returns a token nothing stored, leaving
       the browser with a cookie that will never authenticate. A missing user
       fails the foreign key, which is not a unique violation, so it must
       surface immediately. */
    let threw = false;
    let returned: string | null = null;
    try {
      returned = await session.issueSession(2_147_000_000);
    } catch {
      threw = true;
    }
    assert.equal(threw, true, "issueSession returned instead of throwing");
    if (returned !== null) {
      assert.equal(await session.resolveSession(returned), null, "it returned a working token");
    }
    const orphans = await prisma.userSession.count({ where: { userId: 2_147_000_000 } });
    assert.equal(orphans, 0);
  });

  /* ------------------------------------- 2026-10-07 audit: a sign-in in context */
  await check("38. a sign-in that presents its own browser's session replaces it — the other device keeps its place", async () => {
    await prisma.userSession.updateMany({ where: { userId: other.id, revokedAt: null }, data: { revokedAt: new Date() } });
    const laptop = await session.issueSession(other.id);
    const phone = await session.issueSession(other.id);
    const phoneRow = await prisma.userSession.findUnique({ where: { tokenHash: createHash("sha256").update(phone, "utf8").digest("hex") } });
    // The phone is the session unused the longest: without the replacement it would be the one closed.
    await prisma.userSession.update({ where: { id: phoneRow!.id }, data: { lastSeenAt: new Date(Date.now() - 3_600_000) } });
    const evicted: string[] = [];
    const again = await session.issueSession(other.id, { replacing: laptop, onEvicted: (id) => evicted.push(id) });
    assert.deepEqual(evicted, [], "a replacement was reported as an eviction");
    assert.equal(await session.resolveSession(laptop), null, "the replaced session still works");
    assert.equal((await session.resolveSession(phone))?.userId, other.id, "the other device was closed");
    assert.equal((await session.resolveSession(again))?.userId, other.id);
    assert.equal(await prisma.userSession.count({ where: { userId: other.id, revokedAt: null } }), 2);
  });

  await check("39. a browser that signs in to another account closes the session it held for the first", async () => {
    const held = await session.issueSession(user.id);
    const theirs = await session.issueSession(other.id, { replacing: held });
    assert.equal(await session.resolveSession(held), null, "the first account's session is still live, held by nobody");
    assert.equal((await session.resolveSession(theirs))?.userId, other.id);
  });

  await check("40. a password changed after the check issues nothing", async () => {
    await prisma.user.update({ where: { id: other.id }, data: { passwordHash: "hash-at-check" } });
    const liveBefore = await prisma.userSession.count({ where: { userId: other.id, revokedAt: null } });
    await prisma.user.update({ where: { id: other.id }, data: { passwordHash: "hash-after-change" } });
    await assert.rejects(
      session.issueSession(other.id, { expectedPasswordHash: "hash-at-check" }),
      (error: unknown) => error instanceof session.SessionIssueRefusedError,
    );
    assert.equal(await prisma.userSession.count({ where: { userId: other.id, revokedAt: null } }), liveBefore);
    const fresh = await session.issueSession(other.id, { expectedPasswordHash: "hash-after-change" });
    assert.equal((await session.resolveSession(fresh))?.userId, other.id);
  });

  await check("41. an account blocked after the check gets no session", async () => {
    await prisma.user.update({ where: { id: other.id }, data: { status: "blocked" } });
    await assert.rejects(
      session.issueSession(other.id, { expectedPasswordHash: "hash-after-change" }),
      (error: unknown) => error instanceof session.SessionIssueRefusedError,
    );
    await prisma.user.update({ where: { id: other.id }, data: { status: "active" } });
  });

  /* ---------------------------------------------- analytics is not authority
     Click classification labels a row; it grants nothing. But a label that
     anyone can set by writing a cookie is not a label, and an intermediate
     version of this called mere presence `authenticated_user`. These prove it
     verifies, and that every failure mode falls through to `qualified` rather
     than claiming a learner. */
  {
    const { classifyRequest } = await import("../../src/lib/affiliate/acquisition-click");
    const req = (cookie: string | null) =>
      new Request("https://example.test/go/abc", { headers: cookie ? { cookie } : {} });
    const NAME = session.SESSION_COOKIE_NAME;

    await check("30. a valid active session classifies as an authenticated learner", async () => {
      await prisma.userSession.deleteMany({ where: { userId: user.id } });
      const token = await session.issueSession(user.id);
      assert.equal(await classifyRequest(req(`${NAME}=${token}`)), "authenticated_user");
    });

    await check("31. a random cookie is not an authenticated learner", async () => {
      assert.equal(await classifyRequest(req(`${NAME}=not-a-real-token`)), "qualified");
      assert.equal(await classifyRequest(req(`${NAME}=`)), "qualified");
      assert.equal(await classifyRequest(req(null)), "qualified");
    });

    await check("32. a revoked session is not an authenticated learner", async () => {
      const token = await session.issueSession(user.id);
      await session.revokeSession(token);
      assert.equal(await classifyRequest(req(`${NAME}=${token}`)), "qualified");
    });

    await check("33. an expired session is not an authenticated learner", async () => {
      const token = await session.issueSession(user.id);
      await prisma.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      assert.equal(await classifyRequest(req(`${NAME}=${token}`)), "qualified");
    });

    await check("34. a blocked user is not an authenticated learner", async () => {
      const token = await session.issueSession(user.id);
      await prisma.user.update({ where: { id: user.id }, data: { status: "blocked" } });
      assert.equal(await classifyRequest(req(`${NAME}=${token}`)), "qualified");
      await prisma.user.update({ where: { id: user.id }, data: { status: "active" } });
    });

    await check("35. a legacy stateless token is not an authenticated learner", async () => {
      const legacy = `${user.id}.user.${Date.now() + 60_000}.` + "0".repeat(64);
      assert.equal(await classifyRequest(req(`trading_platform_session=${legacy}`)), "qualified");
      assert.equal(await classifyRequest(req(`${NAME}=${legacy}`)), "qualified");
    });

    await check("36. classification decides no permission and writes nothing", () => {
      const code = fs.readFileSync(
        path.join(process.cwd(), "src/lib/affiliate/acquisition-click.ts"),
        "utf8",
      );
      const fn = code.slice(code.indexOf("export async function classifyRequest"));
      const body = fn.slice(0, fn.indexOf("\n}"));
      for (const forbidden of ["prisma.", "create(", "update(", "delete(", "requireCurrentUser", "canAccess"]) {
        assert.ok(!body.includes(forbidden), `classifyRequest does ${forbidden}`);
      }
      // Its only outward call is the read-only resolver.
      assert.ok(body.includes("resolveSession"));
    });
  }

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
