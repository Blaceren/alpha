/**
 * QAOPS-1 — the PREPROD QA operator ops command.
 *
 * TWO VERBS AND NOTHING ELSE:
 *
 *   provision   create (or complete) the ONE synthetic PREPROD QA staff
 *               principal, so a real Chrome can log into the PREPROD CRM as
 *               somebody who is not a real employee
 *
 *   attest      execute the EXISTING typed StagingAttestation domain operation
 *               as that principal, for `pocket_registration` or
 *               `financial_checkpoint`, on one named learner and one named level
 *
 * IT IS A DRY RUN UNTIL `--apply`. Without it, both verbs read, report and write
 * nothing. With it, the acknowledgement `ATA_QA_OPS_CONFIRM` must also carry the
 * exact sentinel for THAT verb, and the deployment must pass all three
 * environment checks in `preprod-qa-operator/guard.ts`. A production checkout
 * plus knowledge of this command name is not enough to write anything, anywhere.
 *
 * WHAT IT IS NOT
 *   • not a user-management CLI — one frozen identity, no `--email`, no
 *     `--role`, no delete, no password rotation, no second principal
 *   • not an attestation CLI — two event classes taken from the domain's own
 *     list, no arbitrary type, no free-form mutation
 *   • not a database tool — no SQL, no `--table`, no raw query, no migration
 *   • not an HTTP surface — nothing here is imported by a route, and no route
 *     is added; it runs on the host, under the deployment's own environment
 *
 * OUTPUT DISCIPLINE. Human lines go to stderr, one JSON result object goes to
 * stdout (so `> evidence.json` is clean). Neither carries a password, a hash, a
 * cookie, a CAPTCHA token, a learner email or any secret from the environment.
 */
import { PrismaClient } from "@prisma/client";
import {
  asEventClass,
  attestAsQaOperator,
  preflightAttestation,
  resolveQaOperator,
  type AttestTarget,
} from "./preprod-qa-operator/attest";
import {
  checkPreprodEnvironment,
  checkQaOpsAllowed,
  QA_OPS_CONFIRM_KEY,
  QA_OPS_CONFIRM_VALUES,
} from "./preprod-qa-operator/guard";
import {
  QA_OPERATOR_EMAIL,
  QA_OPERATOR_STAFF_ROLE,
  QA_OPERATOR_USER_ROLE,
} from "./preprod-qa-operator/identity";
import {
  intakeOperatorPassword,
  QA_OPERATOR_PASSWORD_KEY,
} from "./preprod-qa-operator/password";
import { inspectQaOperator, provisionQaOperator } from "./preprod-qa-operator/provision";
import {
  isStagingAttestationUsable,
  STAGING_ATTESTATION_ENABLED_KEY,
} from "@/lib/curriculum/staging-attestation-policy";
import { STAGING_ATTESTATION_EVENT_CLASSES } from "@/lib/curriculum/staging-attestation";

/* -------------------------------------------------------------- exit codes */

export const EXIT = {
  ok: 0,
  usage: 2,
  refusedByGuard: 3,
  refusedByState: 4,
  domainError: 5,
} as const;

/* ------------------------------------------------------------ arg handling */

/**
 * Money-shaped flags, named so the refusal is an explanation rather than
 * "unknown option".
 *
 * None of these could have worked: `AttestStagingGateInput` has no field for
 * them and `StagingAttestation` has no column for them. They are listed to make
 * the refusal legible, not to provide the protection — the protection is
 * structural.
 */
const REFUSED_FINANCIAL_FLAGS = [
  "amount",
  "balance",
  "deposit",
  "currency",
  "transaction",
  "pnl",
  "profit",
  "equity",
  "pocket-transaction",
  "provider-event",
] as const;

type ParsedArgs =
  | { kind: "ok"; verb: string; flags: Map<string, string>; apply: boolean }
  | { kind: "error"; message: string };

/**
 * A strict `--key value` parser. Unknown keys are errors, never ignored extras —
 * the same posture the accepted HTTP route takes with its strict body schema.
 */
export function parseArgs(argv: readonly string[], allowed: readonly string[]): ParsedArgs {
  const [verb, ...rest] = argv;
  if (verb === undefined) return { kind: "error", message: "a verb is required" };

  const flags = new Map<string, string>();
  let apply = false;

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] as string;
    if (!token.startsWith("--")) {
      return { kind: "error", message: `unexpected positional argument at position ${i + 1}` };
    }
    const key = token.slice(2);

    if (key === "apply") {
      apply = true;
      continue;
    }
    if ((REFUSED_FINANCIAL_FLAGS as readonly string[]).includes(key)) {
      return {
        kind: "error",
        message: `--${key} is refused: a staging attestation records that a gate was witnessed, never a figure. There is no field for it in the domain input and no column for it on the row.`,
      };
    }
    if (!allowed.includes(key)) {
      return { kind: "error", message: `unknown option --${key}` };
    }
    if (flags.has(key)) {
      return { kind: "error", message: `--${key} given more than once` };
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      return { kind: "error", message: `--${key} requires a value` };
    }
    flags.set(key, value);
    i += 1;
  }

  return { kind: "ok", verb, flags, apply };
}

