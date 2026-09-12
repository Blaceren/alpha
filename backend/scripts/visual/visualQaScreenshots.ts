import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { PrismaClient, type UserRole } from "@prisma/client";

const baseUrl = process.env.VISUAL_QA_BASE_URL ?? "http://localhost:3009";
const outputRoot = path.join(process.cwd(), "visual-qa", "screenshots");
const screenshotTimeoutMs = Number(process.env.VISUAL_QA_TIMEOUT_MS ?? 20000);
const sessionCookieName = "trading_platform_session";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

const themes = ["light", "dark"] as const;

const accounts = {
  user: { email: "user@test.com", role: "user" },
  admin: { email: "admin@test.com", role: "admin" },
  support: { email: "support@test.com", role: "support" },
  mentor: { email: "mentor@test.com", role: "mentor" },
  moderator: { email: "moderator@test.com", role: "moderator" },
  newsEditor: { email: "news@test.com", role: "news_editor" },
} satisfies Record<string, { email: string; role: UserRole }>;

const roleAccountKey = {
  user: "user",
  admin: "admin",
  support: "support",
  mentor: "mentor",
  moderator: "moderator",
  news_editor: "newsEditor",
} satisfies Record<UserRole, keyof typeof accounts>;

type SessionCookie = {
  name: string;
  value: string;
  url: string;
  httpOnly: boolean;
  sameSite: "Lax";
  secure: boolean;
  expires: number;
};

type ScreenshotRoute = {
  route: string;
  role: string;
  fallbackRole?: string;
};

const routes: ScreenshotRoute[] = [
  ...["/", "/login", "/register", "/privacy", "/cookies", "/security"].map((route) => ({ route, role: "public" })),
  ...[
    "/dashboard",
    "/tasks",
    "/levels",
    "/rewards",
    "/rewards/daily",
    "/leaderboard",
    "/achievements",
    "/chat",
    "/mentor-chat",
    "/notifications",
    "/exchange",
    "/exchange/existing-account",
    "/feedback",
  ].map((route) => ({ route, role: "user" })),
  ...[
    "/design-lab",
    "/admin",
    "/admin/users",
    "/admin/tasks",
    "/admin/rewards",
    "/admin/promocodes",
    "/admin/achievements",
    "/admin/news",
    "/admin/task-reports",
    "/admin/exchange",
    "/admin/feedback",
    "/admin/audit-logs",
    "/crm",
    "/open-questions",
  ].map((route) => ({ route, role: "admin" })),
  { route: "/support", role: "support" },
  { route: "/admin/chat-moderation", role: "moderator", fallbackRole: "admin" },
];

type RouteCheck = {
  route: string;
  role: string;
  theme: string;
  viewport: string;
  screenshot?: string;
  ok: boolean;
  warnings: string[];
};

type BrowserContextLike = {
  addInitScript: (script: (themeName: string) => void, arg: string) => Promise<void>;
  addCookies: (cookies: SessionCookie[]) => Promise<void>;
  newPage: () => Promise<PageLike>;
  close: () => Promise<void>;
};

