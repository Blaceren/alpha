/**
 * PHASE-G2 TRANSPORT — the protected-database guard.
 *
 * WHAT THIS REPLACES. The CV-1 importer decided whether a target was safe by
 * asking whether its PATH STRING contained one of four substrings. Two defects
 * followed from that, and both were demonstrated on the preprod host:
 *
 *   1. The live PREPROD database was not protected at all. The list contained
 *      "ata-prod"; the live file is "ata-preprod.sqlite", and "ata-preprod" does
 *      not contain "ata-prod" — the only eight-character windows are "ata-prep",
 *      "ta-prepr", "a-prepro" and "-preprod". The importer would have written to
 *      the live runtime on request.
 *
 *   2. A dangling symlink laundered the alias. `fs.realpathSync` throws ENOENT on
 *      a link whose target does not exist, and the old fallback then resolved
 *      only the PARENT DIRECTORY and re-appended the basename — discarding the
 *      link target entirely. A link literally naming `ata-dev.sqlite` was checked
 *      as `/tmp/ata-dev-alias-*.sqlite` and passed. The guard failed OPEN, which
 *      is what `curriculum-package` check 49 has been reporting.
 *
 * THE CORRECTION IS TO STOP PROTECTING NAMES AND START PROTECTING FILES. A path
 * is a label; `(st_dev, st_ino)` is the thing itself. Every alias that actually
 * resolves — symlink, hardlink, bind mount, `../` traversal, a second mount
 * point, a rename — reports the same device and inode as the file it aliases, so
 * one comparison closes the whole class. Substring matching is retained only as
 * a coarse net for paths that cannot be stat'ed at all.
 *
 * FAIL CLOSED IS THE DEFAULT ANSWER. Where identity cannot be established — a
 * dangling symlink, an unresolvable parent — the guard refuses. The previous
 * implementation treated "I could not tell" as "it is fine", and that is the
 * single decision that made both defects reachable.
 *
 * IT RETURNS WHAT IT CHECKED. `assertSafeDatabaseTarget` hands back the resolved
 * absolute path and, when the file exists, its device/inode. Callers open THAT
 * path, so the thing inspected and the thing written are the same thing. The
 * TOCTOU boundary is documented on `ResolvedDatabaseTarget` and narrowed by
 * `assertTargetIdentityUnchanged`, which a caller may run immediately before it
 * opens a connection.
 *
 * NO BYPASS EXISTS HERE. This module refuses protected databases; it offers no
 * flag, environment variable or argument that permits one. A future privileged
 * activation path that intends to write a runtime database must introduce its
 * own explicitly-audited mechanism rather than weakening this one.
 *
 * THAT MECHANISM NOW EXISTS, AND IT IS NOT A WEAKENING OF THIS ONE.
 * `src/lib/curriculum/preprod-activation` implements a PREPROD-only activation
 * authorization: a reviewed manifest, pinned by a digest supplied separately
 * from the file, binding the host, the exact target database, a verified local
 * rollback backup, the migration lineage, the structural package, the editorial
 * overlay, the deployed releases, the feature-flag baseline and the database's
 * own starting contents. When every one of those holds it issues a GRANT, and
 * `assertSafeDatabaseTarget` accepts a grant that names exactly the target in
 * front of it.
 *
 * WHY THAT IS STILL FAIL-CLOSED. The grant is not a boolean and not a flag. It
 * carries one absolute path, one `(device, inode)` pair, one operation and one
 * stage, and every one of them is compared here against the target actually
 * being opened. A grant issued for one database cannot admit another, an alias
 * of the granted file is still refused because the path must match exactly, and
 * `assertStillValid` is called at the last possible moment so a target that
 * moved between authorization and open is refused rather than followed. No
 * argument to this module, and no environment variable read by it, produces a
 * grant: only the authorization module does, and only after all of the above.
 */
import fs from "node:fs";
import path from "node:path";

import {
  assertAuthenticActivationGrant,
  type PreprodActivationGrant,
} from "./preprod-activation/grant";
import type { AuthorizedOperation } from "./preprod-activation/stages";

export type ProtectedDatabaseErrorCode =
  | "TARGET_URL_INVALID"
  | "TARGET_PATH_RELATIVE"
  | "TARGET_IS_SYMLINK"
  | "TARGET_PARENT_UNRESOLVABLE"
  | "TARGET_PROTECTED"
  | "PROTECTED_IDENTITY_UNRESOLVED"
  | "TARGET_IDENTITY_CHANGED";

