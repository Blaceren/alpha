import { z } from "zod";

/**
 * Client-visible UI flags.
 *
 * The CRM runtime mode is NOT here. It moved to `@/config/server-runtime`,
 * which reads the server-only `CRM_MODE` and fails closed. The old
 * `NEXT_PUBLIC_CRM_MODE` was browser-owned and defaulted to "mock" on any bad
 * input — a fail-open default is exactly wrong for a switch that decides whether
 * the app serves synthetic data or real employee data.
 *
 * What remains is a genuine UI preference with no security meaning.
 */
const EnvSchema = z.object({
  ENABLE_ROLE_SWITCH: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type CrmEnv = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse({
  ENABLE_ROLE_SWITCH: process.env.NEXT_PUBLIC_ENABLE_ROLE_SWITCH ?? "true",
});

export const env: CrmEnv = parsed.success ? parsed.data : { ENABLE_ROLE_SWITCH: true };

/** True in local/dev where the mock role switch and DEMO MODE marker are shown. */
export const isDevelopment = process.env.NODE_ENV !== "production";

/**
 * The role switch is a DEV-ONLY frontend-visibility tool. NOT production RBAC.
 * Mode gating is separate and stricter: the switch also requires a mock session
 * (see Topbar), so this flag can never surface it against a backend session.
 */
export const isRoleSwitchEnabled = isDevelopment && env.ENABLE_ROLE_SWITCH;
