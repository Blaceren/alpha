/**
 * QAOPS-1 — the hard PREPROD guard.
 *
 * THE THREAT THIS ANSWERS
 * Somebody with a shell on a PRODUCTION host, holding a PROD checkout of this
 * repository and knowing the command name, must not be able to mint an admin
 * principal or complete a learner's gate. Filesystem access plus knowledge of
 * the command must not be sufficient.
 *
 * FOUR INDEPENDENT CHECKS, ALL REQUIRED
 *
 *   1. AUTHORITATIVE CLASSIFICATION — `classifyEnvironment` must answer exactly
 *      `staging`. This is the platform's own environment identity
 *      (src/lib/environment.ts), and it is stated positively: absent,
 *      misspelled, `dev` and `production` all refuse. Nothing here is derived
 *      from `NODE_ENV`, which in this project is `production` in DEV and in
 *      PREPROD alike and therefore says nothing about where the code is running.
 *
 *   2. THE PREPROD CAPABILITY MARKER — `STAGING_ATTESTATION_ENABLED` must be
 *      exactly `true`. This is not a restatement of check 1. It is an
 *      independent fact about the deployment with a property no other flag has:
 *      `validateRuntimeEnv` REFUSES TO BOOT a deployment that sets it anywhere
 *      other than `staging` (src/lib/env.ts). A host on which this key is `true`
 *      and which is nonetheless serving traffic has therefore already proved,
 *      through the application's own startup contract, that it is not
 *      production.
 *
 *   3. A COHERENT DEPLOYMENT — `validateRuntimeEnv(env).ok`. The environment
 *      handed to this tool must be one the application itself would agree to
 *      boot on. A shell that exported `ATA_ENVIRONMENT=staging` by hand, with
 *      none of the deployment's real configuration around it, fails here: it is
 *      not a PREPROD deployment, it is a claim about one. This is the check that
 *      makes checks 1 and 2 hard to forge by typing two variables.
 *
 *   4. AN EXPLICIT, PER-VERB ACKNOWLEDGEMENT — `ATA_QA_OPS_CONFIRM` must equal
 *      the exact sentinel for the operation being performed. Provisioning and
 *      attesting have DIFFERENT sentinels, so an acknowledgement left in a
 *      shell's environment after a provisioning run cannot silently authorize an
 *      attestation later.
 *
 * ORDER MATTERS. The environment checks run BEFORE the acknowledgement, so on a
 * production host the answer is "wrong environment" no matter what anyone typed,
 * and the sentinel values are never a thing a production host can be walked
 * toward one variable at a time.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * It never consults `NODE_ENV !== "production"`, never infers PREPROD from a
 * hostname or a database path, and never has a bypass, an override flag or a
 * "force" mode. There is no code path through this module that returns `allowed`
 * without all four checks passing.
 */
import { classifyEnvironment, describeEnvironment } from "@/lib/environment";
import { validateRuntimeEnv } from "@/lib/env";
import { isStagingAttestationFlagSet } from "@/lib/curriculum/staging-attestation-policy";

/** The two operations this capability has. There is no third. */
export type QaOpsVerb = "provision" | "attest";

/**
 * The per-verb acknowledgement values.
 *
 * Deliberately verbose and deliberately different from each other. Neither is a
 * value anyone would produce by accident, and neither one authorizes the other.
 */
export const QA_OPS_CONFIRM_KEY = "ATA_QA_OPS_CONFIRM";

export const QA_OPS_CONFIRM_VALUES: Record<QaOpsVerb, string> = {
  provision: "PROVISION_PREPROD_QA_OPERATOR",
  attest: "ATTEST_PREPROD_QA_GATE",
};

export type QaOpsRefusalReason =
  /** `classifyEnvironment` did not answer `staging`. */
  | "environment_not_staging"
  /** `STAGING_ATTESTATION_ENABLED` is not exactly `true`. */
  | "staging_capability_absent"
  /** The environment is not one the application would boot on. */
  | "runtime_env_invalid"
  /** `ATA_QA_OPS_CONFIRM` is missing or is not this verb's sentinel. */
  | "acknowledgement_missing";

export type QaOpsGuardResult =
  | { readonly kind: "allowed" }
  | {
      readonly kind: "refused";
      readonly reason: QaOpsRefusalReason;
      /** Operator-facing, never quotes a secret or a supplied value. */
      readonly detail: string;
    };

/**
 * The environment half of the guard: checks 1 to 3.
 *
 * Split from the acknowledgement so the read-only DRY RUN can require it. A dry
 * run performs no write, but it does READ the database, and reading a production
 * database with a QA tool is not something to be relaxed about either.
 */
export function checkPreprodEnvironment(env: NodeJS.ProcessEnv = process.env): QaOpsGuardResult {
  const classification = classifyEnvironment(env);
  if (classification.kind !== "classified" || classification.environment !== "staging") {
    return {
      kind: "refused",
      reason: "environment_not_staging",
      // `describeEnvironment` renders a bounded label ("production", "unknown
      // (absent)") and never echoes an arbitrary supplied value.
      detail: `ATA_ENVIRONMENT must be exactly staging (environment is ${describeEnvironment(env)})`,
    };
  }

  if (!isStagingAttestationFlagSet(env)) {
    return {
      kind: "refused",
      reason: "staging_capability_absent",
      detail:
        "STAGING_ATTESTATION_ENABLED=true is required: it is the PREPROD capability marker the application refuses to boot with anywhere else",
    };
  }

  const runtime = validateRuntimeEnv(env);
  if (!runtime.ok) {
    return {
      kind: "refused",
      reason: "runtime_env_invalid",
      // The error list is the application's own, and is written to name keys
      // rather than quote values (see src/lib/env.ts).
      detail: `the environment is not one this application would boot on: ${runtime.errors.join("; ")}`,
    };
  }

  return { kind: "allowed" };
}

/**
 * The full guard: the environment checks, then the per-verb acknowledgement.
 *
 * Required before any WRITE. `checkPreprodEnvironment` alone is required before
 * any read.
 */
export function checkQaOpsAllowed(
  verb: QaOpsVerb,
  env: NodeJS.ProcessEnv = process.env,
): QaOpsGuardResult {
  const environment = checkPreprodEnvironment(env);
  if (environment.kind === "refused") return environment;

  const expected = QA_OPS_CONFIRM_VALUES[verb];
  if (env[QA_OPS_CONFIRM_KEY] !== expected) {
    return {
      kind: "refused",
      reason: "acknowledgement_missing",
      detail: `${QA_OPS_CONFIRM_KEY}=${expected} is required to apply the ${verb} operation`,
    };
  }

  return { kind: "allowed" };
}
