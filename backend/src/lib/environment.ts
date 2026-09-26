/**
 * L4DSP-1 — the authoritative deployment-environment classification.
 *
 * WHY THIS FILE HAD TO EXIST
 * Before this phase the platform had exactly one environment signal, `NODE_ENV`,
 * and in this project it cannot carry the meaning a safety gate needs:
 *
 *   * the DEV runtime does not set `NODE_ENV` at all — it is absent from
 *     `env/backend.env` and from the launched wrapper's environment;
 *   * the DEV runtime starts a PRODUCTION BUILD via `next start`, and Next.js
 *     itself sets `NODE_ENV=production` inside that process.
 *
 * So application code running in DEV observes `NODE_ENV === "production"`. A
 * "refuse when NODE_ENV is production" rule would therefore refuse in DEV — and,
 * far worse, a "permit when NODE_ENV is not production" rule would permit in any
 * real deployment that happened to launch the same way. `NODE_ENV` describes the
 * BUILD, not the DEPLOYMENT, and this file exists to say which deployment we are.
 *
 * THE CONTRACT
 * `ATA_ENVIRONMENT` is an explicit operator declaration with exactly three legal
 * values. Everything else — absent, empty, misspelled, wrongly cased, padded,
 * or contradicted by the rest of the configuration — is `unknown`.
 *
 * FAILING CLOSED IS THE WHOLE POINT
 * Nothing dangerous is unlocked by `unknown`. Only the literal string `dev`
 * unlocks anything, so an operator who forgets to classify a production host has
 * NOT thereby enabled the DEV simulator there: forgetting is the safe direction,
 * which is the opposite of how a `NODE_ENV !== "production"` test behaves.
 */

/** The three deployment classes the platform recognises. */
export type AtaEnvironment = "dev" | "staging" | "production";

export const ATA_ENVIRONMENT_KEY = "ATA_ENVIRONMENT";

export const ATA_ENVIRONMENTS: readonly AtaEnvironment[] = ["dev", "staging", "production"];

/** Why a deployment could not be classified. Never a value, only a shape. */
export type AtaEnvironmentUnknownReason =
  /** `ATA_ENVIRONMENT` is missing or empty. */
  | "absent"
  /** Present but not one of the three legal tokens (case and padding count). */
  | "unrecognised"
  /** Legal, but contradicted by another authoritative part of the configuration. */
  | "ambiguous";

export type AtaEnvironmentClassification =
  | { readonly kind: "classified"; readonly environment: AtaEnvironment }
  | { readonly kind: "unknown"; readonly reason: AtaEnvironmentUnknownReason };

/**
 * Hosts a genuinely local deployment may serve itself on.
 *
 * Kept deliberately small: the contradiction check below must be conservative
 * enough never to misclassify a real DEV box, and specific enough that a
 * public origin cannot sit behind a `dev` declaration unnoticed.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/** Reserved, non-routable TLDs. A host here can never be a real deployment. */
const LOCAL_TLDS = [".localhost", ".local", ".invalid", ".test", ".example"];

function isLocalOrigin(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return true;
  return LOCAL_TLDS.some((tld) => host.endsWith(tld));
}

/**
 * Classify the deployment.
 *
 * The `dev` answer additionally requires that the rest of the configuration does
 * not contradict it. Today that is one independent cross-check: a deployment
 * that serves itself on a PUBLIC origin is not a developer box, whatever the
 * variable claims. This is defence in depth, not the primary control — it means
 * enabling the simulator on a real host requires both an untrue declaration and
 * a loopback-only public URL, rather than one edited line.
 *
 * The check is deliberately one-directional: it can only DEMOTE `dev` to
 * `unknown`. It can never promote `production` or `staging` to `dev`.
 */
export function classifyEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): AtaEnvironmentClassification {
  const raw = env[ATA_ENVIRONMENT_KEY];

  if (raw === undefined || raw === "") {
    return { kind: "unknown", reason: "absent" };
  }
  // Exact match only. `" dev"`, `"Dev"` and `"dev,staging"` are all rejected
  // rather than normalised, because a value someone had to guess the shape of
  // is not a declaration anyone should be able to rely on.
  if (!(ATA_ENVIRONMENTS as readonly string[]).includes(raw)) {
    return { kind: "unknown", reason: "unrecognised" };
  }

  const environment = raw as AtaEnvironment;

  if (environment === "dev") {
    const appUrl = env.APP_URL;
    if (appUrl !== undefined && appUrl !== "" && !isLocalOrigin(appUrl)) {
      return { kind: "unknown", reason: "ambiguous" };
    }
  }

  return { kind: "classified", environment };
}

/**
 * The single question every DEV-only capability must ask.
 *
 * There is no `isNotProduction()` counterpart on purpose: "not production" is
 * the permissive phrasing that lets an unclassified host through, and no
 * capability in this codebase should be gated on it.
 */
export function isDevEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  const classification = classifyEnvironment(env);
  return classification.kind === "classified" && classification.environment === "dev";
}

/** A stable, non-secret label for diagnostics and operator output. */
export function describeEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  const classification = classifyEnvironment(env);
  return classification.kind === "classified"
    ? classification.environment
    : `unknown (${classification.reason})`;
}
