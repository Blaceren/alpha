/**
 * Server-side Learner Operations reads (SERVER-ONLY).
 *
 * The same seam `server/curriculum/server-read.ts` uses, for the same reason:
 * Level Detail is a Server Component, so it reads the Backend server-to-server
 * with the learner's own httpOnly session forwarded, rather than shipping a
 * client fetch and a loading state for one paragraph of text.
 *
 * READ-ONLY, AND NARROWLY. Two GETs, both against routes the learner already
 * owns: their own case list and one of their own cases. There is no write here,
 * no route that names another learner, and no staff route — the CRM Learner
 * Operations surface is a different origin path this module never mentions.
 *
 * FAILURE IS NOT AN ERROR PAGE. Mentor feedback is context beside a canonical
 * task, never the task itself. If Learner Operations is slow, disabled or
 * unreachable, the level page must still render its canonical state and its
 * canonical control — so every failure here degrades to "no feedback known"
 * and the caller shows the level exactly as it did before this feature existed.
 */
import { cookies } from "next/headers";
import { getAcademyConfig } from "@/config/academy-config";
import { sessionCookieHeader } from "@/lib/auth/constants";
import {
  findLevelReviewCase,
  toMentorFeedback,
  type LearnerOpsCaseSummary,
  type LearnerOpsCaseThread,
  type MentorFeedback,
} from "@/lib/learner-ops/mentor-feedback";

/** Bounds the payload this module will parse at all. */
const MAX_RESPONSE_BYTES = 512 * 1024;

async function learnerOpsGet(path: string): Promise<unknown | null> {
  const config = getAcademyConfig();
  if (config.mode !== "api" || !config.backendOrigin) return null;

  const cookieStore = await cookies();
  const session = sessionCookieHeader((name) => cookieStore.get(name));
  // No session, no read. An unauthenticated request would answer 401 and the
  // round trip is pointless.
  if (!session) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(`${config.backendOrigin}${path}`, {
      method: "GET",
      headers: new Headers({
        accept: "application/json",
        cookie: session,
      }),
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const raw = await response.arrayBuffer();
    if (raw.byteLength === 0 || raw.byteLength > MAX_RESPONSE_BYTES) return null;
    return JSON.parse(new TextDecoder().decode(raw)) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The learner's own review cases, reduced to the coordinate this build uses.
 *
 * Everything not named in `LearnerOpsCaseSummary` is dropped at the boundary
 * rather than carried and filtered later — a payload that never enters the
 * process cannot leak from it.
 */
function readCaseSummaries(payload: unknown): LearnerOpsCaseSummary[] {
  if (typeof payload !== "object" || payload === null) return [];
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return [];
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];

  const rows: LearnerOpsCaseSummary[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.type !== "string") continue;

    let level: LearnerOpsCaseSummary["level"] = null;
    const rawLevel = row.level;
    if (typeof rawLevel === "object" && rawLevel !== null) {
      const l = rawLevel as Record<string, unknown>;
      if (typeof l.levelNumber === "number" && typeof l.stableCode === "string" && typeof l.title === "string") {
        level = { levelNumber: l.levelNumber, stableCode: l.stableCode, title: l.title };
      }
    }
    rows.push({ id: row.id, type: row.type, level });
  }
  return rows;
}

function readThread(payload: unknown): LearnerOpsCaseThread {
  if (typeof payload !== "object" || payload === null) return { messages: [] };
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return { messages: [] };
  const messages = (data as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return { messages: [] };

  const rows: LearnerOpsCaseThread["messages"][number][] = [];
  for (const item of messages) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      typeof row.authorKind !== "string" ||
      typeof row.authorName !== "string" ||
      typeof row.body !== "string" ||
      typeof row.createdAt !== "string"
    ) {
      continue;
    }
    rows.push({
      id: row.id,
      authorKind: row.authorKind,
      authorName: row.authorName,
      body: row.body,
      createdAt: row.createdAt,
    });
  }
  return { messages: rows };
}

/**
 * The public mentor feedback for one level, or null when there is none.
 *
 * Null is the ordinary answer and covers every one of: the level has no review
 * workflow, the review exists but nobody has written yet, Learner Operations is
 * unavailable, and the learner is not signed in. The caller renders the same
 * thing in all four cases, because in all four the platform genuinely has no
 * reviewer message to show.
 */
export async function readLevelMentorFeedback(levelCode: string): Promise<MentorFeedback | null> {
  const list = await learnerOpsGet("/api/learner-ops/cases");
  if (list === null) return null;

  const match = findLevelReviewCase(readCaseSummaries(list), levelCode);
  if (!match) return null;

  const detail = await learnerOpsGet(`/api/learner-ops/cases/${encodeURIComponent(match.caseId)}`);
  if (detail === null) return null;

  return toMentorFeedback(readThread(detail), match.kind, levelCode);
}
