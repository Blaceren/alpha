import { z } from "zod";
import { classifyEnvironment } from "@/lib/environment";
import {
  CAPTCHA_LOGIN_ENFORCED_KEY,
  CAPTCHA_PROVIDERS,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_TEST_MODE_KEY,
  CAPTCHA_TEST_MODE_MARKER,
  TURNSTILE_EXPECTED_ACTION_KEY,
  TURNSTILE_EXPECTED_HOSTNAMES_KEY,
  TURNSTILE_SECRET_ENV_KEY,
  TURNSTILE_TEST_PROVIDER,
  describeCaptchaConfigRejection,
  isCaptchaLoginEnforced,
  isCaptchaProviderRequired,
  resolveCaptchaConfig,
} from "@/lib/captcha/provider";
import { isDevSimulatorModeSelected } from "@/lib/curriculum/checkpoint-provider-mode";
import {
  describeStagingAttestationRejection,
  isStagingAttestationFlagSet,
  STAGING_ATTESTATION_ENABLED_KEY,
} from "@/lib/curriculum/staging-attestation-policy";
import { describeEnvironment } from "@/lib/environment";
import {
  AFFILIATE_ATTRIBUTION_ENABLED_KEY,
  ATTRIBUTION_TOKEN_SECRET_KEY,
  describeAttributionConfigRejection,
  resolveAttributionConfig,
} from "@/lib/affiliate/attribution-config";
import {
  AFFILIATE_CPA_QUALIFICATION_ENABLED_KEY,
  AFFILIATE_PLATFORM_ENABLED_KEY,
  AFFILIATE_POSTBACK_DELIVERY_ENABLED_KEY,
  PARTNER_SESSION_SECRET_KEY,
  describePartnerSessionSecretRejection,
  resolvePartnerPlatformConfig,
} from "@/lib/affiliate/platform-config";
import { AFFILIATE_POSTBACK_TEST_HOST_ALLOW_KEY } from "@/lib/affiliate/postback/destination";
import {
  AFFILIATE_GO_IP_LIMIT_KEY,
  AFFILIATE_GO_LIMIT_WINDOW_SECONDS_KEY,
  AFFILIATE_GO_LINK_LIMIT_KEY,
  AFFILIATE_GO_TRUST_FORWARDED_FOR_KEY,
} from "@/lib/affiliate/go-abuse-limit";
import { describePublicAppUrlRejection, resolvePublicAppUrl } from "@/lib/publicUrl";
import {
  describePocketAffiliateUrlRejection,
  resolvePocketAffiliateUrl,
} from "@/lib/exchange/pocketAffiliateUrl";

export const DEV_SESSION_SECRET = "local-dev-session-secret";
export const DEV_POSTBACK_SECRET = "dev-postback-secret";

const REQUIRED_IN_PRODUCTION = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "POSTBACK_SECRET",
  "APP_URL",
  "STORAGE_DRIVER",
  "POCKET_AFFILIATE_BASE_URL",
] as const;

