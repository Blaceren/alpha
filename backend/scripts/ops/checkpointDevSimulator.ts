/**
 * L4DSP-1 — the server-local operator control plane for the DEV checkpoint
 * simulator.
 *
 * WHY THIS IS A CLI AND NOT AN ENDPOINT
 * The one thing a scenario control must never become is a way for a learner to
 * choose their own result at a financial gate. An HTTP route — however
 * authenticated, however admin-only — is reachable from a browser, needs its own
 * authorization model, and would sit one bug away from that outcome. A binary
 * that must be run by a shell on the box has no such failure mode: the attack
 * surface is "who can log into the server", which is a question already answered
 * elsewhere and not by this code.
 *
 * WHAT IT DELIBERATELY CANNOT DO
 * There is no `complete` command and no `grant-xp` command. The most an operator
 * can do is decide what the PROVIDER will say the next time the LEARNER asks;
 * every rule about cooldown, rate limiting, idempotency and completion is
 * applied afterwards by unchanged engine code. "Set met" is not "pass the
 * learner" — it is "arrange for the next honest verification to succeed".
 *
 * WHAT IT REFUSES
 * Running anywhere that is not authoritatively `dev`; an unsafe state path; an
 * unknown scenario; a TTL beyond seven days; an over-long note; a learner id
 * that is not a positive integer; and, when a database is reachable, a learner
 * who does not exist.
 *
 * WHAT IT NEVER PRINTS
 * Secrets, Pocket identifiers, balances, amounts, thresholds or file contents
 * beyond the three fields of the schema. Learner ids appear only because the
 * operator typed them.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { classifyEnvironment, describeEnvironment } from "@/lib/environment";
import {
  SIMULATOR_NOTE_MAX_LENGTH,
  SIMULATOR_SCENARIOS,
  SIMULATOR_STATE_MAX_BYTES,
  SIMULATOR_STATE_MAX_ENTRIES,
  emptySimulatorState,
  isEntryExpired,
  isSimulatorScenario,
  readSimulatorState,
  resolveSimulatorStatePath,
  serializeSimulatorState,
  type SimulatorScenario,
  type SimulatorScenarioEntry,
  type SimulatorState,
} from "@/lib/curriculum/checkpoint-simulator-state";

/** Seven days. A test fixture that outlives a working week is not a fixture. */
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;

/** How long a lock file may sit before we treat its owner as gone. */
const STALE_LOCK_MS = 60_000;

/** Bounded wait for a contended lock, in milliseconds. */
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 50;

const COMMANDS = ["set", "get", "clear", "list", "clear-expired", "validate", "help"] as const;
type Command = (typeof COMMANDS)[number];

const LEARNER_ID_PATTERN = /^[1-9][0-9]{0,15}$/;
const TTL_PATTERN = /^([1-9][0-9]{0,6})(m|h|d)$/;

class OperatorError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = 2,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------------ */
/* Argument parsing                                                          */
/* ------------------------------------------------------------------------ */

type Args = {
  readonly command: Command;
  readonly flags: ReadonlyMap<string, string | true>;
};

function parseArgs(argv: readonly string[]): Args {
  const [rawCommand, ...rest] = argv;
  const command = rawCommand ?? "help";
  if (!(COMMANDS as readonly string[]).includes(command)) {
    throw new OperatorError(`unknown command: ${command}`);
  }

  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) throw new OperatorError(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  }
  return { command: command as Command, flags };
}

function requireString(flags: ReadonlyMap<string, string | true>, key: string): string {
  const value = flags.get(key);
  if (typeof value !== "string") throw new OperatorError(`--${key} is required`);
  return value;
}

