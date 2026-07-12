import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

const baseUrl = process.env.STAGE12_BASE_URL ?? "http://127.0.0.1:3100";
const root = path.join(process.cwd(), "design-memory", "screenshots", "stage-12");
const videoRoot = path.join(root, "video");
const home = "/design-lab/tradequest-home-v2";
const news = "/design-lab/tradequest-news-v2";
let article = `${news}/market-review-today`;
const errors: string[] = [];

async function prepare(context: BrowserContext, theme: "dark" | "light") {
  const userId = Number(process.env.STAGE12_USER_ID ?? 0);
  const secret = process.env.SESSION_SECRET;
  if (userId && secret) {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const payload = `${userId}.admin.${expiresAt}`;
    const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    await context.addCookies([{
      name: "trading_platform_session",
      value: `${payload}.${signature}`,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
      expires: Math.floor(expiresAt / 1000),
    }]);
  }
  await context.addInitScript((value) => {
    localStorage.setItem("theme", value);
    sessionStorage.setItem("tqv2-seen", "1");
    localStorage.setItem("trading-platform-cookie-consent", JSON.stringify({ necessary: true, analytics: false, marketing: false, functional: false }));
  }, theme);
}

async function open(page: Page, route: string) {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${route}: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`${route}: ${error.message}`));
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(900);
}

async function scrollToSelector(page: Page, selector: string, offset = 0) {
  await page.locator(selector).evaluate((element, amount) => {
    const top = element.getBoundingClientRect().top + window.scrollY + Number(amount);
    window.scrollTo(0, top);
  }, offset);
  await page.waitForTimeout(850);
}

async function settleAtSelector(page: Page, selector: string, offset = 0) {
  const target = await page.locator(selector).evaluate((element, amount) => (
    element.getBoundingClientRect().top + window.scrollY + Number(amount)
  ), offset);
  await animateScroll(page, target, 900);
  await page.waitForTimeout(850);
}

async function animateScroll(page: Page, to: number, duration = 1500) {
  const start = await page.evaluate(() => window.scrollY);
  const steps = 36;
  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    const eased = 0.5 - Math.cos(progress * Math.PI) / 2;
    await page.evaluate((target) => window.scrollTo(0, target), start + (to - start) * eased);
    await page.waitForTimeout(duration / steps);
  }
}

async function screenshot(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  name: string,
  route: string,
  viewport: { width: number; height: number },
  theme: "dark" | "light",
  action?: (page: Page) => Promise<void>,
  fullPage = false,
) {
  const context = await browser.newContext({ viewport });
  await prepare(context, theme);
  const page = await context.newPage();
  await open(page, route);
  if (action) await action(page);
  await page.screenshot({ path: path.join(root, `${name}.png`), fullPage });
  const metrics = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  if (metrics.scrollWidth > metrics.width + 2) errors.push(`${name}: horizontal overflow ${metrics.scrollWidth}/${metrics.width}`);
  await context.close();
}

async function record(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  name: string,
  route: string,
  viewport: { width: number; height: number },
  action: (page: Page) => Promise<void>,
) {
  const temp = path.join(videoRoot, ".raw");
  const context = await browser.newContext({ viewport, recordVideo: { dir: temp, size: viewport } });
  await prepare(context, "dark");
  const page = await context.newPage();
  await open(page, route);
  const video = page.video();
  await action(page);
  await page.waitForTimeout(350);
  await context.close();
  if (!video) return;
  const source = await video.path();
  await fs.rename(source, path.join(videoRoot, `${name}.webm`));
}

