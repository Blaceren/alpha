/**
 * AFD-4 — server-local reconciliation for Pocket first deposits that arrived
 * before the registration which would tell us whose they are.
 *
 * It calls the SAME reconciliation service the `goal=reg` postback calls, so the
 * command and the callback can never reach different answers. It never binds an
 * identity, never completes a level, never awards XP, never touches a balance
 * and never contacts Pocket.
 *
 * WHY THIS EXISTS AT ALL, GIVEN THE CALLBACK ALREADY RECONCILES. The callback's
 * reconciliation deliberately swallows its own failures so a deposit can never
 * fail a registration. That is the right trade, but it means a transient
 * database error at exactly the wrong moment leaves a pending row nobody
 * revisits. This command is the operator's way to revisit them — bounded,
 * idempotent, and safe to run as often as they like.
 *
 * OUTPUT IS COUNTS ONLY. No click ids, no player ids, no amounts, no learner
 * ids, no secrets and no callback URLs ever reach stdout, because an operator
 * pastes this output into a ticket.
 */
import { prisma } from "@/lib/prisma";
import {
  convergePendingEvent,
  type FirstDepositOutcome,
} from "@/lib/exchange/pocketFirstDeposit";
import { resolvePocketFirstDepositConfig } from "@/lib/exchange/pocketFirstDepositConfig";

/** Bounded work per run. An operator can simply run it again. */
const DEFAULT_BATCH = 200;
const MAX_BATCH = 1000;

type Counts = Record<string, number>;

function parseBatch(argv: string[]): number {
  const flag = argv.indexOf("--batch");
  if (flag < 0) return DEFAULT_BATCH;

  const value = Number(argv[flag + 1]);
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_BATCH) {
    console.error(`--batch must be a positive integer up to ${MAX_BATCH}`);
    process.exit(2);
  }
  return value;
}

async function main() {
  const argv = process.argv.slice(2);
  // DRY RUN IS THE DEFAULT. Applying is something an operator has to ask for.
  const apply = argv.includes("--apply");
  const batch = parseBatch(argv);

  const resolution = resolvePocketFirstDepositConfig();
  if (resolution.kind !== "resolved" || !resolution.config.enabled) {
    // Fails closed and says why in bounded terms, rather than reconciling under
    // a currency nobody configured.
    console.error(
      `pocket first deposit is not enabled: ${
        resolution.kind === "invalid" ? resolution.reason : "disabled"
      }`,
    );
    process.exit(2);
  }

  // Bound once, so the currency stamped on every row in this run comes from a
  // single authoritative read rather than being re-resolved per iteration.
  const { currency } = resolution.config;

  // Deterministic ordering, oldest first, so repeated runs walk the backlog in a
  // stable sequence and a run that is interrupted resumes predictably.
  const pending = await prisma.pocketProviderEvent.findMany({
    where: { provider: "pocket", eventType: "first_deposit", status: "pending_identity" },
    select: { id: true },
    orderBy: [{ firstReceivedAt: "asc" }, { id: "asc" }],
    take: batch,
  });

  if (!apply) {
    // A dry run must not report "matched" for work it has not done. It reports
    // only how much is waiting, which is the honest answer to "what would this
    // do" without performing half of it to find out.
    console.log(
      JSON.stringify({ mode: "dry-run", inspected: pending.length, pending: pending.length }, null, 2),
    );
    await prisma.$disconnect();
    return;
  }

  const outcomes: Counts = {};
  let errors = 0;
  let conversions = 0;

  for (const { id } of pending) {
    try {
      const result = await prisma.$transaction((tx) =>
        convergePendingEvent(tx, id, currency, new Date()),
      );
      outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
      if (result.outcome === "reconciled") conversions += 1;
    } catch {
      // The thrown value is deliberately not inspected or printed: a Prisma
      // error can quote the conflicting row, and this must not become the way a
      // Pocket identifier reaches an operator's terminal or a ticket.
      errors += 1;
    }
  }

  const count = (outcome: FirstDepositOutcome) => outcomes[outcome] ?? 0;

  console.log(
    JSON.stringify(
      {
        mode: "apply",
        inspected: pending.length,
        matched: count("reconciled"),
        unchanged_pending: count("unchanged_pending"),
        conflicts: count("conflict"),
        conversion_events_created: conversions,
        errors,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
  if (errors > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
