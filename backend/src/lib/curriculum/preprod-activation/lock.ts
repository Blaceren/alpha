/**
 * PREPROD ACTIVATION AUTHORIZATION — one activation at a time.
 *
 * WHAT GOES WRONG WITHOUT IT. Two sessions, each having validated an identical
 * manifest, each observing the same correct pre-stage state, both proceeding.
 * Every individual check passes in both processes because they ran before either
 * wrote anything. The database ends up with a structural import applied twice,
 * or with an overlay racing an import. Nothing in the per-check logic can catch
 * this, because the checks are correct — what is missing is mutual exclusion.
 *
 * `wx` IS THE WHOLE MECHANISM. `fs.openSync(path, "wx")` creates the file only
 * if it does not exist, atomically, in one syscall. There is no window between
 * "does it exist" and "create it" for a second process to slip through, which is
 * exactly the property a check-then-create implementation would lack.
 *
 * STALENESS IS EXPLICIT, AND NEVER AUTOMATIC. There is no force-unlock in any
 * activation command: clearing a lock is a deliberate act an operator performs
 * after confirming no activation process is running, not something a tool does
 * on their behalf while they are reading the message. A lock left by a crashed process
 * is a real operational problem, and the tempting fix — "if the PID is gone,
 * take the lock" — is wrong here: a crashed activation may have left the
 * database part-way through a stage, and the correct next step is a human
 * looking at it, not a second process helpfully continuing. So a held lock is
 * always refused; the message tells the operator what holds it and how to
 * release it deliberately.
 */
import fs from "node:fs";
import path from "node:path";

import { PreprodActivationError } from "./errors";

/**
 * THE ONE LOCK, AND WHY IT IS A CONSTANT.
 *
 * The independent audit found that `--activation-lock` let a caller choose the
 * lock file, which means two concurrent activations can each name a different
 * one and both proceed — a mutual-exclusion primitive that any caller can opt
 * out of is not one. The path is a constant in this source now. No CLI argument,
 * no environment variable and no manifest field selects it, so "take the lock"
 * and "take THE lock" are the same operation.
 */
export const ACTIVATION_LOCK_PATH = "/srv/ata-data/activation/preprod-activation.lock";

export type ActivationLockRecord = {
  activationId: string;
  manifestSha256: string;
  stage: string;
  operation: string;
  pid: number;
  createdAt: string;
};

export type ActivationLock = {
  path: string;
  record: ActivationLockRecord;
  release: () => void;
};

function readRecord(lockPath: string): ActivationLockRecord | null {
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8")) as ActivationLockRecord;
  } catch {
    return null;
  }
}

/**
 * Take the lock, or refuse.
 *
 * The record is written with `0600` and contains no secret — an activation id, a
 * manifest digest, the stage, the pid and a timestamp. That is enough for an
 * operator to identify the other session without being enough to impersonate it.
 */
/**
 * Test-only substitution of the lock location.
 *
 * WHY THIS IS NOT THE DEFECT THAT WAS REMOVED. `--activation-lock` was an ARGV
 * flag: an operator could pass it, and two of them could pass different values.
 * This is a function parameter on an options object, reachable only by code
 * already running inside this process. No CLI in `scripts/` passes it and the
 * regression suite asserts that none ever does — the same seam, and the same
 * justification, as the sanctioned-target substitution in `target.ts`.
 */
export type ActivationLockOverride = {
  readonly __testOnlyActivationLockPath: string;
};

export function acquireActivationLock(
  input: { activationId: string; manifestSha256: string; stage: string; operation: string },
  override?: ActivationLockOverride,
): ActivationLock {
  const resolved = path.resolve(override?.__testOnlyActivationLockPath ?? ACTIVATION_LOCK_PATH);
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  } catch {
    /* an existing directory with usable permissions is fine */
  }

  const record: ActivationLockRecord = {
    activationId: input.activationId,
    manifestSha256: input.manifestSha256,
    stage: input.stage,
    operation: input.operation,
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };

  let fd: number;
  try {
    fd = fs.openSync(resolved, "wx", 0o600);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      const held = readRecord(resolved);
      throw new PreprodActivationError(
        "ACTIVATION_LOCK_HELD",
        held
          ? `another activation holds the lock at ${resolved}: activation ${held.activationId}, stage ${held.stage}, pid ${held.pid}, since ${held.createdAt}. If that process is gone, inspect the database state before releasing the lock by hand — a crashed activation may have stopped part-way through a stage.`
          : `another activation holds the lock at ${resolved}. Inspect the database state before releasing it by hand.`,
        { expected: "no activation in progress", actual: held?.activationId ?? "unreadable lock record" },
      );
    }
    throw new PreprodActivationError(
      "ACTIVATION_LOCK_UNWRITABLE",
      `cannot create the activation lock at ${resolved}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    fs.writeSync(fd, JSON.stringify(record, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  let released = false;
  return {
    path: resolved,
    record,
    release: () => {
      if (released) return;
      released = true;
      // Only ever remove a lock this process wrote. A lock whose record no
      // longer names our pid belongs to somebody else and is not ours to clear.
      const current = readRecord(resolved);
      if (current && current.pid !== process.pid) return;
      try {
        fs.rmSync(resolved, { force: true });
      } catch {
        /* leaving a stale lock is safer than throwing during cleanup */
      }
    },
  };
}
