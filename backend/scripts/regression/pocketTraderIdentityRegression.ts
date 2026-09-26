/**
 * L4PA-1 — trusted learner-to-Pocket identity binding, and the security
 * boundary that produces it.
 *
 * Synthetic database only. NO EXTERNAL REQUEST IS MADE and no Pocket endpoint is
 * contacted: this suite exercises the postback route handler in-process and the
 * binding module directly. Every secret and identifier here is synthetic.
 *
 * The claim under test is the one the whole phase rests on: **a Pocket trader id
 * can only ever enter this platform through an authenticated registration
 * postback, and once bound it can never be silently changed.** If either half
 * fails, the $50 checkpoint can be pointed at someone else's funded account.
 *
 * Proven here:
 *   A. auth      — disabled, missing/invalid/ambiguous secret, URL-borne auth.
 *   B. binding   — created only on goal=reg, only after authentication.
 *   C. validity  — missing, malformed, zero, negative, padded, oversized ids.
 *   D. conflicts — learner rebind, trader reuse; never an overwrite.
 *   E. races     — concurrent identical and concurrent conflicting claims.
 *   F. legacy    — ExchangeAccount.traderId is NOT the authority.
 *   G. authz     — no caller-supplied identity is accepted anywhere.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-pocket-identity-pa1-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

const SECRET = "pocket-pa1-synthetic-secret-value";
const WRONG_SECRET = "pocket-pa1-synthetic-secret-wrong";
/**
 * Synthetic trader ids. Deliberately NOT the operator's example `playerid`,
 * which may name a real Pocket trader and has no place in committed source.
 *
 * `pocketUserId` is globally UNIQUE — that is the constraint stopping one funded
 * Pocket account from passing the checkpoint for many learners — so each test
 * that expects a binding to SUCCEED must claim an id no earlier test consumed.
 * `nextPocketId()` exists for exactly that reason.
 */
const POCKET_USER_ID = "101010";

let pocketIdSeq = 0;
function nextPocketId() {
  pocketIdSeq += 1;
  return String(200_000_000 + pocketIdSeq);
}

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

let ipSeq = 0;
/** A fresh source IP per request so the route's rate limit never masks a result. */
function nextIp() {
  ipSeq += 1;
  return `10.0.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`;
}

