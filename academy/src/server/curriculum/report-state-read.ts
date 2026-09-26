/**
 * The canonical REPORT STATE, read server-side for the return-after-pause
 * answer (§16).
 *
 * THE PROBLEM IT SOLVES. A report that came back with corrections is not a
 * report that has not been written yet, but to the progression engine both are
 * `in_progress` — the reviewer's rejection puts the level back to `in_progress`
 * precisely so the learner can act on it again. `/api/curriculum/v2/current`
 * therefore cannot distinguish them, and Home said "Подготовьте и отправьте
 * отчёт" to a learner whose report was already written, already read, and
 * already returned with a list of things to fix. That is a small sentence and a
 * large loss of trust: it tells the learner the platform has forgotten what they
 * did.
 *
 * WHY IT IS THE CANONICAL SOURCE AND NOT THE OPERATIONAL MIRROR. A rejected
 * report also moves its Learner Operations case to `waiting_learner`, and that
 * status is right there in a projection this app already reads. Using it would
 * be wrong: the Learner Operations contract says an operational status and a
 * progression status are never mapped onto one another, because a mapping is how
 * the first quietly becomes the second. So this asks the report owner directly.
 *
 * IT IS A READ, AND IT DECIDES NOTHING. The result only selects which sentence
 * describes a state the Backend already holds. It cannot submit, resubmit,
 * approve or reject, and a failure answers `null` — under which every surface
 * behaves exactly as it did before this module existed.
 */
import { cookies } from "next/headers";
import { getAcademyConfig } from "@/config/academy-config";
import { sessionCookieHeader } from "@/lib/auth/constants";

/** The canonical report lifecycle, exactly as the Backend names it. */
export type CanonicalReportState = "available" | "draft" | "pending_review" | "rejected" | "approved";

const KINDS: readonly string[] = ["available", "draft", "pending_review", "rejected", "approved"];
const MAX_RESPONSE_BYTES = 512 * 1024;

/**
 * The report's canonical state for one level, or null when it cannot be known.
 *
 * Null covers: not a report level, the learner has not started it, the feature
 * is off, the Backend is unreachable, and any payload this build cannot read.
 * All of them mean the same thing to a caller — "no more specific answer than
 * the progression state" — so all of them get the same value.
 */
export async function readReportState(stableCode: string): Promise<CanonicalReportState | null> {
  const config = getAcademyConfig();
  if (config.mode !== "api" || !config.backendOrigin) return null;

  const cookieStore = await cookies();
  const session = sessionCookieHeader((name) => cookieStore.get(name));
  if (!session) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(
      `${config.backendOrigin}/api/curriculum/v2/levels/${encodeURIComponent(stableCode)}/report?locale=ru`,
      {
        method: "GET",
        headers: new Headers({
          accept: "application/json",
          cookie: session,
        }),
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      },
    );
    // Every documented failure of this route — not started, not configured,
    // wrong level type, no submission — is a legitimate "nothing more to say".
    if (!response.ok) return null;

    const raw = await response.arrayBuffer();
    if (raw.byteLength === 0 || raw.byteLength > MAX_RESPONSE_BYTES) return null;
    const payload = JSON.parse(new TextDecoder().decode(raw)) as unknown;

    const data = typeof payload === "object" && payload !== null ? (payload as { data?: unknown }).data : null;
    if (typeof data !== "object" || data === null) return null;
    const kind = (data as { kind?: unknown }).kind;
    return typeof kind === "string" && KINDS.includes(kind) ? (kind as CanonicalReportState) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
