/**
 * POCKETCTA-1 — the disposable end-to-end proof.
 *
 * WHAT THIS PROVES, WITHOUT TOUCHING THE PRIMARY LEARNER
 * That the whole chain still fits together after this phase: a learner obtains
 * the real affiliate link through the PUBLIC Academy proxy, and a Pocket-format
 * registration callback carrying that learner's own clickid arrives at the
 * PUBLIC callback endpoint and completes Level 1, unlocks Level 2, awards zero
 * XP and records no balance. Then it proves the replay is idempotent and that a
 * conflicting identity is refused.
 *
 * WHY A DISPOSABLE LEARNER
 * The primary learner must stay at Level 1 until the operator registers with
 * Pocket by hand. Registration is irreversible in the sense that matters here —
 * once an identity is bound and L1 completes, you cannot un-know it. So the
 * compatibility proof runs on an account created for the purpose.
 *
 * SECRET HANDLING
 * POSTBACK_SECRET is read from the protected runtime env into a process variable
 * and used ONLY as the opaque `ow` query value. It is never printed, hashed,
 * copied to another file, or written to any artifact. The learner's clickid is
 * likewise never printed — only its shape and ownership are asserted.
 *
 * NO REAL POCKET ACCOUNT IS CREATED. Nothing here contacts Pocket.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import bcrypt from "bcryptjs";

/** A parsed JSON body, before anything has decided what it is. */
type JsonBody = Record<string, unknown> | null;

const ACADEMY = "https://57.128.213.204";
const CALLBACK = "https://57.128.213.204/api/postbacks/pocket";
const ENV_FILE = "/home/ubuntu/runtime/ata-dev-v2/env/backend.env";
const ACCESS = "/home/ubuntu/runtime/ata-dev-v2/handoff/public-dev-access.json";