async function main() {
  cleanup();
  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  process.env.POSTBACK_SECRET = SECRET;
  process.env.POCKET_POSTBACK_ENABLED = "true";
  // POCKET-REG-SECURITY-CLOSURE-1 (§14): this suite OWNS its fixture flags.
  // It set only the master gate, so after G4 made ingest granular it was green
  // solely because an operator exported the family switches — and red for
  // anyone who ran it plainly. Families this suite does not exercise are
  // DELETED rather than left inherited, so an exported flag cannot turn one of
  // its refusal assertions into an acceptance.
  process.env.POCKET_REG_INGEST_ENABLED = "true";
  delete process.env.POCKET_DEP_INGEST_ENABLED;
  delete process.env.POCKET_RDEP_INGEST_ENABLED;
  delete process.env.POCKET_FIRST_DEPOSIT_ENABLED;

  const { prisma } = await import("../../src/lib/prisma");
  const identity = await import("../../src/lib/exchange/pocketTraderIdentity");
  const route = await import("../../src/app/api/postbacks/pocket/route");

  let learnerSeq = 0;
  /** A learner with an ExchangeAccount carrying a known clickid. */
  async function createLearner() {
    learnerSeq += 1;
    const user = await prisma.user.create({
      data: { email: `pa1-${learnerSeq}@example.com`, name: "PA1" },
    });
    const clickId = `tq-pa1-click-${learnerSeq}`;
    await prisma.exchangeAccount.create({
      data: {
        userId: user.id,
        provider: "real_placeholder",
        referralLink: "https://example.com/ref",
        exchangeAccountId: `pocket-pending-${user.id}`,
        clickId,
        status: "pending",
      },
    });
    return { userId: user.id, clickId };
  }

  let eventSeq = 0;
  /** Deliver a registration postback exactly as an upstream would. */
  function registrationRequest(input: {
    clickId?: string;
    playerId?: string;
    goal?: string;
    secret?: string | null;
    secretInQuery?: boolean;
    eventId?: string;
  }) {
    const params = new URLSearchParams();
    if (input.clickId !== undefined) params.set("clickid", input.clickId);
    params.set("goal", input.goal ?? "reg");
    if (input.playerId !== undefined) params.set("playerid", input.playerId);
    params.set("event_id", input.eventId ?? `pa1-event-${++eventSeq}`);
    if (input.secretInQuery) params.set("ow", SECRET);

    const headers: Record<string, string> = { "x-forwarded-for": nextIp() };
    if (input.secret !== null) headers["x-postback-secret"] = input.secret ?? SECRET;

    return new Request(`https://ata.test/api/postbacks/pocket?${params.toString()}`, {
      method: "GET",
      headers,
    });
  }

  const postRegistration = (input: Parameters<typeof registrationRequest>[0]) =>
    route.GET(registrationRequest(input));

  const bindingFor = (userId: number) =>
    prisma.pocketTraderIdentity.findUnique({ where: { userId } });

  /* ------------------------------------------------------------------ */
  /* A. The authentication boundary                                      */
  /* ------------------------------------------------------------------ */

  await check("A1 an unauthenticated registration binds nothing", async () => {
    const learner = await createLearner();
    const response = await postRegistration({
      clickId: learner.clickId,
      playerId: POCKET_USER_ID,
      secret: null,
    });
    assert.equal(response.status, 403);
    assert.equal(await bindingFor(learner.userId), null);
  });

  await check("A2 a wrong secret binds nothing", async () => {
    const learner = await createLearner();
    const response = await postRegistration({
      clickId: learner.clickId,
      playerId: POCKET_USER_ID,
      secret: WRONG_SECRET,
    });
    assert.equal(response.status, 403);
    assert.equal(await bindingFor(learner.userId), null);
  });

  await check("A3 a URL-borne secret binds nothing without valid ATA fields", async () => {
    // PDP-1 changed this deliberately. `ow` is Pocket's OFFICIAL registration
    // secret field, so it now authenticates a `goal=reg` request rather than
    // being rejected outright. What has not changed — and is what this check
    // actually protects — is that authentication alone binds nothing: this
    // suite's affiliate-era clickid (`tq-pa1-click-N`) is not the ATA-generated
    // `tq-<uuid>` format, so the strict direct-registration parser refuses it
    // with a bounded 400 and no identity is written.
    const learner = await createLearner();
    const response = await postRegistration({
      clickId: learner.clickId,
      playerId: POCKET_USER_ID,
      secret: null,
      secretInQuery: true,
    });
    assert.equal(response.status, 400);
    assert.notEqual(response.status, 200, "an invalid registration must never succeed");
    assert.equal(await bindingFor(learner.userId), null);
  });

  await check("A3b the legacy query aliases are still refused outright", async () => {
    // `secret` and `token` were ATA-invented aliases with no provider mandate.
    // They remain rejected before any lookup, on every goal.
    const learner = await createLearner();
    for (const alias of ["secret", "token"]) {
      const params = new URLSearchParams({
        clickid: learner.clickId, goal: "reg",
        playerid: POCKET_USER_ID, [alias]: SECRET,
      });
      const response = await route.GET(
        new Request(`https://ata.test/api/postbacks/pocket?${params}`, {
          method: "GET", headers: { "x-forwarded-for": nextIp() },
        }),
      );
      assert.equal(response.status, 403, alias);
      assert.equal(await bindingFor(learner.userId), null);
    }
  });

  await check("A4 an unknown clickid binds nothing", async () => {
    const response = await postRegistration({
      clickId: "tq-pa1-not-a-real-click",
      playerId: POCKET_USER_ID,
    });
    assert.equal(response.status, 404);
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { clickId: "tq-pa1-not-a-real-click" } }), 0);
  });

  await check("A5 a missing clickid binds nothing", async () => {
    const before = await prisma.pocketTraderIdentity.count();
    const response = await postRegistration({ playerId: POCKET_USER_ID });
    assert.equal(response.status, 400);
    assert.equal(await prisma.pocketTraderIdentity.count(), before);
  });

  await check("A6 the integration being disabled binds nothing", async () => {
    const learner = await createLearner();
    process.env.POCKET_POSTBACK_ENABLED = "false";
    try {
      const response = await postRegistration({
        clickId: learner.clickId,
        playerId: POCKET_USER_ID,
      });
      assert.equal(response.status, 503);
      assert.equal(await bindingFor(learner.userId), null);
    } finally {
      process.env.POCKET_POSTBACK_ENABLED = "true";
    }
  });

  /* ------------------------------------------------------------------ */
  /* B. Binding on an authenticated registration                         */
  /* ------------------------------------------------------------------ */

  await check("B1 an authenticated registration binds the learner", async () => {
    const learner = await createLearner();
    const response = await postRegistration({
      clickId: learner.clickId,
      playerId: POCKET_USER_ID,
    });
    assert.equal(response.status, 200);
    const bound = await bindingFor(learner.userId);
    assert.ok(bound);
    assert.equal(bound.pocketUserId, POCKET_USER_ID);
    assert.equal(bound.clickId, learner.clickId);
    assert.equal(bound.source, "registration_postback");
  });

  // POCKET-REG-INGRESS-1 — updated to the post-G4 contract. This case used to
  // expect 200: the pre-G4 header path processed every financial goal through
  // the legacy alias table and the assertion "never binds" was proven against
  // an ACCEPTED financial mutation. G4 removed every non-`reg` goal from the
  // header path outright (the alias table has one entry), so a financial goal
  // is now refused as UNKNOWN_GOAL before touching anything — the stronger
  // spelling of the same invariant: it does not bind because it does not run.
  await check("B2 a non-registration goal never binds", async () => {
    const learner = await createLearner();
    for (const goal of ["dep", "ftd", "redep", "commission", "withdrawal"]) {
      const response = await postRegistration({
        clickId: learner.clickId,
        playerId: POCKET_USER_ID,
        goal,
      });
      assert.equal(response.status, 400, goal);
      assert.equal(await bindingFor(learner.userId), null, goal);
    }
  });

  await check("B3 the resolver returns only what was actually bound", async () => {
    const learner = await createLearner();
    const pocketId = nextPocketId();
    assert.equal(await identity.resolvePocketTraderIdentity(learner.userId, prisma), null);
    await postRegistration({ clickId: learner.clickId, playerId: pocketId });
    assert.equal(
      await identity.resolvePocketTraderIdentity(learner.userId, prisma),
      pocketId,
    );
  });

  /* ------------------------------------------------------------------ */
  /* C. Identifier validity                                              */
  /* ------------------------------------------------------------------ */

  await check("C1 a missing playerid binds nothing", async () => {
    const learner = await createLearner();
    const response = await postRegistration({ clickId: learner.clickId });
    assert.equal(response.status, 200);
    assert.equal(await bindingFor(learner.userId), null);
  });

  await check("C2 malformed, zero, negative and padded ids are refused", async () => {
    for (const bad of ["abc", "0", "-5", "12.5", "1e3", "007", "", "9".repeat(20)]) {
      assert.equal(identity.parsePocketUserId(bad), null, `parse ${JSON.stringify(bad)}`);
    }
    // Through the real route, end to end.
    for (const bad of ["abc", "0", "-5", "12.5", "007"]) {
      const learner = await createLearner();
      const response = await postRegistration({ clickId: learner.clickId, playerId: bad });
      assert.equal(response.status, 200, bad);
      assert.equal(await bindingFor(learner.userId), null, bad);
    }
  });

  await check("C3 canonical decimal ids are accepted, in both shapes", () => {
    assert.equal(identity.parsePocketUserId("797973"), "797973");
    assert.equal(identity.parsePocketUserId(797973), "797973");
    assert.equal(identity.parsePocketUserId("  797973  "), "797973");
    // Beyond safe-integer range the Partner API comparison could lose
    // precision, so it is refused rather than stored.
    assert.equal(identity.parsePocketUserId("9007199254740993"), null);
  });

  await check("C4 an oversized clickid is refused by the binder", async () => {
    const learner = await createLearner();
    const result = await identity.bindPocketTraderIdentity({
      userId: learner.userId,
      pocketUserId: POCKET_USER_ID,
      clickId: "x".repeat(500),
      db: prisma,
    });
    assert.equal(result.outcome, "invalid_click_id");
    assert.equal(await bindingFor(learner.userId), null);
  });

  /* ------------------------------------------------------------------ */
  /* D. Duplicates and conflicts                                         */
  /* ------------------------------------------------------------------ */

  await check("D1 a duplicate identical registration is idempotent", async () => {
    const learner = await createLearner();
    const pocketId = nextPocketId();
    await postRegistration({ clickId: learner.clickId, playerId: pocketId });
    const first = await bindingFor(learner.userId);

    // Replayed with a NEW event id so the postback layer's own idempotency does
    // not mask the binding layer's behaviour.
    const response = await postRegistration({
      clickId: learner.clickId,
      playerId: pocketId,
    });
    assert.equal(response.status, 200);

    const second = await bindingFor(learner.userId);
    assert.ok(first && second);
    assert.equal(second.id, first.id);
    assert.equal(second.pocketUserId, first.pocketUserId);
    assert.equal(second.boundAt.getTime(), first.boundAt.getTime());
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: learner.userId } }), 1);
  });

  await check("D2 the same learner with a DIFFERENT playerid never overwrites", async () => {
    const learner = await createLearner();
    const original = nextPocketId();
    const attacker = nextPocketId();
    await postRegistration({ clickId: learner.clickId, playerId: original });

    const response = await postRegistration({
      clickId: learner.clickId,
      playerId: attacker,
    });
    // The postback itself still succeeds; the binding does not move.
    assert.equal(response.status, 200);
    const bound = await bindingFor(learner.userId);
    assert.equal(bound?.pocketUserId, original);
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: learner.userId } }), 1);
  });

  await check("D3 the same playerid for a DIFFERENT learner is refused", async () => {
    const first = await createLearner();
    const second = await createLearner();
    const shared = "555000111";

    await postRegistration({ clickId: first.clickId, playerId: shared });
    const response = await postRegistration({ clickId: second.clickId, playerId: shared });
    assert.equal(response.status, 200);

    // One funded Pocket account must not be replayable across learners.
    assert.equal((await bindingFor(first.userId))?.pocketUserId, shared);
    assert.equal(await bindingFor(second.userId), null);
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { pocketUserId: shared } }), 1);
  });

  await check("D4 the binder reports conflicts by name, without overwriting", async () => {
    const learner = await createLearner();
    const other = await createLearner();
    await identity.bindPocketTraderIdentity({
      userId: learner.userId, pocketUserId: "600000001",
      clickId: learner.clickId, db: prisma,
    });

    const sameAgain = await identity.bindPocketTraderIdentity({
      userId: learner.userId, pocketUserId: "600000001",
      clickId: learner.clickId, db: prisma,
    });
    assert.equal(sameAgain.outcome, "already_bound");
    assert.equal(sameAgain.created, false);

    const learnerConflict = await identity.bindPocketTraderIdentity({
      userId: learner.userId, pocketUserId: "600000002",
      clickId: learner.clickId, db: prisma,
    });
    assert.equal(learnerConflict.outcome, "conflict_learner_bound");
    assert.equal(learnerConflict.created, false);

    const traderConflict = await identity.bindPocketTraderIdentity({
      userId: other.userId, pocketUserId: "600000001",
      clickId: other.clickId, db: prisma,
    });
    assert.equal(traderConflict.outcome, "conflict_trader_bound");
    assert.equal(traderConflict.created, false);

    assert.equal((await bindingFor(learner.userId))?.pocketUserId, "600000001");
    assert.equal(await bindingFor(other.userId), null);
  });

  await check("D5 a conflict is audited with a bounded, non-identifying reason", async () => {
    const learner = await createLearner();
    await postRegistration({ clickId: learner.clickId, playerId: "700000001" });
    await postRegistration({ clickId: learner.clickId, playerId: "700000002" });

    const audit = await prisma.auditLog.findFirst({
      where: { action: "POCKET_IDENTITY_BINDING_REJECTED" },
      orderBy: { id: "desc" },
    });
    assert.ok(audit, "a conflict must be auditable");
    const metadata = JSON.stringify(audit.metadata ?? {});
    assert.ok(metadata.includes("conflict_learner_bound"));
    // The claimed identifier is never written to the audit row.
    assert.ok(!metadata.includes("700000002"), metadata);
    assert.ok(!metadata.includes("700000001"), metadata);
  });

  /* ------------------------------------------------------------------ */
  /* E. Races                                                            */
  /* ------------------------------------------------------------------ */

  await check("E1 concurrent identical claims produce exactly one binding", async () => {
    const learner = await createLearner();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        identity.bindPocketTraderIdentity({
          userId: learner.userId, pocketUserId: "800000001",
          clickId: learner.clickId, db: prisma,
        }),
      ),
    );
    const created = results.filter((r) => r.created).length;
    assert.equal(created, 1, "exactly one writer may win");
    assert.ok(
      results.every((r) => r.outcome === "bound" || r.outcome === "already_bound"),
      `identical claims must never conflict: ${results.map((r) => r.outcome).join(",")}`,
    );
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: learner.userId } }), 1);
  });

  await check("E2 concurrent conflicting claims never both commit", async () => {
    const learner = await createLearner();
    const results = await Promise.all([
      identity.bindPocketTraderIdentity({
        userId: learner.userId, pocketUserId: "800000010",
        clickId: learner.clickId, db: prisma,
      }),
      identity.bindPocketTraderIdentity({
        userId: learner.userId, pocketUserId: "800000011",
        clickId: learner.clickId, db: prisma,
      }),
    ]);
    assert.equal(results.filter((r) => r.created).length, 1);
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: learner.userId } }), 1);
  });

  await check("E3 one trader claimed by two learners concurrently binds once", async () => {
    const a = await createLearner();
    const b = await createLearner();
    const results = await Promise.all([
      identity.bindPocketTraderIdentity({
        userId: a.userId, pocketUserId: "800000020", clickId: a.clickId, db: prisma,
      }),
      identity.bindPocketTraderIdentity({
        userId: b.userId, pocketUserId: "800000020", clickId: b.clickId, db: prisma,
      }),
    ]);
    assert.equal(results.filter((r) => r.created).length, 1);
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { pocketUserId: "800000020" } }), 1);
  });

  await check("E4 concurrent authenticated registrations bind once", async () => {
    const learner = await createLearner();
    const responses = await Promise.all([
      postRegistration({ clickId: learner.clickId, playerId: "800000030" }),
      postRegistration({ clickId: learner.clickId, playerId: "800000030" }),
      postRegistration({ clickId: learner.clickId, playerId: "800000031" }),
    ]);
    for (const response of responses) assert.ok(response.status < 500);
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: learner.userId } }), 1);
  });

  /* ------------------------------------------------------------------ */
  /* F. The legacy field is NOT the authority                            */
  /* ------------------------------------------------------------------ */

  await check("F1 ExchangeAccount.traderId alone grants no identity", async () => {
    const learner = await createLearner();
    // Exactly what a deposit postback would leave behind: a traderId on the
    // account, written by a goal that must never bind.
    await prisma.exchangeAccount.update({
      where: { userId: learner.userId },
      data: { traderId: "999888777" },
    });
    assert.equal(await identity.resolvePocketTraderIdentity(learner.userId, prisma), null);
    assert.equal(await bindingFor(learner.userId), null);
  });

  await check("F2 a rewritten legacy traderId cannot move a real binding", async () => {
    const learner = await createLearner();
    await postRegistration({ clickId: learner.clickId, playerId: "111222333" });
    // A later postback overwrites the legacy column — as it always has.
    await prisma.exchangeAccount.update({
      where: { userId: learner.userId },
      data: { traderId: "444555666" },
    });
    const account = await prisma.exchangeAccount.findUnique({ where: { userId: learner.userId } });
    assert.equal(account?.traderId, "444555666");
    // The authoritative binding is unmoved, and it is what the provider reads.
    assert.equal(
      await identity.resolvePocketTraderIdentity(learner.userId, prisma),
      "111222333",
    );
  });

  /* ------------------------------------------------------------------ */
  /* G. No caller may nominate an identity                               */
  /* ------------------------------------------------------------------ */

  await check("G1 the verification API accepts no identity parameter at all", async () => {
    const source = fs.readFileSync("src/lib/curriculum/checkpoint-http.ts", "utf8");
    // The request contract must expose no field through which a learner or a
    // staff member could name a Pocket account.
    for (const forbidden of ["playerid", "playerId", "pocketUserId", "user_id", "traderId", "clickId"]) {
      assert.ok(!source.includes(forbidden), `checkpoint-http exposes ${forbidden}`);
    }
  });

  await check("G2 the provider resolves identity only from the learner id", async () => {
    const source = fs.readFileSync("src/lib/curriculum/checkpoint-provider-pocket.ts", "utf8");
    assert.ok(source.includes("resolveIdentity(request.learnerId)"));
    // The provider request type carries no provider-account field.
    const contract = fs.readFileSync("src/lib/curriculum/checkpoint-provider.ts", "utf8");
    for (const forbidden of ["pocketUserId", "playerId", "accountId", "login"]) {
      assert.ok(!contract.includes(forbidden), `provider contract exposes ${forbidden}`);
    }
  });

  // POCKET-REG-INGRESS-1 — updated to the G4-H5 architecture, and STRENGTHENED.
  // The old spelling matched the identifier as TEXT, so after G4-H5 fused the
  // binding into `bindPocketIdentityCanonical` it flagged two files that only
  // MENTION the binder in prose. What the invariant actually protects is the
  // call graph: the raw binder has exactly ONE caller — the canonical domain
  // operation that also projects `pocket_reg` — so no receiver can ever bind
  // without projecting again. The assertion now matches the CALL, not the name.
  await check("G3 only the canonical authority calls the raw binder", async () => {
    const roots = ["src/app", "src/lib", "src/components"];
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(full, "utf8");
          if (/(?<!function )bindPocketTraderIdentity\s*\(/.test(text) && !full.endsWith("pocketTraderIdentity.ts")) {
            callers.push(full);
          }
        }
      }
    };
    for (const root of roots) walk(root);
    assert.deepEqual(
      callers,
      [path.join("src", "lib", "growth", "pocket", "identity-authority.ts")],
      `unexpected binder callers: ${callers.join(", ")}`,
    );
  });

  await prisma.$disconnect();
  cleanup();

  console.log(`\nL4PA-1 pocket trader identity: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exitCode = 1;
});
