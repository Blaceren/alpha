/**
 * LEARNER-OPERATIONS-V1 acceptance fixtures — password intake.
 *
 * THE PASSWORD IS TYPED BY A HUMAN, ON THE CONTROLLING TERMINAL, WITH ECHO OFF.
 * There is deliberately no other way in:
 *
 *   argv         would land in `ps`, in the shell's history file, and in any
 *                process listing a co-tenant can read
 *   environment  would land in `/proc/<pid>/environ` and be inherited by every
 *                child this process spawns
 *   stdin pipe   would land in the history of whatever produced it, and makes
 *                `echo secret | tool` the obvious usage — which is the failure
 *                mode the whole rule exists to prevent
 *   a file       persists the secret at rest, in a repository or beside one
 *
 * So the ONLY accepted source is `/dev/tty`, opened directly rather than reading
 * `process.stdin`. Opening the controlling terminal explicitly means the read
 * cannot be satisfied by a redirect: `tool < secrets.txt` does not reach
 * `/dev/tty`, and in a pipeline with no terminal the open fails and the tool
 * refuses. A refusal is the correct outcome there — it is what stops this from
 * being automatable into a CI job that stores a password somewhere.
 *
 * NOTHING DERIVED FROM THE PASSWORD IS EVER LOGGED. Not the plaintext, not the
 * bcrypt hash, not a length, not a prefix, not a checksum. The only thing that
 * leaves this module is the string itself, to the caller, in memory.
 */
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readSync } from "node:fs";
import { registerSchema } from "@/lib/validation";

export type PasswordIntake =
  | { readonly ok: true; readonly password: string }
  | { readonly ok: false; readonly reason: "no_tty" | "empty" | "mismatch" | "policy"; readonly issues?: readonly string[] };

/**
 * Validate against the PLATFORM'S OWN registration policy rather than restating
 * its rules here. A password this accepts is one the product would accept, and
 * it stays correct when that policy changes.
 */
export function validateAgainstProductPolicy(password: string): readonly string[] {
  const parsed = registerSchema.safeParse({
    email: "policy-probe@learner-ops.invalid",
    password,
    name: "Policy Probe",
  });
  if (parsed.success) return [];
  return parsed.error.issues
    .filter((issue) => issue.path[0] === "password")
    .map((issue) => issue.message);
}

/** Read one line from the controlling terminal with echo disabled. */
function readLineFromTty(prompt: string): string | null {
  let fd: number;
  try {
    fd = openSync("/dev/tty", "r+");
  } catch {
    // No controlling terminal. Refuse rather than silently falling back to a
    // source the rule above forbids.
    return null;
  }

  try {
    // Disable echo for the duration of the read, then restore it. `stty` is
    // pointed at the SAME descriptor, so this cannot affect another terminal.
    const stty = (args: readonly string[]) => {
      try {
        execFileSync("stty", args as string[], { stdio: [fd, "ignore", "ignore"] });
      } catch {
        /* a terminal that cannot toggle echo still reads — see the notice below */
      }
    };

    process.stderr.write(prompt);
    stty(["-echo"]);
    try {
      const buffer = Buffer.alloc(1);
      const chars: string[] = [];
      for (;;) {
        const read = readSync(fd, buffer, 0, 1, null);
        if (read === 0) break;
        const char = buffer.toString("utf8");
        if (char === "\n" || char === "\r") break;
        // Backspace handling, so a mistyped character can be corrected.
        if (char === "" || char === "\b") {
          chars.pop();
          continue;
        }
        chars.push(char);
      }
      return chars.join("");
    } finally {
      stty(["echo"]);
      process.stderr.write("\n");
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * Prompt twice and require the two entries to match, so a typo becomes a
 * refusal rather than a principal nobody can log in as.
 */
export function intakeFixturePassword(label: string): PasswordIntake {
  const first = readLineFromTty(`  password for ${label} (input hidden): `);
  if (first === null) {
    return { ok: false, reason: "no_tty" };
  }
  if (first.length === 0) {
    return { ok: false, reason: "empty" };
  }

  const second = readLineFromTty(`  repeat password for ${label}: `);
  if (second === null) return { ok: false, reason: "no_tty" };
  if (first !== second) return { ok: false, reason: "mismatch" };

  const issues = validateAgainstProductPolicy(first);
  if (issues.length > 0) return { ok: false, reason: "policy", issues };

  return { ok: true, password: first };
}

/** True when a controlling terminal exists at all. Used for the preflight. */
export function hasControllingTty(): boolean {
  try {
    const fd = openSync("/dev/tty", "r+");
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}
