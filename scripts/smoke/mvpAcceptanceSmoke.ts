import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3009").replace(/\/$/, "");
const postbackSecret = process.env.SMOKE_POSTBACK_SECRET ?? "dev-postback-secret";
const defaultPassword = process.env.SMOKE_PASSWORD ?? "password123";

type JsonBody = Record<string, unknown> | unknown[] | string | number | boolean | null;

type SmokeResponse = {
  endpoint: string;
  status: number;
  body: JsonBody;
  headers: Headers;
  text: string;
};

type CheckResult = {
  block: string;
  name: string;
  passed: boolean;
  error?: string;
};

const results: CheckResult[] = [];

function formatBody(body: JsonBody) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text.length > 700 ? `${text.slice(0, 700)}...` : text;
}

function fail(response: SmokeResponse, message: string): never {
  throw new Error(
    `${message}\nendpoint: ${response.endpoint}\nstatus: ${response.status}\nbody: ${formatBody(response.body)}`,
  );
}

function expectStatus(response: SmokeResponse, expected: number) {
  if (response.status !== expected) {
    fail(response, `Expected status ${expected}`);
  }
}

function asObject(body: JsonBody) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`Expected JSON object, got: ${formatBody(body)}`);
  }

  return body as Record<string, unknown>;
}

function asArray(value: unknown, field: string) {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }

  return value as Array<Record<string, unknown>>;
}

