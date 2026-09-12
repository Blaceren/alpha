import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const baseUrl = process.env.HERO_V6_BASE_URL ?? "http://127.0.0.1:3011";
const route = "/design-lab/tradequest-hero-v6";
const root = path.join(process.cwd(), "design-memory", "screenshots", "hero-v6");
const videoRoot = path.join(root, "video");
const errors: string[] = [];

async function prepare(context: BrowserContext, theme: "dark" | "light") {
  const userId = Number(process.env.HERO_V6_USER_ID ?? 18);
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
  await context.addInitScript((selectedTheme) => {
    localStorage.setItem("theme", selectedTheme);
    localStorage.setItem("trading-platform-cookie-consent", JSON.stringify({ necessary: true }));
  }, theme);
}

async function open(page: Page) {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.locator("[data-dashboard]").waitFor({ state: "visible" });
  await page.waitForTimeout(800);
}

async function check(page: Page, name: string) {
  const result = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    dashboardVisible: Boolean(document.querySelector("[data-dashboard]")),
    links: Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-dashboard] a")).map((link) => link.getAttribute("href")),
  }));
  if (result.scrollWidth > result.width + 2) errors.push(`${name}: overflow ${result.scrollWidth}/${result.width}`);
  if (!result.dashboardVisible) errors.push(`${name}: dashboard missing`);
  const required = ["/tasks", "/levels", "/mentor-chat", "/exchange", "/rewards/daily", "/leaderboard"];
  for (const href of required) if (!result.links.includes(href)) errors.push(`${name}: missing href ${href}`);
}

async function capture(
  browser: Browser,
  name: string,
  viewport: { width: number; height: number },
  theme: "dark" | "light",
  hover?: string,
) {
  const context = await browser.newContext({ viewport });
  await prepare(context, theme);
  const page = await context.newPage();
  await open(page);
  if (hover) {
    await page.locator(`[data-module="${hover}"]`).first().hover();
    await page.waitForTimeout(350);
  }
  await check(page, name);
  await page.screenshot({ path: path.join(root, `${name}.png`) });
  await context.close();
}

async function animateScroll(page: Page, target: number, duration: number) {
  for (let frame = 0; frame <= 45; frame += 1) {
    const progress = frame / 45;
    const eased = 0.5 - Math.cos(progress * Math.PI) / 2;
    await page.evaluate((y) => window.scrollTo(0, y), target * eased);
    await page.waitForTimeout(duration / 45);
  }
}

async function record(browser: Browser) {
  const raw = path.join(videoRoot, ".raw");
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: raw, size: { width: 1440, height: 900 } },
  });
  await prepare(context, "dark");
  const page = await context.newPage();
  await open(page);
  const video = page.video();
  const box = await page.locator("[data-dashboard]").boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.25, { steps: 12 });
    await page.waitForTimeout(350);
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7, { steps: 18 });
    await page.waitForTimeout(350);
  }
  await page.locator('[data-module="active-step"]').hover();
  await page.waitForTimeout(450);
  const target = await page.evaluate(() => Math.min(document.documentElement.scrollHeight - innerHeight, innerHeight * 0.7));
  await animateScroll(page, target, 1800);
  await page.waitForTimeout(500);
  await context.close();
  if (video) await fs.rename(await video.path(), path.join(videoRoot, "hero-v6-interaction-scroll.webm"));
}

async function run() {
  await fs.mkdir(videoRoot, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    await capture(browser, "hero-v6-1440-dark", { width: 1440, height: 900 }, "dark");
    await capture(browser, "hero-v6-1920-dark", { width: 1920, height: 1080 }, "dark");
    await capture(browser, "hero-v6-1440-light", { width: 1440, height: 900 }, "light");
    await capture(browser, "hero-v6-375-mobile", { width: 375, height: 812 }, "dark");
    await capture(browser, "hero-v6-hover-active-step", { width: 1440, height: 900 }, "dark", "active-step");
    await capture(browser, "hero-v6-hover-mentor", { width: 1440, height: 900 }, "dark", "mentor");
    await capture(browser, "hero-v6-hover-pocket", { width: 1440, height: 900 }, "dark", "pocket");
    await record(browser);
  } finally {
    await browser.close();
  }

  const files = await fs.readdir(root, { recursive: true });
  const summary = {
    generatedAt: new Date().toISOString(),
    route,
    files: files.filter((file) => !String(file).includes(".raw")),
    errors,
  };
  await fs.writeFile(path.join(root, "qa-summary.json"), JSON.stringify(summary, null, 2));
  console.log(`HERO_V6_QA files=${summary.files.length} errors=${errors.length}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
