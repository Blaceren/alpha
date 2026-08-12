/**
 * QAOPS-1 — secure intake of the synthetic operator's password.
 *
 * THE RULES, AND WHERE EACH IS ENFORCED
 *   supplied at execution time ... env var or stdin, below
 *   never hardcoded ............. there is no default anywhere in this file
 *   never committed ............. nothing writes it to disk
 *   never printed ............... it is returned, never logged; the CLI's only
 *                                 output about it is a boolean
 *   never in audit artifacts .... the provisioner records no password field
 *   fail closed ................. `{ kind: "absent" }` when neither source
 *                                 supplied one, and the caller exits non-zero
 *
 * TWO SOURCES, IN ORDER
 *   1. `ATA_QA_OPERATOR_PASSWORD`
 *   2. stdin, when stdin is not a TTY (`… | preprodQaOperator provision`)
 *
 * stdin is offered because an environment variable is visible in `/proc` and in
 * a shell's history, and a pipe is not. An interactive TTY is deliberately NOT
 * read: this tool never prompts, so it can never hang a deployment script
 * waiting for a keystroke nobody is there to press.
 */
import { registerSchema } from "@/lib/validation";
import { QA_OPERATOR_EMAIL } from "./identity";

export const QA_OPERATOR_PASSWORD_KEY = "ATA_QA_OPERATOR_PASSWORD";

export type PasswordIntake =
  | { readonly kind: "supplied"; readonly password: string; readonly source: "env" | "stdin" }
  | { readonly kind: "absent" }
  /** Supplied, but not a password the product's own registration would accept. */
  | { readonly kind: "rejected"; readonly issues: readonly string[] };

/**
 * Read stdin to completion, or return null when stdin is a TTY.
 *
 * Exactly ONE trailing newline is stripped (with an optional carriage return),
 * because `printf '%s\n'` and a here-string both add one and neither means the
 * password ends in a newline. Nothing else is trimmed: a password may legally
 * begin or end with a space, and silently discarding one would provision an
 * account whose password is not the one the operator supplied.
 */
export async function readPasswordFromStdin(
  stdin: NodeJS.ReadStream = process.stdin,
): Promise<string | null> {
  if (stdin.isTTY) return null;

  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw === "") return null;
  return raw.replace(/\r?\n$/, "");
}

/**
 * Validate against the PRODUCT'S OWN policy by parsing the shipped
 * `registerSchema`, rather than restating its rules here.
 *
 * That schema is what `POST /api/auth/register` applies, so a password this
 * accepts is one the platform would have accepted for a real account, and a
 * future change to the policy reaches this tool without anyone remembering to
 * update it. The reserved address is passed in as the email because the schema
 * validates the pair; `name` and `referralCode` are optional and omitted.
 *
 * The parsed value is discarded. Only the issue list is returned, and the
 * schema's messages name the RULE that failed and never quote the input.
 */
export function validateOperatorPassword(password: string): readonly string[] {
  const parsed = registerSchema.safeParse({ email: QA_OPERATOR_EMAIL, password });
  if (parsed.success) return [];
  return parsed.error.issues
    .filter((issue) => issue.path[0] === "password")
    .map((issue) => issue.message);
}

/**
 * Resolve the password from the environment or stdin, then check it.
 *
 * Returns `absent` when neither source supplied one — the caller must treat that
 * as a refusal, never as "use a default", because there is no default.
 */
export async function intakeOperatorPassword(
  env: NodeJS.ProcessEnv = process.env,
  stdin: NodeJS.ReadStream = process.stdin,
): Promise<PasswordIntake> {
  const fromEnv = env[QA_OPERATOR_PASSWORD_KEY];
  let password: string | null = fromEnv !== undefined && fromEnv !== "" ? fromEnv : null;
  let source: "env" | "stdin" = "env";

  if (password === null) {
    password = await readPasswordFromStdin(stdin);
    source = "stdin";
  }

  if (password === null || password === "") return { kind: "absent" };

  const issues = validateOperatorPassword(password);
  if (issues.length > 0) return { kind: "rejected", issues };

  return { kind: "supplied", password, source };
}
