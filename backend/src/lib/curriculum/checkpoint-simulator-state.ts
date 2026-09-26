/**
 * L4DSP-1 — the DEV simulator's scenario state: schema, safe read, safe write.
 *
 * WHAT THIS STATE IS
 * A mapping from learner id to the typed outcome an operator wants that learner
 * to receive at the L4 gate, plus an expiry. That is the entire vocabulary. It
 * holds no balance, no amount, no threshold, no Pocket identifier, no credential
 * and no provider payload — not by convention but because this file is the only
 * thing that can parse the file, and it REBUILDS every entry from an allow-list
 * rather than passing objects through.
 *
 * WHY IT IS NOT IN THE DATABASE
 * A scenario is an operator's temporary intent about a test, not a fact about a
 * learner. Putting it in the database would mean a migration, a table that
 * production also has, and a row that outlives the intent. Keeping it in a
 * runtime-owned file means production simply does not have one, and the
 * simulator's own reachability does not depend on remembering to exclude it.
 *
 * WHY IT IS NOT IN THE RELEASE OR IN GIT
 * A release is built from a git tree and is immutable; state that changes while
 * the service runs cannot live there without making the release a lie. The path
 * is supplied by the runtime, and this module refuses any path that is not
 * absolute.
 *
 * THE READ IS HOSTILE-INPUT CODE
 * Backend reads this file on a request path, so every failure mode here must
 * degrade to a typed refusal rather than an exception: missing, empty, truncated,
 * oversized, group-readable, symlinked, replaced mid-read, or simply garbage.
 * The file is opened with `O_NOFOLLOW` and every check is then made against the
 * FILE DESCRIPTOR, so there is no window between "we checked the path" and "we
 * read the path" for anything to be swapped underneath us.
 */
import fs from "node:fs";
import path from "node:path";

export const CHECKPOINT_DEV_SIMULATOR_STATE_PATH_KEY = "CHECKPOINT_DEV_SIMULATOR_STATE_PATH";

/** The schema this build understands. A different number is refused, not migrated. */
export const SIMULATOR_STATE_SCHEMA_VERSION = 1;

/** Hard ceiling on the file. 256 KiB is far more than an operator will ever need. */
export const SIMULATOR_STATE_MAX_BYTES = 256 * 1024;

/** Ceiling on entries, so a well-formed file cannot become a denial of service. */
export const SIMULATOR_STATE_MAX_ENTRIES = 1_000;

/** Operator notes are for humans and are bounded so they cannot become a payload. */
export const SIMULATOR_NOTE_MAX_LENGTH = 200;

/** Learner ids are platform integers. The key is their decimal rendering. */
const LEARNER_ID_PATTERN = /^[1-9][0-9]{0,15}$/;

/**
 * The scenarios an operator may select.
 *
 * Every name here is ALREADY a public outcome or unavailable-reason name in
 * `checkpoint-provider.ts`. No name was invented for the simulator, so the
 * scenario an operator sets and the outcome a learner's client sees are the same
 * vocabulary — which is why nothing has to translate between them, and why there
 * is no simulator-shaped concept for Academy to learn.
 */
export type SimulatorScenario =
  | "met"
  | "not_met"
  | "identity_unlinked"
  | "identity_mismatch"
  | "unsupported_currency"
  | "provider_timeout"
  | "provider_maintenance"
  | "provider_rate_limited"
  | "stale"
  | "invalid_provider_response";

export const SIMULATOR_SCENARIOS: readonly SimulatorScenario[] = [
  "met",
  "not_met",
  "identity_unlinked",
  "identity_mismatch",
  "unsupported_currency",
  "provider_timeout",
  "provider_maintenance",
  "provider_rate_limited",
  "stale",
  "invalid_provider_response",
];

const SCENARIO_SET = new Set<string>(SIMULATOR_SCENARIOS);

export function isSimulatorScenario(value: unknown): value is SimulatorScenario {
  return typeof value === "string" && SCENARIO_SET.has(value);
}

export type SimulatorScenarioEntry = {
  readonly scenario: SimulatorScenario;
  /** ISO-8601 instant, or null for "until an operator clears it". */
  readonly expiresAt: string | null;
  readonly note: string | null;
};

export type SimulatorState = {
  readonly schemaVersion: typeof SIMULATOR_STATE_SCHEMA_VERSION;
  readonly updatedAt: string;
  readonly scenarios: Readonly<Record<string, SimulatorScenarioEntry>>;
};

/** Why state could not be used. Operational only — never financial, never a path. */
export type SimulatorStateProblem =
  | "path_unconfigured"
  | "path_not_absolute"
  | "not_found"
  | "not_a_regular_file"
  | "symlink"
  | "unsafe_permissions"
  | "too_large"
  | "unreadable"
  | "malformed_json"
  | "invalid_schema"
  | "unsupported_schema_version";

export type SimulatorStateRead =
  | { readonly ok: true; readonly state: SimulatorState; readonly sizeBytes: number }
  | { readonly ok: false; readonly problem: SimulatorStateProblem };

