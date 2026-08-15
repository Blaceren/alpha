/**
 * AFFILIATE-PLATFORM-V1 §27/§28 — the delivery worker.
 *
 * ONE LOGICAL DELIVERY, MANY ATTEMPTS. The delivery row is the fact "this
 * partner is owed a notification about this conversion". An attempt row is the
 * fact "we tried at this instant and this happened". Retries add attempts and
 * never deliveries, which is what makes "how many times did we tell them" and
 * "how many times did we try" two answerable and different questions.
 *
 * ---------------------------------------------------------------------------
 * CLAIMING, AND WHY A DUPLICATE WORKER IS SAFE
 *
 * A run claims a batch by moving each due row's `nextAttemptAt` forward with a
 * CONDITIONAL UPDATE — `updateMany` filtered on the id AND on the state it was
 * read in. Two workers that both read the same row both issue that update, and
 * SQLite serialises them: the first matches one row, the second matches ZERO
 * and skips it. So a duplicated worker performs no duplicate attempt, and it
 * needs no lock table, no lease column and no cleanup job for leases whose
 * owner died.
 *
 * §28 asks for duplicate-worker and concurrent-worker behaviour to be tested.
 * This is the property those tests assert, and it is a property of the claim,
 * not of scheduling.
 *
 * ---------------------------------------------------------------------------
 * THE ENDPOINT IS RE-READ AT DELIVERY TIME, EVERY TIME
 *
 * Not the URL — that was rendered when the conversion happened and is frozen on
 * the delivery row, so a partner cannot rewrite the payload of a past
 * conversion by editing a template. But the endpoint's STATUS and its SIGNING
 * SECRET are read fresh: a partner who disabled an endpoint five minutes ago
 * must not receive the backlog, and a rotated secret must sign the next attempt.
 *
 * ---------------------------------------------------------------------------
 * NOTHING FROM A REMOTE SERVER IS TRUSTED OR EXPANDED
 *
 * The only remote-controlled value stored is a bounded, control-character-free
 * response snippet. No remote header is persisted, no remote body is parsed,
 * and no error message from the socket layer — which can quote a hostname — is
 * ever written to a row or a log.
 */
import type { AffiliatePostbackAttemptOutcome, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deliverPostback } from "@/lib/affiliate/postback/client";
import { postbackHeaders } from "@/lib/affiliate/postback/signature";
import { nextAttemptAt } from "@/lib/affiliate/postback/enqueue";
import { isPostbackDeliveryEnabled } from "@/lib/affiliate/platform-config";

/** A bound on how much one run may do, so a backlog drains in slices. */
export const POSTBACK_WORKER_BATCH_SIZE = 25;

/**
 * Outcomes that will never succeed on a retry, whatever the partner does to
 * their server in the next seven hours.
 *
 * A 4xx IS TERMINAL. The receiver understood the request and refused it;
 * sending the identical bytes again is not a recovery strategy, it is a way to
 * hammer somebody's endpoint. `blocked_destination` is terminal for a stronger
 * reason: the destination failed a SECURITY check, and retrying a blocked
 * address is exactly what an attacker probing for a race would want.
 */
const TERMINAL_OUTCOMES = new Set(["http_4xx", "blocked_destination", "too_many_redirects"]);

export type WorkerRunResult = {
  readonly claimed: number;
  readonly delivered: number;
  readonly retryable: number;
  readonly terminal: number;
  readonly skipped: number;
  readonly disabled: boolean;
};

/**
 * Run one pass of the worker.
 *
 * IT NEVER THROWS FOR A SINGLE BAD DELIVERY. One partner's endpoint must not be
 * able to stop every other partner's deliveries, so each row is handled inside
 * its own try and a failure is recorded as an attempt rather than raised.
 */
