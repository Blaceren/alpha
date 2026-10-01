# ACCOUNT RECOVERY V1 — password reset, address confirmation, address change

Owner, 2026-10-01: «сделаем функционал для пользователей: сброс пароля /
восстановление пароля, подтверждение и смена почты» — for learners; the mail
channel is connected on PROD, this is the foundation; confirmation is soft.

## What exists

| | |
|---|---|
| Mail layer | `src/lib/mail/` — configuration, transport interface, six templates, `sendMail` |
| One-time links | `AccountActionToken` (migration `20261001120000_account_action_token`, additive) for reset and address change; `EmailVerificationToken` (unchanged) for confirmation |
| Flows | `src/lib/account/` — `passwordReset.ts`, `emailChange.ts`, `lifecycle.ts` (what one change does to the links of the others), `tokens.ts`, `links.ts`, `capabilities.ts`, `background.ts` |
| Routes | below |
| Tests | `src/lib/account-recovery-http.test.ts` — 40 cases over real route handlers and a throwaway database |

### Routes

| Route | Who | What |
|---|---|---|
| `GET /api/auth/capabilities` | anyone | `{ passwordRecovery, emailVerification, emailChange }` — true only where mail can be sent |
| `POST /api/auth/password-reset/request` | anyone, challenge always on (surface `academy_password_reset`) | always `{ ok: true }`; a live account is sent a link |
| `POST /api/auth/password-reset/confirm` | holder of a link | sets the password, closes every session, confirms the address |
| `POST /api/auth/verify-email` | holder of a link | confirms the address (existing route) |
| `POST /api/auth/resend-verification` | signed in, CSRF | sends the confirmation message again |
| `POST /api/me/email-change` | signed in, CSRF, current password | records the pending address, mails the new and the old address |
| `POST /api/me/email-change/cancel` | signed in, CSRF | forgets the pending address, kills its link |
| `POST /api/auth/email-change/confirm` | holder of a link | the pending address becomes the address |
| `GET /api/me/account` | signed in | the address, whether it is confirmed, the address waiting to replace it, and the capabilities |
| `POST /api/auth/change-password` (existing) | signed in, CSRF, current password | now also retires older links and tells the account's address |

`PATCH /api/me` no longer accepts `email`: it wrote `pendingEmail` for anyone
holding a session, with no password and nothing that ever resolved it.

## Properties the tests hold

- **A deployment that cannot send mail offers nothing.** Capabilities are false,
  the reset request answers 503, a change cannot be requested, resend answers
  503. No token is created that nobody could receive.
- **The reset request does not reveal whether an address has an account**: one
  answer, and the lookup, token and message run detached so the response time
  does not differ either.
- **A mailbox cannot be flooded**: three reset messages per account per hour,
  five requests per network address per quarter hour.
- **A link works once, the newest only**, for 60 minutes (reset) or 24 hours
  (address). The database holds its SHA-256, never the token.
- **The token rides in the URL fragment** (`…/reset-password#token=…`), so it
  reaches no access log and no Referer. The page posts it in a body.
- **A reset closes every session and opens none.**
- **An address changes only when the new mailbox answers**, takes the current
  password to request, and the old address is told at the request and at the
  change, with the new address masked.
- **The audit names the kind of message**, never an address, a link or a token.

### Across the flows (`src/lib/account/lifecycle.ts`)

Every link is a way to act on the account for whoever reads that mailbox, so the
flows were walked against each other. Each rule runs inside the transaction that
makes the change.

- **A pending change of address does not survive a change of password** — reset
  by link or changed in the profile. The case it closes: someone who has the
  password asks for the account to move to their mailbox; the link sits there
  for a day and needs no session. The owner, told at the old address, changes
  the password — and that alone stops the change. The notice says exactly this.
- **A reset link does not survive a change of address or a change of password
  in the profile.** A link mailed to the address the account had an hour ago
  cannot set the password once the account has moved.
- **A confirmation link mailed to the old address is spent when the address
  changes.**
- **A pending address is held only while its link can be opened** (24 hours).
  After that reads report no pending address and another account may ask for
  it. This also retires the `pendingEmail` values the old `PATCH /api/me` left
  behind: they have no request time, so they are not pending.
- **Every change of password is told to the account's address** — after a reset
  and after a change in the profile — where mail can be sent.

## Configuration

| Variable | Meaning |
|---|---|
| `MAIL_TRANSPORT` | absent = disabled. `outbox` = files, `ATA_ENVIRONMENT=dev` only. |
| `MAIL_FROM` | `Name <address>` or a bare address. Required with a transport. |
| `MAIL_OUTBOX_DIR` | absolute directory for `outbox`. |
| `PUBLIC_APP_URL` | the origin every link is built from. Required with a transport. |

Half-configured mail is a startup error (`validateRuntimeEnv`), like CAPTCHA.
PREPROD sets none of these: nothing is offered there, and nothing changed for
its learners.

## Connecting the channel on PROD

1. Choose the provider (Amazon SES is the natural one on AWS; SMTP relay of the
   domain's mail works too). The owner supplies credentials through the env
   file, never through chat.
2. Add one `MailTransport` implementation in `src/lib/mail/transport.ts`, its
   name in `MAIL_TRANSPORTS` and its settings in `resolveMailConfig`. Nothing in
   `src/lib/account/` or the routes changes.
3. DNS for the sender's domain: DKIM (and SPF/custom MAIL FROM if the provider
   needs them). The domain's MX, SPF and DKIM for the existing mailboxes belong
   to the workspace mail and are not replaced — records are added beside them.
4. Set `MAIL_TRANSPORT`, `MAIL_FROM`, keep `PUBLIC_APP_URL=https://alfatrade.media`.
5. Verify with a real mailbox on PROD: register → confirmation arrives; forgot
   password → link → new password → old session is gone; change address →
   both mailboxes receive their message → link → sign in with the new address.

## Not in this version

Staff (CRM) and partner accounts — their passwords are still managed by an
administrator. A Polish set of messages. Making confirmation mandatory
(`EMAIL_VERIFICATION_REQUIRED` exists and is unchanged; with a channel
connected it can be turned on, but existing learners would have to confirm
before their next sign-in).

**Undoing a completed change of address from the old mailbox.** If someone who
has the password requests a change AND confirms it before the owner reacts, the
account is on their mailbox and the owner's only path is support. A "return the
address" link in the message to the old mailbox would close that — and would
also let whoever reads the OLD mailbox pull the account back for as long as the
link lives, which is the wrong direction when the address was changed because
the old mailbox was lost. It is a product decision with a cost either way, so
it is the owner's, and it is open.

## Running it locally

`MAIL_TRANSPORT=outbox` with `ATA_ENVIRONMENT=dev` writes each message as a JSON
file into `MAIL_OUTBOX_DIR`. `PUBLIC_APP_URL` must still be a public https
origin (it is validated as one), so the links in those files name that origin;
to follow one on a local stand, replace the origin with the local Academy's.
