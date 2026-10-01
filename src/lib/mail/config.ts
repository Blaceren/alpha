/**
 * MAIL — whether this deployment can send email, and through what.
 *
 * THE PRODUCT SENT NO EMAIL BEFORE THIS FILE. Email verification issued a token
 * nobody received, and there was no password recovery at all. The owner's
 * decision (2026-10-01): build the foundation now, connect the real channel on
 * PROD. So the default — and the state of every deployment that says nothing —
 * is DISABLED, and a disabled deployment does not pretend: the capability
 * endpoint answers `false`, the Academy shows no «Забыли пароль?», and no route
 * here creates a link that nobody could receive.
 *
 * WHAT "CONFIGURED" REQUIRES, all of it or none:
 *   - `MAIL_TRANSPORT` names a transport this build knows;
 *   - `MAIL_FROM` is a sender, `Name <address>` or a bare address;
 *   - `PUBLIC_APP_URL` resolves, because every message carries a link and a
 *     link built from an internal origin is useless to the person who got it.
 * Half of that is not "mostly working", it is INVALID, and runtime validation
 * refuses to boot on it — the same direction of failure as CAPTCHA.
 *
 * THE TRANSPORTS. `outbox` writes each message to a file in a directory and
 * sends nothing: it exists so the flows can be driven end to end on a
 * developer's machine and in tests, and it is refused outside
 * `ATA_ENVIRONMENT=dev` so that a stand reachable by real people can never be
 * told to drop their password links into a folder. The real provider (SES or
 * SMTP) is added to `MAIL_TRANSPORTS` when PROD is connected; nothing else in
 * the flows changes.
 *
 * Exact match only, like `ATA_ENVIRONMENT` and `CAPTCHA_PROVIDER`: no trimming,
 * no case folding. A misspelled transport is an error, not a quiet "disabled".
 */
import { isAbsolute } from "node:path";
import { isDevEnvironment } from "@/lib/environment";
import { publicAppOrigin } from "@/lib/publicUrl";

export const MAIL_TRANSPORT_KEY = "MAIL_TRANSPORT";
export const MAIL_FROM_KEY = "MAIL_FROM";
export const MAIL_OUTBOX_DIR_KEY = "MAIL_OUTBOX_DIR";

export const MAIL_TRANSPORT_OUTBOX = "outbox" as const;
/** Every transport this build can run. The PROD provider is added here. */
export const MAIL_TRANSPORTS = [MAIL_TRANSPORT_OUTBOX] as const;
export type MailTransportName = (typeof MAIL_TRANSPORTS)[number];

export type MailConfigReason =
  /** `MAIL_TRANSPORT` is set, but to a name this build does not know. */
  | "transport_unrecognised"
  /** A transport is named and `MAIL_FROM` is not set. */
  | "from_absent"
  /** `MAIL_FROM` is neither `Name <address>` nor a bare address. */
  | "from_malformed"
  /** A transport is named and there is no public origin to build links from. */
  | "public_origin_absent"
  /** The file transport was named outside an `ATA_ENVIRONMENT=dev` deployment. */
  | "outbox_outside_dev"
  /** The file transport was named without its directory. */
  | "outbox_dir_absent"
  /** The directory is not an absolute path. */
  | "outbox_dir_not_absolute";

export type MailConfig = {
  readonly transport: MailTransportName;
  /** The header value, e.g. `Alfa Trade Academy <no-reply@alfatrade.media>`. */
  readonly from: string;
  /** The address inside `from`. */
  readonly fromAddress: string;
  /** The learner-facing origin every link is built from. */
  readonly origin: string;
  /** Set for the file transport only. */
  readonly outboxDir: string | null;
};

export type MailConfigResolution =
  | { readonly kind: "disabled" }
  | { readonly kind: "configured"; readonly config: MailConfig }
  | { readonly kind: "invalid"; readonly reason: MailConfigReason };

const MAIL_CONFIG_REASON_TEXT: Record<MailConfigReason, string> = {
  transport_unrecognised: `${MAIL_TRANSPORT_KEY} is not a transport this build knows`,
  from_absent: `${MAIL_FROM_KEY} is required when ${MAIL_TRANSPORT_KEY} is set`,
  from_malformed: `${MAIL_FROM_KEY} must be "Name <address>" or a bare address`,
  public_origin_absent: `PUBLIC_APP_URL is required when ${MAIL_TRANSPORT_KEY} is set: every message carries a link`,
  outbox_outside_dev: `${MAIL_TRANSPORT_KEY}=outbox requires ATA_ENVIRONMENT=dev`,
  outbox_dir_absent: `${MAIL_OUTBOX_DIR_KEY} is required when ${MAIL_TRANSPORT_KEY}=outbox`,
  outbox_dir_not_absolute: `${MAIL_OUTBOX_DIR_KEY} must be an absolute path`,
};

/** A bounded, value-free description for the runtime check. */
export function describeMailConfigRejection(reason: MailConfigReason): string {
  return MAIL_CONFIG_REASON_TEXT[reason];
}

/** One address: something, an at sign, a dotted host. No spaces, no brackets. */
const ADDRESS_PATTERN = /^[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+$/;
/** `Display name <address>`; the name may not contain brackets, quotes or line breaks. */
const NAMED_FROM_PATTERN = /^([^<>"\r\n]{1,80}) <([^<>\s]+)>$/;

/** The address inside a `MAIL_FROM` value, or null when the value is not a sender. */
export function parseMailFrom(raw: string): { from: string; address: string } | null {
  if (raw.length === 0 || raw.length > 200 || /[\r\n]/.test(raw)) return null;
  if (ADDRESS_PATTERN.test(raw)) return { from: raw, address: raw };
  const named = NAMED_FROM_PATTERN.exec(raw);
  if (named && named[1]!.trim() === named[1] && ADDRESS_PATTERN.test(named[2]!)) {
    return { from: raw, address: named[2]! };
  }
  return null;
}

function isTransportName(value: string): value is MailTransportName {
  return (MAIL_TRANSPORTS as readonly string[]).includes(value);
}

export function resolveMailConfig(env: NodeJS.ProcessEnv = process.env): MailConfigResolution {
  const transport = env[MAIL_TRANSPORT_KEY];
  if (transport === undefined || transport === "") return { kind: "disabled" };
  if (!isTransportName(transport)) return { kind: "invalid", reason: "transport_unrecognised" };

  const rawFrom = env[MAIL_FROM_KEY];
  if (rawFrom === undefined || rawFrom === "") return { kind: "invalid", reason: "from_absent" };
  const sender = parseMailFrom(rawFrom);
  if (!sender) return { kind: "invalid", reason: "from_malformed" };

  const origin = publicAppOrigin(env);
  if (!origin) return { kind: "invalid", reason: "public_origin_absent" };

  let outboxDir: string | null = null;
  if (transport === MAIL_TRANSPORT_OUTBOX) {
    if (!isDevEnvironment(env)) return { kind: "invalid", reason: "outbox_outside_dev" };
    const dir = env[MAIL_OUTBOX_DIR_KEY];
    if (dir === undefined || dir === "") return { kind: "invalid", reason: "outbox_dir_absent" };
    if (!isAbsolute(dir)) return { kind: "invalid", reason: "outbox_dir_not_absolute" };
    outboxDir = dir;
  }

  return {
    kind: "configured",
    config: { transport, from: sender.from, fromAddress: sender.address, origin, outboxDir },
  };
}

/** Can this deployment deliver a message? Invalid configuration is NOT enabled. */
export function isMailEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveMailConfig(env).kind === "configured";
}