export class ProtectedDatabaseError extends Error {
  readonly code: ProtectedDatabaseErrorCode;
  /** Which protected database was matched, when the refusal names one. */
  readonly protectedPath: string | null;
  /** Which rule fired, so a refusal is debuggable without re-deriving it. */
  readonly rule: string | null;

  constructor(
    code: ProtectedDatabaseErrorCode,
    message: string,
    detail: { protectedPath?: string | null; rule?: string | null } = {},
  ) {
    super(message);
    this.name = "ProtectedDatabaseError";
    this.code = code;
    this.protectedPath = detail.protectedPath ?? null;
    this.rule = detail.rule ?? null;
  }
}

export function isProtectedDatabaseError(
  error: unknown,
  code?: ProtectedDatabaseErrorCode,
): error is ProtectedDatabaseError {
  if (!(error instanceof ProtectedDatabaseError)) return false;
  return code === undefined || error.code === code;
}

/**
 * The floor. These are protected even when nothing in the environment mentions
 * them, because a tool run with an empty environment must not become the one
 * that writes a runtime database. Discovery below ADDS to this set; it never
 * subtracts from it.
 */
export const DEFAULT_PROTECTED_DATABASE_PATHS: readonly string[] = [
  "/srv/ata-data/data/ata-preprod.sqlite",
  "/srv/ata-data/data/ata-prod.sqlite",
  "/home/ubuntu/runtime/ata-dev-v2/data/ata-dev.sqlite",
  "/home/ubuntu/runtime/ata-suite/data/ata-suite.sqlite",
];

/**
 * The coarse net, applied only to path strings. It cannot see through an alias,
 * which is exactly why it is last and why `ata-preprod` is listed explicitly
 * rather than being assumed to follow from `ata-prod`.
 */
export const PROTECTED_PATH_SUBSTRINGS: readonly string[] = [
  "/runtime/ata-dev",
  "/runtime/ata-suite",
  "ata-dev.sqlite",
  "ata-suite.sqlite",
  "ata-preprod",
  "ata-prod",
];

export type ProtectedDatabase = {
  /** The configured path, before resolution. */
  declaredPath: string;
  /** realpath when it could be resolved, else the normalised absolute path. */
  resolvedPath: string;
  /** Present only when the file exists AND could be identified. */
  identity: { dev: number; ino: number } | null;
  /** Where this entry came from, for diagnostics. */
  source: "default" | "DATABASE_URL" | "ATA_PROTECTED_DATABASES" | "runtime-config";
  /**
   * Was this entry EXPLICITLY configured for this deployment, as opposed to the
   * conventional floor?
   *
   * The distinction only matters when identity cannot be established. A
   * conventional path that simply is not mounted on this host is nothing to worry
   * about. A path the operator or the deployment named, which exists but cannot
   * be identified, is: the guard then cannot tell an alias of it from an ordinary
   * file, and that is precisely the gap a hardlink walks through.
   */
  authoritative: boolean;
  /**
   * Identity could not be established, and NOT because the file is absent.
   * Permission denied, a broken link, an I/O error — anything that leaves the
   * question open rather than answered "no such file".
   */
  unresolved: boolean;
};

function fileUrlToPath(value: string): string | null {
  if (!value.startsWith("file:")) return null;
  const raw = value.slice("file:".length);
  return raw.length > 0 ? raw : null;
}

/**
 * Identity, and — when there is none — WHY there is none.
 *
 * CORRECTION-1. The previous version swallowed every error into `null`, which
 * made "this file does not exist" and "I am not allowed to look at this file"
 * the same answer. They are not: the second means an alias of a protected
 * database can be handed to the guard and compared against nothing. `ENOENT` is
 * an answer; everything else is an open question, and an open question about a
 * database the deployment explicitly named is refused rather than assumed benign.
 */
function resolveIdentity(target: string): {
  identity: { dev: number; ino: number } | null;
  unresolved: boolean;
} {
  try {
    const stat = fs.statSync(target);
    return { identity: { dev: stat.dev, ino: stat.ino }, unresolved: false };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { identity: null, unresolved: code !== "ENOENT" };
  }
}

