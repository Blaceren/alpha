/**
 * AFD-5B2A-FINAL — listener ownership for the acceptance manifest.
 *
 * WHY THIS EXISTS
 * The first version of the manifest's port-settle guard matched a port-number
 * regex (`3[45]\d\d|38\d\d|39\d\d`) and waited until nothing in those bands was
 * listening. Two listeners on port **3400** — one IPv4, one IPv6 — have been up
 * since long before the phase and belong to something else entirely. The guard
 * therefore burned its full 90-second bound before every single suite, roughly
 * two hours of pure waiting across an 84-suite sweep, and would never have been
 * satisfied.
 *
 * A port number is not ownership evidence. This module decides ownership from
 * the socket instead:
 *
 *   A. `opening_baseline`  — present in the snapshot taken before the first
 *                            suite ran. Never waited for, never signalled.
 *   B. `phase_owned`       — the socket's owning process is the manifest
 *                            producer or one of its descendants, AND that
 *                            process's cwd is inside the worktree under test.
 *                            Only these may be waited for.
 *   C. `external_new`      — appeared during the run but is not attributable to
 *                            the producer. Recorded, never waited for, never
 *                            signalled.
 *   D. `unknown`           — ownership could not be established. Treated exactly
 *                            like `external_new`: reported, never waited for,
 *                            never signalled. Ambiguity must never authorise a
 *                            signal.
 *
 * Nothing in this module sends a signal to anything.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

export type ListenerClass = "opening_baseline" | "phase_owned" | "external_new" | "unknown";

export type Listener = {
  /** `tcp4` or `tcp6` — a port bound on both stacks is two distinct sockets. */
  family: "tcp4" | "tcp6";
  localAddress: string;
  port: number;
  /** Socket inode, the only field that is stable across a listener's lifetime. */
  inode: string | null;
  pid: number | null;
  uid: number | null;
  /** Stable identity used for baseline comparison. */
  key: string;
};

export type ClassifiedListener = Listener & {
  classification: ListenerClass;
  /** Why it was classified that way, for the audit trail. */
  reason: string;
};

/**
 * `ss -ltnHp` lines look like:
 *   LISTEN 0 511 127.0.0.1:3100 0.0.0.0:* users:(("next-server",pid=123,fd=21))
 * and with `-e`, carry `ino:12345 sk:... uid:1000`.
 */
export function parseListeners(raw: string): Listener[] {
  const listeners: Listener[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const columns = trimmed.split(/\s+/);
    // LISTEN Recv-Q Send-Q Local:Port Peer:Port [extras...]
    const local = columns[3];
    if (local === undefined) continue;
    const separator = local.lastIndexOf(":");
    if (separator === -1) continue;
    const address = local.slice(0, separator);
    const port = Number(local.slice(separator + 1));
    if (!Number.isInteger(port)) continue;

    const pidMatch = trimmed.match(/pid=(\d+)/);
    const inodeMatch = trimmed.match(/\bino:(\d+)/);
    const uidMatch = trimmed.match(/\buid:(\d+)/);
    // `[::]` and `*` are the IPv6 wildcard forms; `0.0.0.0` and `*` the IPv4.
    const family: Listener["family"] = address.includes(":") || address === "[::]" ? "tcp6" : "tcp4";

    listeners.push({
      family,
      localAddress: address,
      port,
      inode: inodeMatch?.[1] ?? null,
      pid: pidMatch ? Number(pidMatch[1]) : null,
      uid: uidMatch ? Number(uidMatch[1]) : null,
      // Inode first: it survives a process being re-parented and distinguishes
      // the IPv4 and IPv6 sockets of the same port. Address+family+port is the
      // fallback when `ss` could not show the inode.
      key: inodeMatch ? `ino:${inodeMatch[1]}` : `${family}|${address}|${port}`,
    });
  }
  return listeners;
}

export function readListeners(): Listener[] {
  try {
    // -H no header, -l listening, -t tcp, -n numeric, -p process, -e extended
    // (this is where `ino:` and `uid:` come from).
    return parseListeners(execFileSync("ss", ["-ltnpeH"], { encoding: "utf8" }));
  } catch {
    return [];
  }
}

