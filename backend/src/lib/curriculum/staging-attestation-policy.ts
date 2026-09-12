/**
 * A8 — whether STAGING_ATTESTED QA verification exists in this deployment.
 *
 * Split out from the attestation service on purpose: this file has no Prisma,
 * no HTTP and no side effects, so the completion primitive, the service, the
 * routes and `validateRuntimeEnv` can all ask the SAME question without any of
 * them importing the others. One answer, four callers, no drift.
 *
 * THE RULE, STATED POSITIVELY SO FORGETTING FAILS
 * The capability exists only when BOTH are true:
 *
 *   1. `ATA_ENVIRONMENT` is exactly `staging` (see src/lib/environment.ts —
 *      `NODE_ENV` is NOT an environment signal in this project, because the DEV
 *      and PREPROD runtimes both serve a production build);
 *   2. `STAGING_ATTESTATION_ENABLED` is exactly the string `true`.
 *
 * Absent is disabled. Misspelled is disabled. `"TRUE"`, `"1"` and `" true"` are
 * disabled. An unclassified, `dev` or `production` deployment is disabled even
 * with the flag set — and `validateRuntimeEnv` additionally refuses to BOOT a
 * production deployment that has the flag on, so the mistake is caught by the
 * operator at deploy time rather than discovered later.
 *
 * WHAT THIS FLAG DOES NOT DO
 * It grants no Pocket capability whatsoever. It does not enable
 * `POCKET_POSTBACK_ENABLED`, does not enable `POCKET_BALANCE_PROVIDER_ENABLED`,
 * does not select a checkpoint provider, does not touch any affiliate flag, and
 * does not relax CAPTCHA/Turnstile. Those are independent questions with
 * independent flags, and a QA attestation deliberately answers none of them:
 * production remains Pocket-authoritative for both registration and money.
 */
import { classifyEnvironment } from "@/lib/environment";

export const STAGING_ATTESTATION_ENABLED_KEY = "STAGING_ATTESTATION_ENABLED";

export type StagingAttestationRefusalReason =
  /** The deployment is not authoritatively classified `staging`. */
  | "environment_not_staging"
  /** The deployment is staging, but the opt-in flag is not exactly `true`. */
  | "flag_disabled";

export type StagingAttestationPolicy =
  | { readonly kind: "usable" }
  | { readonly kind: "unusable"; readonly reason: StagingAttestationRefusalReason };

/**
 * Is the flag literally `true`?
 *
 * Exported so `validateRuntimeEnv` can ask "did the operator ASK for this?"
 * separately from "may they have it?". A production deployment that asked for it
 * must fail to boot, and that requires seeing the intent even where the
 * capability is refused.
 */
export function isStagingAttestationFlagSet(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[STAGING_ATTESTATION_ENABLED_KEY] === "true";
}

export function resolveStagingAttestationPolicy(
  env: NodeJS.ProcessEnv = process.env,
): StagingAttestationPolicy {
  const classification = classifyEnvironment(env);
  if (classification.kind !== "classified" || classification.environment !== "staging") {
    return { kind: "unusable", reason: "environment_not_staging" };
  }
  if (!isStagingAttestationFlagSet(env)) {
    return { kind: "unusable", reason: "flag_disabled" };
  }
  return { kind: "usable" };
}

/** The single question every staging-attestation capability must ask. */
export function isStagingAttestationUsable(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveStagingAttestationPolicy(env).kind === "usable";
}

/**
 * The startup rejection message.
 *
 * Never quotes a value: the only thing worth saying is which key is wrong and
 * what the deployment would have to be for it to be legal.
 */
export function describeStagingAttestationRejection(environmentLabel: string): string {
  return `${STAGING_ATTESTATION_ENABLED_KEY}=true is a PREPROD QA capability and requires ATA_ENVIRONMENT=staging (environment is ${environmentLabel})`;
}

/** The literal recorded on every durable attestation row. */
export const STAGING_ATTESTATION_ENVIRONMENT = "staging" as const;
