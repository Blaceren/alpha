/**
 * NEWS — the public news, read on the server (SERVER-ONLY).
 *
 * ANONYMOUS ON PURPOSE. These pages are for everyone, signed in or not, and in
 * production for search engines. So no cookie is ever forwarded: the Backend's
 * `/api/public/news*` answers anyone with published items and nothing else,
 * and the page a signed-in learner sees is exactly the page a crawler sees.
 *
 * FAILURE IS NOT ABSENCE. An unreachable Backend is `unavailable`, which the
 * page renders as a temporary error (not indexed, like every 5xx); only the
 * Backend's own 404 is `not_found`, which the page turns into a real 404.
 */
import { getAcademyConfig } from "@/config/academy-config";
import {
  isPublicNewsItemAnswer,
  isPublicNewsListAnswer,
  type PublicNewsItemAnswer,
  type PublicNewsItemView,
  type PublicNewsListAnswer,
} from "@/features/public-news/public-news-model";

/** A page of the list, or one article with its neighbours, stays well inside this. */
const MAX_RESPONSE_BYTES = 512 * 1024;

export type PublicRead<T> = { status: "ok"; data: T } | { status: "not_found" } | { status: "unavailable" };

async function readPublic(path: string): Promise<PublicRead<unknown>> {
  const config = getAcademyConfig();
  if (config.mode !== "api" || !config.backendOrigin) return { status: "unavailable" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(`${config.backendOrigin}${path}`, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status === 404) return { status: "not_found" };
    if (!response.ok) return { status: "unavailable" };
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) return { status: "unavailable" };
    const body = JSON.parse(text) as unknown;
    const data = typeof body === "object" && body !== null ? (body as { data?: unknown }).data : undefined;
    return { status: "ok", data };
  } catch {
    return { status: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

/** `page` is already a validated whole number from 1. */
export async function readPublicNewsList(page: number): Promise<PublicRead<PublicNewsListAnswer>> {
  const read = await readPublic(page === 1 ? "/api/public/news" : `/api/public/news?page=${page}`);
  if (read.status !== "ok") return read;
  return isPublicNewsListAnswer(read.data) ? { status: "ok", data: read.data } : { status: "unavailable" };
}

/**
 * `slug` is already checked against the address shape; anything else never
 * leaves the process. Whether the release has come out is decided here, at the
 * moment of the read, so the page says «ожидается» only for a fact still to come.
 */
export async function readPublicNewsItem(slug: string): Promise<PublicRead<PublicNewsItemView>> {
  const read = await readPublic(`/api/public/news/${slug}`);
  if (read.status !== "ok") return read;
  if (!isPublicNewsItemAnswer(read.data)) return { status: "unavailable" };
  const answer: PublicNewsItemAnswer = read.data;
  return { status: "ok", data: { ...answer, released: Date.parse(answer.item.releaseAt) <= Date.now() } };
}

/** Every published address for the sitemap; an empty list when the Backend cannot say. */
export async function readNewsSitemap(): Promise<{ slug: string; updatedAt: string }[]> {
  const read = await readPublic("/api/public/news-sitemap");
  if (read.status !== "ok" || typeof read.data !== "object" || read.data === null) return [];
  const items = (read.data as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is { slug: string; updatedAt: string } =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { slug?: unknown }).slug === "string" &&
      typeof (item as { updatedAt?: unknown }).updatedAt === "string",
  );
}