const OPTIONAL_ENV = [
  "LOCAL_UPLOADS_DIR",
  "NODE_ENV",
  "SMOKE_BASE_URL",
  "VISUAL_QA_BASE_URL",
  "EMAIL_VERIFICATION_REQUIRED",
  // AFD-3A2 — the CAPTCHA provider contract. `CAPTCHA_DEV_BYPASS` used to live
  // here and is deliberately GONE: it defaulted to an open door, and leaving it
  // in the contract would suggest setting it still means something. It does not.
  CAPTCHA_PROVIDER_KEY,
  TURNSTILE_SECRET_ENV_KEY,
  TURNSTILE_EXPECTED_ACTION_KEY,
  TURNSTILE_EXPECTED_HOSTNAMES_KEY,
  CAPTCHA_TEST_MODE_KEY,
  CAPTCHA_LOGIN_ENFORCED_KEY,
  "ALLOW_PRODUCTION_SEED",
  "ALLOW_PRODUCTION_BETA_RESET",
  "BETA_RESET_CONFIRM",
  "POCKET_POSTBACK_ENABLED",
  "POCKET_REFERRAL_URL",
  "CURRICULUM_V2_ADMIN_ENABLED",
  "CURRICULUM_V2_READ_ENABLED",
  "CURRICULUM_V2_ENROLLMENT_ENABLED",
  "CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED",
  "CURRICULUM_V2_XP_ENABLED",
  "CURRICULUM_V2_CONTENT_ENABLED",
  "CURRICULUM_V2_ASSESSMENT_ENABLED",
  "CURRICULUM_V2_REPORT_ENABLED",
  "CURRICULUM_V2_REPORT_ATTACHMENTS_ENABLED",
  "CURRICULUM_V2_CHECKPOINT_ENABLED",
  "POCKET_BALANCE_PROVIDER_ENABLED",
  "CHECKPOINT_PROVIDER_TEST_BACKEND",
  "ATA_ENVIRONMENT",
  "CHECKPOINT_PROVIDER_MODE",
  "CHECKPOINT_DEV_SIMULATOR_STATE_PATH",
  // A8 — PREPROD QA attestation. Absent means disabled, which is the only safe
  // default: a deployment that has not explicitly asked for QA attestation must
  // not be able to mark gates satisfied.
  STAGING_ATTESTATION_ENABLED_KEY,
  "POCKET_PARTNER_API_BASE_URL",
  "POCKET_PARTNER_ID",
  "POCKET_PARTNER_API_TOKEN",
  "POCKET_PARTNER_API_TIMEOUT_MS",
  "POCKET_PARTNER_API_TEST_MODE",
  "REPORT_ATTACHMENT_S3_BUCKET",
  "REPORT_ATTACHMENT_S3_REGION",
  "REPORT_ATTACHMENT_S3_ENDPOINT",
  "REPORT_ATTACHMENT_S3_FORCE_PATH_STYLE",
  "REPORT_ATTACHMENT_S3_SSE",
  "REPORT_ATTACHMENT_CLAMAV_HOST",
  "REPORT_ATTACHMENT_CLAMAV_PORT",
  "REPORT_ATTACHMENT_TEST_BACKEND",
  "PUBLIC_APP_URL",
  // AFD-3B2 — acquisition attribution. Absent means disabled, which is the only
  // safe default: a deployment that has not been given a signing secret must not
  // be issuing attribution tokens.
  AFFILIATE_ATTRIBUTION_ENABLED_KEY,
  ATTRIBUTION_TOKEN_SECRET_KEY,
  AFFILIATE_GO_TRUST_FORWARDED_FOR_KEY,
  AFFILIATE_GO_IP_LIMIT_KEY,
  AFFILIATE_GO_LINK_LIMIT_KEY,
  AFFILIATE_GO_LIMIT_WINDOW_SECONDS_KEY,
  // AFFILIATE-PLATFORM-V1 §36 — three switches, each absent-means-off, and the
  // partner session secret they oblige. Absence is the safe default for all
  // four: a deployment that has not been given a partner signing secret must
  // not be minting partner sessions, and one that has not been asked to create
  // commercial money must not create any.
  AFFILIATE_PLATFORM_ENABLED_KEY,
  AFFILIATE_CPA_QUALIFICATION_ENABLED_KEY,
  AFFILIATE_POSTBACK_DELIVERY_ENABLED_KEY,
  PARTNER_SESSION_SECRET_KEY,
  AFFILIATE_POSTBACK_TEST_HOST_ALLOW_KEY,
] as const;

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  POSTBACK_SECRET: z.string().optional(),
  APP_URL: z.string().url().optional(),
  // Validated by `resolvePublicAppUrl` rather than by `z.string().url()`, which
  // would happily accept http, embedded credentials, a query string or a
  // loopback host. See the PUBLIC_APP_URL check in validateRuntimeEnv.
  PUBLIC_APP_URL: z.string().optional(),
  STORAGE_DRIVER: z.enum(["local", "s3", "r2"]).optional(),
  LOCAL_UPLOADS_DIR: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).optional(),
  SMOKE_BASE_URL: z.string().url().optional(),
  VISUAL_QA_BASE_URL: z.string().url().optional(),
  EMAIL_VERIFICATION_REQUIRED: z.enum(["true", "false"]).optional(),
  // AFD-3A2. Enumerated so a misspelled provider is a startup error rather than
  // a silent "unrecognised → unconfigured → every registration closed". The
  // secret is `z.string()` only: its CONTENT is validated by
  // `resolveCaptchaConfig`, which never quotes it in a message.
  [CAPTCHA_PROVIDER_KEY]: z.enum(CAPTCHA_PROVIDERS).optional(),
  [TURNSTILE_SECRET_ENV_KEY]: z.string().optional(),
  [TURNSTILE_EXPECTED_ACTION_KEY]: z.string().optional(),
  [TURNSTILE_EXPECTED_HOSTNAMES_KEY]: z.string().optional(),
  [CAPTCHA_TEST_MODE_KEY]: z.literal(CAPTCHA_TEST_MODE_MARKER).optional(),
  [CAPTCHA_LOGIN_ENFORCED_KEY]: z.enum(["true", "false"]).optional(),
  ALLOW_PRODUCTION_SEED: z.enum(["true", "false"]).optional(),
  ALLOW_PRODUCTION_BETA_RESET: z.enum(["true", "false"]).optional(),
  BETA_RESET_CONFIRM: z.string().optional(),
  POCKET_POSTBACK_ENABLED: z.enum(["true", "false"]).optional(),
  CURRICULUM_V2_ADMIN_ENABLED: z.enum(["true", "false"]).optional(),
  CURRICULUM_V2_READ_ENABLED: z.enum(["true", "false"]).optional(),
  CURRICULUM_V2_ENROLLMENT_ENABLED: z.enum(["true", "false"]).optional(),
  CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED: z.enum(["true", "false"]).optional(),
  CURRICULUM_V2_XP_ENABLED: z.enum(["true", "false"]).optional(),
  CURRICULUM_V2_CONTENT_ENABLED: z.enum(["true", "false"]).optional(),
  CURRICULUM_V2_ASSESSMENT_ENABLED: z.enum(["true", "false"]).optional(),
  CURRICULUM_V2_REPORT_ENABLED: z.enum(["true", "false"]).optional(),
  CURRICULUM_V2_REPORT_ATTACHMENTS_ENABLED: z.enum(["true", "false"]).optional(),
  CURRICULUM_V2_CHECKPOINT_ENABLED: z.enum(["true", "false"]).optional(),
  POCKET_BALANCE_PROVIDER_ENABLED: z.enum(["true", "false"]).optional(),
  CHECKPOINT_PROVIDER_TEST_BACKEND: z
    .literal("unsafe-deterministic-mock-regression-only")
    .optional(),
  // L4DSP-1 — deployment classification and explicit provider selection.
  // `ATA_ENVIRONMENT` is the authoritative environment identity; NODE_ENV is
  // NOT, because this project runs a production build in DEV (see
  // src/lib/environment.ts). Both are enumerated so a misspelling is a startup
  // error rather than a silent reclassification.
  ATA_ENVIRONMENT: z.enum(["dev", "staging", "production"]).optional(),
  CHECKPOINT_PROVIDER_MODE: z
    .enum(["disabled", "pocket_partner", "dev_simulator"])
    .optional(),
  CHECKPOINT_DEV_SIMULATOR_STATE_PATH: z.string().optional(),
  // A8. Enumerated so a misspelled "TRUE" is a startup error rather than a
  // silent "not exactly true -> disabled" that an operator would read as
  // enabled — the same reasoning as the affiliate attribution flag.
  [STAGING_ATTESTATION_ENABLED_KEY]: z.enum(["true", "false"]).optional(),
  // L4PA-1 — official Pocket Partner user-info API. Server-only, all optional:
  // absent configuration means the adapter is unconfigured and the checkpoint
  // reports `provider_unconfigured`. The token is never read outside
  // src/lib/exchange/pocketPartner*.ts and never reaches browser code.
  POCKET_PARTNER_API_BASE_URL: z.string().url().optional(),
  POCKET_PARTNER_ID: z.string().regex(/^[1-9][0-9]*$/).optional(),
  POCKET_PARTNER_API_TOKEN: z.string().optional(),
  POCKET_PARTNER_API_TIMEOUT_MS: z.string().regex(/^\d+$/).optional(),
  POCKET_PARTNER_API_TEST_MODE: z
    .literal("unsafe-loopback-mock-regression-only")
    .optional(),
  REPORT_ATTACHMENT_S3_BUCKET: z.string().optional(),
  REPORT_ATTACHMENT_S3_REGION: z.string().optional(),
  REPORT_ATTACHMENT_S3_ENDPOINT: z.string().url().optional(),
  REPORT_ATTACHMENT_S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).optional(),
  REPORT_ATTACHMENT_S3_SSE: z.string().optional(),
  REPORT_ATTACHMENT_CLAMAV_HOST: z.string().optional(),
  REPORT_ATTACHMENT_CLAMAV_PORT: z.string().regex(/^\d+$/).optional(),
  REPORT_ATTACHMENT_TEST_BACKEND: z.literal("unsafe-in-memory-regression-only").optional(),
  // Validated by `resolvePocketAffiliateUrl` rather than by `z.string().url()`,
  // which would accept http, embedded credentials, a fragment, a loopback host
  // or an internal service port. See the affiliate check in validateRuntimeEnv.
  POCKET_AFFILIATE_BASE_URL: z.string().optional(),
  POCKET_REFERRAL_URL: z.string().optional(),
  // AFD-3B2. Enumerated so a misspelled "TRUE" is a startup error rather than a
  // silent "not exactly true → disabled" that an operator would read as enabled.
  // The secret is `z.string()` only: its CONTENT is judged by
  // `resolveAttributionConfig`, which never quotes it in a message.
  [AFFILIATE_ATTRIBUTION_ENABLED_KEY]: z.enum(["true", "false"]).optional(),
  [ATTRIBUTION_TOKEN_SECRET_KEY]: z.string().optional(),
  [AFFILIATE_GO_TRUST_FORWARDED_FOR_KEY]: z.enum(["true", "false"]).optional(),
  [AFFILIATE_GO_IP_LIMIT_KEY]: z.string().regex(/^\d+$/).optional(),
  [AFFILIATE_GO_LINK_LIMIT_KEY]: z.string().regex(/^\d+$/).optional(),
  [AFFILIATE_GO_LIMIT_WINDOW_SECONDS_KEY]: z.string().regex(/^\d+$/).optional(),
  [AFFILIATE_PLATFORM_ENABLED_KEY]: z.enum(["true", "false"]).optional(),
  [AFFILIATE_CPA_QUALIFICATION_ENABLED_KEY]: z.enum(["true", "false"]).optional(),
  [AFFILIATE_POSTBACK_DELIVERY_ENABLED_KEY]: z.enum(["true", "false"]).optional(),
  // `z.string()` only. Its CONTENT is judged by `resolvePartnerPlatformConfig`,
  // which never quotes the value in a message.
  [PARTNER_SESSION_SECRET_KEY]: z.string().optional(),
  [AFFILIATE_POSTBACK_TEST_HOST_ALLOW_KEY]: z.string().optional(),
});