/* ------------------------------------------------------------------------ */
/* Path resolution                                                           */
/* ------------------------------------------------------------------------ */

export type SimulatorStatePath =
  | { readonly ok: true; readonly file: string; readonly directory: string }
  | { readonly ok: false; readonly problem: "path_unconfigured" | "path_not_absolute" };

/**
 * Resolve the configured state file.
 *
 * There is deliberately NO built-in default. A hard-coded fallback path would
 * mean every deployment has a location the simulator would read if a file ever
 * appeared there; requiring the runtime to name the path means production has no
 * such location at all, and `path_unconfigured` is the shipped state everywhere.
 */
export function resolveSimulatorStatePath(
  env: NodeJS.ProcessEnv = process.env,
): SimulatorStatePath {
  const raw = env[CHECKPOINT_DEV_SIMULATOR_STATE_PATH_KEY];
  if (raw === undefined || raw === "") return { ok: false, problem: "path_unconfigured" };
  if (!path.isAbsolute(raw)) return { ok: false, problem: "path_not_absolute" };
  // `path.resolve` normalises `..` segments, so a configured path cannot use
  // traversal to end up somewhere the operator did not read when setting it.
  const file = path.resolve(raw);
  return { ok: true, file, directory: path.dirname(file) };
}

/* ------------------------------------------------------------------------ */
/* Validation                                                                */
/* ------------------------------------------------------------------------ */

/** ISO-8601 with an explicit offset or `Z`. Bare local timestamps are refused. */
const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function parseInstant(value: unknown): string | null | "invalid" {
  if (value === null) return null;
  if (typeof value !== "string" || !RFC3339.test(value)) return "invalid";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "invalid";
  return new Date(parsed).toISOString();
}

/**
 * Rebuild a state object from an allow-list.
 *
 * Nothing is spread and nothing is passed through. An entry carrying
 * `{"scenario":"met","balanceMinorUnits":9999}` does not leak a balance into the
 * runtime, because `balanceMinorUnits` has nowhere to land: the returned entry
 * is constructed field by field from the three fields that exist.
 *
 * Unknown fields are IGNORED rather than rejected, matching
 * `normalizeCheckpointProviderResult`, which likewise rebuilds rather than
 * validates-and-forwards. Ignoring is safe precisely because rebuilding makes
 * the ignored field unreachable; it would not be safe if the object survived.
 */
export function validateSimulatorState(raw: unknown): SimulatorStateRead {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, problem: "invalid_schema" };
  }
  const value = raw as Record<string, unknown>;

  if (value.schemaVersion !== SIMULATOR_STATE_SCHEMA_VERSION) {
    return {
      ok: false,
      problem:
        typeof value.schemaVersion === "number"
          ? "unsupported_schema_version"
          : "invalid_schema",
    };
  }

  const updatedAt = parseInstant(value.updatedAt);
  if (updatedAt === "invalid" || updatedAt === null) {
    return { ok: false, problem: "invalid_schema" };
  }

  const rawScenarios = value.scenarios;
  if (!rawScenarios || typeof rawScenarios !== "object" || Array.isArray(rawScenarios)) {
    return { ok: false, problem: "invalid_schema" };
  }

  const entries = Object.entries(rawScenarios as Record<string, unknown>);
  if (entries.length > SIMULATOR_STATE_MAX_ENTRIES) {
    return { ok: false, problem: "invalid_schema" };
  }

  const scenarios: Record<string, SimulatorScenarioEntry> = Object.create(null);

  for (const [learnerId, rawEntry] of entries) {
    if (!LEARNER_ID_PATTERN.test(learnerId)) return { ok: false, problem: "invalid_schema" };
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      return { ok: false, problem: "invalid_schema" };
    }
    const entry = rawEntry as Record<string, unknown>;

    if (!isSimulatorScenario(entry.scenario)) return { ok: false, problem: "invalid_schema" };

    const expiresAt =
      entry.expiresAt === undefined ? null : parseInstant(entry.expiresAt);
    if (expiresAt === "invalid") return { ok: false, problem: "invalid_schema" };

    let note: string | null = null;
    if (entry.note !== undefined && entry.note !== null) {
      if (typeof entry.note !== "string" || entry.note.length > SIMULATOR_NOTE_MAX_LENGTH) {
        return { ok: false, problem: "invalid_schema" };
      }
      note = entry.note;
    }

    scenarios[learnerId] = { scenario: entry.scenario, expiresAt, note };
  }

  return {
    ok: true,
    state: { schemaVersion: SIMULATOR_STATE_SCHEMA_VERSION, updatedAt, scenarios },
    sizeBytes: 0,
  };
}

/* ------------------------------------------------------------------------ */
/* Reading                                                                   */
/* ------------------------------------------------------------------------ */

/** True when any bit outside owner rwx is set. Group and world must have none. */
function hasUnsafeMode(mode: number): boolean {
  return (mode & 0o077) !== 0;
}

