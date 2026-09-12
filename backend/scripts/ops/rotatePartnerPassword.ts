/**
 * AFFILIATE-PLATFORM-V1 — set a PARTNER PRINCIPAL's password, interactively,
 * with the operator typing it and nobody else ever holding it.
 *
 * WHY THIS EXISTS. The browser gate needs a human to sign in as the two
 * synthetic partner principals. Every other way of getting them a password puts
 * the password somewhere it must not be:
 *
 *   * generating one and printing it   -> it lands in a transcript, a scrollback
 *                                         buffer and an audit package;
 *   * passing it as an argument        -> it lands in argv, which is world-
 *                                         readable in /proc, and in shell
 *                                         history;
 *   * piping it in                     -> it lands in whatever produced the pipe;
 *   * an env var                       -> it lands in the environment of every
 *                                         child process.
 *
 * So the password is read from THE TERMINAL, with echo off, and it exists in
 * this process's memory for exactly as long as it takes to hash it.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT REFUSES TO DO, BY CONSTRUCTION
 *
 *   * IT TOUCHES ONLY `AffiliatePartnerUser`. There is no code path here to a
 *     `User`, a `StaffProfile`, an htpasswd file or any CRM credential. It
 *     cannot rotate a staff or Basic Auth secret because it cannot address one.
 *   * IT TAKES NO PASSWORD FROM argv, stdin-as-a-pipe, or the environment. If
 *     `/dev/tty` is not a terminal it REFUSES rather than falling back — a
 *     fallback would reintroduce every leak listed above.
 *   * IT NEVER PRINTS, LOGS OR AUDITS THE VALUE. The audit row records that a
 *     rotation happened, the principal's public id and the new session epoch.
 *   * IT REQUIRES THE PASSWORD TWICE and compares them, so a mistyped password
 *     locks nobody out of a principal they cannot then reach.
 *
 * IT IS GUARDED LIKE EVERY OTHER OPS COMMAND HERE: positive `staging`
 * classification, an environment the application itself would boot on, and an
 * exact acknowledgement sentinel. A production checkout plus knowledge of this
 * command's name writes nothing.
 *
 * ROTATION BUMPS THE SESSION EPOCH, so every token issued to that principal
 * before this moment stops verifying on its next request. That is the same
 * behaviour the partner's own password change has, and it is what makes
 * "rotate" mean something immediately.
 */
import fs from "node:fs";
import tty from "node:tty";
import { PrismaClient } from "@prisma/client";
import { checkPreprodEnvironment } from "./preprod-qa-operator/guard";
import { validateRuntimeEnv } from "../../src/lib/env";
import {
  changePartnerPassword,
  describePartnerPasswordRejection,
  hashPartnerPassword,
  normalisePartnerEmail,
  PARTNER_PASSWORD_MIN_LENGTH,
} from "../../src/lib/affiliate/partner/credential";

const CONFIRM_KEY = "ATA_PARTNER_PASSWORD_CONFIRM";
const CONFIRM_VALUE = "ROTATE_PREPROD_PARTNER_PRINCIPAL_PASSWORD";

/**
 * The ONLY principals this command will address.
 *
 * AN ALLOWLIST, NOT A PARAMETER. A `--email` flag would make this a partner
 * user-management CLI, and the first time somebody needed one for a real
 * partner it would be reached for. These two addresses are the synthetic
 * acceptance principals under `.invalid`, which RFC 2606 reserves and which can
 * never be a real mailbox.
 */
const ROTATABLE = new Set(["acceptance-a@partners.invalid", "acceptance-b@partners.invalid"]);

/**
 * Read a line from the TERMINAL with echo disabled.
 *
 * IT OPENS `/dev/tty` DIRECTLY rather than reading `process.stdin`, so a piped
 * or redirected stdin cannot supply the value — the point is that the human at
 * the keyboard types it and no file, history entry or process ever holds it.
 */
