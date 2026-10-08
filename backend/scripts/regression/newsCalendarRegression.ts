/**
 * TOOLS-V2 — News Calendar (L30) and the news it reads, against a real SQLite
 * database and a real HTTP server.
 *
 * SELF-CONTAINED AND ISOLATED. It creates its own empty database in a fresh
 * temporary directory, applies EVERY migration with the production runner,
 * starts an isolated `next dev` on a loopback port with that database, and
 * never reads DATABASE_URL from the environment.
 *
 * What it proves:
 *   - persistence: a new item is a draft; the address follows the text until
 *     the first publication and never after; a stale form writes nothing;
 *     publishing and unpublishing keep the row and the address; the public and
 *     the calendar see published items only; the learner's plan is kept in
 *     versions; the tables refuse states the service never writes (raw SQL);
 *   - the CRM gate: exactly the roles holding `news_publish` (the copywriter and
 *     crm_admin) reach the news API, writes need CSRF and are audited, and the
 *     copywriter is refused the learner list, a learner card and an owner;
 *   - the public API answers anyone with published items and nothing else;
 *   - the tool opens at L30 durably completed, reads published releases and
 *     keeps the plan, and is refused to a learner below L30 and to staff.
 *
 *   npx tsx scripts/regression/newsCalendarRegression.ts
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { seedLegacyToolUnlocks } from "./support/toolUnlocks";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "ata-news-calendar-"));
const dbUrl = `file:${path.join(scratchDir, "regression.sqlite")}`;
process.env.DATABASE_URL = dbUrl;
const port = 3960 + (process.pid % 20);
const baseUrl = `http://127.0.0.1:${port}`;
const password = "NewsCalendar123!";

let passed = 0;
let failed = 0;
let logs = "";

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    if (logs) console.error(`--- server log tail ---\n${logs.slice(-1200)}\n--- end ---`);
  }
}

function cleanupScratch() {
  if (scratchDir.startsWith(os.tmpdir()) && path.basename(scratchDir).startsWith("ata-news-calendar-")) {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

const serverEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: dbUrl,
  SESSION_SECRET: "news-calendar-regression-secret",
  POSTBACK_SECRET: "news-calendar-postback-secret",
  APP_URL: baseUrl,
  PUBLIC_APP_URL: "https://news-e2e.example",
  STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
  EMAIL_VERIFICATION_REQUIRED: "false",
  CAPTCHA_DEV_BYPASS: "true",
};
for (const key of ["NODE_ENV"]) delete serverEnv[key];

async function start(): Promise<ChildProcess> {
  // No --turbopack: this workspace's node_modules is a farm of symlinks and
  // Turbopack cannot resolve the Next package through it (see crmUsersRegression).
  const child = spawn("npx", ["next", "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: process.cwd(),
    env: serverEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (value) => (logs += String(value)));
  child.stderr?.on("data", (value) => (logs += String(value)));
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return child;
    } catch {
      /* booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`next dev failed to start\n${logs.slice(-3000)}`);
}

async function stop(child: ChildProcess | null) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* gone */
  }
}

/** A JSON answer read by property paths; the assertions are the type check. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary JSON bodies, asserted field by field
type Json = Record<string, any>;
type Reply = { status: number; body: Json; text: string };

class Client {
  cookies = new Map<string, string>();
  csrf: string | null = null;

  async request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: {
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ") } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0]!;
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text();
    let value: unknown = {};
    try {
      value = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: response.status, body: value as Json, text };
  }

  async login(email: string) {
    const reply = await this.request("POST", "/api/auth/login", { email, password, captchaToken: "dev-captcha-ok" });
    assert.equal(reply.status, 200, `login ${email}: ${reply.text.slice(0, 300)}`);
    const csrf = await this.request("GET", "/api/csrf");
    this.csrf = String(csrf.body.csrfToken);
    return this;
  }

  write(method: string, url: string, body: unknown) {
    return this.request(method, url, body, { "x-csrf-token": this.csrf ?? "" });
  }
}

/** The CRM form for the presentation's release, 14:30 Warsaw. */
function form(overrides: Record<string, unknown> = {}) {
  return {
    title: "Базовый индекс потребительских цен, м/м",
    summary: "Инфляция без еды и энергии за август: рынок ждёт 0.3% после 0.2% месяцем раньше.",
    body: "Базовый ИПЦ показывает устойчивую инфляцию.\n\nПервое движение после публикации часто ложное.",
    country: "US",
    importance: 3,
    releaseDate: "2026-09-21",
    releaseTime: "14:30",
    timeZone: "Europe/Warsaw",
    forecast: "0.3%",
    previous: "0.2%",
    actual: "",
    sourceName: "",
    sourceUrl: "",
    ...overrides,
  };
}