function resolveExisting(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function pushProtected(
  into: Map<string, ProtectedDatabase>,
  declaredPath: string,
  source: ProtectedDatabase["source"],
): void {
  if (!path.isAbsolute(declaredPath)) return;
  const resolvedPath = resolveExisting(declaredPath);
  const existing = into.get(resolvedPath);
  // A default entry that is re-discovered from the environment keeps the more
  // specific source label, so diagnostics say where protection actually came from.
  if (existing && existing.source !== "default") return;
  const resolved = resolveIdentity(declaredPath);
  into.set(resolvedPath, {
    declaredPath,
    resolvedPath,
    identity: resolved.identity,
    source,
    authoritative: source !== "default",
    unresolved: resolved.unresolved,
  });
}

/**
 * Read `DATABASE_URL` out of the deployment's EnvironmentFiles when they are
 * readable. On the preprod host these are `0600 ata`, so an unprivileged tool
 * simply learns nothing here and falls back to the defaults — which is why the
 * defaults exist. Unreadable config is never an error: a guard that refuses to
 * start because it could not read a file it does not need would be a worse
 * failure than the one it prevents.
 */
function discoverFromRuntimeConfig(env: NodeJS.ProcessEnv): Array<{ path: string }> {
  const dir = env.ATA_RUNTIME_CONFIG_DIR ?? "/srv/ata/config";
  const found: Array<{ path: string }> = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir).filter((name) => name.endsWith(".env"));
  } catch {
    return found;
  }
  for (const name of entries) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("DATABASE_URL=")) continue;
      const filePath = fileUrlToPath(trimmed.slice("DATABASE_URL=".length).trim());
      if (filePath) found.push({ path: filePath });
    }
  }
  return found;
}

/**
 * The protected set for this process. Recomputed per call rather than cached:
 * the set is small, and a cached answer would go stale exactly when a test or an
 * operator changed the environment to check something.
 */
export function resolveProtectedDatabases(
  env: NodeJS.ProcessEnv = process.env,
): ProtectedDatabase[] {
  const byResolved = new Map<string, ProtectedDatabase>();

  for (const candidate of DEFAULT_PROTECTED_DATABASE_PATHS) {
    pushProtected(byResolved, candidate, "default");
  }

  const own = env.DATABASE_URL ? fileUrlToPath(env.DATABASE_URL) : null;
  // The process's own database is protected ONLY when it is a runtime one. A
  // disposable fixture addressed by DATABASE_URL must stay writable, otherwise
  // every test that points the importer at its own scratch file would refuse.
  if (own && looksLikeRuntimePath(own)) pushProtected(byResolved, own, "DATABASE_URL");

  const explicit = env.ATA_PROTECTED_DATABASES;
  if (explicit) {
    for (const entry of explicit.split(path.delimiter)) {
      const trimmed = entry.trim();
      if (trimmed) pushProtected(byResolved, trimmed, "ATA_PROTECTED_DATABASES");
    }
  }

  for (const discovered of discoverFromRuntimeConfig(env)) {
    pushProtected(byResolved, discovered.path, "runtime-config");
  }

  return [...byResolved.values()];
}

function looksLikeRuntimePath(candidate: string): boolean {
  return PROTECTED_PATH_SUBSTRINGS.some((needle) => candidate.includes(needle));
}

/**
 * What the guard inspected, so the caller can open exactly that.
 *
 * TOCTOU BOUNDARY. Between this value being produced and a connection being
 * opened, the filesystem can change: the path could be replaced by a symlink to
 * a protected database. The window is real and cannot be closed from userspace
 * without holding the file open, which a Prisma client does not let us do.
 * `assertTargetIdentityUnchanged` narrows it to the smallest practical interval
 * by re-verifying identity immediately before the caller connects. Callers that
 * skip that call still get the primary benefit — they open `absolutePath`, the
 * path that was actually checked, and never the raw argument.
 */
export type ResolvedDatabaseTarget = {
  /** The `file:` URL, normalised to the resolved absolute path. */
  url: string;
  /** The absolute path the caller must open. */
  absolutePath: string;
  /** Device/inode when the file exists; null for a target about to be created. */
  identity: { dev: number; ino: number } | null;
  /** Whether the file existed at check time. */
  existed: boolean;
};