async function run() {
  await fs.mkdir(videoRoot, { recursive: true });
  const newsResponse = await fetch(`${baseUrl}/api/news`).catch(() => null);
  if (newsResponse?.ok) {
    const payload = (await newsResponse.json()) as { news?: Array<{ slug?: string }> };
    const slug = payload.news?.find((item) => item.slug)?.slug;
    if (slug) article = `${news}/${slug}`;
  }
  const browser = await chromium.launch({ headless: true });

  try {
    const desktop = { width: 1440, height: 900 };
    const wide = { width: 1920, height: 1080 };
    const mobile = { width: 375, height: 812 };

    await screenshot(browser, "home-1440-dark-full", home, desktop, "dark", undefined, true);
    await screenshot(browser, "home-1920-dark-full", home, wide, "dark", undefined, true);
    await screenshot(browser, "home-1440-light-full", home, desktop, "light", undefined, true);
    await screenshot(browser, "home-375-dark-full", home, mobile, "dark", undefined, true);
    await screenshot(browser, "home-375-light-full", home, mobile, "light", undefined, true);
    await screenshot(browser, "home-hero-initial", home, desktop, "dark");
    await screenshot(browser, "home-hero-mouse", home, desktop, "dark", async (page) => {
      await page.mouse.move(1180, 360);
      await page.waitForTimeout(650);
    });
    await screenshot(browser, "home-hero-end", home, desktop, "dark", async (page) => {
      await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.7));
      await page.waitForTimeout(900);
    });
    await screenshot(browser, "home-journey", home, desktop, "dark", (page) => scrollToSelector(page, "[data-qa='journey']", 120));
    await screenshot(browser, "home-connected-scenes", home, desktop, "light", (page) => settleAtSelector(page, "[data-qa='connected-scenes']", 120));
    await screenshot(browser, "home-product-showcase", home, desktop, "dark", async (page) => {
      const offset = await page.evaluate(() => window.innerHeight * 0.75);
      await scrollToSelector(page, "[data-showcase-pin]", offset);
    });
    await screenshot(browser, "home-news-teaser", home, desktop, "light", (page) => settleAtSelector(page, "[data-qa='news-teaser']", -80));
    await screenshot(browser, "home-final-cta", home, desktop, "dark", (page) => settleAtSelector(page, "[data-qa='final-cta']", -120));

    await screenshot(browser, "news-1440-dark-full", news, desktop, "dark", undefined, true);
    await screenshot(browser, "news-1440-light-full", news, desktop, "light", undefined, true);
    await screenshot(browser, "news-1920-dark", news, wide, "dark");
    await screenshot(browser, "news-active-card", news, desktop, "dark", (page) => scrollToSelector(page, "[data-qa='orbit']"));
    await screenshot(browser, "news-hover", news, desktop, "dark", async (page) => {
      await scrollToSelector(page, "[data-qa='orbit']");
      await page.locator("[data-orbit-card][data-active]").hover();
    });
    await screenshot(browser, "news-focus", news, desktop, "dark", async (page) => {
      await scrollToSelector(page, "[data-qa='orbit']");
      await page.locator("[data-orbit-card][data-active] a").focus();
    });
    await screenshot(browser, "news-wheel", news, desktop, "dark", async (page) => {
      await scrollToSelector(page, "[data-qa='orbit']");
      await page.mouse.move(720, 470);
      await page.mouse.wheel(0, 420);
      await page.waitForTimeout(800);
    });
    await screenshot(browser, "news-drag", news, desktop, "dark", async (page) => {
      await scrollToSelector(page, "[data-qa='orbit']");
      await page.mouse.move(850, 470);
      await page.mouse.down();
      await page.mouse.move(560, 470, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(800);
    });
    await screenshot(browser, "news-filters", news, desktop, "light", async (page) => {
      await page.locator("[data-qa='filters'] button").nth(2).click();
      await page.waitForTimeout(600);
    });
    await screenshot(browser, "news-375-dark", news, mobile, "dark", undefined, true);
    await screenshot(browser, "news-375-light", news, mobile, "light", undefined, true);
    await screenshot(browser, "news-article-dark", article, desktop, "dark", undefined, true);
    await screenshot(browser, "news-article-light", article, mobile, "light", undefined, true);

    await record(browser, "01-hero-to-path", home, desktop, async (page) => {
      const target = await page.locator("[data-qa='journey']").evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      await animateScroll(page, target, 2200);
    });
    await record(browser, "02-path-to-showcase", home, desktop, async (page) => {
      const start = await page.locator("[data-qa='journey']").evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      const target = await page.locator("[data-showcase-pin]").evaluate((el) => el.getBoundingClientRect().top + window.scrollY + window.innerHeight);
      await page.evaluate((y) => window.scrollTo(0, y), start);
      await animateScroll(page, target, 2400);
    });
    await record(browser, "03-showcase-to-news", home, desktop, async (page) => {
      const start = await page.locator("[data-showcase-pin]").evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      const target = await page.locator("[data-qa='news-teaser']").evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      await page.evaluate((y) => window.scrollTo(0, y), start);
      await animateScroll(page, target, 2200);
    });
    await record(browser, "04-market-orbit-idle", news, desktop, async (page) => {
      await scrollToSelector(page, "[data-qa='orbit']");
      await page.waitForTimeout(5600);
    });
    await record(browser, "05-market-orbit-drag-wheel", news, desktop, async (page) => {
      await scrollToSelector(page, "[data-qa='orbit']");
      await page.mouse.move(850, 460);
      await page.mouse.down();
      await page.mouse.move(560, 460, { steps: 16 });
      await page.mouse.up();
      await page.waitForTimeout(700);
      await page.mouse.wheel(0, 480);
      await page.waitForTimeout(900);
    });
    await record(browser, "06-home-fast-down", home, desktop, async (page) => {
      const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      await animateScroll(page, max, 1200);
    });
    await record(browser, "07-home-fast-up", home, desktop, async (page) => {
      const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      await page.evaluate((y) => window.scrollTo(0, y), max);
      await animateScroll(page, 0, 1200);
    });
    await record(browser, "08-mobile-swipe", news, mobile, async (page) => {
      const list = page.locator("section[aria-label='Лента новостей']");
      await list.scrollIntoViewIfNeeded();
      await page.mouse.move(320, 520);
      await page.mouse.down();
      await page.mouse.move(55, 520, { steps: 18 });
      await page.mouse.up();
      await page.waitForTimeout(900);
    });
  } finally {
    await browser.close();
  }

  const files = await fs.readdir(root, { recursive: true });
  const summary = { generatedAt: new Date().toISOString(), baseUrl, files: files.filter((file) => !String(file).includes(".raw")), errors };
  await fs.writeFile(path.join(root, "qa-summary.json"), JSON.stringify(summary, null, 2));
  console.log(`STAGE12_QA_DONE files=${summary.files.length} errors=${errors.length}`);
  for (const error of errors) console.log(`QA_WARNING ${error}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