async function main() {
  const migrate = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  assert.equal(migrate.status, 0, `migrate failed: ${migrate.stderr}`);

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const news = await import("@/lib/news/news-service");
  const { NewsError, parseNewsInput } = await import("@/lib/news/news");
  const calendar = await import("@/lib/tools/news-calendar-service");
  const { parseNewsPlan } = await import("@/lib/tools/news-calendar");
  const { isToolUnlockedForUser } = await import("@/lib/tools/access");
  const { CRM_STAFF_ROLES, resolveEffectivePermissions } = await import("@/lib/crm/roles");
  const { EXPECTED_MIGRATION_COUNT } = await import("./support/migrationCount");

  const hash = await bcrypt.hash(password, 10);
  const NOW = new Date("2026-09-21T12:00:00.000Z");

  /* A published ata-v2 graph with thirty levels; learners complete levels by row. */
  const version = await db.curriculumVersion.create({
    data: { code: "ata-v2", name: "news", versionNumber: 1, status: "published", publishedAt: new Date(), effectiveFrom: new Date() },
  });
  const moduleDefinition = await db.moduleDefinition.create({
    data: { curriculumVersionId: version.id, moduleNumber: 1, code: "m1", title: "M", firstLevel: 1, lastLevel: 31, learningObjective: "L" },
  });
  const levels: { id: number; levelNumber: number }[] = [];
  for (let n = 1; n <= 31; n += 1) {
    levels.push(
      await db.levelDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleId: moduleDefinition.id,
          levelNumber: n,
          stableCode: `v2.l${String(n).padStart(3, "0")}.news`,
          type: "lesson",
          title: `Level ${n}`,
          learningObjective: "L",
          completionMethod: "manual",
          requiredPreviousLevel: n === 1 ? null : n - 1,
          status: "active",
        },
      }),
    );
  }
  await seedLegacyToolUnlocks(db, version.id, levels);
  async function learner(email: string, completedThrough: number) {
    const user = await db.user.create({ data: { email, name: email, role: "user", passwordHash: hash } });
    const enrollment = await db.userCurriculumEnrollment.create({
      data: {
        userId: user.id,
        curriculumVersionId: version.id,
        curriculumCode: "ata-v2",
        status: "active",
        enrolledAt: new Date(),
        currentLevel: completedThrough + 1,
        highestCompletedLevel: completedThrough,
      },
    });
    for (const level of levels.filter((candidate) => candidate.levelNumber <= completedThrough)) {
      await db.userLevelProgress.create({
        data: { enrollmentId: enrollment.id, curriculumVersionId: version.id, levelDefinitionId: level.id, status: "completed", startedAt: new Date(), completedAt: new Date() },
      });
    }
    return user;
  }

  const staffByRole = new Map<string, { email: string; userId: number }>();
  for (const role of CRM_STAFF_ROLES) {
    const email = `news-staff-${role}@example.invalid`;
    // A copywriter account is a `news_editor` on the User axis, so it is never listed as a learner.
    const user = await db.user.create({
      data: { email, name: `Staff ${role}`, role: role === "copywriter" ? "news_editor" : "admin", passwordHash: hash },
    });
    await db.staffProfile.create({ data: { userId: user.id, displayName: `Staff ${role}`, staffRole: role } });
    staffByRole.set(role, { email, userId: user.id });
  }
  const copywriterId = staffByRole.get("copywriter")!.userId;
  const readerL30 = await learner("news-reader-l30@example.invalid", 30);
  const readerL29 = await learner("news-reader-l29@example.invalid", 29);

  let server: ChildProcess | null = null;
  try {
    /* ------------------------------------------------------ persistence */

    await check("every migration applied, the news calendar one among them", async () => {
      const rows = await db.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`;
      assert.equal(rows.length, EXPECTED_MIGRATION_COUNT);
      assert.ok(rows.some((row) => row.migration_name === "20260921230000_news_calendar"));
    });

    await check("the tool opens with L30 durably completed, and not a level before", async () => {
      assert.equal(await isToolUnlockedForUser(readerL30.id, "tool.news_calendar", db), true);
      assert.equal(await isToolUnlockedForUser(readerL29.id, "tool.news_calendar", db), false);
    });

    let cpiId = "";
    await check("a new item is a draft with an address made from its text", async () => {
      const created = await news.createNews(parseNewsInput(form(), NOW), copywriterId, db);
      cpiId = created.id;
      assert.equal(created.status, "draft");
      assert.equal(created.slug, "ssha-bazovyy-indeks-potrebitelskikh-tsen-m-m-2026-09-21");
      assert.equal(created.releaseAt.toISOString(), "2026-09-21T12:30:00.000Z");
      assert.equal(created.currency, "USD");
      assert.equal(created.publishedAt, null);
      assert.equal(created.createdById, copywriterId);
    });

    await check("the public and the calendar never see a draft", async () => {
      assert.equal(await news.readPublicNews("ssha-bazovyy-indeks-potrebitelskikh-tsen-m-m-2026-09-21", db), null);
      const window = { from: new Date("2026-09-21T00:00:00Z"), to: new Date("2026-09-22T00:00:00Z") };
      assert.deepEqual(await calendar.readCalendarEvents(window, db), []);
      assert.deepEqual(await news.readNewsSitemap(db), []);
    });

    await check("the same title on the same day takes the next free address", async () => {
      const twin = await news.createNews(parseNewsInput(form({ releaseTime: "16:00" }), NOW), copywriterId, db);
      assert.equal(twin.slug, "ssha-bazovyy-indeks-potrebitelskikh-tsen-m-m-2026-09-21-2");
    });

    await check("before the first publication the address follows the text", async () => {
      const current = await news.readCrmNews(cpiId, db);
      const edited = await news.updateNews(
        cpiId,
        parseNewsInput(form({ title: "Индекс потребительских цен, м/м" }), NOW),
        current.updatedAt.toISOString(),
        copywriterId,
        db,
      );
      assert.equal(edited.slug, "ssha-indeks-potrebitelskikh-tsen-m-m-2026-09-21");
      assert.equal(edited.title, "Индекс потребительских цен, м/м");
    });

    await check("a stale form writes nothing", async () => {
      const before = await news.readCrmNews(cpiId, db);
      await assert.rejects(
        news.updateNews(cpiId, parseNewsInput(form({ forecast: "0.4%" }), NOW), "2020-01-01T00:00:00.000Z", copywriterId, db),
        (error: unknown) => error instanceof NewsError && error.code === "NEWS_STALE",
      );
      await assert.rejects(
        news.updateNews("clnewsmissing000000000001", parseNewsInput(form(), NOW), before.updatedAt.toISOString(), copywriterId, db),
        (error: unknown) => error instanceof NewsError && error.code === "NEWS_NOT_FOUND",
      );
      assert.deepEqual(await news.readCrmNews(cpiId, db), before);
    });

    await check("publishing makes it public and a calendar row; the address is fixed from then on", async () => {
      const current = await news.readCrmNews(cpiId, db);
      const { item, changed } = await news.setNewsStatus(cpiId, "published", current.updatedAt.toISOString(), copywriterId, NOW, db);
      assert.equal(changed, true);
      assert.equal(item.status, "published");
      assert.equal(item.publishedAt?.toISOString(), NOW.toISOString());
      assert.equal(item.firstPublishedAt?.toISOString(), NOW.toISOString());
      const found = await news.readPublicNews(item.slug, db);
      assert.equal(found?.item.id, cpiId);
      const window = { from: new Date("2026-09-21T00:00:00Z"), to: new Date("2026-09-22T00:00:00Z") };
      assert.deepEqual((await calendar.readCalendarEvents(window, db)).map((row) => row.id), [cpiId]);

      const edited = await news.updateNews(
        cpiId,
        parseNewsInput(form({ title: "Совсем другое название", actual: "0.4%" }), NOW),
        item.updatedAt.toISOString(),
        copywriterId,
        db,
      );
      assert.equal(edited.slug, item.slug, "a published address never changes");
      assert.equal(edited.actual, "0.4%");
      assert.equal(edited.status, "published");
    });

    await check("publishing twice changes nothing", async () => {
      const current = await news.readCrmNews(cpiId, db);
      const again = await news.setNewsStatus(cpiId, "published", current.updatedAt.toISOString(), copywriterId, new Date(), db);
      assert.equal(again.changed, false);
      assert.deepEqual(again.item, current);
    });

    await check("unpublishing takes it off the site and the calendar, and keeps the row and the address", async () => {
      const current = await news.readCrmNews(cpiId, db);
      const { item } = await news.setNewsStatus(cpiId, "draft", current.updatedAt.toISOString(), copywriterId, new Date(), db);
      assert.equal(item.status, "draft");
      assert.equal(item.publishedAt, null);
      assert.ok(item.firstPublishedAt, "the first publication is remembered");
      assert.equal(await news.readPublicNews(item.slug, db), null);
      const republished = await news.setNewsStatus(cpiId, "published", item.updatedAt.toISOString(), copywriterId, new Date(), db);
      assert.equal(republished.item.slug, current.slug);
      assert.equal(republished.item.firstPublishedAt?.toISOString(), current.firstPublishedAt?.toISOString());
    });

    await check("the public list: what is coming first, then what has been, newest first", async () => {
      for (const [time, title] of [["09:00", "Розничные продажи, м/м"], ["20:00", "Решение по ставке ФРС"]] as const) {
        const item = await news.createNews(parseNewsInput(form({ title, releaseTime: time }), NOW), copywriterId, db);
        await news.setNewsStatus(item.id, "published", item.updatedAt.toISOString(), copywriterId, NOW, db);
      }
      const page = await news.readPublicNewsPage(1, NOW, db);
      assert.deepEqual(page.upcoming.map((row) => row.title), ["Совсем другое название", "Решение по ставке ФРС"]);
      assert.deepEqual(page.past.map((row) => row.title), ["Розничные продажи, м/м"]);
      assert.equal(page.pageCount, 1);
      await assert.rejects(news.readPublicNewsPage(2, NOW, db), (error: unknown) => error instanceof NewsError && error.code === "NEWS_NOT_FOUND");
      assert.equal((await news.readNewsSitemap(db)).length, 3);
    });

    await check("the learner's plan is kept in versions, and another learner sees none of it", async () => {
      assert.equal((await calendar.readNewsPlan(readerL30.id, db)).current, null);
      const plan = parseNewsPlan({ timeZone: "Europe/Warsaw", minImportance: 3, minutesBefore: 15, minutesAfter: 15, currencies: ["USD", "EUR"] });
      const first = await calendar.saveNewsPlan(readerL30.id, plan, db);
      assert.equal(first.created, true);
      assert.equal(first.state.current?.version, 1);
      assert.equal(first.state.current?.row.currencies, "USD,EUR");
      const same = await calendar.saveNewsPlan(readerL30.id, plan, db);
      assert.equal(same.created, false);
      const changed = await calendar.saveNewsPlan(readerL30.id, { ...plan, minutesAfter: 30 }, db);
      assert.equal(changed.state.current?.version, 2);
      assert.equal(await db.toolNewsPlan.count({ where: { userId: readerL30.id } }), 2);
      assert.equal((await calendar.readNewsPlan(readerL29.id, db)).current, null);
    });

    await check("the news table refuses states the service never writes (raw SQL)", async () => {
      let n = 0;
      const insert = (values: Record<string, unknown>) => {
        const row = {
          id: `rawnews${(n += 1)}`,
          slug: `raw-news-${n}-2026-09-21`,
          title: "Сырой заголовок",
          summary: "Двадцать символов и больше для описания.",
          body: "",
          country: "US",
          currency: "USD",
          importance: 2,
          releaseAt: Date.parse("2026-09-21T12:30:00Z"),
          status: "draft",
          publishedAt: null,
          firstPublishedAt: null,
          sourceName: null,
          sourceUrl: null,
          updatedAt: Date.now(),
          ...values,
        };
        const keys = Object.keys(row);
        return db.$executeRawUnsafe(
          `INSERT INTO "NewsItem" (${keys.map((key) => `"${key}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
          ...Object.values(row),
        );
      };
      await assert.rejects(insert({ slug: "Upper-Case-2026" }), "an address with capitals");
      await assert.rejects(insert({ slug: "-leading-2026" }), "an address starting with a hyphen");
      await assert.rejects(insert({ slug: "double--hyphen-2026" }), "an address with a double hyphen");
      await assert.rejects(insert({ slug: "space in-2026" }), "an address with a space");
      await assert.rejects(insert({ title: " Сырой заголовок" }), "an untrimmed title");
      await assert.rejects(insert({ summary: "Коротко." }), "a summary too short to describe a page");
      await assert.rejects(insert({ country: "RU", currency: "RUB" }), "a country outside the list");
      await assert.rejects(insert({ country: "DE", currency: "USD" }), "German data that is not EUR news");
      await assert.rejects(insert({ importance: 4 }), "importance past high");
      await assert.rejects(insert({ releaseAt: "2026-09-21T12:30:00Z" }), "a release as text");
      await assert.rejects(insert({ sourceName: "BLS" }), "a source name without an address");
      await assert.rejects(insert({ sourceName: "BLS", sourceUrl: "http://www.bls.gov/" }), "a source that is not https");
      await assert.rejects(insert({ status: "archived" }), "a status the product does not have");
      await assert.rejects(insert({ status: "published" }), "published without a publication time");
      await assert.rejects(insert({ publishedAt: Date.now() }), "a draft with a publication time");
      await assert.rejects(insert({ status: "published", publishedAt: Date.now() }), "published with no first publication");
      assert.equal(await insert({ slug: "raw-news-taken-2026-09-21" }), 1);
      assert.equal(await insert({ status: "published", publishedAt: Date.now(), firstPublishedAt: Date.now() }), 1);
      await assert.rejects(insert({ slug: "raw-news-taken-2026-09-21" }), "a taken address");
    });

    await check("the plan table refuses states the service never writes (raw SQL)", async () => {
      let n = 0;
      const insert = (values: Record<string, unknown>) => {
        const row = {
          id: `rawplan${(n += 1)}`,
          userId: readerL29.id,
          timeZone: "Europe/Warsaw",
          minImportance: 3,
          minutesBefore: 15,
          minutesAfter: 15,
          currencies: "USD,EUR",
          ...values,
        };
        const keys = Object.keys(row);
        return db.$executeRawUnsafe(
          `INSERT INTO "ToolNewsPlan" (${keys.map((key) => `"${key}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
          ...Object.values(row),
        );
      };
      await assert.rejects(insert({ minImportance: 1 }), "low importance closing entry");
      await assert.rejects(insert({ minutesBefore: 20 }), "a window the form does not offer");
      await assert.rejects(insert({ minutesAfter: 0 }), "no window after");
      await assert.rejects(insert({ currencies: "usd" }), "lower-case codes");
      await assert.rejects(insert({ currencies: ",USD" }), "a leading comma");
      await assert.rejects(insert({ currencies: "" }), "no currency");
      await assert.rejects(insert({ timeZone: "Europe/Warsaw; DROP" }), "a zone that is not a zone name");
      assert.equal(await insert({}), 1);
    });

    await check("a departed staff member leaves the item; a deleted learner takes their plans", async () => {
      const temp = await db.user.create({ data: { email: "news-temp-staff@example.invalid", name: "t", role: "news_editor", passwordHash: hash } });
      const item = await news.createNews(parseNewsInput(form({ title: "Временная новость" }), NOW), temp.id, db);
      await db.user.delete({ where: { id: temp.id } });
      const kept = await db.newsItem.findUniqueOrThrow({ where: { id: item.id } });
      assert.equal(kept.createdById, null);
      const gone = await db.user.create({ data: { email: "news-gone@example.invalid", name: "g", role: "user", passwordHash: hash } });
      await calendar.saveNewsPlan(gone.id, parseNewsPlan({ timeZone: "UTC", minImportance: 2, minutesBefore: 5, minutesAfter: 5, currencies: ["GBP"] }), db);
      await db.user.delete({ where: { id: gone.id } });
      assert.equal(await db.toolNewsPlan.count({ where: { userId: gone.id } }), 0);
    });

    /* ------------------------------------------------------------- HTTP */

    server = await start();
    const publishers = CRM_STAFF_ROLES.filter((role) => resolveEffectivePermissions(role).includes("news_publish"));

    await check("HTTP: the news API is refused without a session", async () => {
      const reply = await new Client().request("GET", "/api/crm/v1/news");
      assert.equal(reply.status, 401);
      assert.equal(reply.body.code, "unauthorized");
    });

    await check("HTTP: exactly the roles holding news_publish reach the news API", async () => {
      assert.deepEqual(publishers, ["crm_admin", "copywriter"]);
      for (const role of CRM_STAFF_ROLES) {
        const client = await new Client().login(staffByRole.get(role)!.email);
        const reply = await client.request("GET", "/api/crm/v1/news");
        if (publishers.includes(role)) {
          assert.equal(reply.status, 200, `${role}: ${reply.text.slice(0, 200)}`);
          assert.ok(Array.isArray(reply.body.data.items));
          assert.ok(Array.isArray(reply.body.data.reference.countries));
        } else {
          assert.equal(reply.status, 403, `${role} must not reach news`);
          assert.equal(reply.body.messageKey, "crm.news.forbidden");
        }
      }
    });

    const copywriter = await new Client().login(staffByRole.get("copywriter")!.email);

    await check("HTTP: the copywriter never reads a learner", async () => {
      const list = await copywriter.request("GET", "/api/crm/v1/users");
      assert.equal(list.status, 403);
      assert.equal(list.body.messageKey, "crm.users.forbidden");
      const card = await copywriter.request("GET", `/api/crm/v1/users/${readerL30.id}`);
      assert.equal(card.status, 403);
      const owner = await copywriter.request("GET", `/api/crm/v1/users/${readerL30.id}/owner`);
      assert.equal(owner.status, 403);
      const notes = await copywriter.request("GET", `/api/crm/v1/users/${readerL30.id}/notes`);
      assert.equal(notes.status, 403);
      const session = await copywriter.request("GET", "/api/crm/v1/session");
      assert.equal(session.status, 200);
      assert.equal(session.body.role, "copywriter");
      assert.deepEqual(session.body.effectivePermissions, ["news_publish"]);
    });

    let httpItem: Json = {};
    await check("HTTP: a write without the CSRF token is refused, audited, and writes nothing", async () => {
      const before = await db.newsItem.count();
      const reply = await copywriter.request("POST", "/api/crm/v1/news", { item: form({ title: "Без токена" }) });
      assert.equal(reply.status, 403);
      assert.equal(reply.body.messageKey, "crm.news.csrf_invalid");
      assert.equal(await db.newsItem.count(), before);
      assert.ok((await db.auditLog.count({ where: { action: "CSRF_INVALID", entityId: "/api/crm/v1/news" } })) > 0);
    });

    await check("HTTP: «Новая новость» is a draft, audited to its author", async () => {
      const reply = await copywriter.write("POST", "/api/crm/v1/news", {
        item: form({ title: "Индекс деловой активности в производстве", country: "DE", importance: 2, releaseTime: "10:30" }),
      });
      assert.equal(reply.status, 201, reply.text.slice(0, 300));
      httpItem = reply.body.data.item;
      assert.equal(httpItem.status, "draft");
      assert.equal(httpItem.currency, "EUR");
      assert.equal(httpItem.publicUrl, null);
      const audit = await db.auditLog.findFirstOrThrow({ where: { action: "NEWS_ITEM_CREATED", entityId: httpItem.id } });
      assert.equal(audit.userId, copywriterId);
    });

    await check("HTTP: a bad field names itself, and an oversized body is refused before parsing", async () => {
      const bad = await copywriter.write("POST", "/api/crm/v1/news", { item: form({ country: "RU" }) });
      assert.equal(bad.status, 400);
      assert.equal(bad.body.error, "NEWS_VALIDATION");
      assert.equal(bad.body.detail, "invalid_country");
      const huge = await copywriter.write("POST", "/api/crm/v1/news", { item: form({ body: "я".repeat(60_000) }) });
      assert.equal(huge.status, 400);
      assert.equal(huge.body.detail, "body_too_large");
      const extra = await copywriter.request("GET", "/api/crm/v1/news?status=all&secret=1");
      assert.equal(extra.status, 400);
    });

    await check("HTTP: the public page answers 404 while the item is a draft", async () => {
      const reply = await new Client().request("GET", `/api/public/news/${httpItem.slug}`);
      assert.equal(reply.status, 404);
      assert.equal(reply.body.error, "NEWS_NOT_FOUND");
    });

    await check("HTTP: «Опубликовать» makes the page public, with no id and no staff in it", async () => {
      const reply = await copywriter.write("POST", `/api/crm/v1/news/${httpItem.id}/status`, {
        status: "published",
        expectedUpdatedAt: httpItem.updatedAt,
      });
      assert.equal(reply.status, 200, reply.text.slice(0, 300));
      assert.equal(reply.body.data.changed, true);
      httpItem = reply.body.data.item;
      assert.equal(httpItem.publicUrl, `https://news-e2e.example/news/${httpItem.slug}`);
      const page = await new Client().request("GET", `/api/public/news/${httpItem.slug}`);
      assert.equal(page.status, 200);
      assert.equal(page.body.data.item.title, "Индекс деловой активности в производстве");
      assert.ok(!("id" in page.body.data.item));
      assert.doesNotMatch(page.text, /createdBy|updatedBy|news-staff|clnews/);
      const list = await new Client().request("GET", "/api/public/news");
      assert.equal(list.status, 200);
      const sitemap = await new Client().request("GET", "/api/public/news-sitemap");
      assert.ok(sitemap.body.data.items.some((item: { slug: string }) => item.slug === httpItem.slug));
      assert.ok(await db.auditLog.findFirst({ where: { action: "NEWS_ITEM_PUBLISHED", entityId: httpItem.id } }));
    });

    await check("HTTP: an edit from a stale form is refused with 409 and writes nothing", async () => {
      const reply = await copywriter.write("PATCH", `/api/crm/v1/news/${httpItem.id}`, {
        item: form({ title: "Индекс деловой активности в производстве", country: "DE", importance: 2, actual: "49.8" }),
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      });
      assert.equal(reply.status, 409);
      assert.equal(reply.body.error, "NEWS_STALE");
      const fresh = await copywriter.write("PATCH", `/api/crm/v1/news/${httpItem.id}`, {
        item: form({ title: "Индекс деловой активности в производстве", country: "DE", importance: 2, releaseTime: "10:30", actual: "49.8" }),
        expectedUpdatedAt: httpItem.updatedAt,
      });
      assert.equal(fresh.status, 200, fresh.text.slice(0, 300));
      assert.equal(fresh.body.data.item.actual, "49.8");
      assert.equal(fresh.body.data.item.slug, httpItem.slug);
      httpItem = fresh.body.data.item;
    });

    await check("HTTP: the public API answers only its own parameters", async () => {
      assert.equal((await new Client().request("GET", "/api/public/news?page=0")).status, 400);
      assert.equal((await new Client().request("GET", "/api/public/news?page=1&draft=1")).status, 400);
      assert.equal((await new Client().request("GET", "/api/public/news?page=9")).status, 404);
      assert.equal((await new Client().request("GET", "/api/public/news/..%2F..%2Fetc")).status, 404);
    });

    await check("HTTP: the tool reads published releases for a learner at L30 and keeps the plan", async () => {
      const reader = await new Client().login("news-reader-l30@example.invalid");
      const first = await reader.request("GET", "/api/tools/news-calendar");
      assert.equal(first.status, 200, first.text.slice(0, 300));
      assert.equal(first.body.data.plan.version, 2);
      const day = await reader.request(
        "GET",
        "/api/tools/news-calendar?from=2026-09-20T22:00:00.000Z&to=2026-09-21T22:00:00.000Z",
      );
      assert.equal(day.status, 200);
      const slugs = day.body.data.events.map((event: { slug: string }) => event.slug);
      assert.ok(slugs.includes(httpItem.slug));
      assert.ok(day.body.data.events.every((event: Record<string, unknown>) => !("id" in event) && !("status" in event)));
      const refused = await reader.request("POST", "/api/tools/news-calendar", {
        plan: { timeZone: "Europe/Moscow", minImportance: 2, minutesBefore: 10, minutesAfter: 30, currencies: ["USD"] },
      });
      assert.equal(refused.status, 403, "a plan save without CSRF is refused");
      const saved = await reader.write("POST", "/api/tools/news-calendar", {
        plan: { timeZone: "Europe/Moscow", minImportance: 2, minutesBefore: 10, minutesAfter: 30, currencies: ["USD"] },
      });
      assert.equal(saved.status, 201, saved.text.slice(0, 300));
      assert.equal(saved.body.data.plan.version, 3);
      const again = await reader.write("POST", "/api/tools/news-calendar", {
        plan: { timeZone: "Europe/Moscow", minImportance: 2, minutesBefore: 10, minutesAfter: 30, currencies: ["USD"] },
      });
      assert.equal(again.status, 200);
      const window = await reader.request("GET", "/api/tools/news-calendar?from=2026-09-01T00:00:00Z&to=2026-09-21T00:00:00Z");
      assert.equal(window.status, 400);
      assert.equal(window.body.detail, "invalid_window");
    });

    await check("HTTP: the tool is closed below L30, and staff have no tool at all", async () => {
      const early = await new Client().login("news-reader-l29@example.invalid");
      const locked = await early.request("GET", "/api/tools/news-calendar");
      assert.equal(locked.status, 403);
      assert.equal(locked.body.error, "TOOL_LOCKED");
      const staff = await copywriter.request("GET", "/api/tools/news-calendar");
      assert.equal(staff.status, 403);
      assert.notEqual(staff.body.error, "TOOL_LOCKED");
    });

    await check("HTTP: «Снять с публикации» takes the page down and keeps its address", async () => {
      const reply = await copywriter.write("POST", `/api/crm/v1/news/${httpItem.id}/status`, {
        status: "draft",
        expectedUpdatedAt: httpItem.updatedAt,
      });
      assert.equal(reply.status, 200, reply.text.slice(0, 300));
      assert.equal(reply.body.data.item.status, "draft");
      assert.equal(reply.body.data.item.slug, httpItem.slug);
      assert.equal(reply.body.data.item.slugLocked, true);
      assert.equal((await new Client().request("GET", `/api/public/news/${httpItem.slug}`)).status, 404);
      assert.ok(await db.auditLog.findFirst({ where: { action: "NEWS_ITEM_UNPUBLISHED", entityId: httpItem.id } }));
    });
  } finally {
    await stop(server);
    await db.$disconnect();
    cleanupScratch();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanupScratch();
  process.exitCode = 1;
});
