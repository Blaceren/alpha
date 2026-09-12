import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const baseUrl = process.env.HERO_V7_BASE_URL ?? "http://127.0.0.1:3112";
const route = "/design-lab/tradequest-hero-v7";
const root = path.join(process.cwd(), "design-memory", "screenshots", "hero-v7");
const videoRoot = path.join(root, "video");
const errors: string[] = [];

async function prepare(context: BrowserContext) {
  const userId = Number(process.env.HERO_V7_USER_ID ?? 18);
  const secret = process.env.SESSION_SECRET ?? "local-dev-session-secret";
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
  await context.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("trading-platform-cookie-consent", JSON.stringify({ necessary: true }));
  });
}

async function open(page: Page) {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.locator("[data-hero-v7]").waitFor({ state: "visible" });
  await page.waitForTimeout(1_650);
}

async function check(page: Page, name: string) {
  const result = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    heroVisible: Boolean(document.querySelector("[data-hero-v7]")),
    links: Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-hero-v7] a"))
      .map((link) => link.getAttribute("href")),
  }));
  if (result.scrollWidth > result.width + 2) errors.push(`${name}: overflow ${result.scrollWidth}/${result.width}`);
  if (!result.heroVisible) errors.push(`${name}: hero missing`);
  const required = ["/tasks", "/levels", "/mentor-chat", "/exchange", "/rewards/daily", "/leaderboard", "/news"];
  for (const href of required) if (!result.links.includes(href)) errors.push(`${name}: missing href ${href}`);
}

async function capture(browser: Browser, name: string, hover?: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await prepare(context);
  const page = await context.newPage();
  await open(page);
  if (hover) {
    await page.locator(`[data-module="${hover}"]`).first().hover();
    await page.waitForTimeout(420);
  }
  await check(page, name);
  await page.screenshot({ path: path.join(root, `${name}.png`) });
  await context.close();
}

async function animateScroll(page: Page, target: number, duration: number) {
  for (let frame = 0; frame <= 48; frame += 1) {
    const progress = frame / 48;
    const eased = 0.5 - Math.cos(progress * Math.PI) / 2;
    await page.evaluate((y) => window.scrollTo(0, y), target * eased);
    await page.waitForTimeout(duration / 48);
  }
}

async function record(browser: Browser) {
  const raw = path.join(videoRoot, ".raw");
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: raw, size: { width: 1440, height: 900 } },
  });
  await prepare(context);
  const page = await context.newPage();
  await open(page);
  const video = page.video();
  const stage = await page.locator("#product-stage").boundingBox();
  if (stage) {
    await page.mouse.move(stage.x + stage.width * 0.25, stage.y + stage.height * 0.25, { steps: 14 });
    await page.waitForTimeout(360);
    await page.mouse.move(stage.x + stage.width * 0.78, stage.y + stage.height * 0.68, { steps: 20 });
    await page.waitForTimeout(420);
  }
  await page.locator('[data-module="active-step"]').hover();
  await page.waitForTimeout(520);
  const target = await page.evaluate(() => Math.min(document.documentElement.scrollHeight - innerHeight, 560));
  await animateScroll(page, target, 1_900);
  await page.waitForTimeout(600);
  await context.close();
  if (video) await fs.rename(await video.path(), path.join(videoRoot, "hero-v7-live-product-stage.webm"));
}

async function run() {
  await fs.mkdir(videoRoot, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    await capture(browser, "hero-v7-1440-dark");
    await capture(browser, "hero-v7-hover-active-step", "active-step");
    await capture(browser, "hero-v7-hover-mentor", "mentor");
    await capture(browser, "hero-v7-hover-pocket", "pocket");
    await record(browser);
  } finally {
    await browser.close();
  }

  const files = await fs.readdir(root, { recursive: true });
  const summary = {
    generatedAt: new Date().toISOString(),
    route,
    viewport: "1440x900 dark",
    files: files.filter((file) => !String(file).includes(".raw")),
    errors,
  };
  await fs.writeFile(path.join(root, "qa-summary.json"), JSON.stringify(summary, null, 2));
  console.log(`HERO_V7_QA files=${summary.files.length} errors=${errors.length}`);
  if (errors.length > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