async function check(block: string, name: string, action: () => Promise<void> | void) {
  try {
    await action();
    results.push({ block, name, passed: true });
    console.log(`[PASS] ${block} :: ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ block, name, passed: false, error: message });
    console.error(`[FAIL] ${block} :: ${name}\n${message}`);
  }
}

class SmokeCookieJar {
  private readonly cookies = new Map<string, string>();
  sawSecureSessionCookie = false;

  absorb(headers: Headers) {
    const extendedHeaders = headers as Headers & { getSetCookie?: () => string[] };
    const setCookies = extendedHeaders.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""];

    for (const rawCookie of setCookies) {
      if (!rawCookie) continue;
      const firstPart = rawCookie.split(";", 1)[0];
      const separator = firstPart.indexOf("=");
      if (separator < 1) continue;
      const name = firstPart.slice(0, separator).trim();
      const value = firstPart.slice(separator + 1).trim();

      const isSecure = /\bSecure\b/i.test(rawCookie);
      if (isSecure && name === "trading_platform_session") {
        this.sawSecureSessionCookie = true;
      }

      if (isSecure && baseUrl.startsWith("http://")) {
        this.cookies.delete(name);
        continue;
      }

      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
  }

  header() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

class ApiClient {
  readonly jar = new SmokeCookieJar();
  csrfToken: string | null = null;

  async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    const cookie = this.jar.header();
    if (cookie) headers.set("cookie", cookie);

    const response = await fetch(`${baseUrl}${path}`, {
      redirect: "manual",
      ...init,
      headers,
    });
    this.jar.absorb(response.headers);
    const text = await response.text();
    let body: JsonBody = text;

    try {
      body = text ? (JSON.parse(text) as JsonBody) : null;
    } catch {
      body = text;
    }

    return {
      endpoint: `${init.method ?? "GET"} ${path}`,
      status: response.status,
      body,
      headers: response.headers,
      text,
    } satisfies SmokeResponse;
  }

  get(path: string) {
    return this.request(path, { cache: "no-store" });
  }

  post(path: string, body: Record<string, unknown>, options: { csrf?: boolean; headers?: HeadersInit } = {}) {
    const headers = new Headers(options.headers);
    headers.set("content-type", "application/json");
    if (options.csrf) {
      if (!this.csrfToken) throw new Error(`CSRF token is missing for POST ${path}`);
      headers.set("x-csrf-token", this.csrfToken);
    }

    return this.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  }

  patch(path: string, body: Record<string, unknown>) {
    if (!this.csrfToken) throw new Error(`CSRF token is missing for PATCH ${path}`);

    return this.request(path, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-csrf-token": this.csrfToken },
      body: JSON.stringify(body),
    });
  }

  delete(path: string) {
    if (!this.csrfToken) throw new Error(`CSRF token is missing for DELETE ${path}`);
    return this.request(path, { method: "DELETE", headers: { "x-csrf-token": this.csrfToken } });
  }

  postForm(path: string, formData: FormData, options: { csrf?: boolean } = {}) {
    const headers = new Headers();
    if (options.csrf) {
      if (!this.csrfToken) throw new Error(`CSRF token is missing for POST ${path}`);
      headers.set("x-csrf-token", this.csrfToken);
    }

    return this.request(path, { method: "POST", headers, body: formData });
  }

  async loadCsrf() {
    const response = await this.get("/api/csrf");
    expectStatus(response, 200);
    const token = asObject(response.body).csrfToken;
    if (typeof token !== "string" || token.length === 0) fail(response, "csrfToken is missing");
    this.csrfToken = token;
  }
}

function restoreSeed() {
  const result = process.platform === "win32"
    ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm.cmd run prisma:seed"], {
        cwd: process.cwd(),
        encoding: "utf8",
      })
    : spawnSync("npm", ["run", "prisma:seed"], {
        cwd: process.cwd(),
        encoding: "utf8",
      });

  if (result.status !== 0) {
    throw new Error(`prisma:seed exited with ${result.status}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
}

type SmokeRole = "user" | "admin" | "support" | "mentor" | "moderator" | "news_editor";

async function login(role: SmokeRole) {
  const client = new ApiClient();
  const response = await client.post("/api/auth/login", {
    email: role === "news_editor" ? "news@test.com" : `${role}@test.com`,
    password: defaultPassword,
    captchaToken: "dev-captcha-ok",
  });
  expectStatus(response, 200);
  const user = asObject(asObject(response.body).user as JsonBody);
  if (user.role !== role) fail(response, `Expected role ${role}`);

  return { client, user };
}

function requireClient(client: ApiClient | undefined, role: string) {
  if (!client) throw new Error(`Login ${role} was not completed`);
  return client;
}

async function getMe(client: ApiClient) {
  const response = await client.get("/api/me");
  expectStatus(response, 200);
  return asObject(asObject(response.body).user as JsonBody);
}

async function getActiveTaskStep(client: ApiClient) {
  const response = await client.get("/api/tasks");
  expectStatus(response, 200);
  const tasks = asArray(asObject(response.body).tasks, "tasks");
  const active = tasks.find((task) => {
    const progress = Array.isArray(task.progress) ? task.progress : [];
    return progress.some((item) => asObject(item as JsonBody).status === "active");
  });

  if (!active) fail(response, "Active task not found");

  return {
    stepNumber: Number(active.stepNumber),
    requiresReport: active.requiresReport === true,
    xpReward: Number(active.xpReward),
  };
}

async function getNotifications(client: ApiClient) {
  const response = await client.get("/api/notifications");
  expectStatus(response, 200);
  const body = asObject(response.body);

  return {
    response,
    items: asArray(body.items, "items"),
    unreadCount: Number(body.unreadCount),
  };
}

async function assertPage(client: ApiClient, path: string, expected = 200) {
  const response = await client.get(path);
  expectStatus(response, expected);
  if (expected === 200 && !response.text.includes("<html")) {
    fail(response, "Expected HTML page");
  }

  return response;
}

async function main() {
  console.log(`MVP acceptance smoke target: ${baseUrl}`);

  let userClient: ApiClient | undefined;
  let adminClient: ApiClient | undefined;
  let supportClient: ApiClient | undefined;
  let mentorClient: ApiClient | undefined;
  let moderatorClient: ApiClient | undefined;
  let newsEditorClient: ApiClient | undefined;
  let reportTaskStep = 0;
  let reportTaskXpReward = 0;
  let reportId = 0;
  let taskFileAssetId = 0;
  let supportFileAssetId = 0;
  let supportDialogId = 0;
  let feedbackId = 0;
  let exchangeExternalAccountId = "";
  let exchangeAccountId = 0;
  let userXpBeforeReportCompletion = 0;
  let userXpAfterReportCompletion = 0;
  let rewardCountAfterReportCompletion = 0;
  let chatMessageId = 0;
  let betaTesterId = 0;
  let betaTesterEmail = "";
  let betaTesterClient: ApiClient | undefined;

  try {
    await check("Setup", "restore deterministic seed", () => restoreSeed());

    const publicClient = new ApiClient();
    await check("Readiness", "health and readiness are ok", async () => {
      const health = await publicClient.get("/api/health");
      expectStatus(health, 200);
      const readiness = await publicClient.get("/api/readiness");
      expectStatus(readiness, 200);
      if (asObject(readiness.body).ok !== true) fail(readiness, "Readiness is not ok");
    });

    for (const page of ["/", "/news", "/login", "/register", "/privacy", "/cookies", "/security"]) {
      await check("Pages public", `GET ${page} -> 200`, async () => {
        await assertPage(publicClient, page);
      });
    }
    await check("Pages public", "GET /news/[id] -> 200", async () => {
      const news = await publicClient.get("/api/news");
      expectStatus(news, 200);
      const items = asArray(asObject(news.body).news, "news");
      const slug = String(items[0]?.slug ?? "");
      if (!slug) fail(news, "Seed news is missing");
      await assertPage(publicClient, `/news/${slug}`);
    });

    for (const role of ["user", "admin", "support", "mentor", "moderator", "news_editor"] as const) {
      await check("Auth", `login ${role}@test.com`, async () => {
        const authenticated = await login(role);
        if (role === "user") userClient = authenticated.client;
        if (role === "admin") adminClient = authenticated.client;
        if (role === "support") supportClient = authenticated.client;
        if (role === "mentor") mentorClient = authenticated.client;
        if (role === "moderator") moderatorClient = authenticated.client;
        if (role === "news_editor") newsEditorClient = authenticated.client;
      });
    }

    await check("Seed", "demo user starts with XP 420 and active step 6", async () => {
      const client = requireClient(userClient, "user");
      const user = await getMe(client);
      if (Number(user.xp) !== 420) throw new Error(`Expected XP 420, got ${String(user.xp)}`);
      const active = await getActiveTaskStep(client);
      if (active.stepNumber !== 6) throw new Error(`Expected active step 6, got ${active.stepNumber}`);
      const response = await client.get("/api/tasks");
      expectStatus(response, 200);
      const tasks = asArray(asObject(response.body).tasks, "tasks");
      if (tasks.length !== 16) fail(response, `Expected 16 seeded tasks, got ${tasks.length}`);
      if (new Set(tasks.map((task) => task.code)).size !== 16) fail(response, "Task stable codes are missing or duplicated");
    });

    await check("Pages user", "user pages render", async () => {
      const client = requireClient(userClient, "user");
      for (const page of [
        "/dashboard",
        "/tasks",
        "/levels",
        "/rewards",
        "/rewards/daily",
        "/chat",
        "/mentor-chat",
        "/leaderboard",
        "/achievements",
        "/notifications",
        "/exchange",
        "/feedback",
      ]) {
        await assertPage(client, page);
      }
    });
    await check("Pages admin", "admin pages render", async () => {
      const client = requireClient(adminClient, "admin");
      for (const page of ["/admin", "/admin/users", "/admin/tasks", "/admin/rewards", "/admin/promocodes", "/admin/achievements", "/admin/news", "/admin/audit-logs", "/admin/task-reports", "/admin/exchange", "/admin/feedback", "/crm", "/open-questions"]) {
        await assertPage(client, page);
      }
    });
    await check("Pages support mentor", "support and mentor pages render", async () => {
      await assertPage(requireClient(supportClient, "support"), "/support");
      await assertPage(requireClient(mentorClient, "mentor"), "/support");
      await assertPage(requireClient(mentorClient, "mentor"), "/admin/task-reports");
    });
    await check("Pages scoped roles", "moderator and news editor pages render", async () => {
      await assertPage(requireClient(moderatorClient, "moderator"), "/admin/chat-moderation");
      await assertPage(requireClient(newsEditorClient, "news_editor"), "/admin/news");
    });

    await check("Pages scoped roles", "service roles are redirected away from user dashboard", async () => {
      for (const [role, client] of [
        ["support", requireClient(supportClient, "support")],
        ["mentor", requireClient(mentorClient, "mentor")],
        ["moderator", requireClient(moderatorClient, "moderator")],
        ["news_editor", requireClient(newsEditorClient, "news_editor")],
      ] as const) {
        const response = await client.get("/dashboard");
        expectStatus(response, 307);
        if (!String(response.headers.get("location")).endsWith("/403")) {
          fail(response, `${role} dashboard denial did not redirect to /403`);
        }
      }
    });

    await check("Dev tools", "design lab is admin-only and absent from user navigation", async () => {
      const anonymous = await publicClient.get("/design-lab");
      expectStatus(anonymous, 307);
      if (!String(anonymous.headers.get("location")).includes("/login?next=%2Fdesign-lab")) fail(anonymous, "Anonymous design-lab redirect is wrong");
      const userDenied = await requireClient(userClient, "user").get("/design-lab");
      expectStatus(userDenied, 307);
      if (!String(userDenied.headers.get("location")).endsWith("/403")) fail(userDenied, "User design-lab denial is wrong");
      await assertPage(requireClient(adminClient, "admin"), "/design-lab");
      const userDashboard = await assertPage(requireClient(userClient, "user"), "/dashboard");
      if (userDashboard.text.includes("/design-lab")) fail(userDashboard, "User navigation exposes design-lab");
    });

    await check("Navigation", "role navigation is scoped", async () => {
      const userDashboard = await assertPage(requireClient(userClient, "user"), "/dashboard");
      if (!userDashboard.text.includes("/exchange")) fail(userDashboard, "User nav misses exchange");
      if (!userDashboard.text.includes("/feedback")) fail(userDashboard, "User nav misses feedback");
      if (userDashboard.text.includes("/admin/users")) fail(userDashboard, "User nav leaks admin users");

      const adminDashboard = await assertPage(requireClient(adminClient, "admin"), "/admin");
      if (!adminDashboard.text.includes("/admin/exchange")) fail(adminDashboard, "Admin nav misses exchange");
      if (!adminDashboard.text.includes("/admin/audit-logs")) fail(adminDashboard, "Admin nav misses audit");
      if (!adminDashboard.text.includes("/admin/feedback")) fail(adminDashboard, "Admin nav misses feedback");

      const supportPage = await assertPage(requireClient(supportClient, "support"), "/support");
      if (!supportPage.text.includes("/support")) fail(supportPage, "Support nav misses support");
      if (supportPage.text.includes("/admin/users")) fail(supportPage, "Support nav leaks admin users");

      const mentorPage = await assertPage(requireClient(mentorClient, "mentor"), "/admin/task-reports");
      if (!mentorPage.text.includes("/admin/task-reports")) fail(mentorPage, "Mentor nav misses reports");
      if (mentorPage.text.includes("/admin/users")) fail(mentorPage, "Mentor nav leaks admin users");

      const moderatorPage = await assertPage(requireClient(moderatorClient, "moderator"), "/admin/chat-moderation");
      if (!moderatorPage.text.includes("/admin/chat-moderation")) fail(moderatorPage, "Moderator nav misses moderation");
      if (moderatorPage.text.includes("/admin/users")) fail(moderatorPage, "Moderator nav leaks admin users");

      const newsEditorPage = await assertPage(requireClient(newsEditorClient, "news_editor"), "/admin/news");
      if (!newsEditorPage.text.includes("/admin/news")) fail(newsEditorPage, "News editor nav misses news admin");
      if (newsEditorPage.text.includes("/admin/users")) fail(newsEditorPage, "News editor nav leaks admin users");
    });

    await check("Roles", "moderator and news editor permissions are scoped", async () => {
      expectStatus(await requireClient(moderatorClient, "moderator").get("/api/admin/users"), 403);
      expectStatus(await requireClient(moderatorClient, "moderator").get("/api/admin/news"), 403);
      expectStatus(await requireClient(newsEditorClient, "news_editor").get("/api/admin/news"), 200);
      expectStatus(await requireClient(newsEditorClient, "news_editor").get("/api/admin/users"), 403);
      expectStatus(await requireClient(newsEditorClient, "news_editor").get("/api/crm/users"), 403);
      expectStatus(await requireClient(newsEditorClient, "news_editor").get("/api/admin/exchange/accounts"), 403);
      expectStatus(await requireClient(supportClient, "support").get("/api/admin/chat-moderation"), 403);
      expectStatus(await requireClient(userClient, "user").get("/api/open-questions"), 403);
      expectStatus(await requireClient(adminClient, "admin").get("/api/open-questions"), 200);
      await requireClient(userClient, "user").loadCsrf();
      expectStatus(await requireClient(userClient, "user").post("/api/exchange/postbacks/simulate", { type: "Registration" }, { csrf: true }), 403);
    });

    await check("Tester onboarding", "new tester registers, logs in and receives active step 1", async () => {
      betaTesterEmail = `beta-${Date.now()}@example.com`;
      const registrationClient = new ApiClient();
      betaTesterClient = registrationClient;
      const registration = await registrationClient.post("/api/auth/register", {
        email: betaTesterEmail,
        password: "BetaTester123",
        captchaToken: "dev-captcha-ok",
      });
      expectStatus(registration, 201);
      const verification = asObject(asObject(registration.body).verification as JsonBody);
      if (verification.required !== false) fail(registration, "Closed beta registration unexpectedly requires email verification");
      betaTesterId = Number(asObject(asObject(registration.body).user as JsonBody).id);
      if (!betaTesterId) fail(registration, "Registered beta tester id is missing");
      await assertPage(registrationClient, "/dashboard");
      const tasks = await registrationClient.get("/api/tasks");
      expectStatus(tasks, 200);
      const active = asArray(asObject(tasks.body).tasks, "tasks").find((task) => asArray(task.progress, "progress")[0]?.status === "active");
      if (Number(active?.stepNumber) !== 1) fail(tasks, "New beta tester did not receive active step 1");

      const loginClient = new ApiClient();
      const loginResponse = await loginClient.post("/api/auth/login", {
        email: betaTesterEmail,
        password: "BetaTester123",
        captchaToken: "dev-captcha-ok",
      });
      expectStatus(loginResponse, 200);
      if (baseUrl.startsWith("http://") && loginClient.jar.sawSecureSessionCookie) {
        fail(loginResponse, "HTTP login returned a Secure session cookie that browsers will reject");
      }
      await assertPage(loginClient, "/dashboard");
      await assertPage(loginClient, "/exchange");
    });

    await check("Tester onboarding", "admin sees tester and operational summary", async () => {
      const admin = requireClient(adminClient, "admin");
      const list = await admin.get(`/api/admin/users?q=${encodeURIComponent(betaTesterEmail)}`);
      expectStatus(list, 200);
      const users = asArray(asObject(list.body).items, "items");
      if (!users.some((item) => Number(item.id) === betaTesterId)) fail(list, "Registered tester is missing from admin users");
      const detail = await admin.get(`/api/admin/users/${betaTesterId}`);
      expectStatus(detail, 200);
      const summary = asObject(asObject(asObject(detail.body).user as JsonBody).betaSummary as JsonBody);
      if (Number(asObject(summary.activeStep as JsonBody).stepNumber) !== 1) fail(detail, "Admin tester summary misses active step 1");
      if (Number(summary.totalTasks) < 1 || !summary.lastActivityAt) fail(detail, "Admin tester summary is incomplete");
    });

    await check("Admin users", "service account creation and blocked login work", async () => {
      const admin = requireClient(adminClient, "admin");
      await admin.loadCsrf();
      const email = `service-${Date.now()}@example.com`;
      const created = await admin.post("/api/admin/users", { email, name: "Smoke service", role: "support", password: "Service123" }, { csrf: true });
      expectStatus(created, 201);
      const serviceUser = asObject(asObject(created.body).user as JsonBody);
      const userId = Number(serviceUser.id);
      const blocked = await admin.patch(`/api/admin/users/${userId}`, { status: "blocked" });
      expectStatus(blocked, 200);
      const loginResponse = await new ApiClient().post("/api/auth/login", { email, password: "Service123", captchaToken: "dev-captcha-ok" });
      expectStatus(loginResponse, 403);
    });

    await check("News editor", "draft creation and publishing work", async () => {
      const editor = requireClient(newsEditorClient, "news_editor");
      await editor.loadCsrf();
      const created = await editor.post("/api/admin/news", { title: `Smoke news ${Date.now()}`, excerpt: "Smoke excerpt", content: "Smoke content", category: "QA", author: "News editor", status: "draft" }, { csrf: true });
      expectStatus(created, 201);
      const item = asObject(asObject(created.body).newsItem as JsonBody);
      const published = await editor.patch(`/api/admin/news/${Number(item.id)}`, { status: "published" });
      expectStatus(published, 200);
      if (asObject(asObject(published.body).newsItem as JsonBody).status !== "published") fail(published, "News editor could not publish draft");
    });

    await check("Referrals", "double-sided bonus is granted once", async () => {
      const inviter = requireClient(userClient, "user");
      const before = await getMe(inviter);
      const referralLink = String(asObject(before.referrals as JsonBody).link ?? "");
      const referralCode = new URL(referralLink).searchParams.get("ref");
      if (!referralCode) throw new Error("Referral code is missing");
      const email = `referral-${Date.now()}@example.com`;
      const referred = new ApiClient();
      const registration = await referred.post("/api/auth/register", { email, password: "Referral123", captchaToken: "dev-captcha-ok", referralCode });
      expectStatus(registration, 201);
      const invitedUser = asObject(asObject(registration.body).user as JsonBody);
      if (Number(invitedUser.xp) !== 50) fail(registration, "Invited user bonus is missing");
      const after = await getMe(inviter);
      if (Number(after.xp) !== Number(before.xp) + 100) throw new Error("Inviter bonus is missing or duplicated");
      const duplicate = await new ApiClient().post("/api/auth/register", { email, password: "Referral123", captchaToken: "dev-captcha-ok", referralCode });
      expectStatus(duplicate, 400);
      const afterDuplicate = await getMe(inviter);
      if (Number(afterDuplicate.xp) !== Number(after.xp)) throw new Error("Referral bonus was granted twice");
    });

    await check("Feedback", "user submits bug feedback", async () => {
      const client = requireClient(userClient, "user");
      await client.loadCsrf();
      const response = await client.post(
        "/api/feedback",
        {
          type: "bug",
          severity: "high",
          title: "MVP acceptance feedback",
          message: "Feedback flow smoke test",
          pageUrl: `${baseUrl}/tasks`,
          browserInfo: "mvp-acceptance-smoke",
        },
        { csrf: true },
      );
      expectStatus(response, 201);
      const feedback = asObject(asObject(response.body).feedback as JsonBody);
      feedbackId = Number(feedback.id);
      if (feedback.status !== "new") fail(response, "Feedback is not new");
      if (!feedbackId) fail(response, "Feedback id is missing");
    });

    await check("Feedback", "admin opens feedback list and detail", async () => {
      const admin = requireClient(adminClient, "admin");
      const list = await admin.get("/api/admin/feedback?type=bug&severity=high&status=new&order=desc");
      expectStatus(list, 200);
      const items = asArray(asObject(list.body).items, "items");
      if (!items.some((item) => Number(item.id) === feedbackId)) {
        fail(list, "Submitted feedback is missing from admin list");
      }

      const detail = await admin.get(`/api/admin/feedback/${feedbackId}`);
      expectStatus(detail, 200);
      const feedback = asObject(asObject(detail.body).feedback as JsonBody);
      if (feedback.title !== "MVP acceptance feedback") {
        fail(detail, "Admin feedback detail has unexpected data");
      }

      const critical = await admin.get("/api/admin/feedback?unresolved=true&critical=true&order=desc");
      expectStatus(critical, 200);
      const criticalItems = asArray(asObject(critical.body).items, "items");
      if (!criticalItems.some((item) => Number(item.id) === feedbackId)) {
        fail(critical, "Critical unresolved feedback filter misses submitted item");
      }
    });

    await check("Feedback", "admin triages then resolves with comment", async () => {
      const admin = requireClient(adminClient, "admin");
      await admin.loadCsrf();
      const triaged = await admin.patch(`/api/admin/feedback/${feedbackId}`, {
        status: "triaged",
      });
      expectStatus(triaged, 200);
      if (asObject(asObject(triaged.body).feedback as JsonBody).status !== "triaged") {
        fail(triaged, "Feedback is not triaged");
      }

      const resolved = await admin.patch(`/api/admin/feedback/${feedbackId}`, {
        status: "resolved",
        adminComment: "Resolved in MVP acceptance smoke",
      });
      expectStatus(resolved, 200);
      const feedback = asObject(asObject(resolved.body).feedback as JsonBody);
      if (feedback.status !== "resolved") fail(resolved, "Feedback is not resolved");
      if (feedback.adminComment !== "Resolved in MVP acceptance smoke") {
        fail(resolved, "Admin comment is missing");
      }
      if (!feedback.resolvedAt || !feedback.resolvedBy) {
        fail(resolved, "Resolution metadata is missing");
      }
    });

    await check("Feedback", "support can open problems while user and mentor cannot", async () => {
      expectStatus(await requireClient(userClient, "user").get("/api/admin/feedback"), 403);
      expectStatus(await requireClient(supportClient, "support").get("/api/admin/feedback"), 200);
      expectStatus(await requireClient(mentorClient, "mentor").get("/api/admin/feedback"), 403);
    });

    await check("Feedback", "feedback audit actions and admin notification exist", async () => {
      const audit = await requireClient(adminClient, "admin").get("/api/admin/audit-logs?pageSize=100");
      expectStatus(audit, 200);
      const actions = asArray(asObject(audit.body).logs, "logs").map((log) => log.action);
      for (const action of [
        "TESTER_FEEDBACK_SUBMITTED",
        "ADMIN_FEEDBACK_UPDATED",
        "ADMIN_FEEDBACK_RESOLVED",
      ]) {
        if (!actions.includes(action)) fail(audit, `Audit misses ${action}`);
      }

      const notifications = await getNotifications(requireClient(adminClient, "admin"));
      if (!notifications.items.some((item) => item.type === "system")) {
        fail(notifications.response, "Admin feedback notification is missing");
      }
    });

    await check("Exchange", "user connects and verifies sandbox exchange", async () => {
      const client = requireClient(userClient, "user");
      await client.loadCsrf();
      const connect = await client.post(
        "/api/exchange/connect",
        { externalAccountId: `MVP-SMOKE-${Date.now()}`, provider: "sandbox" },
        { csrf: true },
      );
      expectStatus(connect, 200);
      if (asObject(asObject(connect.body).account as JsonBody).status !== "pending") fail(connect, "Account is not pending");

      const verify = await client.post("/api/exchange/verify", {}, { csrf: true });
      expectStatus(verify, 200);
      const account = asObject(asObject(verify.body).account as JsonBody);
      exchangeAccountId = Number(account.id);
      exchangeExternalAccountId = String(account.externalAccountId ?? account.exchangeAccountId);
      if (account.status !== "connected") fail(verify, "Account is not connected");
      const registration = await new ApiClient().post(
        "/api/exchange/postbacks/receive",
        {
          type: "Registration",
          trader_id: exchangeExternalAccountId,
          externalEventId: `mvp-user-registration-${Date.now()}`,
        },
        { headers: { "x-postback-secret": postbackSecret } },
      );
      expectStatus(registration, 200);
    });

    await check("Pocket registration", "CTA creates click_id and Registration postback completes level 1 once", async () => {
      const client = requireClient(betaTesterClient, "beta tester");
      await client.loadCsrf();
      const before = await getMe(client);
      const xpBefore = Number(before.xp);
      const referral = await client.post("/api/exchange/referral-link", {}, { csrf: true });
      expectStatus(referral, 200);
      const referralUrl = String(asObject(referral.body).referralUrl ?? "");
      const clickId = new URL(referralUrl).searchParams.get("clickid") ?? "";
      if (!clickId) fail(referral, "Pocket CTA did not create click_id");

      const pendingTasks = await client.get("/api/tasks");
      expectStatus(pendingTasks, 200);
      const pendingItems = asArray(asObject(pendingTasks.body).tasks, "tasks");
      const levelOne = pendingItems.find((task) => task.code === "lvl_01_pocket_registration");
      if (!levelOne || asArray(levelOne.progress, "progress")[0]?.status !== "active") {
        fail(pendingTasks, "CTA completed level 1 before postback");
      }

      const eventId = `registration-task-${Date.now()}`;
      const eventPath = `/api/postbacks/pocket?goal=reg&clickid=${encodeURIComponent(clickId)}&playerid=beta-player&event_id=${eventId}`;
      const event = await new ApiClient().request(eventPath, { headers: { "x-postback-secret": postbackSecret } });
      expectStatus(event, 200);
      if (asObject(event.body).duplicate !== false) fail(event, "First Registration postback was marked duplicate");

      const duplicate = await new ApiClient().request(eventPath, { headers: { "x-postback-secret": postbackSecret } });
      expectStatus(duplicate, 200);
      if (asObject(duplicate.body).duplicate !== true) fail(duplicate, "Duplicate Registration postback was not idempotent");

      const unknown = await new ApiClient().request(
        `/api/postbacks/pocket?goal=reg&clickid=unknown-smoke-click&playerid=unknown&event_id=unknown-${Date.now()}`,
        { headers: { "x-postback-secret": postbackSecret } },
      );
      expectStatus(unknown, 404);

      const active = await getActiveTaskStep(client);
      if (active.stepNumber !== 2) throw new Error(`Registration postback did not activate level 2: ${active.stepNumber}`);
      const after = await getMe(client);
      if (Number(after.xp) !== xpBefore + 15) throw new Error("Level 1 XP was not awarded exactly once");
    });

    await check("Tasks", "level 6 completion unlocks level 7 report task", async () => {
      const client = requireClient(userClient, "user");
      const lesson = await getActiveTaskStep(client);
      if (lesson.stepNumber !== 6) throw new Error(`Expected level 6, got ${lesson.stepNumber}`);
      expectStatus(await client.post("/api/tasks/6/complete", {}, { csrf: true }), 200);
      const reportTask = await getActiveTaskStep(client);
      if (reportTask.stepNumber !== 7) throw new Error(`Expected level 7, got ${reportTask.stepNumber}`);
      if (!reportTask.requiresReport) throw new Error("Expected report task to be active");
      reportTaskStep = reportTask.stepNumber;
      reportTaskXpReward = reportTask.xpReward;
      const blocked = await client.post(`/api/tasks/${reportTaskStep}/complete`, {}, { csrf: true });
      expectStatus(blocked, 400);
    });

    await check("Task report", "user submits report with text url and file", async () => {
      const client = requireClient(userClient, "user");
      const formData = new FormData();
      formData.set("file", new File(["mvp acceptance report"], "mvp-report.txt", { type: "text/plain" }));
      formData.set("purpose", "task_report");
      const upload = await client.postForm("/api/files/upload", formData, { csrf: true });
      expectStatus(upload, 201);
      taskFileAssetId = Number(asObject(asObject(upload.body).file as JsonBody).id);

      const submit = await client.post(
        `/api/tasks/${reportTaskStep}/report`,
        {
          reportText: "MVP acceptance report",
          reportUrl: "https://example.com/mvp-report",
          fileAssetId: taskFileAssetId,
        },
        { csrf: true },
      );
      expectStatus(submit, 201);
      const report = asObject(asObject(submit.body).report as JsonBody);
      reportId = Number(report.id);
      if (report.status !== "pending") fail(submit, "Report is not pending");
    });

    await check("Task report", "mentor rejects, user resubmits, mentor approves", async () => {
      const mentor = requireClient(mentorClient, "mentor");
      await mentor.loadCsrf();
      const reject = await mentor.patch(`/api/admin/task-reports/${reportId}`, {
        status: "rejected",
        reviewComment: "Fix the report",
      });
      expectStatus(reject, 200);

      const resubmit = await requireClient(userClient, "user").post(
        `/api/tasks/${reportTaskStep}/report`,
        { reportText: "MVP acceptance report fixed" },
        { csrf: true },
      );
      expectStatus(resubmit, 200);

      const beforeApproval = await getMe(requireClient(userClient, "user"));
      userXpBeforeReportCompletion = Number(beforeApproval.xp);
      const approve = await mentor.patch(`/api/admin/task-reports/${reportId}`, {
        status: "approved",
        reviewComment: "Accepted",
      });
      expectStatus(approve, 200);
      const afterApproval = await getMe(requireClient(userClient, "user"));
      userXpAfterReportCompletion = Number(afterApproval.xp);
      if (userXpAfterReportCompletion !== userXpBeforeReportCompletion + reportTaskXpReward) {
        throw new Error("Mentor approval did not grant report XP exactly once");
      }
      rewardCountAfterReportCompletion = asArray(afterApproval.rewards, "rewards").length;
    });

    await check("Task report", "duplicate completion does not grant XP or reward twice", async () => {
      const client = requireClient(userClient, "user");
      const complete = await client.post(`/api/tasks/${reportTaskStep}/complete`, {}, { csrf: true });
      expectStatus(complete, 200);
      const xpAwarded = Number(asObject(complete.body).xpAwarded);
      if (xpAwarded !== 0) fail(complete, "Duplicate completion awarded XP");

      const after = await getMe(client);
      if (Number(after.xp) !== userXpAfterReportCompletion) {
        throw new Error("Duplicate completion changed XP");
      }
      if (asArray(after.rewards, "rewards").length !== rewardCountAfterReportCompletion) {
        throw new Error("Duplicate completion changed reward count");
      }
    });

    await check("Checkpoint", "checkpoint API still works", async () => {
      const user = await getMe(requireClient(userClient, "user"));
      const checkpoint = asObject(user.checkpoint as JsonBody);
      const response = await requireClient(userClient, "user").post(
        `/api/checkpoints/${Number(checkpoint.id)}/check`,
        {},
        { csrf: true },
      );
      expectStatus(response, 200);
    });

    await check("Level progression", "balance thresholds 500/1000/2000 and mentor approval are enforced", async () => {
      const user = requireClient(userClient, "user");
      const admin = requireClient(adminClient, "admin");
      const mentor = requireClient(mentorClient, "mentor");
      await admin.loadCsrf();
      await mentor.loadCsrf();
      if (!exchangeAccountId) throw new Error("Exchange account id is missing");

      expectStatus(await admin.patch(`/api/admin/exchange/accounts/${exchangeAccountId}`, { balance: 499 }), 200);
      expectStatus(await user.post("/api/tasks/8/verify", {}, { csrf: true }), 409);
      expectStatus(await admin.patch(`/api/admin/exchange/accounts/${exchangeAccountId}`, { balance: 500 }), 200);
      expectStatus(await user.post("/api/tasks/8/verify", {}, { csrf: true }), 200);
      expectStatus(await user.post("/api/tasks/9/complete", {}, { csrf: true }), 200);
      expectStatus(await user.post("/api/tasks/10/complete", {}, { csrf: true }), 200);

      const report11 = await user.post(
        "/api/tasks/11/report",
        { reportText: "Level 11 progression smoke report" },
        { csrf: true },
      );
      expectStatus(report11, 201);
      const report11Id = Number(asObject(asObject(report11.body).report as JsonBody).id);
      expectStatus(await mentor.patch(`/api/admin/task-reports/${report11Id}`, { status: "approved" }), 200);

      expectStatus(await admin.patch(`/api/admin/exchange/accounts/${exchangeAccountId}`, { balance: 999 }), 200);
      expectStatus(await user.post("/api/tasks/12/verify", {}, { csrf: true }), 409);
      expectStatus(await admin.patch(`/api/admin/exchange/accounts/${exchangeAccountId}`, { balance: 1000 }), 200);
      expectStatus(await user.post("/api/tasks/12/verify", {}, { csrf: true }), 200);
      expectStatus(await user.post("/api/tasks/13/complete", {}, { csrf: true }), 200);
      expectStatus(await user.post("/api/tasks/14/complete", {}, { csrf: true }), 200);

      const report15 = await user.post(
        "/api/tasks/15/report",
        { reportText: "Mentor session completed" },
        { csrf: true },
      );
      expectStatus(report15, 201);
      const report15Id = Number(asObject(asObject(report15.body).report as JsonBody).id);
      const beforeMentorApproval = Number((await getMe(user)).xp);
      expectStatus(await mentor.patch(`/api/admin/task-reports/${report15Id}`, { status: "approved" }), 200);
      const afterMentorApproval = Number((await getMe(user)).xp);
      if (afterMentorApproval !== beforeMentorApproval + 10) {
        throw new Error("Mentor session approval did not award 10 XP exactly once");
      }
      expectStatus(await mentor.patch(`/api/admin/task-reports/${report15Id}`, { status: "approved" }), 200);
      if (Number((await getMe(user)).xp) !== afterMentorApproval) {
        throw new Error("Duplicate mentor approval awarded XP twice");
      }

      expectStatus(await admin.patch(`/api/admin/exchange/accounts/${exchangeAccountId}`, { balance: 1999 }), 200);
      expectStatus(await user.post("/api/tasks/16/verify", {}, { csrf: true }), 409);
      expectStatus(await admin.patch(`/api/admin/exchange/accounts/${exchangeAccountId}`, { balance: 2000 }), 200);
      expectStatus(await user.post("/api/tasks/16/verify", {}, { csrf: true }), 200);
    });

    await check("After-RC rewards", "daily reward promocode achievements and leaderboard work", async () => {
      const client = requireClient(userClient, "user");
      await client.loadCsrf();

      const dailyBefore = await client.get("/api/rewards/daily");
      expectStatus(dailyBefore, 200);
      if (asObject(dailyBefore.body).claimedToday !== false) fail(dailyBefore, "Daily reward should be unclaimed in seed");

      const daily = await client.post("/api/rewards/daily", {}, { csrf: true });
      expectStatus(daily, 200);
      if (asObject(daily.body).duplicate !== false) fail(daily, "Daily reward was not claimed");
      if (Number(asObject(asObject(daily.body).reward as JsonBody).streak) !== 2) fail(daily, "Daily streak did not increment");

      const dailyDuplicate = await client.post("/api/rewards/daily", {}, { csrf: true });
      expectStatus(dailyDuplicate, 200);
      if (asObject(dailyDuplicate.body).duplicate !== true) fail(dailyDuplicate, "Daily reward duplicate was not detected");

      const promocode = await client.post("/api/promocodes/redeem", { code: "MVP100" }, { csrf: true });
      expectStatus(promocode, 200);

      const promocodeDuplicate = await client.post("/api/promocodes/redeem", { code: "MVP100" }, { csrf: true });
      expectStatus(promocodeDuplicate, 400);
      if (asObject(promocodeDuplicate.body).error !== "PROMOCODE_ALREADY_USED") {
        fail(promocodeDuplicate, "Promocode duplicate error is wrong");
      }

      const achievements = await client.get("/api/achievements");
      expectStatus(achievements, 200);
      const achievementItems = asArray(asObject(achievements.body).items, "items");
      if (!achievementItems.some((item) => item.granted === true)) {
        fail(achievements, "Granted achievement is missing");
      }

      const leaderboard = await client.get("/api/leaderboard");
      expectStatus(leaderboard, 200);
      const leaders = asArray(asObject(leaderboard.body).items, "items");
      if (!leaders.some((item) => String(item.displayName).includes("Алекс"))) {
        fail(leaderboard, "Leaderboard misses demo user");
      }
      if (leaders.filter((item) => item.isCurrent === true).length !== 1) {
        fail(leaderboard, "Leaderboard must mark exactly one current user");
      }
    });

    await check("Promocodes", "admin CRUD and inactive validation work", async () => {
      const admin = requireClient(adminClient, "admin");
      const user = requireClient(userClient, "user");
      const code = `SMOKE${Date.now()}`;
      const created = await admin.post("/api/admin/promocodes", { code, type: "xp_bonus", value: { xp: 17 }, maxUses: 2, perUserLimit: 1, isActive: true }, { csrf: true });
      expectStatus(created, 201);
      const item = asObject(asObject(created.body).item as JsonBody);
      const redeem = await user.post("/api/promocodes/redeem", { code }, { csrf: true });
      expectStatus(redeem, 200);
      const duplicate = await user.post("/api/promocodes/redeem", { code }, { csrf: true });
      expectStatus(duplicate, 400);
      const disabled = await admin.patch(`/api/admin/promocodes/${Number(item.id)}`, { isActive: false });
      expectStatus(disabled, 200);
      const inactive = await user.post("/api/promocodes/redeem", { code }, { csrf: true });
      expectStatus(inactive, 400);
      if (asObject(inactive.body).error !== "PROMOCODE_INVALID") fail(inactive, "Inactive promocode was not blocked");
      const expiredCode = `EXPIRED${Date.now()}`;
      const expiredCreate = await admin.post("/api/admin/promocodes", { code: expiredCode, type: "xp_bonus", value: { xp: 1 }, perUserLimit: 1, expiresAt: "2020-01-01T00:00:00.000Z", isActive: true }, { csrf: true });
      expectStatus(expiredCreate, 201);
      const expired = await user.post("/api/promocodes/redeem", { code: expiredCode }, { csrf: true });
      expectStatus(expired, 400);
      const list = await admin.get("/api/admin/promocodes");
      expectStatus(list, 200);
      if (!asArray(asObject(list.body).items, "items").some((entry) => entry.code === code)) fail(list, "Created promocode is missing");
    });

    await check("Achievements", "admin creates, grants and revokes achievement", async () => {
      const admin = requireClient(adminClient, "admin");
      const user = requireClient(userClient, "user");
      const me = await getMe(user);
      const created = await admin.post("/api/admin/achievements", { slug: `smoke-${Date.now()}`, title: "Smoke achievement", description: "Smoke grant", rarity: "rare", iconKey: "award", isActive: true }, { csrf: true });
      expectStatus(created, 201);
      const achievementId = Number(asObject(asObject(created.body).item as JsonBody).id);
      const granted = await admin.post("/api/admin/achievements/grant", { userId: Number(me.id), achievementId, action: "grant" }, { csrf: true });
      expectStatus(granted, 200);
      const visible = await user.get("/api/achievements");
      expectStatus(visible, 200);
      if (!asArray(asObject(visible.body).items, "items").some((item) => Number(item.id) === achievementId && item.granted === true)) fail(visible, "Granted achievement is not visible");
      const selfGrant = await user.post("/api/admin/achievements/grant", { userId: Number(me.id), achievementId, action: "grant" }, { csrf: true });
      expectStatus(selfGrant, 403);
      const revoked = await admin.post("/api/admin/achievements/grant", { userId: Number(me.id), achievementId, action: "revoke" }, { csrf: true });
      expectStatus(revoked, 200);
    });

    await check("Leaderboard", "periods work and blocked users are excluded", async () => {
      const admin = requireClient(adminClient, "admin");
      const created = await admin.post("/api/admin/users", { email: `leader-${Date.now()}@example.com`, name: "Blocked leader", role: "user", password: "Leader123" }, { csrf: true });
      expectStatus(created, 201);
      const userId = Number(asObject(asObject(created.body).user as JsonBody).id);
      expectStatus(await admin.patch(`/api/admin/users/${userId}`, { xp: 999999, level: 20, status: "blocked" }), 200);
      for (const period of ["daily", "weekly", "monthly", "all-time"]) {
        const response = await requireClient(userClient, "user").get(`/api/leaderboard?period=${period}`);
        expectStatus(response, 200);
        if (asObject(response.body).period !== period) fail(response, `Leaderboard period ${period} was ignored`);
        if (asArray(asObject(response.body).items, "items").some((item) => item.displayName === "Blocked leader")) fail(response, "Blocked user leaked into leaderboard");
      }
    });

    await check("After-RC chat", "channels moderation and mentor chat work", async () => {
      const client = requireClient(userClient, "user");
      await client.loadCsrf();

      const channels = await client.get("/api/chat/channels");
      expectStatus(channels, 200);
      const channelItems = asArray(asObject(channels.body).items, "items");
      if (!channelItems.some((item) => item.slug === "general" && item.unlocked === true)) {
        fail(channels, "General channel is not unlocked");
      }
      if (!channelItems.some((item) => item.slug === "level-5" && item.unlocked === true)) {
        fail(channels, "Level 5 channel is not unlocked for the level 6 demo user");
      }

      const blockedLink = await client.post(
        "/api/chat",
        { message: "Проверь https://example.com" },
        { csrf: true },
      );
      expectStatus(blockedLink, 400);
      if (asObject(blockedLink.body).error !== "MESSAGE_BLOCKED") fail(blockedLink, "Link moderation failed");

      const blockedWord = await client.post("/api/chat", { message: "скам" }, { csrf: true });
      expectStatus(blockedWord, 400);
      if (asObject(blockedWord.body).error !== "MESSAGE_BLOCKED") fail(blockedWord, "Stop word moderation failed");

      const sent = await client.post("/api/chat", { message: `Valid smoke message ${Date.now()}` }, { csrf: true });
      expectStatus(sent, 201);
      chatMessageId = Number(asObject(asObject(sent.body).message as JsonBody).id);
      const cooldown = await client.post("/api/chat", { message: "Second message too quickly" }, { csrf: true });
      expectStatus(cooldown, 400);

      const mentorChat = await client.get("/api/mentor-chat");
      expectStatus(mentorChat, 200);
      if (asObject(mentorChat.body).unlocked !== true) fail(mentorChat, "Mentor chat is not unlocked after First Deposit");

      const mentorMessage = await client.post(
        "/api/mentor-chat/messages",
        { message: "Smoke: вопрос ментору" },
        { csrf: true },
      );
      expectStatus(mentorMessage, 201);
      const mentorStaff = await requireClient(mentorClient, "mentor").get("/api/mentor-chat");
      expectStatus(mentorStaff, 200);
      if (asObject(mentorStaff.body).staff !== true) fail(mentorStaff, "Mentor staff view is missing");
      expectStatus(await requireClient(adminClient, "admin").get("/api/mentor-chat"), 200);
      expectStatus(await requireClient(supportClient, "support").get("/api/mentor-chat"), 403);
    });

    await check("Chat moderation", "moderator can manage rules, mutes and hidden messages", async () => {
      const moderator = requireClient(moderatorClient, "moderator");
      const user = requireClient(userClient, "user");
      await moderator.loadCsrf();
      const rule = await moderator.post("/api/admin/chat-moderation", { action: "rule.create", value: `blocked-${Date.now()}` }, { csrf: true });
      expectStatus(rule, 200);
      const ruleId = Number(asObject(rule.body).id);
      const me = await getMe(user);
      const mute = await moderator.post("/api/admin/chat-moderation", { action: "mute.create", userId: Number(me.id), reason: "smoke mute", durationMinutes: null }, { csrf: true });
      expectStatus(mute, 200);
      const muteId = Number(asObject(mute.body).id);
      const mutedPost = await user.post("/api/chat", { message: "Muted message" }, { csrf: true });
      expectStatus(mutedPost, 400);
      const hidden = await moderator.post("/api/admin/chat-moderation", { action: "message.hide", messageId: chatMessageId, reason: "smoke hide" }, { csrf: true });
      expectStatus(hidden, 200);
      expectStatus(await user.post("/api/admin/chat-moderation", { action: "rule.create", value: "forbidden" }, { csrf: true }), 403);
      expectStatus(await moderator.delete(`/api/admin/chat-moderation?type=mute&id=${muteId}`), 200);
      expectStatus(await moderator.delete(`/api/admin/chat-moderation?type=rule&id=${ruleId}`), 200);
    });

    await check("Support", "user writes with attachment and support replies", async () => {
      const user = requireClient(userClient, "user");
      const formData = new FormData();
      formData.set("file", new File(["mvp support attachment"], "mvp-support.txt", { type: "text/plain" }));
      formData.set("purpose", "support_attachment");
      const upload = await user.postForm("/api/files/upload", formData, { csrf: true });
      expectStatus(upload, 201);
      supportFileAssetId = Number(asObject(asObject(upload.body).file as JsonBody).id);

      const createDialog = await user.post(
        "/api/support/my-dialog/messages",
        { message: "MVP acceptance support message", fileAssetId: supportFileAssetId },
        { csrf: true },
      );
      expectStatus(createDialog, 201);
      supportDialogId = Number(asObject(asObject(createDialog.body).dialog as JsonBody).id);

      const support = requireClient(supportClient, "support");
      await support.loadCsrf();
      const reply = await support.post(
        `/api/support/dialogs/${supportDialogId}/messages`,
        { message: "MVP acceptance support reply", internalNote: false },
        { csrf: true },
      );
      expectStatus(reply, 201);
    });

    await check("Notifications", "user receives and reads notification", async () => {
      const client = requireClient(userClient, "user");
      const notifications = await getNotifications(client);
      const notification = notifications.items.find((item) => item.type === "support_reply");
      if (!notification) fail(notifications.response, "Support notification missing");
      await client.loadCsrf();
      const read = await client.patch(`/api/notifications/${Number(notification.id)}/read`, {});
      expectStatus(read, 200);
    });

    await check("Admin", "admin sees users reports exchange and audit", async () => {
      const admin = requireClient(adminClient, "admin");
      for (const endpoint of [
        "/api/admin/users",
        "/api/admin/task-reports",
        "/api/admin/exchange/accounts",
        "/api/admin/audit-logs",
      ]) {
        const response = await admin.get(endpoint);
        expectStatus(response, 200);
      }
    });

    await check("Roles", "forbidden admin APIs are enforced", async () => {
      expectStatus(await requireClient(userClient, "user").get("/api/admin/users"), 403);
      expectStatus(await requireClient(supportClient, "support").get("/api/admin/exchange/accounts"), 403);
      expectStatus(await requireClient(mentorClient, "mentor").get("/api/admin/users"), 403);
      expectStatus(await requireClient(mentorClient, "mentor").get("/api/admin/task-reports"), 200);
    });

    await check("Postbacks", "deposit trade and duplicate update exchange safely", async () => {
      const depositId = `mvp-deposit-${Date.now()}`;
      const tradeId = `mvp-trade-${Date.now()}`;
      const duplicateId = `mvp-duplicate-${Date.now()}`;

      const before = await requireClient(userClient, "user").get("/api/exchange/account");
      expectStatus(before, 200);
      const beforeAccount = asObject(asObject(before.body).account as JsonBody);
      const beforeBalance = Number(beforeAccount.balance);
      const beforeDeposit = Number(beforeAccount.depositAmount);
      const beforeTrades = Number(beforeAccount.tradesCount);

      const deposit = await new ApiClient().post(
        "/api/exchange/postbacks/receive",
        { eventType: "deposit", externalAccountId: exchangeExternalAccountId, externalEventId: depositId, amount: 111 },
        { headers: { "x-postback-secret": postbackSecret } },
      );
      expectStatus(deposit, 200);

      const trade = await new ApiClient().post(
        "/api/exchange/postbacks/receive",
        { eventType: "trade", externalAccountId: exchangeExternalAccountId, externalEventId: tradeId },
        { headers: { "x-postback-secret": postbackSecret } },
      );
      expectStatus(trade, 200);

      const firstDuplicate = await new ApiClient().post(
        "/api/exchange/postbacks/receive",
        { eventType: "trade", externalAccountId: exchangeExternalAccountId, externalEventId: duplicateId },
        { headers: { "x-postback-secret": postbackSecret } },
      );
      expectStatus(firstDuplicate, 200);
      const secondDuplicate = await new ApiClient().post(
        "/api/exchange/postbacks/receive",
        { eventType: "trade", externalAccountId: exchangeExternalAccountId, externalEventId: duplicateId },
        { headers: { "x-postback-secret": postbackSecret } },
      );
      expectStatus(secondDuplicate, 200);
      if (asObject(secondDuplicate.body).duplicate !== true) fail(secondDuplicate, "Duplicate postback was not detected");

      const after = await requireClient(userClient, "user").get("/api/exchange/account");
      expectStatus(after, 200);
      const afterAccount = asObject(asObject(after.body).account as JsonBody);
      if (Number(afterAccount.balance) !== beforeBalance + 111) fail(after, "Deposit did not update balance");
      if (Number(afterAccount.depositAmount) !== beforeDeposit + 111) fail(after, "Deposit did not update depositAmount");
      if (Number(afterAccount.tradesCount) !== beforeTrades + 2) fail(after, "Trade or duplicate idempotency changed tradesCount incorrectly");
    });

    await check("Postbacks", "Pocket lifecycle events are normalized and unmatched events are logged", async () => {
      const cases = [
        ["Email Confirmation", "email_confirmation"], ["First Deposit", "first_deposit"], ["Re-deposit", "redeposit"],
        ["Withdrawal", "withdrawal"], ["Commission", "commission"], ["New Withdrawal", "new_withdrawal"],
        ["Canceled Withdrawal", "canceled_withdrawal"], ["Successful Withdrawal", "successful_withdrawal"],
      ] as const;
      for (const [type, normalized] of cases) {
        const response = await new ApiClient().post("/api/exchange/postbacks/receive", { type, trader_id: exchangeExternalAccountId, externalEventId: `lifecycle-${normalized}-${Date.now()}`, amount: 3, currency: "USD" }, { headers: { "x-postback-secret": postbackSecret } });
        expectStatus(response, 200);
        const event = asObject(asObject(response.body).postback as JsonBody);
        if (event.normalizedEventType !== normalized || !event.processedAt) fail(response, `Lifecycle event ${type} was not processed`);
      }
      const unmatched = await new ApiClient().post("/api/exchange/postbacks/receive", { type: "Registration", trader_id: `unknown-${Date.now()}`, externalEventId: `unmatched-${Date.now()}` }, { headers: { "x-postback-secret": postbackSecret } });
      expectStatus(unmatched, 404);
      const audit = await requireClient(adminClient, "admin").get("/api/admin/audit-logs?pageSize=100");
      expectStatus(audit, 200);
      if (!asArray(asObject(audit.body).logs, "logs").some((item) => item.action === "EXCHANGE_POSTBACK_REJECTED")) fail(audit, "Unmatched postback audit is missing");
    });

    await check("Postbacks", "Pocket macros are normalized and stored", async () => {
      const pocketEventId = `mvp-pocket-${Date.now()}`;
      const response = await new ApiClient().post(
        "/api/exchange/postbacks/receive",
        {
          type: "Registration",
          trader_id: exchangeExternalAccountId,
          click_id: "smoke-click-id",
          site_id: "smoke-site",
          country: "RU",
          device_type: "desktop",
          externalEventId: pocketEventId,
        },
        { headers: { "x-postback-secret": postbackSecret } },
      );
      expectStatus(response, 200);
      const postback = asObject(asObject(response.body).postback as JsonBody);
      if (postback.normalizedEventType !== "registration") fail(response, "Pocket event was not normalized");
      if (postback.traderId !== exchangeExternalAccountId) fail(response, "Pocket trader_id was not stored");
      if (postback.clickId !== "smoke-click-id") fail(response, "Pocket click_id was not stored");

      const duplicate = await new ApiClient().post(
        "/api/exchange/postbacks/receive",
        {
          type: "Registration",
          trader_id: exchangeExternalAccountId,
          externalEventId: pocketEventId,
        },
        { headers: { "x-postback-secret": postbackSecret } },
      );
      expectStatus(duplicate, 200);
      if (asObject(duplicate.body).duplicate !== true) fail(duplicate, "Pocket duplicate was not detected");
    });

    await check("CRM", "search and attribution filters use normalized Pocket macros", async () => {
      const admin = requireClient(adminClient, "admin");
      const search = await admin.get("/api/crm/users?q=smoke-click-id&country=ru&device=desktop&source=smoke-site&eventType=registration");
      expectStatus(search, 200);
      const users = asArray(asObject(search.body).users, "users");
      if (users.length !== 1) fail(search, "CRM filters did not return the expected lead");
      const lead = users[0];
      if (lead.clickId !== "smoke-click-id" || lead.traderId !== exchangeExternalAccountId) fail(search, "CRM normalized identifiers are missing");
      const attribution = asObject(lead.attribution as JsonBody);
      if (attribution.site_id !== "smoke-site" || attribution.country !== "RU") fail(search, "CRM attribution fields are missing");
      if (!Array.isArray(lead.postbackEvents) || lead.postbackEvents.length === 0) fail(search, "CRM postback history is missing");
    });

    await check("Chat cleanup", "retention cleanup runs in safe dry-run mode", () => {
      const result = process.platform === "win32"
        ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm.cmd run chat:cleanup"], { cwd: process.cwd(), encoding: "utf8" })
        : spawnSync("npm", ["run", "chat:cleanup"], { cwd: process.cwd(), encoding: "utf8" });
      if (result.status !== 0 || !String(result.stdout).includes("CHAT_CLEANUP_DRY_RUN")) throw new Error(`chat:cleanup failed\n${result.stdout}\n${result.stderr}`);
    });
  } finally {
    await check("Cleanup", "restore seed after MVP smoke", () => restoreSeed());
    await check("Cleanup", "seed baseline is restored", async () => {
      const fresh = await login("user");
      const freshAdmin = await login("admin");
      const user = await getMe(fresh.client);
      if (Number(user.xp) !== 420) throw new Error(`Expected restored XP 420, got ${String(user.xp)}`);
      const active = await getActiveTaskStep(fresh.client);
      if (active.stepNumber !== 6) throw new Error(`Expected restored active step 6, got ${active.stepNumber}`);
      const notifications = await getNotifications(fresh.client);
      if (notifications.unreadCount !== 0) fail(notifications.response, "Seed restore left notifications");
      const adminNotifications = await getNotifications(freshAdmin.client);
      if (adminNotifications.unreadCount !== 0) {
        fail(adminNotifications.response, "Seed restore left admin feedback notifications");
      }
      const feedback = await freshAdmin.client.get("/api/admin/feedback");
      expectStatus(feedback, 200);
      if (Number(asObject(feedback.body).total) !== 0) {
        fail(feedback, "Seed restore left tester feedback");
      }
      const audit = await freshAdmin.client.get("/api/admin/audit-logs?pageSize=100");
      expectStatus(audit, 200);
      const actions = asArray(asObject(audit.body).logs, "logs").map((log) => log.action);
      if (actions.some((action) => String(action).includes("FEEDBACK"))) {
        fail(audit, "Seed restore left feedback audit actions");
      }
      const uploadsDir = path.resolve(
        process.cwd(),
        process.env.LOCAL_UPLOADS_DIR ?? path.join("storage", "uploads"),
      );
      const uploadEntries = await fs.readdir(uploadsDir).catch(() => []);
      if (uploadEntries.length > 0) {
        throw new Error(`Seed restore left files in uploads: ${uploadEntries.join(", ")}`);
      }
    });
  }

  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  console.log("\nMVP acceptance smoke summary");
  console.log(`total checks: ${results.length}`);
  console.log(`passed: ${passed}`);
  console.log(`failed: ${failed}`);

  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