/**
 * THE ACTIVATION CAPABILITY, AS THIS MODULE SEES IT.
 *
 * WHAT WENT WRONG THE FIRST TIME. This type used to be described STRUCTURALLY —
 * a `kind` string, a path, a device, an inode and a method named
 * `assertStillValid` — and the guard authenticated a grant by reading those
 * fields and then calling that method. Every one of them is something a caller
 * can produce: the identity numbers come from `stat(2)`, and the validator was
 * whatever function the caller attached. The independent audit built one out of
 * an object literal and watched the real structural importer write a protected
 * database with it.
 *
 * WHAT IT IS NOW. An opaque handle. This module cannot read anything meaningful
 * off it and does not try; it passes the value to
 * `assertAuthenticActivationGrant`, which looks it up in a registry private to
 * the authorization module and answers from the claims stored there. A copy, a
 * clone, a JSON round-trip, a class instance or a hand-built object is a
 * different object and is not in the registry, so it is refused — not for having
 * the wrong fields, but for never having been issued.
 */
export type ProtectedDatabaseActivationGrant = PreprodActivationGrant;

export type AssertSafeDatabaseTargetOptions = {
  env?: NodeJS.ProcessEnv;
  /** Injectable for tests that need a set the host does not have. */
  protectedDatabases?: ProtectedDatabase[];
  /**
   * A capability for THIS target and THIS operation, when the caller is a
   * sanctioned PREPROD activation.
   *
   * Absent — which is every ordinary call — leaves the refusal behaviour exactly
   * as it was: a protected database is refused, with no way to ask twice.
   *
   * Present but not issued by this process's authorization module: also refused.
   * Supplying a value here is not a claim the guard takes at face value.
   */
  activationGrant?: ProtectedDatabaseActivationGrant;
  /**
   * Which operation the caller is about to perform.
   *
   * Required alongside a grant, and compared against what the capability
   * actually authorizes, so a structural-import grant cannot admit an overlay
   * import even against the correct file.
   */
  activationOperation?: AuthorizedOperation;
};

/**
 * Is the caller even claiming a capability for this path?
 *
 * A cheap pre-filter, and NOTHING MORE. It decides only whether to attempt
 * verification below; it grants nothing on its own, and a value that passes it
 * still has to be in the authorization module's registry. The path comparison
 * is kept because an activation is authorized to write ONE path, and a hardlink
 * to the granted file is a different label for the same bytes.
 */
function claimsPath(grant: ProtectedDatabaseActivationGrant | undefined, candidatePath: string): boolean {
  if (!grant || typeof grant !== "object") return false;
  const target = (grant as { target?: { absolutePath?: unknown } }).target;
  if (!target || typeof target.absolutePath !== "string") return false;
  return path.resolve(target.absolutePath) === candidatePath;
}

/**
 * Refuse anything that is not an explicit local SQLite file, and anything that
 * is — or aliases — a protected runtime database.
 *
 * The order is deliberate: cheap syntactic refusals first, then identity, then
 * the coarse lexical net. Identity is the load-bearing check; the net exists for
 * paths that cannot be stat'ed at all.
 */
