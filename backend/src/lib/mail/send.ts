/**
 * MAIL — sending one message, and what a failure may say.
 *
 * A delivery failure is not the caller's error to show: the routes that send
 * mail answer the same way whether a message left or not, because the answer
 * must not reveal whether an address has an account. So `sendMail` never
 * throws. It returns what happened, and writes an audit row that names the KIND
 * of message and nothing else — never the recipient, the subject or the body.
 */
import { createAuditLog } from "@/lib/audit";
import { resolveMailConfig } from "@/lib/mail/config";
import { resolveMailTransport, type MailMessage } from "@/lib/mail/transport";

export type MailSendResult =
  | { readonly sent: true }
  | { readonly sent: false; readonly reason: "disabled" | "invalid_config" | "transport_failed" };

export async function sendMail(
  message: MailMessage,
  options: { userId?: number | null; env?: NodeJS.ProcessEnv } = {},
): Promise<MailSendResult> {
  const resolution = resolveMailConfig(options.env ?? process.env);
  if (resolution.kind === "disabled") return { sent: false, reason: "disabled" };
  if (resolution.kind === "invalid") return { sent: false, reason: "invalid_config" };

  try {
    await resolveMailTransport(resolution.config).send(message, resolution.config);
    await createAuditLog({
      userId: options.userId ?? null,
      action: "MAIL_SENT",
      entityType: "Mail",
      metadata: { kind: message.kind, transport: resolution.config.transport },
    });
    return { sent: true };
  } catch {
    // The error is deliberately not logged: a transport error message can quote
    // the recipient or the provider's response. The kind is enough to act on.
    await createAuditLog({
      userId: options.userId ?? null,
      action: "MAIL_SEND_FAILED",
      entityType: "Mail",
      metadata: { kind: message.kind, transport: resolution.config.transport },
    });
    return { sent: false, reason: "transport_failed" };
  }
}
