/**
 * MAIL — the six messages, in the product's voice.
 *
 * Each template is a pure function of its facts and returns a subject, a plain
 * text body and an HTML body that say the same thing. The plain text is the
 * message; the HTML is the same message with a button. Nothing here knows how a
 * message is delivered.
 *
 * WHAT A MESSAGE NEVER CARRIES: a password, the old password's existence, the
 * learner's level or progress, a sum of money, the name of the trading
 * environment, or a staff member's name. A message about an account says what
 * happened to the account and what to do if it was not you, and stops.
 *
 * Interface language: Russian first (CLAUDE.md); a Polish set is a second
 * dictionary later, which is why the strings live here and not in the routes.
 */
import type { MailKind, MailMessage } from "@/lib/mail/transport";

const PRODUCT = "Alfa Trade Academy";

/** Text placed inside HTML. Links are built by this application, names are not. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `iv***@example.com`: enough to recognise an address, not enough to copy it. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const visible = local.slice(0, Math.min(2, Math.max(1, local.length - 1)));
  return `${visible}***${email.slice(at)}`;
}

type Body = { greeting: string; lines: string[]; action?: { label: string; link: string }; after?: string[] };

function compose(kind: MailKind, to: string, subject: string, body: Body): MailMessage {
  const textParts = [body.greeting, "", ...body.lines];
  if (body.action) textParts.push("", `${body.action.label}:`, body.action.link);
  if (body.after?.length) textParts.push("", ...body.after);
  textParts.push("", `— ${PRODUCT}`);

  const paragraph = (line: string) =>
    `<p style="margin:0 0 14px;font:400 16px/1.55 Arial,Helvetica,sans-serif;color:#1c2117">${escapeHtml(line)}</p>`;
  const button = body.action
    ? `<p style="margin:22px 0"><a href="${escapeHtml(body.action.link)}" style="display:inline-block;padding:13px 22px;border-radius:8px;background:#c7f76d;color:#11140f;font:600 16px/1 Arial,Helvetica,sans-serif;text-decoration:none">${escapeHtml(body.action.label)}</a></p>` +
      `<p style="margin:0 0 14px;font:400 13px/1.5 Arial,Helvetica,sans-serif;color:#5e665c">Если кнопка не открывается, скопируйте ссылку в адресную строку:<br><span style="word-break:break-all">${escapeHtml(body.action.link)}</span></p>`
    : "";
  const html =
    `<!doctype html><html lang="ru"><body style="margin:0;padding:24px;background:#f3f4ee">` +
    `<div style="max-width:520px;margin:0 auto;padding:28px;border-radius:12px;background:#ffffff">` +
    `<p style="margin:0 0 18px;font:600 13px/1.4 Arial,Helvetica,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#5e665c">${PRODUCT}</p>` +
    paragraph(body.greeting) +
    body.lines.map(paragraph).join("") +
    button +
    (body.after ?? []).map(paragraph).join("") +
    `</div></body></html>`;

  return { kind, to, subject, text: textParts.join("\n"), html };
}

function greeting(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? `Здравствуйте, ${trimmed}!` : "Здравствуйте!";
}

export function verifyEmailMessage(input: { to: string; name?: string | null; link: string }): MailMessage {
  return compose("verify_email", input.to, `Подтвердите почту — ${PRODUCT}`, {
    greeting: greeting(input.name),
    lines: ["Подтвердите этот адрес, чтобы на него приходили письма о вашем аккаунте: сброс пароля и изменения почты."],
    action: { label: "Подтвердить почту", link: input.link },
    after: ["Ссылка действует 24 часа. Если вы не регистрировались в Академии, ничего делать не нужно."],
  });
}

export function passwordResetMessage(input: { to: string; name?: string | null; link: string; minutes: number }): MailMessage {
  return compose("password_reset", input.to, `Сброс пароля — ${PRODUCT}`, {
    greeting: greeting(input.name),
    lines: ["Мы получили запрос на сброс пароля для вашего аккаунта."],
    action: { label: "Задать новый пароль", link: input.link },
    after: [
      `Ссылка действует ${input.minutes} минут и срабатывает один раз.`,
      "Если вы не запрашивали сброс, ничего делать не нужно: пароль останется прежним.",
    ],
  });
}

export function passwordChangedMessage(input: { to: string; name?: string | null }): MailMessage {
  return compose("password_changed", input.to, `Пароль изменён — ${PRODUCT}`, {
    greeting: greeting(input.name),
    lines: [
      "Пароль вашего аккаунта изменён. Все прежние сеансы завершены.",
      "Если это сделали не вы, сбросьте пароль на странице входа и напишите в поддержку Академии.",
    ],
  });
}

export function emailChangeConfirmMessage(input: { to: string; name?: string | null; link: string }): MailMessage {
  return compose("email_change_confirm", input.to, `Подтвердите новый адрес — ${PRODUCT}`, {
    greeting: greeting(input.name),
    lines: ["Этот адрес указан как новая почта аккаунта в Академии. Подтвердите его, чтобы изменение вступило в силу."],
    action: { label: "Подтвердить новый адрес", link: input.link },
    after: ["Ссылка действует 24 часа. Пока адрес не подтверждён, вход остаётся по прежней почте. Если вы не меняли почту, ничего делать не нужно."],
  });
}

export function emailChangeNoticeMessage(input: { to: string; name?: string | null; newEmail: string }): MailMessage {
  return compose("email_change_notice", input.to, `Запрос на смену почты — ${PRODUCT}`, {
    greeting: greeting(input.name),
    lines: [
      `Для вашего аккаунта запрошена смена почты на ${maskEmail(input.newEmail)}. Изменение вступит в силу после подтверждения нового адреса.`,
      "Если это сделали не вы, отмените смену в профиле, смените пароль и напишите в поддержку Академии.",
    ],
  });
}

export function emailChangedMessage(input: { to: string; name?: string | null; newEmail: string }): MailMessage {
  return compose("email_changed", input.to, `Почта аккаунта изменена — ${PRODUCT}`, {
    greeting: greeting(input.name),
    lines: [
      `Почта вашего аккаунта изменена на ${maskEmail(input.newEmail)}. Вход теперь выполняется по новому адресу.`,
      "Если это сделали не вы, напишите в поддержку Академии.",
    ],
  });
}