export function assertSafeDatabaseTarget(
  url: string,
  options: AssertSafeDatabaseTargetOptions = {},
): ResolvedDatabaseTarget {
  const env = options.env ?? process.env;

  if (!url.startsWith("file:")) {
    throw new ProtectedDatabaseError(
      "TARGET_URL_INVALID",
      "refusing non-file database URL: only local SQLite targets are allowed",
      { rule: "scheme" },
    );
  }
  const raw = url.slice("file:".length);
  if (!raw) {
    throw new ProtectedDatabaseError("TARGET_URL_INVALID", "refusing empty database path", {
      rule: "scheme",
    });
  }
  if (!path.isAbsolute(raw)) {
    throw new ProtectedDatabaseError(
      "TARGET_PATH_RELATIVE",
      "refusing relative database path: pass an absolute path",
      { rule: "absolute-path" },
    );
  }

  const normalised = path.resolve(raw);
  const protectedSet = options.protectedDatabases ?? resolveProtectedDatabases(env);

  // Is a capability being claimed for THIS path? This is a pre-filter only:
  // whether it is REAL is decided by the registry lookup at step 1a, after the
  // file has been resolved and identified. A claim for some other path is worth
  // nothing here, so an alias cannot widen one.
  const claimed = claimsPath(options.activationGrant, normalised);

  // ---- the coarse lexical net runs FIRST, before anything that needs the file
  // to exist.
  //
  // A protected database that is not mounted on this host still must not be a
  // target: the DEV path on a preprod box resolves to nothing, and refusing it
  // as "parent unresolvable" would be true but useless. Naming a protected
  // database is itself disqualifying, whatever the filesystem currently holds.
  // The cost is that a fixture may not borrow a protected name, which is a
  // constraint worth having.
  if (!claimed) {
    for (const needle of PROTECTED_PATH_SUBSTRINGS) {
      if (normalised.includes(needle)) {
        throw new ProtectedDatabaseError(
          "TARGET_PROTECTED",
          `refusing a database path that names a protected runtime database (${needle})`,
          { protectedPath: null, rule: "path-substring" },
        );
      }
    }
  }

  // ---- symlinks are refused outright, resolvable or not.
  //
  // A database target is a file the tool is about to write. A symlink is an
  // indirection whose meaning can change between this check and that write, and
  // a DANGLING one cannot be checked at all. Refusing the whole class is both
  // safer and simpler than trying to decide which links are benign, and it costs
  // nothing: a disposable fixture is a real file.
  let linkStat: fs.Stats | null = null;
  try {
    linkStat = fs.lstatSync(normalised);
  } catch {
    linkStat = null; // does not exist yet — handled by the parent check below
  }
  if (linkStat?.isSymbolicLink()) {
    let linkTarget = "<unreadable>";
    try {
      linkTarget = path.resolve(path.dirname(normalised), fs.readlinkSync(normalised));
    } catch {
      /* keep the placeholder */
    }
    throw new ProtectedDatabaseError(
      "TARGET_IS_SYMLINK",
      `refusing a symlinked database target (${normalised} -> ${linkTarget}): pass the real file`,
      { rule: "symlink" },
    );
  }

  const existed = linkStat !== null;

  // ---- the file must live somewhere that resolves. A target whose parent
  // cannot be resolved cannot be identified, and unidentifiable is refused.
  const parent = path.dirname(normalised);
  let resolvedParent: string;
  try {
    resolvedParent = fs.realpathSync(parent);
  } catch {
    throw new ProtectedDatabaseError(
      "TARGET_PARENT_UNRESOLVABLE",
      `refusing database target whose parent directory cannot be resolved (${parent})`,
      { rule: "parent-realpath" },
    );
  }
  const absolutePath = path.join(resolvedParent, path.basename(normalised));

  // ---- 0. FAIL CLOSED where protection could not be established.
  //
  // CORRECTION-1. An EXPLICITLY configured protected database whose identity
  // cannot be resolved — it exists, or may exist, but cannot be stat'ed — leaves
  // the inode comparison below with nothing to compare against. Every alias of
  // that database then reads as an ordinary file: a hardlink under an innocent
  // name passes, which is exactly the mutant the audit demonstrated.
  //
  // The refusal is scoped to AUTHORITATIVE entries on purpose. The conventional
  // floor names runtime databases that legitimately do not exist on most hosts,
  // and refusing every import because a DEV path is absent would brick ordinary
  // work while protecting nothing — an absent file has no alias. What is refused
  // is the case where the deployment named a database and the answer came back
  // "cannot tell".
  const unresolvedProtected = protectedSet.filter((candidate) => candidate.authoritative && candidate.unresolved);
  if (unresolvedProtected.length > 0) {
    const named = unresolvedProtected.map((candidate) => candidate.declaredPath).join(", ");
    throw new ProtectedDatabaseError(
      "PROTECTED_IDENTITY_UNRESOLVED",
      `refusing to operate while a configured protected database cannot be identified (${named}): its aliases cannot be recognised, so no target can be proven safe`,
      { protectedPath: unresolvedProtected[0].declaredPath, rule: "protected-identity-unresolved" },
    );
  }

  // ---- 1. identity. Catches symlink-through-ancestor, hardlink, bind mount,
  //         `../` traversal, a second mount point and any alternate name.
  const identity = existed ? resolveIdentity(absolutePath).identity : null;

  // ---- 1a. a CAPABILITY admits one file, one operation, and only while the
  //          file is still the file it was issued against.
  //
  // Everything decisive happens inside `assertAuthenticActivationGrant`: it
  // looks the value up in the authorization module's private registry, refuses
  // anything that was not issued there, compares the operation and the
  // `(device, inode)` against the claims STORED AT ISSUANCE rather than against
  // fields on the object in hand, and finally runs the issuer's own
  // revalidation closure — which re-reads the live database at the last possible
  // moment before this function returns and the caller connects.
  //
  // This module contributes the resolution and the identity it just measured. It
  // does not decide, and it cannot be talked into deciding.
  if (claimed) {
    if (!options.activationOperation) {
      throw new ProtectedDatabaseError(
        "TARGET_PROTECTED",
        "an activation grant was supplied without naming the operation it is being used for; a capability is checked against the operation it authorizes, so the operation is not optional",
        { rule: "activation-grant-operation-absent" },
      );
    }
    if (!identity) {
      throw new ProtectedDatabaseError(
        "TARGET_IDENTITY_CHANGED",
        `an activation grant was supplied for ${absolutePath}, but no file exists at that path to identify. Refusing.`,
        { rule: "activation-grant-identity" },
      );
    }
    assertAuthenticActivationGrant(
      options.activationGrant,
      { absolutePath, device: identity.dev, inode: identity.ino },
      options.activationOperation,
    );
    return { url: `file:${absolutePath}`, absolutePath, identity, existed };
  }

  if (identity) {
    for (const candidate of protectedSet) {
      if (
        candidate.identity &&
        candidate.identity.dev === identity.dev &&
        candidate.identity.ino === identity.ino
      ) {
        throw new ProtectedDatabaseError(
          "TARGET_PROTECTED",
          `refusing to operate on a protected runtime database: ${absolutePath} is the same file as ${candidate.declaredPath} (device ${identity.dev}, inode ${identity.ino})`,
          { protectedPath: candidate.declaredPath, rule: "inode-identity" },
        );
      }
    }
  }

  // ---- 2. resolved-path equality, for protected files that do not currently
  //         exist (so have no inode) and for targets not yet created.
  for (const candidate of protectedSet) {
    if (candidate.resolvedPath === absolutePath) {
      throw new ProtectedDatabaseError(
        "TARGET_PROTECTED",
        `refusing to operate on a protected runtime database: ${absolutePath}`,
        { protectedPath: candidate.declaredPath, rule: "resolved-path" },
      );
    }
  }

  // ---- 3. the coarse net again, this time over the RESOLVED path: an alias
  //         whose own name is innocent may still resolve into a protected
  //         location that has no inode to compare (a directory that exists but a
  //         file that does not).
  for (const needle of PROTECTED_PATH_SUBSTRINGS) {
    if (absolutePath.includes(needle)) {
      throw new ProtectedDatabaseError(
        "TARGET_PROTECTED",
        `refusing a database path that resolves into a protected runtime database (${needle})`,
        { protectedPath: null, rule: "resolved-path-substring" },
      );
    }
  }

  return { url: `file:${absolutePath}`, absolutePath, identity, existed };
}