function parseLearnerId(raw: string): number {
  if (!LEARNER_ID_PATTERN.test(raw)) {
    throw new OperatorError(`--learner must be a positive integer, got: ${raw}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new OperatorError(`--learner is out of range: ${raw}`);
  }
  return value;
}

/** `30m`, `12h`, `7d`. Rejected above seven days, and never zero. */
function parseTtlSeconds(raw: string): number {
  const match = TTL_PATTERN.exec(raw);
  if (!match) {
    throw new OperatorError(`--ttl must look like 30m, 12h or 7d, got: ${raw}`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const seconds = unit === "m" ? amount * 60 : unit === "h" ? amount * 3_600 : amount * 86_400;
  if (seconds > MAX_TTL_SECONDS) {
    throw new OperatorError(`--ttl exceeds the ${MAX_TTL_SECONDS / 86_400}-day maximum: ${raw}`);
  }
  return seconds;
}

/* ------------------------------------------------------------------------ */
/* Guards                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Refuse to run anywhere that is not authoritatively DEV.
 *
 * The CLI checks this itself rather than relying on the Backend's check. An
 * operator on a production box must be told "no" by the tool they ran, not
 * discover later that the file they wrote is inert — a file that exists but is
 * ignored is exactly the kind of thing someone eventually "fixes".
 */
function assertDevEnvironment(): void {
  const classification = classifyEnvironment(process.env);
  if (classification.kind !== "classified" || classification.environment !== "dev") {
    throw new OperatorError(
      `refusing to run: the DEV checkpoint simulator control plane requires ATA_ENVIRONMENT=dev (observed: ${describeEnvironment(process.env)})`,
      3,
    );
  }
}

type StatePaths = { readonly file: string; readonly directory: string; readonly lock: string };

function assertStatePath(): StatePaths {
  const resolved = resolveSimulatorStatePath(process.env);
  if (!resolved.ok) {
    throw new OperatorError(
      resolved.problem === "path_unconfigured"
        ? "refusing to run: CHECKPOINT_DEV_SIMULATOR_STATE_PATH is not set"
        : "refusing to run: CHECKPOINT_DEV_SIMULATOR_STATE_PATH must be an absolute path",
      3,
    );
  }
  return {
    file: resolved.file,
    directory: resolved.directory,
    lock: `${resolved.file}.lock`,
  };
}

/**
 * Ensure the state directory exists, is a real directory, and is owner-only.
 *
 * Created with mode 0700 rather than created-then-chmodded, so there is no
 * instant at which the directory is readable by anyone else.
 */
function ensureStateDirectory(paths: StatePaths): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(paths.directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new OperatorError(`cannot inspect the state directory: ${(error as Error).message}`, 3);
    }
    fs.mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
    return;
  }
  if (stat.isSymbolicLink()) {
    throw new OperatorError("refusing to run: the state directory is a symlink", 3);
  }
  if (!stat.isDirectory()) {
    throw new OperatorError("refusing to run: the state path's parent is not a directory", 3);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new OperatorError(
      "refusing to run: the state directory is group- or world-accessible (expected mode 0700)",
      3,
    );
  }
}

/* ------------------------------------------------------------------------ */
/* Locking and atomic writes                                                 */
/* ------------------------------------------------------------------------ */

/**
 * A lock file created with `O_CREAT | O_EXCL`.
 *
 * That flag pair is atomic in the kernel: exactly one of two racing processes
 * creates the file and the other gets EEXIST. No dependency is needed, and none
 * is added — a lock library would be a new supply-chain edge for a guarantee
 * `open(2)` already provides.
 *
 * A crashed operator would otherwise leave the control plane permanently locked,
 * so a lock older than `STALE_LOCK_MS` is broken. It records its pid purely so
 * a human can see who left it.
 */
function acquireLock(paths: StatePaths): () => void {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      const fd = fs.openSync(paths.lock, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
      fs.writeSync(fd, `pid=${process.pid}\nacquiredAt=${new Date().toISOString()}\n`);
      fs.closeSync(fd);
      return () => {
        try {
          fs.rmSync(paths.lock, { force: true });
        } catch {
          /* releasing a lock that is already gone is not an error */
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new OperatorError(`cannot acquire the state lock: ${(error as Error).message}`, 3);
      }
      // Bounded stale-lock handling.
      try {
        const age = Date.now() - fs.statSync(paths.lock).mtimeMs;
        if (age > STALE_LOCK_MS) {
          fs.rmSync(paths.lock, { force: true });
          continue;
        }
      } catch {
        // The lock vanished between EEXIST and stat — the holder released it.
        continue;
      }
      if (Date.now() > deadline) {
        throw new OperatorError(
          "another operator holds the simulator state lock; try again shortly",
          4,
        );
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }
}

/** Deliberately synchronous: the whole CLI is a short, single-threaded script. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Replace the state file atomically.
 *
 * Written to a temporary file IN THE SAME DIRECTORY (so `rename` is a same-filesystem
 * operation and therefore atomic), fsynced so the bytes are durable before the
 * name is published, created 0600 from the start, then renamed over the target.
 * The directory is fsynced afterwards so the rename itself survives a crash.
 *
 * A reader therefore observes either the whole previous file or the whole new
 * one. There is no instant at which a truncated file is visible under the real
 * name, which is what lets Backend read this on a request path without locking.
 */
function writeStateAtomically(paths: StatePaths, state: SimulatorState): void {
  const serialized = serializeSimulatorState(state);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > SIMULATOR_STATE_MAX_BYTES) {
    throw new OperatorError("refusing to write: the state file would exceed 256 KiB", 3);
  }

  const tmp = path.join(
    paths.directory,
    `.${path.basename(paths.file)}.tmp.${process.pid}.${Date.now()}`,
  );

  const fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try {
    fs.writeSync(fd, serialized);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // Belt and braces: `open` mode is masked by umask, so state the mode explicitly.
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, paths.file);

  try {
    const dirFd = fs.openSync(paths.directory, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // Directory fsync is unavailable on some filesystems. The rename is still
    // atomic with respect to readers; only crash-durability of the name is
    // weakened, which is acceptable for DEV scenario state.
  }
}

/**
 * Read the current state for modification.
 *
 * An absent file is not an error — it is an empty control plane. Every other
 * problem IS an error: silently discarding a malformed file would throw away an
 * operator's scenarios without telling them.
 */
function readStateForWrite(): SimulatorState {
  const read = readSimulatorState(process.env);
  if (read.ok) return read.state;
  if (read.problem === "not_found") return emptySimulatorState();
  throw new OperatorError(
    `refusing to modify unreadable state (${read.problem}); inspect or remove the file first`,
    5,
  );
}

/* ------------------------------------------------------------------------ */
/* Learner validation                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Confirm the learner exists, when a database is reachable.
 *
 * Skipped rather than fatal when `DATABASE_URL` is unset, so the CLI stays
 * usable for `validate` and for sandbox checks without a database. When a
 * database IS configured, a typo'd learner id is refused: a scenario set against
 * a nonexistent learner would sit in the file looking effective forever.
 */
async function assertLearnerExists(learnerId: number): Promise<"verified" | "skipped"> {
  if (!process.env.DATABASE_URL) return "skipped";
  const { prisma } = await import("@/lib/prisma");
  const user = await prisma.user.findUnique({ where: { id: learnerId }, select: { id: true } });
  if (!user) throw new OperatorError(`learner ${learnerId} does not exist`, 6);
  return "verified";
}

/* ------------------------------------------------------------------------ */
/* Output                                                                    */
/* ------------------------------------------------------------------------ */

type Output = { json: boolean };

function emit(output: Output, human: string, machine: unknown): void {
  if (output.json) {
    process.stdout.write(`${JSON.stringify(machine, null, 2)}\n`);
  } else {
    process.stdout.write(`${human}\n`);
  }
}

function describeEntry(learnerId: string, entry: SimulatorScenarioEntry, now: Date) {
  return {
    learnerId,
    scenario: entry.scenario,
    expiresAt: entry.expiresAt,
    expired: isEntryExpired(entry, now),
    note: entry.note,
  };
}

/* ------------------------------------------------------------------------ */
/* Commands                                                                  */
/* ------------------------------------------------------------------------ */

const HELP = `checkpoint-dev-simulator — DEV-only L4 checkpoint scenario control

  Server-local. Requires ATA_ENVIRONMENT=dev and CHECKPOINT_DEV_SIMULATOR_STATE_PATH.
  It decides what the balance PROVIDER will answer. It cannot complete a level,
  grant XP, link a Pocket account, or set a balance — no such command exists.

Commands
  set    --learner <id> --scenario <name> (--ttl <30m|12h|7d> | --no-expiry) [--note <text>]
  get    --learner <id>
  clear  --learner <id>
  list
  clear-expired
  validate
  help

Options
  --json        machine-readable output
  --ttl         bounded lifetime; maximum 7d
  --no-expiry   required to set a scenario with no expiry at all
  --note        bounded operator note (max ${SIMULATOR_NOTE_MAX_LENGTH} chars)

Scenarios
  ${SIMULATOR_SCENARIOS.join("\n  ")}

Exit codes
  0 success   2 usage   3 refused (environment/path)   4 lock contention
  5 unreadable state   6 unknown learner   7 not found`;

async function commandSet(flags: ReadonlyMap<string, string | true>, output: Output): Promise<void> {
  assertDevEnvironment();
  const paths = assertStatePath();

  const learnerId = parseLearnerId(requireString(flags, "learner"));
  const scenarioRaw = requireString(flags, "scenario");
  if (!isSimulatorScenario(scenarioRaw)) {
    throw new OperatorError(
      `unknown scenario: ${scenarioRaw}\nvalid scenarios: ${SIMULATOR_SCENARIOS.join(", ")}`,
    );
  }
  const scenario: SimulatorScenario = scenarioRaw;

  const ttlFlag = flags.get("ttl");
  const noExpiry = flags.get("no-expiry") === true;
  if (ttlFlag !== undefined && noExpiry) {
    throw new OperatorError("--ttl and --no-expiry are mutually exclusive");
  }
  // A scenario with no expiry is a scenario someone will forget. Requiring an
  // explicit flag is the "explicit operator intent" the contract calls for.
  if (ttlFlag === undefined && !noExpiry) {
    throw new OperatorError("--ttl is required (or pass --no-expiry deliberately)");
  }
  if (ttlFlag === true) throw new OperatorError("--ttl requires a value, e.g. --ttl 30m");

  const note = flags.get("note");
  if (note === true) throw new OperatorError("--note requires a value");
  if (typeof note === "string" && note.length > SIMULATOR_NOTE_MAX_LENGTH) {
    throw new OperatorError(`--note exceeds ${SIMULATOR_NOTE_MAX_LENGTH} characters`);
  }

  const learnerCheck = await assertLearnerExists(learnerId);

  ensureStateDirectory(paths);
  const release = acquireLock(paths);
  try {
    const state = readStateForWrite();
    const now = new Date();
    const expiresAt =
      ttlFlag === undefined
        ? null
        : new Date(now.getTime() + parseTtlSeconds(ttlFlag) * 1_000).toISOString();

    const scenarios = { ...state.scenarios } as Record<string, SimulatorScenarioEntry>;
    if (!(String(learnerId) in scenarios) && Object.keys(scenarios).length >= SIMULATOR_STATE_MAX_ENTRIES) {
      throw new OperatorError(`refusing to write: more than ${SIMULATOR_STATE_MAX_ENTRIES} scenarios`, 3);
    }
    scenarios[String(learnerId)] = {
      scenario,
      expiresAt,
      note: typeof note === "string" ? note : null,
    };

    writeStateAtomically(paths, {
      schemaVersion: state.schemaVersion,
      updatedAt: now.toISOString(),
      scenarios,
    });

    emit(
      output,
      `set learner ${learnerId} -> ${scenario} (expires: ${expiresAt ?? "never"})`,
      { ok: true, action: "set", learnerId: String(learnerId), scenario, expiresAt, learnerCheck },
    );
  } finally {
    release();
  }
}

function commandGet(flags: ReadonlyMap<string, string | true>, output: Output): void {
  assertDevEnvironment();
  assertStatePath();
  const learnerId = parseLearnerId(requireString(flags, "learner"));

  const read = readSimulatorState(process.env);
  if (!read.ok) {
    if (read.problem === "not_found") {
      emit(output, `no scenario for learner ${learnerId}`, { ok: true, found: false });
      return;
    }
    throw new OperatorError(`state is unreadable (${read.problem})`, 5);
  }

  const entry = read.state.scenarios[String(learnerId)];
  if (!entry) {
    emit(output, `no scenario for learner ${learnerId}`, { ok: true, found: false });
    process.exitCode = 7;
    return;
  }
  const now = new Date();
  const described = describeEntry(String(learnerId), entry, now);
  emit(
    output,
    `learner ${learnerId}: ${described.scenario} (expires: ${described.expiresAt ?? "never"}${described.expired ? ", EXPIRED" : ""})${described.note ? ` note: ${described.note}` : ""}`,
    { ok: true, found: true, ...described },
  );
}

function commandList(output: Output): void {
  assertDevEnvironment();
  assertStatePath();

  const read = readSimulatorState(process.env);
  if (!read.ok) {
    if (read.problem === "not_found") {
      emit(output, "no scenarios configured", { ok: true, count: 0, scenarios: [] });
      return;
    }
    throw new OperatorError(`state is unreadable (${read.problem})`, 5);
  }

  const now = new Date();
  const rows = Object.keys(read.state.scenarios)
    .sort((a, b) => Number(a) - Number(b))
    .map((learnerId) => describeEntry(learnerId, read.state.scenarios[learnerId], now));

  emit(
    output,
    rows.length === 0
      ? "no scenarios configured"
      : rows
          .map(
            (row) =>
              `learner ${row.learnerId}: ${row.scenario} (expires: ${row.expiresAt ?? "never"}${row.expired ? ", EXPIRED" : ""})`,
          )
          .join("\n"),
    { ok: true, count: rows.length, updatedAt: read.state.updatedAt, scenarios: rows },
  );
}

function commandClear(flags: ReadonlyMap<string, string | true>, output: Output): void {
  assertDevEnvironment();
  const paths = assertStatePath();
  const learnerId = parseLearnerId(requireString(flags, "learner"));

  ensureStateDirectory(paths);
  const release = acquireLock(paths);
  try {
    const state = readStateForWrite();
    const scenarios = { ...state.scenarios } as Record<string, SimulatorScenarioEntry>;
    const existed = String(learnerId) in scenarios;
    delete scenarios[String(learnerId)];

    if (existed) {
      writeStateAtomically(paths, {
        schemaVersion: state.schemaVersion,
        updatedAt: new Date().toISOString(),
        scenarios,
      });
    }
    emit(
      output,
      existed ? `cleared learner ${learnerId}` : `no scenario for learner ${learnerId}`,
      { ok: true, action: "clear", learnerId: String(learnerId), cleared: existed },
    );
    if (!existed) process.exitCode = 7;
  } finally {
    release();
  }
}

function commandClearExpired(output: Output): void {
  assertDevEnvironment();
  const paths = assertStatePath();

  ensureStateDirectory(paths);
  const release = acquireLock(paths);
  try {
    const state = readStateForWrite();
    const now = new Date();
    const scenarios: Record<string, SimulatorScenarioEntry> = {};
    const removed: string[] = [];

    for (const [learnerId, entry] of Object.entries(state.scenarios)) {
      if (isEntryExpired(entry, now)) removed.push(learnerId);
      else scenarios[learnerId] = entry;
    }

    if (removed.length > 0) {
      writeStateAtomically(paths, {
        schemaVersion: state.schemaVersion,
        updatedAt: now.toISOString(),
        scenarios,
      });
    }
    emit(output, `removed ${removed.length} expired scenario(s)`, {
      ok: true,
      action: "clear-expired",
      removed: removed.length,
      remaining: Object.keys(scenarios).length,
    });
  } finally {
    release();
  }
}

/**
 * Report on the state without modifying it.
 *
 * `validate` is the one command that must work when everything else refuses,
 * because it is what an operator runs to find out WHY. It still requires DEV —
 * a production operator gets the environment refusal, which is itself the
 * answer.
 */
function commandValidate(output: Output): void {
  assertDevEnvironment();
  const paths = assertStatePath();

  const read = readSimulatorState(process.env);
  const now = new Date();

  if (!read.ok) {
    emit(output, `state INVALID: ${read.problem}`, {
      ok: false,
      problem: read.problem,
      directory: paths.directory,
    });
    // An absent file is a legitimate, inert state — not a failure to report.
    process.exitCode = read.problem === "not_found" ? 0 : 5;
    return;
  }

  const entries = Object.entries(read.state.scenarios);
  const expired = entries.filter(([, entry]) => isEntryExpired(entry, now)).length;
  emit(
    output,
    `state OK: ${entries.length} scenario(s), ${expired} expired, ${read.sizeBytes} bytes, updated ${read.state.updatedAt}`,
    {
      ok: true,
      schemaVersion: read.state.schemaVersion,
      updatedAt: read.state.updatedAt,
      total: entries.length,
      expired,
      sizeBytes: read.sizeBytes,
      maxBytes: SIMULATOR_STATE_MAX_BYTES,
    },
  );
}

/* ------------------------------------------------------------------------ */
/* Entry point                                                               */
/* ------------------------------------------------------------------------ */

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const { command, flags } = parseArgs(argv);
  const output: Output = { json: flags.get("json") === true };

  switch (command) {
    case "help":
      process.stdout.write(`${HELP}\n`);
      return;
    case "set":
      return commandSet(flags, output);
    case "get":
      return commandGet(flags, output);
    case "list":
      return commandList(output);
    case "clear":
      return commandClear(flags, output);
    case "clear-expired":
      return commandClearExpired(output);
    case "validate":
      return commandValidate(output);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && /checkpointDevSimulator\.(ts|js|mjs)$/.test(process.argv[1]);

if (invokedDirectly) {
  main().then(
    () => {
      process.exit(process.exitCode ?? 0);
    },
    (error: unknown) => {
      const exitCode = error instanceof OperatorError ? error.exitCode : 1;
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(exitCode);
    },
  );
}

export { OperatorError, MAX_TTL_SECONDS, parseTtlSeconds, parseArgs };