type PageLike = {
  goto: (url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<ResponseLike | null>;
  waitForLoadState: (state: string, options?: { timeout?: number }) => Promise<unknown>;
  waitForTimeout: (timeout: number) => Promise<void>;
  evaluate: <T, A = undefined>(callback: (arg: A) => T | Promise<T>, arg?: A) => Promise<T>;
  screenshot: (options: { path: string; fullPage: boolean }) => Promise<unknown>;
};

type ResponseLike = {
  status: () => number;
};

type RoleSession = {
  email: string;
  cookie: SessionCookie;
};

function getSessionSecret() {
  return process.env.SESSION_SECRET ?? "local-dev-session-secret";
}

function createSessionToken(userId: number, role: UserRole) {
  const expiresAt = Date.now() + sessionMaxAgeSeconds * 1000;
  const payload = `${userId}.${role}.${expiresAt}`;
  const signature = crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("hex");

  return {
    token: `${payload}.${signature}`,
    expiresAt,
  };
}

async function loadRoleSessions() {
  const prisma = new PrismaClient();
  const sessions = new Map<string, RoleSession>();

  try {
    for (const account of Object.values(accounts)) {
      const user = await prisma.user.findUnique({
        where: { email: account.email },
        select: { id: true, role: true, status: true },
      });

      if (!user || user.status === "blocked") continue;

      const { token, expiresAt } = createSessionToken(user.id, user.role);
      sessions.set(account.role, {
        email: account.email,
        cookie: {
          name: sessionCookieName,
          value: token,
          url: baseUrl,
          httpOnly: true,
          sameSite: "Lax",
          secure: false,
          expires: Math.floor(expiresAt / 1000),
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }

  return sessions;
}

function routeName(route: string) {
  if (route === "/") return "home";
  return route.replace(/^\//, "").replaceAll("/", "-");
}

async function ensureServer() {
  const response = await fetch(`${baseUrl}/api/health`);
  if (!response.ok) {
    throw new Error(`Health check failed with HTTP ${response.status}`);
  }
}

async function loadPlaywright() {
  const moduleName = "playwright";
  try {
    return await import(moduleName);
  } catch {
    return null;
  }
}

function printPlaywrightMissing() {
  console.warn("VISUAL_QA_SKIPPED: Playwright is not installed in this project.");
  console.warn("To enable screenshots locally:");
  console.warn("  npm.cmd install --save-dev playwright");
  console.warn("  npx playwright install chromium");
  console.warn("Then run:");
  console.warn("  npm.cmd run build");
  console.warn("  npm.cmd run start -- --port 3009");
  console.warn("  npm.cmd run visual:qa");
}

async function applyAuth(context: BrowserContextLike, role: string, sessions: Map<string, RoleSession>, warnings: string[]) {
  if (role === "public") return true;
  const roleKey = role as UserRole;
  const accountKey = roleAccountKey[roleKey];
  const session = sessions.get(roleKey);

  if (!accountKey || !session) {
    warnings.push(`No configured account for role ${role}`);
    return false;
  }

  await context.addCookies([session.cookie]);

  return true;
}

async function verifyAuth(page: PageLike, role: string, sessions: Map<string, RoleSession>, warnings: string[]) {
  if (role === "public") return true;
  const session = sessions.get(role as UserRole);
  const me = await page.evaluate(async () => {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    return response.ok ? response.json() : null;
  });

  if (!me?.user) {
    warnings.push(`Session failed for ${session?.email ?? role}`);
    return false;
  }

  return true;
}

async function applyTheme(context: BrowserContextLike, theme: "light" | "dark") {
  await context.addInitScript((themeName: string) => {
    window.localStorage.setItem("theme", themeName);
    window.localStorage.setItem(
      "trading-platform-cookie-consent",
      JSON.stringify({ necessary: true, analytics: false, marketing: false, functional: false }),
    );
    document.documentElement.classList.toggle("theme-dark", themeName === "dark");
    document.documentElement.classList.toggle("theme-light", themeName === "light");
    document.documentElement.dataset.theme = themeName;
  }, theme);
}

async function checkPage(page: PageLike) {
  return page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;
    const text = body.innerText ?? "";
    const badPatterns = [/Рџ|РЅ|Рґ|Рє|Рѕ|СЃ|С‚|СЊ|В·|вњ/];
    const main = document.querySelector("main");
    const horizontalOverflow = Math.ceil(body.scrollWidth) > Math.ceil(window.innerWidth + 2);
    const htmlOverflow = Math.ceil(html.scrollWidth) > Math.ceil(window.innerWidth + 2);
    const empty = text.trim().length < 20;
    const errorText = /Application error|Unhandled Runtime Error|Internal Server Error|Something went wrong/i.test(text);
    const mojibake = badPatterns.some((pattern) => pattern.test(text));

    return {
      mainExists: Boolean(main),
      horizontalOverflow: horizontalOverflow || htmlOverflow,
      empty,
      errorText,
      mojibake,
    };
  });
}

async function run() {
  await ensureServer();

  const playwright = await loadPlaywright();
  if (!playwright) {
    printPlaywrightMissing();
    return;
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const results: RouteCheck[] = [];
  const roleSessions = await loadRoleSessions();

  try {
    for (const theme of themes) {
      for (const viewport of viewports) {
        for (const item of routes) {
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
          });
          await applyTheme(context, theme);
          const page = await context.newPage();
          const warnings: string[] = [];
          let roleUsed = item.role;

          let authenticated = await applyAuth(context, roleUsed, roleSessions, warnings);
          if (!authenticated && item.fallbackRole) {
            warnings.push(`Retrying ${item.route} as ${item.fallbackRole}`);
            roleUsed = item.fallbackRole;
            authenticated = await applyAuth(context, roleUsed, roleSessions, warnings);
          }

          if (authenticated) {
            const response = await page.goto(`${baseUrl}${item.route}`, {
              waitUntil: "networkidle",
              timeout: screenshotTimeoutMs,
            });
            const status = response?.status();
            if (status && status >= 500) warnings.push(`HTTP ${status}`);
            await verifyAuth(page, roleUsed, roleSessions, warnings);
            await page.waitForTimeout(300);
            const checks = await checkPage(page);

            for (const [name, value] of Object.entries(checks)) {
              if (name === "mainExists" && !value) warnings.push("main content element is missing");
              if (name !== "mainExists" && value) warnings.push(name);
            }

            const directory = path.join(outputRoot, theme, viewport.name);
            await fs.mkdir(directory, { recursive: true });
            const screenshotPath = path.join(directory, `${routeName(item.route)}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });

            results.push({
              route: item.route,
              role: roleUsed,
              theme,
              viewport: viewport.name,
              screenshot: path.relative(process.cwd(), screenshotPath),
              ok: warnings.length === 0,
              warnings,
            });
          } else {
            results.push({
              route: item.route,
              role: roleUsed,
              theme,
              viewport: viewport.name,
              ok: false,
              warnings,
            });
          }

          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  await fs.mkdir(path.join(process.cwd(), "visual-qa"), { recursive: true });
  const summaryPath = path.join(process.cwd(), "visual-qa", "summary.json");
  await fs.writeFile(summaryPath, JSON.stringify({ baseUrl, generatedAt: new Date().toISOString(), results }, null, 2));

  const failed = results.filter((result) => !result.ok);
  console.log(`VISUAL_QA_DONE: ${results.length - failed.length}/${results.length} clean screenshots`);
  if (failed.length > 0) {
    console.log(`VISUAL_QA_WARNINGS: ${failed.length}`);
    for (const result of failed.slice(0, 30)) {
      console.log(`${result.theme}/${result.viewport}${result.route}: ${result.warnings.join(", ")}`);
    }
  }
  console.log(`Summary: ${path.relative(process.cwd(), summaryPath)}`);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/Executable doesn't exist|browserType.launch/i.test(message)) {
    console.error("VISUAL_QA_BROWSER_MISSING: Playwright is installed, but Chromium binaries are missing.");
    console.error("Run: npx playwright install chromium");
  } else {
    console.error(`VISUAL_QA_FAILED: ${message}`);
  }
  process.exitCode = 1;
});
