/**
 * AFFILIATE-PLATFORM-V1 §27/§28 — the operator entry point for the delivery
 * worker.
 *
 * WHY A SCRIPT AND NOT AN INTERVAL INSIDE THE APP. A Next.js server process may
 * be restarted, may run more than one instance, and has no supervised lifecycle
 * of its own. A timer started inside it would deliver at a cadence nobody
 * declared and would double up on every extra instance. A supervised unit that
 * runs one pass and exits is observable, stoppable, and its concurrency is the
 * scheduler's business rather than an emergent property.
 *
 * RUNNING IT TWICE AT ONCE IS SAFE, and that is a tested property rather than a
 * hope: the worker claims each row with a conditional update, so the second
 * process matches zero rows and skips. §28 asks for duplicate-worker and
 * concurrent-worker behaviour, and this is the entry point those tests drive.
 *
 * IT PRINTS A COUNT AND NOTHING ELSE. No URL, no partner, no response body —
 * the delivery ledger holds all of that, and a worker that logged destinations
 * would put partner data into a system journal.
 */
import { PrismaClient } from "@prisma/client";
import { runPostbackDeliveryWorker } from "../../src/lib/affiliate/postback/worker";

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await runPostbackDeliveryWorker(prisma, new Date());
    if (result.disabled) {
      console.log("affiliate-postback-worker: delivery disabled by configuration, nothing sent");
      return;
    }
    console.log(
      `affiliate-postback-worker: claimed=${result.claimed} delivered=${result.delivered} ` +
        `retryable=${result.retryable} terminal=${result.terminal} skipped=${result.skipped}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // A BOUNDED MESSAGE. A thrown Prisma error can quote a row, and a socket
  // error can quote a partner's hostname — neither belongs in a journal.
  console.error("affiliate-postback-worker: failed");
  console.error((error as Error).message.slice(0, 200));
  process.exit(1);
});
