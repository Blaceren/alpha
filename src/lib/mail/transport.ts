/**
 * MAIL — the transport: the one place a message leaves the application.
 *
 * A transport takes a finished message and delivers it, or throws. It knows
 * nothing about accounts, tokens or templates, so swapping the file transport
 * for SES or SMTP on PROD is one new implementation and one new name in
 * `mail/config.ts`.
 *
 * WHAT A TRANSPORT MAY NEVER DO: log the body, the link or the recipient. A
 * message body carries a one-time credential. The only thing that may reach a
 * log or an audit row is the message KIND.
 */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MAIL_TRANSPORT_OUTBOX, type MailConfig } from "@/lib/mail/config";

/** Every message this product sends. A bounded vocabulary, safe to audit. */
export const MAIL_KINDS = [
  "verify_email",
  "password_reset",
  "password_changed",
  "email_change_confirm",
  "email_change_notice",
  "email_changed",
] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

export type MailMessage = {
  readonly kind: MailKind;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

export interface MailTransport {
  readonly name: string;
  send(message: MailMessage, config: MailConfig): Promise<void>;
}

/**
 * The file transport: one JSON file per message, readable only by the owner of
 * the process. DEV and tests only — `mail/config.ts` refuses it elsewhere.
 */
export const outboxTransport: MailTransport = {
  name: MAIL_TRANSPORT_OUTBOX,
  async send(message, config) {
    if (!config.outboxDir) throw new Error("mail: the outbox directory is not configured");
    await mkdir(config.outboxDir, { recursive: true, mode: 0o700 });
    const file = `${Date.now()}-${message.kind}-${randomBytes(6).toString("hex")}.json`;
    const body = JSON.stringify(
      {
        kind: message.kind,
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    );
    await writeFile(join(config.outboxDir, file), body, { mode: 0o600, flag: "wx" });
  },
};

let testTransport: MailTransport | null = null;

/** Test seam. Never called by product code. */
export function setMailTransportForTests(transport: MailTransport | null): void {
  testTransport = transport;
}

export function resolveMailTransport(config: MailConfig): MailTransport {
  if (testTransport) return testTransport;
  switch (config.transport) {
    case MAIL_TRANSPORT_OUTBOX:
      return outboxTransport;
  }
}
