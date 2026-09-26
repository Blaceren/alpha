/**
 * PREPROD ACTIVATION AUTHORIZATION — the environment around the database.
 *
 * A manifest is reviewed against a whole deployment, not just a file. Two parts
 * of that deployment can move between preparation and execution without anybody
 * touching the database, and both change what the activation means:
 *
 *   RELEASES  a deploy in the window means the code that will read the imported
 *             rows is not the code the plan was reviewed against;
 *   FLAGS     a curriculum flag switched on early means "imported but inert" is
 *             no longer true, and the import stops being a rehearsal.
 *
 * Both are therefore pinned, and both are re-read at every authorization
 * boundary rather than assumed to have held.
 *
 * BOTH PROBES ARE INJECTABLE. The regression suite has to present a deployment
 * that differs from the manifest, and it cannot do that by deploying. Production
 * callers pass nothing and read the host.
 */
import fs from "node:fs";
import path from "node:path";

import { PreprodActivationError } from "./errors";

/** The ten curriculum flags whose starting state an activation is reviewed against. */
export const CURRICULUM_V2_FLAG_KEYS: readonly string[] = [
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
];

export const DEFAULT_RELEASE_LINK_DIR = "/srv/ata/current";
export const DEFAULT_RUNTIME_CONFIG_DIR = "/srv/ata/config";

export type DeployedReleases = {
  backend: string;
  academy: string;
  crm: string;
};

/**
 * A flag's observed state.
 *
 * `absent` is a distinct value from `"false"` on purpose. The runtime treats a
 * missing flag as off, so the two are equivalent in behaviour — but they are not
 * equivalent as evidence. "Somebody wrote CURRICULUM_V2_CONTENT_ENABLED=false"
 * means somebody has been editing the flag block; "the line is not there" means
 * nobody has. An activation reviewed against the second should not silently
 * proceed against the first.
 */
export type FlagState = "absent" | "true" | "false" | "other";
export type FlagBaseline = Record<string, FlagState>;

export type DeployedReleasesProvider = () => DeployedReleases;
export type FlagBaselineProvider = () => FlagBaseline;

/**
 * The three deployment slots, as SYMLINK NAMES under `/srv/ata/current`.
 *
 * These are release pointers on the PREPROD host, not source repositories. This
 * module resolves a symlink to the commit id it names and reads nothing else —
 * in particular it never opens a file inside another checkout, which is the rule
 * `curriculum-ata100` check 39 pins for everything under `src/`.
 */
const RELEASE_SLOTS = ["backend", "academy", "crm"] as const;
type ReleaseSlot = (typeof RELEASE_SLOTS)[number];

function resolveReleaseSlot(linkDir: string, slot: ReleaseSlot): string {
  const link = path.join(linkDir, slot);
  try {
    return path.basename(fs.realpathSync(link));
  } catch {
    throw new PreprodActivationError(
      "RELEASE_MISMATCH",
      `cannot resolve the deployed ${slot} release at ${link}. An activation cannot be authorized against a deployment whose current release is unknown.`,
    );
  }
}

/** Resolve `/srv/ata/current/<slot>` to the release commit each one points at. */
export function readDeployedReleases(linkDir: string = DEFAULT_RELEASE_LINK_DIR): DeployedReleases {
  const resolved = {} as Record<ReleaseSlot, string>;
  for (const slot of RELEASE_SLOTS) {
    resolved[slot] = resolveReleaseSlot(linkDir, slot);
  }
  return { ...resolved };
}

export function assertReleasesMatch(expected: DeployedReleases, actual: DeployedReleases): void {
  const drift = (["backend", "academy", "crm"] as const).filter((app) => expected[app] !== actual[app]);
  if (drift.length === 0) return;
  throw new PreprodActivationError(
    "RELEASE_MISMATCH",
    `the deployed release has changed since this manifest was reviewed (${drift.join(", ")}). Re-review the activation against what is actually deployed; do not continue on stale assumptions.`,
    {
      expected: drift.map((app) => `${app}=${expected[app]}`).join(" "),
      actual: drift.map((app) => `${app}=${actual[app]}`).join(" "),
    },
  );
}

/**
 * Read the curriculum flag block out of the backend runtime environment file.
 *
 * UNREADABLE CONFIG IS NOT "ALL ABSENT". On the preprod host these files are
 * `0600 ata`, so an unprivileged caller genuinely cannot see them — and reporting
 * that as "every flag is off" would be a guess presented as a measurement. The
 * probe refuses instead, because an activation that cannot see the flag state is
 * an activation whose central assumption ("imported data stays inert") is
 * unverified.
 */
export function readFlagBaseline(
  configDir: string = DEFAULT_RUNTIME_CONFIG_DIR,
  fileName = "backend.env",
): FlagBaseline {
  const file = path.join(configDir, fileName);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new PreprodActivationError(
      "FLAG_BASELINE_MISMATCH",
      `cannot read the runtime flag configuration at ${file}. The activation depends on imported data staying inert, which cannot be confirmed without reading the flag block.`,
    );
  }
  const observed = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    observed.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  const baseline: FlagBaseline = {};
  for (const key of CURRICULUM_V2_FLAG_KEYS) {
    if (!observed.has(key)) {
      baseline[key] = "absent";
      continue;
    }
    const value = observed.get(key) ?? "";
    baseline[key] = value === "true" ? "true" : value === "false" ? "false" : "other";
  }
  return baseline;
}

export function assertFlagBaselineMatches(expected: FlagBaseline, actual: FlagBaseline): void {
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  const drift = [...keys]
    .filter((key) => expected[key] !== actual[key])
    .sort();
  if (drift.length === 0) return;
  throw new PreprodActivationError(
    "FLAG_BASELINE_MISMATCH",
    `the curriculum feature-flag baseline has changed since this manifest was reviewed (${drift.join(", ")}). A flag enabled before activation means imported rows would not be inert.`,
    {
      expected: drift.map((key) => `${key}=${expected[key] ?? "unset"}`).join(" "),
      actual: drift.map((key) => `${key}=${actual[key] ?? "unset"}`).join(" "),
    },
  );
}