/* ---------------------------------------------------------------- printing */

function note(line: string) {
  process.stderr.write(`${line}\n`);
}

function emit(payload: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function usage() {
  note("usage:");
  note("  preprodQaOperator provision [--apply]");
  note("  preprodQaOperator attest --learner <id> --level <stableCode> \\");
  note(`      --event <${STAGING_ATTESTATION_EVENT_CLASSES.join("|")}> --request-id <id> [--apply]`);
  note("");
  note("environment:");
  note("  ATA_ENVIRONMENT=staging                 (authoritative classification)");
  note(`  ${STAGING_ATTESTATION_ENABLED_KEY}=true         (PREPROD capability marker)`);
  note(`  ${QA_OPS_CONFIRM_KEY}=<sentinel>            (required only with --apply)`);
  note(`  ${QA_OPERATOR_PASSWORD_KEY}=<secret>   (provision only; or pipe it on stdin)`);
}

/* ------------------------------------------------------------------- verbs */

/** What a dry run would do, in the imperative. */
const PROVISION_INTENT: Record<string, string> = {
  created: "create the principal and its staff profile",
  staff_profile_created: "create only the missing staff profile",
  already_configured: "do nothing: the principal already matches exactly",
  conflict: "refuse",
};

async function runProvision(db: PrismaClient, apply: boolean): Promise<number> {
  if (!apply) {
    const outcome = await inspectQaOperator(db);
    note(`dry run: no write performed. Address ${QA_OPERATOR_EMAIL}.`);
    note(
      outcome.action === "conflict"
        ? `would refuse: ${outcome.conflicts.join("; ")}`
        : `would ${PROVISION_INTENT[outcome.action] ?? outcome.action}`,
    );
    emit({
      verb: "provision",
      // `applied` is the MODE (was --apply given), `wrote` is the EFFECT (did the
      // database change). They are reported separately because an apply run that
      // finds everything already correct writes nothing, and collapsing the two
      // would make that run indistinguishable from one that did.
      applied: false,
      wrote: false,
      action: outcome.action,
      userId: outcome.userId,
      staffProfileId: outcome.staffProfileId,
      conflicts: outcome.conflicts,
      email: QA_OPERATOR_EMAIL,
      role: QA_OPERATOR_USER_ROLE,
      staffRole: QA_OPERATOR_STAFF_ROLE,
    });
    return outcome.action === "conflict" ? EXIT.refusedByState : EXIT.ok;
  }

  const guard = checkQaOpsAllowed("provision");
  if (guard.kind === "refused") {
    note(`refused (${guard.reason}): ${guard.detail}`);
    emit({ verb: "provision", applied: false, refused: guard.reason });
    return EXIT.refusedByGuard;
  }

  // FAIL CLOSED. There is no default password anywhere in this capability, so an
  // absent one is a refusal and not a fallback.
  const intake = await intakeOperatorPassword();
  if (intake.kind === "absent") {
    note(
      `refused: a password is required. Set ${QA_OPERATOR_PASSWORD_KEY} or pipe it on stdin. It is never stored, printed or defaulted.`,
    );
    emit({ verb: "provision", applied: false, refused: "password_absent" });
    return EXIT.refusedByGuard;
  }
  if (intake.kind === "rejected") {
    note(`refused: the supplied password does not satisfy the product policy:`);
    for (const issue of intake.issues) note(`  - ${issue}`);
    emit({ verb: "provision", applied: false, refused: "password_rejected" });
    return EXIT.refusedByGuard;
  }

  const outcome = await provisionQaOperator(db, intake.password);
  if (outcome.action === "conflict") {
    note(`refused: a different principal already holds ${QA_OPERATOR_EMAIL}. Nothing was written.`);
    for (const conflict of outcome.conflicts) note(`  - ${conflict}`);
    emit({
      verb: "provision",
      applied: false,
      action: "conflict",
      userId: outcome.userId,
      conflicts: outcome.conflicts,
    });
    return EXIT.refusedByState;
  }

  note(
    `${outcome.action}: user ${outcome.userId}, staff profile present${outcome.readOnly ? " (nothing was written)" : ""}.`,
  );
  // The password source is reported as a boolean-ish label, never the value.
  note(`password source: ${intake.source}. It was not written to disk or logged.`);
  emit({
    verb: "provision",
    applied: true,
    action: outcome.action,
    userId: outcome.userId,
    staffProfileId: outcome.staffProfileId,
    email: QA_OPERATOR_EMAIL,
    role: QA_OPERATOR_USER_ROLE,
    staffRole: QA_OPERATOR_STAFF_ROLE,
    wrote: !outcome.readOnly,
  });
  return EXIT.ok;
}

async function runAttest(
  db: PrismaClient,
  flags: Map<string, string>,
  apply: boolean,
): Promise<number> {
  const learnerRaw = flags.get("learner");
  const level = flags.get("level");
  const eventRaw = flags.get("event");
  const requestId = flags.get("request-id");

  if (!learnerRaw || !level || !eventRaw || !requestId) {
    note("refused: --learner, --level, --event and --request-id are all required");
    return EXIT.usage;
  }
  const learnerUserId = Number(learnerRaw);
  if (!Number.isSafeInteger(learnerUserId) || learnerUserId <= 0) {
    note("refused: --learner must be a positive integer user id");
    return EXIT.usage;
  }
  const eventClass = asEventClass(eventRaw);
  if (!eventClass) {
    note(
      `refused: --event must be one of ${STAGING_ATTESTATION_EVENT_CLASSES.join(", ")}. No other attestation type exists.`,
    );
    return EXIT.usage;
  }

  const target: AttestTarget = { eventClass, learnerUserId, stableCode: level, requestId };

  const preflight = await preflightAttestation(db, target);
  if (preflight.kind === "refused") {
    note(`refused (${preflight.code}): ${preflight.detail}`);
    emit({ verb: "attest", applied: false, refused: preflight.code, facts: preflight.facts });
    return EXIT.refusedByState;
  }

  if (!apply) {
    note(
      `dry run: no write performed. Target verified for ${eventClass} on ${level} for learner ${learnerUserId}.`,
    );
    if (preflight.facts.replayOfSameRequest) {
      note("note: an identical attestation already exists; applying would REPLAY it, not attest twice.");
    }
    emit({ verb: "attest", applied: false, wrote: false, eventClass, facts: preflight.facts });
    return EXIT.ok;
  }

  const guard = checkQaOpsAllowed("attest");
  if (guard.kind === "refused") {
    note(`refused (${guard.reason}): ${guard.detail}`);
    emit({ verb: "attest", applied: false, refused: guard.reason });
    return EXIT.refusedByGuard;
  }

  const operator = await resolveQaOperator(db);
  if (!operator) {
    note(`refused: no principal exists at ${QA_OPERATOR_EMAIL}`);
    return EXIT.refusedByState;
  }

  try {
    const receipt = await attestAsQaOperator(db, operator.id, target);
    note(
      `${receipt.created ? "attested" : "replayed"}: attestation ${receipt.attestationId}, level ${receipt.levelNumber}, completed=${receipt.completed}, xpAwarded=${receipt.xpAwarded}`,
    );
    emit({
      verb: "attest",
      applied: true,
      // A replay writes no new attestation; `created` from the domain receipt is
      // the authority on that, so `wrote` simply mirrors it.
      wrote: receipt.created,
      operatorUserId: operator.id,
      learnerUserId,
      ...receipt,
    });
    return EXIT.ok;
  } catch (error) {
    // The domain's own refusal codes are bounded and carry no learner data.
    const code =
      error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : null;
    note(`refused by the domain${code ? ` (${code})` : ""}`);
    emit({ verb: "attest", applied: false, refused: code ?? "STAGING_ATTESTATION_ERROR" });
    return EXIT.domainError;
  }
}

/* -------------------------------------------------------------------- main */

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv, ["learner", "level", "event", "request-id"]);
  if (parsed.kind === "error") {
    note(`refused: ${parsed.message}`);
    usage();
    return EXIT.usage;
  }
  if (parsed.verb !== "provision" && parsed.verb !== "attest") {
    note(`refused: unknown verb ${JSON.stringify(parsed.verb)}. This tool has exactly two.`);
    usage();
    return EXIT.usage;
  }
  if (parsed.verb === "provision" && parsed.flags.size > 0) {
    note("refused: provision takes no options; the identity is frozen in source");
    return EXIT.usage;
  }

  // The environment half of the guard runs before ANY database access, including
  // the dry run's: reading a production database with a QA tool is not a thing to
  // be relaxed about either.
  const environment = checkPreprodEnvironment();
  if (environment.kind === "refused") {
    note(`refused (${environment.reason}): ${environment.detail}`);
    emit({ verb: parsed.verb, applied: false, refused: environment.reason });
    return EXIT.refusedByGuard;
  }

  // Belt and braces: the same question the domain asks itself, asked here so a
  // guard that ever drifted from the capability policy is caught immediately.
  if (!isStagingAttestationUsable()) {
    note("refused: staging attestation is not usable in this deployment");
    return EXIT.refusedByGuard;
  }

  if (parsed.apply) {
    note(`applying as the synthetic principal ${QA_OPERATOR_EMAIL}`);
    note(`acknowledgement expected: ${QA_OPS_CONFIRM_KEY}=${QA_OPS_CONFIRM_VALUES[parsed.verb]}`);
  }

  const db = new PrismaClient();
  try {
    return parsed.verb === "provision"
      ? await runProvision(db, parsed.apply)
      : await runAttest(db, parsed.flags, parsed.apply);
  } finally {
    await db.$disconnect();
  }
}

/**
 * Run only when this file is the process entry point.
 *
 * The regression imports `main` and `parseArgs` directly to exercise them
 * in-process, and an unconditional call here would fire on that import.
 */
const invokedPath = process.argv[1] ?? "";
if (invokedPath.endsWith("preprodQaOperator.ts") || invokedPath.endsWith("preprodQaOperator.js")) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      note(`internal error: ${error instanceof Error ? error.message : "unknown"}`);
      process.exitCode = EXIT.domainError;
    });
}