/**
 * Re-verify immediately before opening a connection.
 *
 * This is the TOCTOU narrowing described on `ResolvedDatabaseTarget`: it does not
 * eliminate the window, it shortens it to the interval between this call and the
 * client connecting. Any change of identity — a file replaced, a path that has
 * become a symlink, a target that vanished — is refused rather than followed.
 */
export function assertTargetIdentityUnchanged(
  target: ResolvedDatabaseTarget,
  options: AssertSafeDatabaseTargetOptions = {},
): void {
  let current: fs.Stats;
  try {
    current = fs.lstatSync(target.absolutePath);
  } catch {
    if (!target.existed) return; // still about to be created — nothing has changed
    throw new ProtectedDatabaseError(
      "TARGET_IDENTITY_CHANGED",
      `database target disappeared between check and open: ${target.absolutePath}`,
      { rule: "toctou" },
    );
  }
  if (current.isSymbolicLink()) {
    throw new ProtectedDatabaseError(
      "TARGET_IDENTITY_CHANGED",
      `database target became a symlink between check and open: ${target.absolutePath}`,
      { rule: "toctou" },
    );
  }
  if (!target.existed) {
    // It was going to be created and now exists. Re-run the full guard so a file
    // that appeared in the window is identified rather than assumed benign. The
    // caller's options travel with it: a grant that admitted this target a
    // moment ago must still be the thing being evaluated, not silently dropped.
    assertSafeDatabaseTarget(`file:${target.absolutePath}`, options);
    return;
  }
  if (
    target.identity &&
    (current.dev !== target.identity.dev || current.ino !== target.identity.ino)
  ) {
    throw new ProtectedDatabaseError(
      "TARGET_IDENTITY_CHANGED",
      `database target changed identity between check and open: ${target.absolutePath}`,
      { rule: "toctou" },
    );
  }
}