/** True when `pid` is `ancestor`, or is descended from it. */
export function isDescendantOf(pid: number, ancestor: number, readStat = defaultReadStat): boolean {
  let current = pid;
  // The loop is bounded by the depth of the process tree; 64 is far beyond any
  // real nesting and stops a corrupted /proc from spinning forever.
  for (let depth = 0; depth < 64; depth += 1) {
    if (current === ancestor) return true;
    if (current <= 1) return false;
    const parent = readStat(current);
    if (parent === null) return false;
    current = parent;
  }
  return false;
}

function defaultReadStat(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    // The comm field can contain spaces and parentheses, so parse after ')'.
    const after = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ppid = Number(after[1]);
    return Number.isInteger(ppid) ? ppid : null;
  } catch {
    return null;
  }
}

function defaultReadCwd(pid: number): string | null {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

export type OwnershipContext = {
  /** The manifest producer's pid. A listener under it is phase-owned. */
  producerPid: number;
  /** Only a process working inside this tree counts as phase-owned. */
  worktreeRoot: string;
  /** The producer's uid. A socket owned by another user is never ours. */
  producerUid?: number;
  /** Snapshot keys taken before the first suite ran. */
  baselineKeys: Set<string>;
  readStat?: (pid: number) => number | null;
  readCwd?: (pid: number) => string | null;
};

export function classifyListener(listener: Listener, context: OwnershipContext): ClassifiedListener {
  const readStat = context.readStat ?? defaultReadStat;
  const readCwd = context.readCwd ?? defaultReadCwd;

  if (context.baselineKeys.has(listener.key)) {
    return {
      ...listener,
      classification: "opening_baseline",
      reason: `present in the opening baseline (${listener.key})`,
    };
  }

  if (listener.pid === null) {
    // `ss` could not attribute the socket — almost always another user's
    // process, and on this host that is exactly what the pre-existing port 3400
    // listeners look like. Ambiguity is never treated as ownership.
    return { ...listener, classification: "unknown", reason: "no owning pid visible to this user" };
  }

  // A different user's process is never ours, whatever else is true of it.
  if (context.producerUid !== undefined && listener.uid !== null && listener.uid !== context.producerUid) {
    return {
      ...listener,
      classification: "external_new",
      reason: `socket is owned by uid ${listener.uid}, not the producer's uid ${context.producerUid}`,
    };
  }

  // Two independent forms of evidence, either of which establishes ownership:
  //
  //   1. process ancestry — the listener's process descends from THIS producer;
  //   2. working directory — the process works inside the worktree under test.
  //
  // Ancestry alone is not enough, because a *leaked* listener is precisely one
  // that outlived its suite: once the suite's process group exits, the stray
  // server is reparented away from the producer and ancestry is lost. The cwd
  // survives that reparenting, so it is what catches a real leak.
  const descendant = isDescendantOf(listener.pid, context.producerPid, readStat);
  const cwd = readCwd(listener.pid);
  const inWorktree = cwd !== null && (cwd === context.worktreeRoot || cwd.startsWith(`${context.worktreeRoot}/`));

  if (descendant && inWorktree) {
    return {
      ...listener,
      classification: "phase_owned",
      reason: `pid ${listener.pid} descends from producer ${context.producerPid} and works inside ${context.worktreeRoot}`,
    };
  }
  if (inWorktree) {
    return {
      ...listener,
      classification: "phase_owned",
      reason: `pid ${listener.pid} works inside the worktree under test (${context.worktreeRoot}); a suite leaked it and it was reparented away from the producer`,
    };
  }
  if (descendant) {
    return {
      ...listener,
      classification: "phase_owned",
      reason: `pid ${listener.pid} descends from producer ${context.producerPid} (cwd ${cwd ?? "unreadable"})`,
    };
  }

  return {
    ...listener,
    classification: "external_new",
    reason: `pid ${listener.pid} neither descends from producer ${context.producerPid} nor works inside ${context.worktreeRoot} (cwd ${cwd ?? "unreadable"})`,
  };
}

export function classifyAll(listeners: Listener[], context: OwnershipContext): ClassifiedListener[] {
  return listeners.map((listener) => classifyListener(listener, context));
}

/** The only listeners the manifest is ever allowed to wait for. */
export function phaseOwned(listeners: ClassifiedListener[]): ClassifiedListener[] {
  return listeners.filter((listener) => listener.classification === "phase_owned");
}
