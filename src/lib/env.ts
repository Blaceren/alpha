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
  "POCKET_POSTBACK_REQUIRE_SECRET",
  "POCKET_REFERRAL_URL",
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
  POCKET_POSTBACK_REQUIRE_SECRET: z.enum(["true", "false"]).optional(),
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

export function isPocketPostbackSecretRequired() {
  assertRuntimeEnv();
  return process.env.POCKET_POSTBACK_REQUIRE_SECRET === "true";
}

export const envContract = {
  requiredInProduction: REQUIRED_IN_PRODUCTION,
  optional: OPTIONAL_ENV,
};