export type RuntimeEnvCheck = {
  ok: boolean;
  errors: string[];
  env: z.infer<typeof envSchema>;
};

function collectValidationErrors(env: NodeJS.ProcessEnv) {
  const parsed = envSchema.safeParse(env);

  if (parsed.success) {
    return { parsedEnv: parsed.data, errors: [] as string[] };
  }

  return {
    parsedEnv: {},
    errors: parsed.error.issues.map((issue) => {
      const key = issue.path.join(".") || "env";
      return `${key}: ${issue.message}`;
    }),
  };
}

export function validateRuntimeEnv(env = process.env): RuntimeEnvCheck {
  const { parsedEnv, errors } = collectValidationErrors(env);
  const isProduction = env.NODE_ENV === "production";

  // L4DSP-1 — the DEV simulator's hard boundary.
  //
  // This check is OUTSIDE the `isProduction` block on purpose. `NODE_ENV` is
  // `production` in this project's DEV runtime and absent in its env file, so
  // hanging the rule on it would refuse in DEV and, worse, permit anywhere
  // NODE_ENV happened not to be production. The rule is stated positively
  // instead: naming the simulator requires the deployment to be authoritatively
  // classified `dev`, and every other classification — production, staging,
  // absent, misspelled, or contradicted by a public APP_URL — is an error.
  //
  // Because absence fails, an operator who forgets to classify a production host
  // has not thereby enabled the simulator there. Forgetting is the safe way.
  if (isDevSimulatorModeSelected(env)) {
    const classification = classifyEnvironment(env);
    if (classification.kind !== "classified" || classification.environment !== "dev") {
      const detail =
        classification.kind === "classified"
          ? `environment is ${classification.environment}`
          : `environment identity is ${classification.reason}`;
      errors.push(
        `CHECKPOINT_PROVIDER_MODE=dev_simulator requires ATA_ENVIRONMENT=dev (${detail})`,
      );
    }
  }

  // PUBLICURL-1 — the public learner-facing origin.
  //
  // A malformed value is an error rather than a silent fallback: the alternative
  // is emitting a link built from an internal origin, which looks fine in a
  // response body and is useless to the learner who received it. Absence is
  // legal and handled by the caller's fail-closed policy (an empty link), so a
  // deployment that has no public origin is not forced to invent one.
  //
  // This check deliberately does NOT consult classifyEnvironment. PUBLIC_APP_URL
  // must never influence environment classification, the simulator's production
  // prohibition, or cookie policy — that entanglement is exactly what this phase
  // exists to undo.
  {
    const publicUrl = resolvePublicAppUrl(env);
    if (publicUrl.kind === "invalid") {
      errors.push(describePublicAppUrlRejection(publicUrl.reason));
    }
  }

  // The external Pocket affiliate base URL (POCKETCTA-1). Same fail-closed
  // reasoning as PUBLIC_APP_URL, and for the same reason: this value is opened
  // in a learner's browser, so `z.string().url()` is not a sufficient gate. It
  // is checked here rather than at first use so a misconfigured deployment
  // fails at startup instead of at the moment a learner clicks the action.
  {
    const affiliateUrl = resolvePocketAffiliateUrl(env);
    if (affiliateUrl.kind === "invalid") {
      errors.push(describePocketAffiliateUrlRejection(affiliateUrl.reason, affiliateUrl.key));
    }
  }

  // AFD-3B2 — acquisition attribution.
  //
  // OUTSIDE the `isProduction` block, and unconditional, for the reason the
  // CAPTCHA and simulator checks are: this project serves a production build in
  // DEV, so `NODE_ENV` says nothing about where the code is running. The rule is
  // simply that asking for attribution obliges the deployment to be able to sign
  // a token, everywhere. There is no environment in which a half-enabled
  // attribution — a route that answers and a signature anyone can forge — is a
  // useful state to boot into, so this fails closed rather than degrading.
  //
  // Absence is legal and means disabled. An operator who has not configured
  // attribution has not accidentally enabled it.
  {
    const resolution = resolveAttributionConfig(env);
    if (resolution.kind === "invalid") {
      errors.push(describeAttributionConfigRejection(resolution.reason));
    }
  }

  // AFFILIATE-PLATFORM-V1 §36 — the same rule, for the same reason, applied to
  // the partner platform: asking for it obliges the deployment to be able to
  // sign a partner session, and a half-enabled platform — a console that
  // answers and a session cookie anyone can forge — is not a state worth
  // booting into.
  //
  // THE SECRET MUST ALSO NOT BE ANY OTHER SECRET. §30 forbids reusing
  // POSTBACK_SECRET, SESSION_SECRET or ATTRIBUTION_TOKEN_SECRET for partner
  // signing, and the resolver refuses each of them by constant-time comparison
  // rather than by asking an operator to remember.
  {
    const resolution = resolvePartnerPlatformConfig(env);
    if (resolution.kind === "invalid") {
      errors.push(describePartnerSessionSecretRejection(resolution.reason));
    }
  }

  // A8 — the STAGING_ATTESTED capability's hard boundary.
  //
  // OUTSIDE the `isProduction` block, and keyed on `classifyEnvironment` rather
  // than on `NODE_ENV`, for the reason the simulator and CAPTCHA checks are:
  // this project serves a production build in DEV and in PREPROD, so `NODE_ENV`
  // says nothing about where the code is running.
  //
  // The rule is stated positively so that FORGETTING FAILS: asking for QA
  // attestation obliges the deployment to be authoritatively classified
  // `staging`. Production is an error. So is `dev`, so is an unclassified host
  // and so is a misspelled one. A production deployment that has this key set to
  // `true` does not boot at all, which means the mistake is caught by the
  // operator at deploy time rather than by whoever notices a gate was waved
  // through later.
  //
  // Absence is legal and means disabled, so no existing deployment is affected
  // and no operator can enable this by omission.
  if (isStagingAttestationFlagSet(env)) {
    const classification = classifyEnvironment(env);
    if (classification.kind !== "classified" || classification.environment !== "staging") {
      errors.push(describeStagingAttestationRejection(describeEnvironment(env)));
    }
  }

  // A state path is meaningless — and, on a real host, a liability — unless the
  // deployment is DEV. Its mere presence elsewhere is a configuration error, in
  // the same spirit as the regression-only markers below.
  if (env.CHECKPOINT_DEV_SIMULATOR_STATE_PATH) {
    const classification = classifyEnvironment(env);
    if (classification.kind !== "classified" || classification.environment !== "dev") {
      errors.push(
        "CHECKPOINT_DEV_SIMULATOR_STATE_PATH is a DEV-only simulator path and requires ATA_ENVIRONMENT=dev",
      );
    }
  }

  // AFD-3A2 — the CAPTCHA provider.
  //
  // Like the simulator check above, this sits OUTSIDE the `isProduction` block
  // and is keyed on `classifyEnvironment`, not `NODE_ENV`. The DEV runtime
  // serves a production build, so `NODE_ENV === "production"` there: hanging
  // these rules on it would demand a real Turnstile secret on a developer box
  // and demand nothing at all on a host that happened to launch differently.
  //
  // Three separate obligations, each phrased so that FORGETTING FAILS:
  //
  //  1. Any configuration that is present must be COHERENT. A named provider
  //     with a missing, empty or placeholder secret is a startup error rather
  //     than a service that boots and then refuses every registration with an
  //     opaque 503. Absent configuration is legal and simply closes the door.
  //
  //  2. Outside an explicit `ATA_ENVIRONMENT=dev` deployment, a working
  //     provider is MANDATORY. An unclassified or misspelled environment counts
  //     as "outside", so an operator who forgets to classify a real host has not
  //     thereby excused it from having a CAPTCHA.
  //
  //  3. Outside dev, login must be enforced too. This is what keeps the
  //     bounded DEV login exception in src/lib/captcha.ts from ever becoming a
  //     production bypass: such a deployment does not boot.
  {
    const resolution = resolveCaptchaConfig(env);
    const providerNamed = env[CAPTCHA_PROVIDER_KEY] !== undefined && env[CAPTCHA_PROVIDER_KEY] !== "";
    const required = isCaptchaProviderRequired(env);

    if (!resolution.configured && (providerNamed || required)) {
      errors.push(describeCaptchaConfigRejection(resolution.reason));
    }

    // The isolated-test provider must never be reachable on a real host. The
    // resolver already refuses it, but a hard startup failure means the mistake
    // is caught by the operator at deploy time rather than by a learner at a
    // registration form.
    if (required && env[CAPTCHA_PROVIDER_KEY] === TURNSTILE_TEST_PROVIDER) {
      errors.push(
        `${CAPTCHA_PROVIDER_KEY}=${TURNSTILE_TEST_PROVIDER} is an isolated-test provider and requires ATA_ENVIRONMENT=dev`,
      );
    }
    if (required && env[CAPTCHA_TEST_MODE_KEY]) {
      errors.push(
        `${CAPTCHA_TEST_MODE_KEY} is an isolated-test marker and must never be set outside ATA_ENVIRONMENT=dev`,
      );
    }
    if (required && !isCaptchaLoginEnforced(env)) {
      errors.push(
        `${CAPTCHA_LOGIN_ENFORCED_KEY}=true is required outside ATA_ENVIRONMENT=dev`,
      );
    }

    // AFD-3A3 — the retired deployment-wide action pin, reported EVERYWHERE and
    // not only where a provider is configured. An operator who set this key
    // believes a pin is in force; the honest answer is that actions are now
    // owned by src/lib/captcha/surface.ts, one per authentication surface, and
    // that this key does nothing. Failing at startup says so once, loudly,
    // instead of leaving a false belief in a runtime environment file.
    if (env[TURNSTILE_EXPECTED_ACTION_KEY]) {
      errors.push(
        `${TURNSTILE_EXPECTED_ACTION_KEY} is retired — each authentication surface pins its own Turnstile action in source; unset this key`,
      );
    }
  }

  if (isProduction) {
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (!env[key]) {
        errors.push(`${key} is required in production`);
      }
    }

    if (env.SESSION_SECRET === DEV_SESSION_SECRET) {
      errors.push("SESSION_SECRET must not use the development fallback in production");
    }

    if (env.POSTBACK_SECRET === DEV_POSTBACK_SECRET) {
      errors.push("POSTBACK_SECRET must not use the development fallback in production");
    }

    if (env.REPORT_ATTACHMENT_TEST_BACKEND) {
      errors.push("REPORT_ATTACHMENT_TEST_BACKEND is a regression-only backend and must never be set in production");
    }

    if (env.CHECKPOINT_PROVIDER_TEST_BACKEND) {
      errors.push("CHECKPOINT_PROVIDER_TEST_BACKEND is a regression-only balance provider and must never be set in production");
    }

    // L4PA-1. The marker exists only so regression suites may point the adapter
    // at a loopback mock over plaintext HTTP. In production it would permit
    // sending a token-derived credential to an unapproved host, so its mere
    // presence is a hard failure rather than something the resolver silently
    // ignores.
    if (env.POCKET_PARTNER_API_TEST_MODE) {
      errors.push("POCKET_PARTNER_API_TEST_MODE is a regression-only marker and must never be set in production");
    }

    // A8 is deliberately NOT re-checked here against `NODE_ENV`.
    //
    // It would look like useful defence in depth and it would be a bug: PREPROD
    // runs `NODE_ENV=production` with `ATA_ENVIRONMENT=staging` (this project
    // serves a production BUILD everywhere), so a rule here would refuse the one
    // deployment the capability exists for while adding nothing on a real
    // production host — which is already refused by the classification check
    // above, on the only signal that actually distinguishes deployments.
  }

  return {
    ok: errors.length === 0,
    errors,
    env: parsedEnv,
  };
}