let passed = 0, failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}`); console.error(e instanceof Error ? e.message : e); }
}

/** Read one key out of the protected env file without echoing anything. */
function readEnvValue(key: string): string {
  for (const raw of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    if (!raw.startsWith(`${key}=`)) continue;
    let value = raw.slice(key.length + 1);
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  throw new Error(`${key} not present`);
}

const access = JSON.parse(fs.readFileSync(ACCESS, "utf8"));
const basic = "Basic " + Buffer.from(
  `${access.teamIngress.username}:${access.teamIngress.password}`,
).toString("base64");

function session() {
  const jar = new Map<string, string>();
  return {
    async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
      const res = await fetch(`${ACADEMY}${path}`, {
        method, redirect: "follow",
        headers: {
          authorization: basic,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      for (const raw of res.headers.getSetCookie()) {
        const pair = raw.split(";")[0]; const i = pair.indexOf("=");
        if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
      const text = await res.text();
      /* A response body is unknown until something reads it. `JsonBody` says
         only that: an index into an object of unknowns, which every call site
         below narrows for itself. It is not a claim about any real payload. */
      let json: JsonBody = null;
      try { json = JSON.parse(text) as JsonBody; } catch { /* html */ }
      return { status: res.status, text, json };
    },
    async csrf() { return String((await this.req("GET", "/api/backend/csrf")).json?.csrfToken); },
  };
}

async function main() {
  const { prisma } = await import("../../src/lib/prisma");
  const { enrollUserInPublishedCurriculum } = await import("../../src/lib/curriculum/enrollment");

  const stamp = Date.now();
  const email = `pocketcta1-disposable-${stamp}@example.invalid`;
  const password = `Disposable-${stamp}!aA`;

  // ─────────────────────────────── 1. a disposable learner, legally enrolled
  const learner = await prisma.user.create({
    data: {
      email, name: "POCKETCTA1 DISPOSABLE",
      passwordHash: await bcrypt.hash(password, 10),
      referralCode: `PD${stamp % 1000000}`, status: "active",
    },
  });
  console.log(`disposable learner id=${learner.id} email=${email}`);

  // The shipped enrolment owner. Enrolment is deliberately an ADMIN action —
  // there is no learner-facing enrolment endpoint — so the existing active admin
  // is the actor. This is the same path a real enrolment takes.
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: "admin", status: "active" }, select: { id: true },
  });
  const enrolled = await enrollUserInPublishedCurriculum({ userId: learner.id, actorId: admin.id });
  await check("1 the disposable learner is legally enrolled by the enrolment owner", async () => {
    const rows = await prisma.userCurriculumEnrollment.findMany({ where: { userId: learner.id } });
    assert.equal(rows.length, 1, `enrollments=${rows.length} (${JSON.stringify(enrolled).slice(0, 160)})`);
    assert.equal(rows[0].status, "active");
    assert.equal(rows[0].currentLevel, 1);
    assert.equal(rows[0].highestCompletedLevel, 0);
  });

  // ─────────────────────────────── 2. the link, through the PUBLIC Academy
  const s = session();
  await check("2 the disposable learner logs in through the public Academy", async () => {
    const reply = await s.req("POST", "/api/backend/auth/login",
      { email, password, captchaToken: "dev-captcha-ok" }, { "x-csrf-token": await s.csrf() });
    assert.equal(reply.status, 200, `HTTP ${reply.status}`);
  });

  let clickId = "";
  await check("3 the referral link comes from the exact Academy proxy route and is external", async () => {
    const reply = await s.req("POST", "/api/backend/exchange/referral-link", undefined,
      { "x-csrf-token": await s.csrf() });
    assert.equal(reply.status, 200, `HTTP ${reply.status}`);
    const url = new URL(String(reply.json?.referralUrl));
    assert.equal(url.origin, "https://u3.shortink.io");
    assert.equal(url.pathname, "/register");
    assert.equal(url.searchParams.get("cid"), "962747", "cid must survive");
    assert.equal(url.searchParams.has("ow"), false);
    assert.equal(/playerid/i.test(url.href), false);
    // The clickid is captured into a process variable only. It is never printed.
    clickId = url.searchParams.get("clickid") ?? "";
    assert.match(clickId, /^tq-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(url.searchParams.get("click_id"), clickId);
    // It belongs to THIS learner.
    const account = await prisma.exchangeAccount.findUnique({ where: { userId: learner.id } });
    assert.equal(clickId, account?.clickId, "clickid must be this learner's own");
  });

  // ─────────────────────────────── 3. one synthetic registration callback
  const secret = readEnvValue("POSTBACK_SECRET");
  const playerId = String(700000000 + (stamp % 9000000));
  const callbackUrl = (cid: string, pid: string) => {
    const u = new URL(CALLBACK);
    u.searchParams.set("goal", "reg");
    u.searchParams.set("clickid", cid);
    u.searchParams.set("playerid", pid);
    u.searchParams.set("ow", secret);
    return u;
  };
  const sendCallback = async (cid: string, pid: string) => {
    const res = await fetch(callbackUrl(cid, pid), { headers: { authorization: basic } });
    const text = await res.text();
    return { status: res.status, text };
  };

  await check("4 the public callback accepts the registration (HTTP 200)", async () => {
    const r = await sendCallback(clickId, playerId);
    assert.equal(r.status, 200, `HTTP ${r.status} ${r.text.slice(0, 200)}`);
  });

  await check("5 exactly one PocketTraderIdentity is bound to the disposable learner", async () => {
    const rows = await prisma.pocketTraderIdentity.findMany({ where: { userId: learner.id } });
    assert.equal(rows.length, 1, `identities=${rows.length}`);
  });

  await check("6 Level 1 completes and Level 2 unlocks", async () => {
    const e = await prisma.userCurriculumEnrollment.findFirstOrThrow({ where: { userId: learner.id } });
    assert.equal(e.highestCompletedLevel, 1, `highestCompletedLevel=${e.highestCompletedLevel}`);
    assert.equal(e.currentLevel, 2, `currentLevel=${e.currentLevel}`);
    const done = await prisma.userLevelProgress.count({ where: { enrollmentId: e.id, status: "completed" } });
    assert.equal(done, 1, `completed progress rows=${done}`);
  });

  await check("7 the completion awards zero XP", async () => {
    const e = await prisma.userCurriculumEnrollment.findFirstOrThrow({ where: { userId: learner.id } });
    const xp = await prisma.xPTransaction.aggregate({
      where: { userId: learner.id }, _sum: { amount: true },
    }).catch(() => ({ _sum: { amount: null } }));
    assert.ok(!xp._sum.amount, `XP awarded: ${xp._sum.amount}`);
    void e;
  });

  await check("8 no balance is recorded for the disposable learner", async () => {
    const account = await prisma.exchangeAccount.findUnique({ where: { userId: learner.id } });
    assert.ok(
      account?.balance === null || account?.balance === undefined || Number(account?.balance) === 0,
      `balance=${String(account?.balance)}`,
    );
  });

  await check("9 the public Academy now reports L1 completed and L2 available", async () => {
    const cur = await s.req("GET", "/api/backend/curriculum/current");
    /* The body is unknown until something looks at it. These shapes are read
       positionally and nothing else here depends on them, so a narrow local
       type says exactly what is being read without claiming to describe the
       whole curriculum payload. */
    type LevelRow = { levelNumber?: number; durableStatus?: string; presentationState?: string };
    type ModuleRow = { levels?: LevelRow[] };
    type CurrentBody = { modules?: ModuleRow[]; enrollment?: { highestCompletedLevel?: number } };
    const d = (cur.json as { data?: CurrentBody } | null)?.data ?? {};
    const levels = (d.modules ?? []).flatMap((m) => m.levels ?? []);
    const l1 = levels.find((l) => l.levelNumber === 1);
    const l2 = levels.find((l) => l.levelNumber === 2);
    assert.equal(d.enrollment?.highestCompletedLevel, 1);
    assert.equal(l1?.durableStatus, "completed", `L1 durable=${l1?.durableStatus}`);
    assert.notEqual(l2?.presentationState, "locked", `L2=${l2?.presentationState}`);
  });

  await check("10 the replay is idempotent — nothing doubles", async () => {
    const r = await sendCallback(clickId, playerId);
    assert.equal(r.status, 200, `HTTP ${r.status}`);
    const identities = await prisma.pocketTraderIdentity.count({ where: { userId: learner.id } });
    assert.equal(identities, 1, `identities=${identities}`);
    const e = await prisma.userCurriculumEnrollment.findFirstOrThrow({ where: { userId: learner.id } });
    assert.equal(e.highestCompletedLevel, 1);
    assert.equal(e.currentLevel, 2);
    const done = await prisma.userLevelProgress.count({ where: { enrollmentId: e.id, status: "completed" } });
    assert.equal(done, 1, `completed rows=${done}`);
  });

  await check("11 a conflicting playerid never rebinds the learner's identity", async () => {
    // The route answers 200 so the provider stops retrying, but the binder
    // returns `conflict_learner_bound` with created:false and the UNIQUE index on
    // userId makes a second identity structurally impossible. What must hold is
    // that the ORIGINAL identity survives untouched.
    const conflicting = String(Number(playerId) + 1);
    await sendCallback(clickId, conflicting);
    const rows = await prisma.pocketTraderIdentity.findMany({ where: { userId: learner.id } });
    assert.equal(rows.length, 1, `identities=${rows.length}`);
    assert.equal(rows[0].pocketUserId, playerId, "the original identity must survive a conflict");
    assert.notEqual(rows[0].pocketUserId, conflicting, "the conflicting identity must not be bound");
    // And the conflicting trader id must not have been bound to anyone at all.
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { pocketUserId: conflicting } }), 0);
    // Progression is unchanged by a conflict.
    const e = await prisma.userCurriculumEnrollment.findFirstOrThrow({ where: { userId: learner.id } });
    assert.equal(e.highestCompletedLevel, 1);
    assert.equal(e.currentLevel, 2);
  });

  await check("12 an unknown clickid is refused and creates nothing", async () => {
    const before = await prisma.pocketTraderIdentity.count();
    const r = await sendCallback("tq-00000000-0000-4000-8000-000000000000", "999999999");
    assert.notEqual(r.status, 200, `unknown clickid accepted: HTTP ${r.status}`);
    assert.equal(await prisma.pocketTraderIdentity.count(), before);
  });

  await check("13 a callback without the secret is refused", async () => {
    const u = new URL(CALLBACK);
    u.searchParams.set("goal", "reg");
    u.searchParams.set("clickid", clickId);
    u.searchParams.set("playerid", playerId);
    const res = await fetch(u, { headers: { authorization: basic } });
    assert.notEqual(res.status, 200, `unauthenticated callback accepted: HTTP ${res.status}`);
  });

  // ─────────────────────────────── 4. the primary learner is untouched
  await check("14 the PRIMARY learner is still at Level 1 with no Pocket identity", async () => {
    const e = await prisma.userCurriculumEnrollment.findFirstOrThrow({ where: { userId: 34 } });
    assert.equal(e.currentLevel, 1);
    assert.equal(e.highestCompletedLevel, 0);
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: 34 } }), 0);
    const done = await prisma.userLevelProgress.count({ where: { enrollmentId: e.id, status: "completed" } });
    assert.equal(done, 0);
  });

  // ─────────────────────────────── 5. classification
  console.log(`\nDISPOSABLE_LEARNER_ID=${learner.id}`);
  console.log(`DISPOSABLE_LEARNER_EMAIL=${email}`);
  console.log("classification: synthetic, disposable, DEV-only; identifiable by the pocketcta1-disposable- email prefix");
  await prisma.$disconnect();
}

main().then(() => {
  console.log(`\npocketcta1 disposable e2e: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}).catch((e) => {
  console.error(e);
  console.log(`\npocketcta1 disposable e2e: ${passed} passed, ${failed + 1} failed`);
  process.exitCode = 1;
});
