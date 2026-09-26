import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

const baseUrl = process.env.STAGE12_BASE_URL ?? "http://127.0.0.1:3100";
const route = "/design-lab/tradequest-hero-v3";
const root = path.join(process.cwd(), "design-memory", "screenshots", "stage-12-hero-v3");
const videoRoot = path.join(root, "video");
const errors: string[] = [];

async function prepare(context: BrowserContext) {
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
  await context.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("trading-platform-cookie-consent", JSON.stringify({ necessary: true, analytics: false, marketing: false, functional: false }));
  });
}

async function open(page: Page) {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
}

async function select(page: Page, index: number) {
  await page.getByRole("tab").nth(index).click();
  await page.waitForTimeout(700);
}

async function animateScroll(page: Page, target: number, duration: number) {
  const start = await page.evaluate(() => window.scrollY);
  for (let frame = 1; frame <= 48; frame += 1) {
    const progress = frame / 48;
    const eased = 0.5 - Math.cos(progress * Math.PI) / 2;
    await page.evaluate((y) => window.scrollTo(0, y), start + (target - start) * eased);
    await page.waitForTimeout(duration / 48);
  }
}

async function screenshotVariant(browser: Awaited<ReturnType<typeof chromium.launch>>, index: number, name: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await prepare(context);
  const page = await context.newPage();
  await open(page);
  await select(page, index);
  await page.screenshot({ path: path.join(root, `${name}.png`) });
  const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  if (metrics.scrollWidth > metrics.width + 2) errors.push(`${name}: horizontal overflow ${metrics.scrollWidth}/${metrics.width}`);
  await context.close();
}

async function recordVariant(browser: Awaited<ReturnType<typeof chromium.launch>>, index: number, name: string) {
  const raw = path.join(videoRoot, ".raw");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: raw, size: { width: 1440, height: 900 } } });
  await prepare(context);
  const page = await context.newPage();
  await open(page);
  await select(page, index);
  const video = page.video();
  const target = await page.evaluate(() => Math.min(document.documentElement.scrollHeight - innerHeight, innerHeight * 1.75));
  await animateScroll(page, target, 2600);
  await page.waitForTimeout(500);
  await context.close();
  if (!video) return;
  await fs.rename(await video.path(), path.join(videoRoot, `${name}.webm`));
}

async function run() {
  await fs.mkdir(videoRoot, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    await screenshotVariant(browser, 0, "hero-v3-a-monolith");
    await screenshotVariant(browser, 1, "hero-v3-b-system");
    await screenshotVariant(browser, 2, "hero-v3-c-corridor");
    await recordVariant(browser, 0, "hero-v3-a-transition");
    await recordVariant(browser, 1, "hero-v3-b-transition");
    await recordVariant(browser, 2, "hero-v3-c-transition");
  } finally {
    await browser.close();
  }
  const files = await fs.readdir(root, { recursive: true });
  const summary = { generatedAt: new Date().toISOString(), route, files: files.filter((file) => !String(file).includes(".raw")), errors };
  await fs.writeFile(path.join(root, "qa-summary.json"), JSON.stringify(summary, null, 2));
  console.log(`STAGE12_HERO_V3_QA files=${summary.files.length} errors=${errors.length}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