export function assertRuntimeEnv() {
  const result = validateRuntimeEnv();

  if (!result.ok) {
    throw new Error(`Invalid runtime environment: ${result.errors.join("; ")}`);
  }

  return result.env;
}

export function getSessionSecret() {
  assertRuntimeEnv();
  return process.env.SESSION_SECRET ?? DEV_SESSION_SECRET;
}

export function getPostbackSecret() {
  assertRuntimeEnv();
  return process.env.POSTBACK_SECRET ?? DEV_POSTBACK_SECRET;
}

// POCKET_POSTBACK_ENABLED gates the Pocket postback intake and fails closed:
// absent means disabled. It is resolved together with the secret by the single
// authoritative resolver in src/lib/exchange/pocketPostbackAuth.ts, so there is
// exactly one place that decides whether Pocket postbacks are accepted.
//
// The removed POCKET_POSTBACK_REQUIRE_SECRET flag had the opposite, unsafe
// direction — absent meant "no secret required" — and must not return.

// Feature flag for the V2 curriculum admin API. Absent env means disabled.
export function isCurriculumV2AdminEnabled() {
  return process.env.CURRICULUM_V2_ADMIN_ENABLED === "true";
}

// Read at call time so tests and long-lived processes never capture stale flag values.
export function isCurriculumV2ReadEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CURRICULUM_V2_READ_ENABLED === "true";
}

