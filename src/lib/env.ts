import { z } from "zod";

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
  "CAPTCHA_DEV_BYPASS",
  "ALLOW_PRODUCTION_SEED",
  "ALLOW_PRODUCTION_BETA_RESET",
  "BETA_RESET_CONFIRM",
  "POCKET_POSTBACK_ENABLED",
  "POCKET_REFERRAL_URL",
  "CURRICULUM_V2_ADMIN_ENABLED",
  "CURRICULUM_V2_READ_ENABLED",
  "CURRICULUM_V2_ENROLLMENT_ENABLED",
  "CURRICULUM_V2_XP_ENABLED",
  "CURRICULUM_V2_CONTENT_ENABLED",
  "CURRICULUM_V2_ASSESSMENT_ENABLED",
  "CURRICULUM_V2_REPORT_ENABLED",
  "CURRICULUM_V2_REPORT_ATTACHMENTS_ENABLED",
  "CURRICULUM_V2_CHECKPOINT_ENABLED",
  "POCKET_BALANCE_PROVIDER_ENABLED",
  "CHECKPOINT_PROVIDER_TEST_BACKEND",
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
] as const;

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  POSTBACK_SECRET: z.string().optional(),
  APP_URL: z.string().url().optional(),
  STORAGE_DRIVER: z.enum(["local", "s3", "r2"]).optional(),
  LOCAL_UPLOADS_DIR: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).optional(),
  SMOKE_BASE_URL: z.string().url().optional(),
  VISUAL_QA_BASE_URL: z.string().url().optional(),
  EMAIL_VERIFICATION_REQUIRED: z.enum(["true", "false"]).optional(),
  CAPTCHA_DEV_BYPASS: z.enum(["true", "false"]).optional(),
  ALLOW_PRODUCTION_SEED: z.enum(["true", "false"]).optional(),
  ALLOW_PRODUCTION_BETA_RESET: z.enum(["true", "false"]).optional(),
  BETA_RESET_CONFIRM: z.string().optional(),
  POCKET_POSTBACK_ENABLED: z.enum(["true", "false"]).optional(),
  CURRICULUM_V2_ADMIN_ENABLED: z.enum(["true", "false"]).optional(),
  CURRICULUM_V2_READ_ENABLED: z.enum(["true", "false"]).optional(),
  CURRICULUM_V2_ENROLLMENT_ENABLED: z.enum(["true", "false"]).optional(),
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
  POCKET_AFFILIATE_BASE_URL: z.string().url().optional(),
  POCKET_REFERRAL_URL: z.string().url().optional(),
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