export async function runPostbackDeliveryWorker(
  db: PrismaClient = prisma,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorkerRunResult> {
  const empty: WorkerRunResult = {
    claimed: 0,
    delivered: 0,
    retryable: 0,
    terminal: 0,
    skipped: 0,
    disabled: false,
  };

  // §36. The switch is read here, not cached, and the queue SURVIVES it being
  // off: deliveries keep being enqueued and simply are not sent, so turning it
  // on drains the backlog rather than losing it.
  if (!isPostbackDeliveryEnabled(env)) return { ...empty, disabled: true };

  const due = await db.affiliatePostbackDelivery.findMany({
    where: {
      status: { in: ["pending", "failed_retryable"] },
      nextAttemptAt: { lte: now },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: POSTBACK_WORKER_BATCH_SIZE,
    select: {
      id: true,
      publicId: true,
      requestUrl: true,
      attemptCount: true,
      maxAttempts: true,
      nextAttemptAt: true,
      status: true,
      endpointId: true,
      endpointVersion: true,
    },
  });

  let claimed = 0;
  let delivered = 0;
  let retryable = 0;
  let terminal = 0;
  let skipped = 0;

  for (const row of due) {
    // THE CLAIM. Conditional on the exact state this row was read in, so a
    // second worker that read the same row matches zero rows and moves on.
    const claim = await db.affiliatePostbackDelivery.updateMany({
      where: {
        id: row.id,
        status: row.status,
        attemptCount: row.attemptCount,
        nextAttemptAt: row.nextAttemptAt,
      },
      data: { nextAttemptAt: nextAttemptAt(row.attemptCount + 1, now) },
    });
    if (claim.count === 0) {
      skipped += 1;
      continue;
    }
    claimed += 1;

    try {
      const outcome = await attemptOneDelivery(db, row, now, env);
      if (outcome === "delivered") delivered += 1;
      else if (outcome === "terminal") terminal += 1;
      else retryable += 1;
    } catch {
      // The row keeps the claim's `nextAttemptAt`, so it is retried on a later
      // pass rather than being lost or spun on.
      retryable += 1;
    }
  }

  return { claimed, delivered, retryable, terminal, skipped, disabled: false };
}

type DueRow = {
  id: number;
  publicId: string;
  requestUrl: string;
  attemptCount: number;
  maxAttempts: number;
  endpointId: number;
  endpointVersion: number;
};

async function attemptOneDelivery(
  db: PrismaClient,
  row: DueRow,
  now: Date,
  env: NodeJS.ProcessEnv,
): Promise<"delivered" | "retryable" | "terminal"> {
  const endpoint = await db.affiliatePostbackEndpoint.findUnique({
    where: { id: row.endpointId },
    select: { status: true, signingSecret: true, secretVersion: true, version: true },
  });

  const attemptNumber = row.attemptCount + 1;
  const startedAt = new Date();

  // A DISABLED ENDPOINT ENDS THE DELIVERY, TERMINALLY, WITH AN ATTEMPT ROW
  // SAYING SO. The partner sees why, and no request is made.
  if (endpoint === null || endpoint.status !== "active") {
    await recordAttempt(db, row, {
      attemptNumber,
      startedAt,
      finishedAt: new Date(),
      outcome: "endpoint_disabled",
      httpStatus: null,
      responseSnippet: null,
      durationMs: 0,
      terminal: true,
    });
    return "terminal";
  }

  const result = await deliverPostback(
    row.requestUrl,
    postbackHeaders({
      secret: endpoint.signingSecret,
      secretVersion: endpoint.secretVersion,
      deliveryPublicId: row.publicId,
      requestUrl: row.requestUrl,
      now: startedAt,
    }),
    env,
  );

  const isTerminal =
    result.outcome !== "delivered" &&
    (TERMINAL_OUTCOMES.has(result.outcome) || attemptNumber >= row.maxAttempts);

  await recordAttempt(db, row, {
    attemptNumber,
    startedAt,
    finishedAt: new Date(),
    outcome: result.outcome,
    httpStatus: result.httpStatus,
    responseSnippet: result.responseSnippet,
    durationMs: result.durationMs,
    terminal: isTerminal,
  });

  if (result.outcome === "delivered") return "delivered";
  return isTerminal ? "terminal" : "retryable";
}

async function recordAttempt(
  db: PrismaClient,
  row: DueRow,
  attempt: {
    attemptNumber: number;
    startedAt: Date;
    finishedAt: Date;
    // THE PRISMA ENUM ITSELF, not a widened `string`. The client outcome union
    // and this enum are the same eleven values pinned to the same CHECK
    // constraint in migration 50, so taking the enum here means a value the
    // database would refuse cannot reach this function — and no `any` cast is
    // needed at the write.
    outcome: AffiliatePostbackAttemptOutcome;
    httpStatus: number | null;
    responseSnippet: string | null;
    durationMs: number;
    terminal: boolean;
  },
): Promise<void> {
  const delivered = attempt.outcome === "delivered";
  const status = delivered ? "delivered" : attempt.terminal ? "failed_terminal" : "failed_retryable";

  // ONE TRANSACTION. The attempt and the delivery's summary of it are one fact;
  // a delivery marked delivered with no attempt row explaining it would be a
  // claim with no evidence.
  await db.$transaction(async (tx) => {
    await tx.affiliatePostbackAttempt.create({
      data: {
        deliveryId: row.id,
        attemptNumber: attempt.attemptNumber,
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        outcome: attempt.outcome,
        httpStatus: attempt.httpStatus,
        durationMs: attempt.durationMs,
        responseSnippet: attempt.responseSnippet,
      },
    });

    await tx.affiliatePostbackDelivery.update({
      where: { id: row.id },
      data: {
        status,
        attemptCount: { increment: 1 },
        lastAttemptAt: attempt.finishedAt,
        lastOutcome: attempt.outcome,
        lastHttpStatus: attempt.httpStatus,
        deliveredAt: delivered ? attempt.finishedAt : null,
        // A TERMINAL ROW IS NEVER SCHEDULED AGAIN. The CHECK constraint in
        // migration 50 enforces exactly this pairing, so a bug that set one
        // without the other would fail the write rather than create a delivery
        // the worker picks up forever.
        nextAttemptAt: delivered || attempt.terminal ? null : undefined,
      },
    });
  });
}