// Mutation gate for the controlled enrollment command; absent env stays disabled.
export function isCurriculumV2EnrollmentEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CURRICULUM_V2_ENROLLMENT_ENABLED === "true";
}

/**
 * PHASE-F — REGISTRATION AUTO-ENROLLMENT. Absent env is the safe OFF default.
 *
 * WHY THIS IS ITS OWN FLAG AND NOT `CURRICULUM_V2_ENROLLMENT_ENABLED`
 * They answer different questions, and an operator has a real reason to want one
 * without the other:
 *
 *   CURRICULUM_V2_ENROLLMENT_ENABLED
 *     may the platform enroll ANYONE at all? It gates the admin command, which
 *     is how a pilot cohort is enrolled deliberately, one learner at a time.
 *
 *   CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED
 *     does EVERY NEW REGISTRATION become an enrollment automatically?
 *
 * Overloading the first would mean that turning on the operator command — the
 * safe, reversible, one-learner-at-a-time thing — silently opts every future
 * signup into the curriculum as a side effect. That is precisely the kind of
 * coupling a launch gate must not have, so this is a separate switch.
 *
 * It is a NARROWING flag, never a widening one: auto-enrollment additionally
 * requires READ and ENROLLMENT to be on, because it calls the same primitive the
 * admin command calls and that primitive refuses without them. So the activation
 * condition is the conjunction, and this flag alone grants nothing.
 *
 * `NODE_ENV` is deliberately not consulted anywhere in this decision.
 */