/**
 * Read the state file, refusing everything that is not exactly what we expect.
 *
 * The sequence matters. The file is opened with `O_NOFOLLOW` FIRST — so a
 * symlink is refused by the kernel rather than by a check we could race — and
 * every subsequent question (regular file? size? permissions? content?) is asked
 * of that same descriptor. An atomic `rename` over the path while we hold the
 * descriptor leaves us reading the complete previous file, which is exactly the
 * behaviour the writer's atomicity is designed to give us: a reader sees one
 * whole version or the other, never a half-written one.
 *
 * The containing directory is checked by path rather than by descriptor. That is
 * a deliberate, bounded weakness: it is an advisory check on the operator's own
 * setup, and the security-relevant guarantees (no symlink, no group access, no
 * oversize, no partial read) are all descriptor-based.
 */
export function readSimulatorState(env: NodeJS.ProcessEnv = process.env): SimulatorStateRead {
  const resolved = resolveSimulatorStatePath(env);
  if (!resolved.ok) return { ok: false, problem: resolved.problem };

  // Advisory: the directory must not be a symlink and must not be group- or
  // world-accessible. A shared directory would let another account replace the
  // file between writes even when the file itself is 0600.
  try {
    const dirStat = fs.lstatSync(resolved.directory);
    if (dirStat.isSymbolicLink()) return { ok: false, problem: "symlink" };
    if (!dirStat.isDirectory()) return { ok: false, problem: "not_a_regular_file" };
    if (hasUnsafeMode(dirStat.mode)) return { ok: false, problem: "unsafe_permissions" };
  } catch (error) {
    return { ok: false, problem: isNotFound(error) ? "not_found" : "unreadable" };
  }

  let fd: number;
  try {
    // O_NOFOLLOW makes "the path is a symlink" an ELOOP from the kernel. There
    // is no TOCTOU here: we never look at the path and then open it.
    fd = fs.openSync(resolved.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (error) {
    if (isNotFound(error)) return { ok: false, problem: "not_found" };
    if (isSymlinkRefusal(error)) return { ok: false, problem: "symlink" };
    return { ok: false, problem: "unreadable" };
  }

  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return { ok: false, problem: "not_a_regular_file" };
    if (hasUnsafeMode(stat.mode)) return { ok: false, problem: "unsafe_permissions" };
    if (stat.size > SIMULATOR_STATE_MAX_BYTES) return { ok: false, problem: "too_large" };

    // Bounded read. The buffer is the ceiling, so even a file that grew between
    // fstat and read cannot make us allocate without limit.
    const buffer = Buffer.allocUnsafe(Math.min(stat.size, SIMULATOR_STATE_MAX_BYTES));
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytes).toString("utf8");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // The text is NEVER included in the failure. A malformed state file is an
      // operational fact, and quoting it back is how file contents end up in logs.
      return { ok: false, problem: "malformed_json" };
    }

    const validated = validateSimulatorState(parsed);
    if (!validated.ok) return validated;
    return { ok: true, state: validated.state, sizeBytes: bytes };
  } catch {
    return { ok: false, problem: "unreadable" };
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* the descriptor is going away with the request either way */
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function isSymlinkRefusal(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  // Linux answers ELOOP for O_NOFOLLOW on a symlink; some platforms use EMLINK.
  return code === "ELOOP" || code === "EMLINK";
}

/* ------------------------------------------------------------------------ */
/* Expiry                                                                    */
/* ------------------------------------------------------------------------ */

export function isEntryExpired(entry: SimulatorScenarioEntry, now: Date): boolean {
  if (entry.expiresAt === null) return false;
  const expiry = Date.parse(entry.expiresAt);
  if (Number.isNaN(expiry)) return true; // unparseable expiry is treated as expired
  return expiry <= now.getTime();
}

export type SimulatorScenarioLookup =
  | { readonly kind: "active"; readonly entry: SimulatorScenarioEntry }
  | { readonly kind: "absent" }
  | { readonly kind: "expired" };

export function lookupScenario(
  state: SimulatorState,
  learnerId: number,
  now: Date,
): SimulatorScenarioLookup {
  const entry = state.scenarios[String(learnerId)];
  if (!entry) return { kind: "absent" };
  if (isEntryExpired(entry, now)) return { kind: "expired" };
  return { kind: "active", entry };
}

/** The state an empty control plane holds. Used by the CLI when creating a file. */
export function emptySimulatorState(now: Date = new Date()): SimulatorState {
  return {
    schemaVersion: SIMULATOR_STATE_SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    scenarios: Object.create(null) as Record<string, SimulatorScenarioEntry>,
  };
}

/** Serialise for the writer. Sorted keys so a diff of two states is readable. */
export function serializeSimulatorState(state: SimulatorState): string {
  const scenarios: Record<string, SimulatorScenarioEntry> = {};
  for (const learnerId of Object.keys(state.scenarios).sort((a, b) => Number(a) - Number(b))) {
    const entry = state.scenarios[learnerId];
    scenarios[learnerId] = {
      scenario: entry.scenario,
      expiresAt: entry.expiresAt,
      note: entry.note,
    };
  }
  return `${JSON.stringify(
    { schemaVersion: state.schemaVersion, updatedAt: state.updatedAt, scenarios },
    null,
    2,
  )}\n`;
}