function readSecretFromTty(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let fd: number;
    try {
      fd = fs.openSync("/dev/tty", "r");
    } catch {
      reject(new Error("no controlling terminal — refusing to read a password from anywhere else"));
      return;
    }
    if (!tty.isatty(fd)) {
      fs.closeSync(fd);
      reject(new Error("/dev/tty is not a terminal — refusing"));
      return;
    }

    const input = new tty.ReadStream(fd);
    process.stderr.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");

    let value = "";
    const finish = (error: Error | null) => {
      input.setRawMode(false);
      input.pause();
      try {
        input.destroy();
      } catch {
        /* the stream is already gone */
      }
      try {
        fs.closeSync(fd);
      } catch {
        /* likewise */
      }
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(value);
    };

    input.on("data", (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          finish(null);
          return;
        }
        // Ctrl-C and Ctrl-D abandon the rotation without writing anything.
        if (ch === "\u0003" || ch === "\u0004") {
          finish(new Error("aborted at the prompt"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        // NOTHING IS ECHOED. Not the character, not a masking asterisk — a
        // count of characters is itself information, and a terminal recording
        // would carry it.
        value += ch;
      }
    });
    input.on("error", (error) => finish(error as Error));
  });
}

async function main(argv: readonly string[]): Promise<number> {
  const email = normalisePartnerEmail(argv[0] ?? "");
  const env = process.env;

  if (!ROTATABLE.has(email)) {
    console.error(
      `REFUSED: this command addresses only the synthetic acceptance principals:\n  ${[...ROTATABLE].join("\n  ")}`,
    );
    return 2;
  }

  const guard = checkPreprodEnvironment(env);
  if (guard.kind === "refused") {
    console.error(`REFUSED: ${guard.reason} — ${guard.detail}`);
    return 2;
  }
  if (!validateRuntimeEnv(env).ok) {
    console.error("REFUSED: this environment is not one the application would boot on");
    return 2;
  }
  if (env[CONFIRM_KEY] !== CONFIRM_VALUE) {
    console.error(`REFUSED: ${CONFIRM_KEY}=${CONFIRM_VALUE} is required`);
    return 2;
  }

  const prisma = new PrismaClient();
  try {
    const principal = await prisma.affiliatePartnerUser.findUnique({
      where: { email },
      select: { id: true, publicId: true, affiliatePartnerId: true, status: true },
    });
    if (principal === null) {
      console.error(`REFUSED: no partner principal exists for ${email}`);
      return 2;
    }

    process.stderr.write(
      `Rotating the password for the SYNTHETIC partner principal ${email}\n` +
        `Policy: at least ${PARTNER_PASSWORD_MIN_LENGTH} characters, at least 8 distinct,\n` +
        `and it must not contain the address's local part.\n` +
        `Nothing you type is echoed, stored in history, or shown to anyone.\n\n`,
    );

    const first = await readSecretFromTty("New password: ");
    const second = await readSecretFromTty("Repeat it:    ");

    if (first !== second) {
      console.error("REFUSED: the two entries differ — nothing was changed");
      return 3;
    }

    // THE SOURCE-OWNED POLICY, not a second copy of it. The same function the
    // partner's own password-change route calls.
    const rejection = describePartnerPasswordRejection(first, email);
    if (rejection !== null) {
      console.error(`REFUSED: password ${rejection} — nothing was changed`);
      return 3;
    }

    // …and the source-owned hasher, so cost and construction cannot drift from
    // the credential the login path verifies.
    const passwordHash = await hashPartnerPassword(first);
    const sessionEpoch = await changePartnerPassword(prisma, {
      partnerUserId: principal.id,
      newPasswordHash: passwordHash,
      now: new Date(),
    });

    // The FACT of the rotation, never the value and never the digest.
    await prisma.auditLog.create({
      data: {
        action: "AFFILIATE_PARTNER_PASSWORD_ROTATED_BY_OPERATOR",
        entityType: "AFFILIATE_PARTNER_USER",
        entityId: principal.publicId,
        metadata: {
          affiliatePartnerId: principal.affiliatePartnerId,
          sessionEpoch,
          reason: "preprod_browser_acceptance_gate",
        },
      },
    });

    process.stderr.write(
      `\nDone. ${email} now has the password you typed.\n` +
        `Every session issued to this principal before now has been invalidated ` +
        `(session epoch ${sessionEpoch}).\n`,
    );
    console.log(
      JSON.stringify({ email, partnerUserPublicId: principal.publicId, sessionEpoch }, null, 2),
    );
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error) => {
    // A BOUNDED MESSAGE. An exception's text must never be able to carry the
    // value that was being typed when it was thrown.
    console.error(`partner password rotation failed: ${(error as Error).message.slice(0, 160)}`);
    process.exit(1);
  });