export function isCurriculumV2RegistrationAutoEnrollEnabled(
  env: NodeJS.ProcessEnv = process.env,
) {
  return env.CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED === "true";
}

// Read at call time. Absent env is the safe disabled default.
export function isCurriculumV2XpEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CURRICULUM_V2_XP_ENABLED === "true";
}

// Independent dynamic gate for V2 content authoring/publication mutations.
export function isCurriculumV2ContentEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CURRICULUM_V2_CONTENT_ENABLED === "true";
}

// Independent dynamic gate for server-only V2 assessment authoring/publication mutations.
export function isCurriculumV2AssessmentEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CURRICULUM_V2_ASSESSMENT_ENABLED === "true";
}

// Independent dynamic gate for server-only V2 report-definition mutations.
export function isCurriculumV2ReportEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CURRICULUM_V2_REPORT_ENABLED === "true";
}

// Independent dynamic gate for the private V2 report attachment runtime.
// Read at call time; absent env is the safe disabled default.
export function isCurriculumV2ReportAttachmentsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CURRICULUM_V2_REPORT_ATTACHMENTS_ENABLED === "true";
}

// Independent dynamic gate for the V2 financial-checkpoint runtime. Read at call
// time; absent env is the safe disabled default.
//
// This flag governs ONLY whether checkpoint verification may be attempted at
// all. It is deliberately independent of REPORT, XP, ADMIN, attachments and
// Pocket: a checkpoint is neither a report nor a reward, and enabling any of
// those must never enable balance verification as a side effect.
//
// Enabling it is NOT sufficient to verify a checkpoint. There is no
// authoritative balance provider, so `resolveCheckpointVerification` still
// answers `verification_unavailable` with the flag on — see
// src/lib/curriculum/checkpoint.ts.
export function isCurriculumV2CheckpointEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CURRICULUM_V2_CHECKPOINT_ENABLED === "true";
}

