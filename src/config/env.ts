import { z } from "zod";

/**
 * Environment validation foundation (Phase 1A).
 * There are NO real secrets here — only UI-mode flags. Values are read from
 * NEXT_PUBLIC_* so they are available in both server and client components.
 * Invalid values fall back to safe defaults rather than throwing, so the shell
 * always boots in mock mode.
 */
const EnvSchema = z.object({
  CRM_MODE: z.enum(["mock"]).default("mock"),
  ENABLE_ROLE_SWITCH: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type CrmEnv = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse({
  CRM_MODE: process.env.NEXT_PUBLIC_CRM_MODE ?? "mock",
  ENABLE_ROLE_SWITCH: process.env.NEXT_PUBLIC_ENABLE_ROLE_SWITCH ?? "true",
});

export const env: CrmEnv = parsed.success
  ? parsed.data
  : { CRM_MODE: "mock", ENABLE_ROLE_SWITCH: true };

/** True in local/dev where the mock role switch and DEMO MODE marker are shown. */
export const isDevelopment = process.env.NODE_ENV !== "production";

/** The role switch is a DEV-ONLY frontend-visibility tool. NOT production RBAC. */
export const isRoleSwitchEnabled = isDevelopment && env.ENABLE_ROLE_SWITCH;
