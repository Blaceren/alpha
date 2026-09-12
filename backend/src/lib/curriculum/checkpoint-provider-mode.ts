/**
 * L4DSP-1 — the explicit checkpoint provider-selection contract.
 *
 * Before this phase provider selection was implicit: whichever adapter happened
 * to validate its own configuration won. That is fine while there is exactly one
 * real adapter, and unacceptable once a DEV-only simulator exists, because
 * "which implementation answered?" would become a question about which
 * variables were set rather than a question the operator answered on purpose.
 *
 * `CHECKPOINT_PROVIDER_MODE` makes the choice a declaration:
 *
 *   disabled       — never ask a provider.
 *   pocket_partner — the official adapter, subject to its own configuration.
 *   dev_simulator  — the DEV-only simulator, subject to the environment being
 *                    authoritatively classified `dev`.
 *
 * ABSENCE IS NOT A THIRD BEHAVIOUR
 * An absent mode means `pocket_partner` — exactly what the platform did before
 * this phase — so deploying this code changes nothing until an operator writes
 * the variable. What absence can never do is select the simulator: reaching the
 * simulator requires spelling its name.
 *
 * INVALID IS NOT "FALL BACK TO SOMETHING"
 * An unrecognised mode resolves to `invalid`, and the resolver treats that as
 * unconfigured. A typo must not silently hand a financial question to whichever
 * adapter happens to be wired — in either direction.
 *
 * This module imports NOTHING. `src/lib/env.ts` needs `isDevSimulatorModeSelected`
 * for its production hard-fail, so a dependency in the other direction would be
 * a cycle between environment validation and the thing it validates.
 */

export const CHECKPOINT_PROVIDER_MODE_KEY = "CHECKPOINT_PROVIDER_MODE";

export type CheckpointProviderMode = "disabled" | "pocket_partner" | "dev_simulator";

export const CHECKPOINT_PROVIDER_MODES: readonly CheckpointProviderMode[] = [
  "disabled",
  "pocket_partner",
  "dev_simulator",
];

/**
 * What the operator wrote, before any flag or environment is considered.
 *
 * `absent` and `invalid` are kept apart because they are different operational
 * facts: one is a deployment that has not opted in, the other is a deployment
 * whose configuration is wrong and whose operator should be told so.
 */
export type CheckpointProviderModeSelection =
  | { readonly kind: "declared"; readonly mode: CheckpointProviderMode }
  | { readonly kind: "absent" }
  | { readonly kind: "invalid" };

export function readCheckpointProviderMode(
  env: NodeJS.ProcessEnv = process.env,
): CheckpointProviderModeSelection {
  const raw = env[CHECKPOINT_PROVIDER_MODE_KEY];

  if (raw === undefined || raw === "") return { kind: "absent" };
  // Exact tokens only — no trimming, no case folding. `"Dev_Simulator"` is a
  // configuration error, not a request.
  if (!(CHECKPOINT_PROVIDER_MODES as readonly string[]).includes(raw)) {
    return { kind: "invalid" };
  }
  return { kind: "declared", mode: raw as CheckpointProviderMode };
}

/**
 * The mode actually in force, with absence resolved to the legacy default.
 *
 * Returns `null` for an invalid declaration so callers must handle it — there is
 * deliberately no "safe default" return that would let a typo be ignored.
 */
export function effectiveCheckpointProviderMode(
  env: NodeJS.ProcessEnv = process.env,
): CheckpointProviderMode | null {
  const selection = readCheckpointProviderMode(env);
  switch (selection.kind) {
    case "declared":
      return selection.mode;
    case "absent":
      return "pocket_partner";
    case "invalid":
      return null;
  }
}

/**
 * Whether the DEV simulator has been NAMED — not whether it may run.
 *
 * Used by environment validation and by operational policy, both of which need
 * to react to the intent even (especially) when the environment would refuse to
 * honour it.
 */
export function isDevSimulatorModeSelected(env: NodeJS.ProcessEnv = process.env): boolean {
  const selection = readCheckpointProviderMode(env);
  return selection.kind === "declared" && selection.mode === "dev_simulator";
}
