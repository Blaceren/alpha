/**
 * LO-REVIEW-WORKITEM-UNREACHABLE-1 §12/§13 — the operator entry point for
 * rebuilding MISSING derived operational state.
 *
 * The whole decision lives in `src/lib/learner-ops/reconcile-review-work-items.ts`;
 * this is the CLI around it, following the house pattern: environment gate
 * first, dry run by default, one JSON object on stdout, human lines on stderr.
 *
 * IT CANNOT CHANGE CANONICAL EDUCATIONAL TRUTH. The owner it calls reads
 * `ReportSubmission` and `UserLevelProgress` and writes neither. There is no
 * flag here that makes it approve, reject, complete or rewind anything, because
 * there is no such code path to expose.
 *
 * §13 — INSPECT BEFORE YOU APPLY. Without `--apply` it prints the proposed set
 * and exits, so the rows can be read and judged against their fixture
 * provenance before a single case is created.
 *
 *   DATABASE_URL=... npx tsx scripts/ops/reconcileReviewWorkItems.ts [--apply]
 */
import { checkPreprodEnvironment } from "./preprod-qa-operator/guard";
import { reconcileReviewWorkItems } from "@/lib/learner-ops/reconcile-review-work-items";

function note(line: string): void {
  process.stderr.write(`${line}\n`);
}

async function main(): Promise<number> {
  const environment = checkPreprodEnvironment(process.env);
  if (environment.kind === "refused") {
    note(`REFUSED: ${environment.reason}`);
    process.stdout.write(JSON.stringify({ ok: false, refusal: "environment" }, null, 2) + "\n");
    return 3;
  }

  const apply = process.argv.includes("--apply");
  const report = await reconcileReviewWorkItems({ apply });

  note(apply ? "APPLYING — missing work items will be created." : "DRY RUN — nothing is written. Add --apply.");
  for (const row of report.rows) {
    note(
      `  ${row.kind.padEnd(6)} canonical=${String(row.canonicalId).padEnd(5)} ` +
        `user=${String(row.userId).padEnd(4)} level=${String(row.levelNumber).padEnd(3)} ` +
        `state=${row.canonicalState.padEnd(14)} workItem=${row.hasWorkItem ? "present" : "MISSING"}`,
    );
  }
  note(
    `  reports: ${report.pendingReports} pending, ${report.reportsMissingWorkItem} missing, ` +
      `${report.reportsRepaired} repaired`,
  );
  note(
    `  mentor : ${report.pendingMentorReviews} pending, ${report.mentorReviewsMissingWorkItem} missing, ` +
      `${report.mentorReviewsRepaired} repaired`,
  );
  note(`  orphaned operational items: ${report.orphanedWorkItems}`);

  process.stdout.write(JSON.stringify({ ok: true, ...report }, null, 2) + "\n");
  return 0;
}

const invokedDirectly =
  typeof process.argv[1] === "string" && process.argv[1].includes("reconcileReviewWorkItems");

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exit(1);
    });
}
