/**
 * NEWS — persistence.
 *
 * PUBLIC READS see published items only, and only through the public shapes in
 * `news.ts`. CRM READS see everything. WRITES come from the CRM alone.
 *
 * NOTHING IS DELETED. An item comes off the site by being unpublished; its page
 * then answers 404 and it leaves the calendar, but the row, its address and its
 * history stay. An address never changes after the first publication, so a
 * page search engines have seen keeps its URL when it comes back.
 *
 * A STALE FORM WRITES NOTHING. Every change names the `updatedAt` the editor
 * loaded, and the row is changed only if it still has it, in one statement. Two
 * copywriters editing the same item cannot overwrite each other silently.
 */
import type { NewsItem, Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { NewsError, type NewsInput, type NewsStatus } from "./news";
import { newsCountryByCode } from "./reference";
import { SLUG_RE, newsSlugBase, uniqueSlug } from "./slug";

type Db = Pick<PrismaClient, "newsItem">;
type TxDb = Pick<PrismaClient, "newsItem" | "$transaction">;

export const NEWS_PAGE_SIZES = {
  /** Past releases per page of the public list. */
  publicPast: 30,
  /** Upcoming releases on the first page of the public list. */
  publicUpcoming: 40,
  /** «Другие новости» under an item. */
  publicOthers: 6,
  crm: 50,
  /** Addresses in the sitemap. */
  sitemap: 5000,
} as const;

const PUBLISHED = { status: "published" } as const;

/* ---------------------------------------------------------------- public */

export type PublicNewsPage = {
  readonly upcoming: NewsItem[];
  readonly past: NewsItem[];
  readonly page: number;
  readonly pageCount: number;
};

/** The public list: what is coming (first page only), then what has been, newest first. */
export async function readPublicNewsPage(page: number, now: Date = new Date(), db: Db = defaultPrisma): Promise<PublicNewsPage> {
  const pastWhere = { ...PUBLISHED, releaseAt: { lt: now } };
  const [upcoming, pastCount, past] = await Promise.all([
    page === 1
      ? db.newsItem.findMany({
          where: { ...PUBLISHED, releaseAt: { gte: now } },
          orderBy: [{ releaseAt: "asc" }, { importance: "desc" }, { id: "asc" }],
          take: NEWS_PAGE_SIZES.publicUpcoming,
        })
      : Promise.resolve([]),
    db.newsItem.count({ where: pastWhere }),
    db.newsItem.findMany({
      where: pastWhere,
      orderBy: [{ releaseAt: "desc" }, { importance: "desc" }, { id: "asc" }],
      skip: (page - 1) * NEWS_PAGE_SIZES.publicPast,
      take: NEWS_PAGE_SIZES.publicPast,
    }),
  ]);
  const pageCount = Math.max(1, Math.ceil(pastCount / NEWS_PAGE_SIZES.publicPast));
  if (page > pageCount) throw new NewsError("NEWS_NOT_FOUND");
  return { upcoming, past, page, pageCount };
}

/** One published item by its address, with the latest other items for «Другие новости». */
export async function readPublicNews(
  slug: string,
  db: Db = defaultPrisma,
): Promise<{ readonly item: NewsItem; readonly others: NewsItem[] } | null> {
  if (!SLUG_RE.test(slug) || slug.length > 120) return null;
  const item = await db.newsItem.findFirst({ where: { ...PUBLISHED, slug } });
  if (!item) return null;
  const others = await db.newsItem.findMany({
    where: { ...PUBLISHED, id: { not: item.id } },
    orderBy: [{ releaseAt: "desc" }, { id: "asc" }],
    take: NEWS_PAGE_SIZES.publicOthers,
  });
  return { item, others };
}

/** Every published address and when it last changed, newest release first. */
export function readNewsSitemap(db: Db = defaultPrisma) {
  return db.newsItem.findMany({
    where: PUBLISHED,
    orderBy: [{ releaseAt: "desc" }, { id: "asc" }],
    select: { slug: true, updatedAt: true },
    take: NEWS_PAGE_SIZES.sitemap,
  });
}

/* ------------------------------------------------------------------- CRM */

export type CrmNewsFilter = "all" | NewsStatus;

export async function listCrmNews(filter: CrmNewsFilter, page: number, db: Db = defaultPrisma) {
  const where: Prisma.NewsItemWhereInput = filter === "all" ? {} : { status: filter };
  const [total, items] = await Promise.all([
    db.newsItem.count({ where }),
    db.newsItem.findMany({
      where,
      orderBy: [{ releaseAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * NEWS_PAGE_SIZES.crm,
      take: NEWS_PAGE_SIZES.crm,
    }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / NEWS_PAGE_SIZES.crm));
  return { items, total, page, pageCount };
}

export async function readCrmNews(id: string, db: Db = defaultPrisma): Promise<NewsItem> {
  const item = await db.newsItem.findUnique({ where: { id } });
  if (!item) throw new NewsError("NEWS_NOT_FOUND");
  return item;
}

function slugBaseFor(input: Pick<NewsInput, "country" | "title" | "releaseAt">): string {
  const country = newsCountryByCode(input.country);
  return newsSlugBase(country?.label ?? input.country, input.title, input.releaseAt.toISOString().slice(0, 10));
}

function columns(input: NewsInput) {
  return {
    title: input.title,
    summary: input.summary,
    body: input.body,
    country: input.country,
    currency: input.currency,
    importance: input.importance,
    releaseAt: input.releaseAt,
    forecast: input.forecast,
    previous: input.previous,
    actual: input.actual,
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
  };
}

/** A new item is always a draft; publishing is its own step. */
export async function createNews(input: NewsInput, staffId: number, db: TxDb = defaultPrisma): Promise<NewsItem> {
  return db.$transaction(async (tx) => {
    const slug = await uniqueSlug(slugBaseFor(input), async (candidate) =>
      (await tx.newsItem.count({ where: { slug: candidate } })) > 0,
    );
    return tx.newsItem.create({
      data: { ...columns(input), slug, status: "draft", createdById: staffId, updatedById: staffId },
    });
  });
}

/** Change `id` only if it still carries the `updatedAt` the editor loaded. */
async function changeIfCurrent(
  tx: Db,
  id: string,
  expectedUpdatedAt: string,
  data: Prisma.NewsItemUncheckedUpdateManyInput,
): Promise<NewsItem> {
  const expected = new Date(expectedUpdatedAt);
  if (Number.isNaN(expected.getTime())) throw new NewsError("NEWS_VALIDATION", "invalid_updated_at");
  const { count } = await tx.newsItem.updateMany({ where: { id, updatedAt: expected }, data });
  if (count === 0) {
    const exists = await tx.newsItem.count({ where: { id } });
    throw new NewsError(exists ? "NEWS_STALE" : "NEWS_NOT_FOUND");
  }
  return readCrmNews(id, tx);
}

export async function updateNews(
  id: string,
  input: NewsInput,
  expectedUpdatedAt: string,
  staffId: number,
  db: TxDb = defaultPrisma,
): Promise<NewsItem> {
  return db.$transaction(async (tx) => {
    const current = await readCrmNews(id, tx);
    let slug = current.slug;
    // Until the first publication the address follows the text; after it, never.
    if (current.firstPublishedAt === null) {
      const base = slugBaseFor(input);
      const stillFits = current.slug === base || new RegExp(`^${base}-\\d{1,2}$`).test(current.slug);
      if (!stillFits) {
        slug = await uniqueSlug(base, async (candidate) =>
          (await tx.newsItem.count({ where: { slug: candidate, id: { not: id } } })) > 0,
        );
      }
    }
    return changeIfCurrent(tx, id, expectedUpdatedAt, {
      ...columns(input),
      slug,
      updatedById: staffId,
      updatedAt: new Date(),
    });
  });
}

/** «Опубликовать» / «Снять с публикации». Publishing twice, or unpublishing a draft, changes nothing. */
export async function setNewsStatus(
  id: string,
  status: NewsStatus,
  expectedUpdatedAt: string,
  staffId: number,
  now: Date = new Date(),
  db: TxDb = defaultPrisma,
): Promise<{ readonly item: NewsItem; readonly changed: boolean }> {
  return db.$transaction(async (tx) => {
    const current = await readCrmNews(id, tx);
    if (current.status === status) return { item: current, changed: false };
    const data: Prisma.NewsItemUncheckedUpdateManyInput =
      status === "published"
        ? { status, publishedAt: now, firstPublishedAt: current.firstPublishedAt ?? now, updatedById: staffId, updatedAt: now }
        : { status, publishedAt: null, updatedById: staffId, updatedAt: now };
    return { item: await changeIfCurrent(tx, id, expectedUpdatedAt, data), changed: true };
  });
}