// Independent PROVIDER CAPABILITY gate (L4VC-1). Absent env is the safe
// disabled default.
//
// Two flags, two different questions, deliberately not merged:
//   CURRICULUM_V2_CHECKPOINT_ENABLED — may the platform run a checkpoint at all?
//   POCKET_BALANCE_PROVIDER_ENABLED  — may it ask a balance provider?
//
// Verification requires BOTH, plus a configured adapter and a configured
// requirement. Every other combination answers with a typed unavailable state
// and performs no provider call.
//
// It is independent of POCKET_POSTBACK_ENABLED (affiliate postback intake — a
// different system with different data and a different risk), of REPORT and of
// XP. Enabling any of those must never enable balance verification as a side
// effect, and enabling this one grants no postback, report or XP capability.
export function isPocketBalanceProviderEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.POCKET_BALANCE_PROVIDER_ENABLED === "true";
}

// Regression-only deterministic balance provider. Activation requires the exact
// opt-in marker AND a non-production runtime; production env validation
// additionally hard-fails when the marker is present, so the mock cannot be
// selected in production even by accident.
export function isCheckpointProviderTestBackendEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.NODE_ENV !== "production" &&
    env.CHECKPOINT_PROVIDER_TEST_BACKEND === "unsafe-deterministic-mock-regression-only"
  );
}

// Regression-only in-memory attachment storage/scanner backend. Activation
// requires the exact opt-in marker AND a non-production runtime; production
// env validation additionally hard-fails when the marker is present, so the
// fake backend cannot be enabled in production by accident.
export function isReportAttachmentTestBackendEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.NODE_ENV !== "production" &&
    env.REPORT_ATTACHMENT_TEST_BACKEND === "unsafe-in-memory-regression-only"
  );
}

export const envContract = {
  requiredInProduction: REQUIRED_IN_PRODUCTION,
  optional: OPTIONAL_ENV,
};
