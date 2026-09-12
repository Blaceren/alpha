import { spawnSync } from "node:child_process";

const baseUrl = (process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3009").replace(/\/$/, "");
const postbackSecret = process.env.SMOKE_POSTBACK_SECRET ?? "dev-postback-secret";
const allowRemoteSeed = process.env.SMOKE_ALLOW_REMOTE_SEED === "true";
const defaultPassword = process.env.SMOKE_PASSWORD ?? "password123";

type JsonBody = Record<string, unknown> | unknown[] | string | number | boolean | null;

type SmokeResponse = {
  endpoint: string;
  status: number;
  body: JsonBody;
  headers: Headers;
};

type CheckResult = {
  block: string;
  name: string;
  passed: boolean;
  error?: string;
};

const results: CheckResult[] = [];

function isLoopbackUrl(value: string) {
  const hostname = new URL(value).hostname;
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function formatBody(body: JsonBody) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text.length > 800 ? `${text.slice(0, 800)}…` : text;
}

function fail(response: SmokeResponse, message: string): never {
  throw new Error(
    `${message}\nendpoint: ${response.endpoint}\nstatus: ${response.status}\nbody: ${formatBody(response.body)}`,
  );
}

function expectStatus(response: SmokeResponse, expected: number) {
  if (response.status !== expected) {
    fail(response, `Ожидался status ${expected}`);
  }
}

function asObject(body: JsonBody) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`Ожидался JSON object, получено: ${formatBody(body)}`);
  }
  return body as Record<string, unknown>;
}

function asArray(value: unknown, field: string) {
  if (!Array.isArray(value)) {
    throw new Error(`Поле ${field} должно быть массивом`);
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
    let body: JsonBody = null;
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
    } satisfies SmokeResponse;
  }

  get(path: string) {
    return this.request(path, { cache: "no-store" });
  }

  post(path: string, body: Record<string, unknown>, options: { csrf?: boolean; headers?: HeadersInit } = {}) {
    const headers = new Headers(options.headers);
    headers.set("content-type", "application/json");
    if (options.csrf) {
      if (!this.csrfToken) throw new Error(`CSRF token не загружен для POST ${path}`);
      headers.set("x-csrf-token", this.csrfToken);
    }
    return this.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  }

  patch(path: string, body: Record<string, unknown>) {
    if (!this.csrfToken) throw new Error(`CSRF token не загружен для PATCH ${path}`);
    return this.request(path, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-csrf-token": this.csrfToken },
      body: JSON.stringify(body),
    });
  }

  postForm(path: string, formData: FormData, options: { csrf?: boolean } = {}) {
    const headers = new Headers();
    if (options.csrf) {
      if (!this.csrfToken) throw new Error(`CSRF token не загружен для POST ${path}`);
      headers.set("x-csrf-token", this.csrfToken);
    }
    return this.request(path, { method: "POST", headers, body: formData });
  }
  async loadCsrf() {
    const response = await this.get("/api/csrf");
    expectStatus(response, 200);
    const token = asObject(response.body).csrfToken;
    if (typeof token !== "string" || token.length === 0) fail(response, "csrfToken отсутствует");
    this.csrfToken = token;
  }
}

function restoreSeed() {
  if (!isLoopbackUrl(baseUrl) && !allowRemoteSeed) {
    throw new Error(
      `Auto-seed запрещён для ${baseUrl}. Для осознанного удалённого запуска задайте SMOKE_ALLOW_REMOTE_SEED=true.`,
    );
  }

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
    throw new Error(
      `prisma:seed завершился с code ${result.status}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
}

async function login(role: "user" | "admin" | "support" | "mentor") {
  const client = new ApiClient();
  const response = await client.post("/api/auth/login", {
    email: `${role}@test.com`,
    password: defaultPassword,
    captchaToken: "dev-captcha-ok",
  });
  expectStatus(response, 200);
  const user = asObject(asObject(response.body).user as JsonBody);
  if (user.role !== role) fail(response, `Ожидалась роль ${role}`);
  return { client, user };
}

function requireClient(client: ApiClient | undefined, role: string) {
  if (!client) throw new Error(`Login ${role} не был успешно выполнен`);
  return client;
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

async function main() {
  console.log(`Integration smoke target: ${baseUrl}`);
  if (baseUrl.startsWith("http://")) {
    console.log("INFO: HTTP target; Secure session cookies будут вручную replay только для loopback API smoke.");
  }

  let userClient: ApiClient | undefined;
  let adminClient: ApiClient | undefined;
  let supportClient: ApiClient | undefined;
  let mentorClient: ApiClient | undefined;
  let userId: number | undefined;
  let activeTaskStep: number | undefined;
  let reportTaskStep: number | undefined;
  let reportTaskXpReward = 0;
  let reportXpBeforeApproval = 0;
  let taskReportId: number | undefined;
  let rejectedReportTaskStep: number | undefined;
  let rejectedTaskXpReward: number | undefined;
  let rejectedXpBeforeApproval = 0;
  let rejectedTaskReportId: number | undefined;
  let checkpointId: number | undefined;
  let supportDialogId: number | undefined;
  let supportReply = "";
  let internalNote = "";
  let supportNotificationId: number | undefined;
  let taskReportFileAssetId: number | undefined;
  let supportFileAssetId: number | undefined;
  let exchangeAccountId: number | undefined;
  let exchangeExternalAccountId = "";
  let exchangeTradesAfterTrade = 0;

  try {
    await check("Setup", "restore deterministic seed before smoke", () => restoreSeed());

    const publicClient = new ApiClient();
    await check("Public", "GET /api/health -> 200", async () => {
      const response = await publicClient.get("/api/health");
      expectStatus(response, 200);
      if (asObject(response.body).database !== "connected") fail(response, "Database не connected");
    });
    await check("Public", "GET /api/readiness -> 200", async () => {
      const response = await publicClient.get("/api/readiness");
      expectStatus(response, 200);
      const body = asObject(response.body);
      if (body.ok !== true) fail(response, "Readiness не ok");
      const checks = asObject(body.checks as JsonBody);
      if (checks.database !== "ok" || checks.storage !== "ok" || checks.env !== "ok") {
        fail(response, "Readiness checks не ok");
      }
    });
    await check("Public", "GET /api/news -> 200", async () => {
      const response = await publicClient.get("/api/news");
      expectStatus(response, 200);
      asArray(asObject(response.body).news, "news");
    });
    await check("Public", "GET /api/csrf -> csrfToken", async () => {
      await publicClient.loadCsrf();
    });

    for (const role of ["user", "admin", "support", "mentor"] as const) {
      await check("Auth", `login ${role}@test.com -> 200`, async () => {
        const authenticated = await login(role);
        if (role === "user") {
          userClient = authenticated.client;
          userId = Number(authenticated.user.id);
        }
        if (role === "admin") adminClient = authenticated.client;
        if (role === "support") supportClient = authenticated.client;
        if (role === "mentor") mentorClient = authenticated.client;
      });
    }
    await check("Auth", "session cookie matches target scheme", () => {
      const client = requireClient(userClient, "user");
      if (baseUrl.startsWith("http://") && client.jar.sawSecureSessionCookie) {
        throw new Error("HTTP target returned a Secure session cookie that browsers will reject");
      }
    });

    await check("Security", "mutation without CSRF -> 403 CSRF_INVALID", async () => {
      const response = await requireClient(userClient, "user").post("/api/chat", { message: "csrf smoke" });
      expectStatus(response, 403);
      if (asObject(response.body).error !== "CSRF_INVALID") fail(response, "Ожидался CSRF_INVALID");
    });

    await check("User", "load user CSRF", async () => requireClient(userClient, "user").loadCsrf());
    await check("Notifications", "initial unreadCount -> 0", async () => {
      const result = await getNotifications(requireClient(userClient, "user"));
      if (result.unreadCount !== 0) {
        fail(result.response, "Ожидался unreadCount 0 после seed");
      }
      if (result.items.length !== 0) {
        fail(result.response, "После seed уведомлений быть не должно");
      }
    });
    await check("User", "GET /api/me -> 200", async () => {
      const response = await requireClient(userClient, "user").get("/api/me");
      expectStatus(response, 200);
      const user = asObject(asObject(response.body).user as JsonBody);
      userId = Number(user.id);
      const checkpoint = asObject(user.checkpoint as JsonBody);
      checkpointId = Number(checkpoint.id);
    });
    await check("User", "GET /api/tasks -> active task", async () => {
      const response = await requireClient(userClient, "user").get("/api/tasks");
      expectStatus(response, 200);
      const tasks = asArray(asObject(response.body).tasks, "tasks");
      const active = tasks.find((task) => {
        const progress = Array.isArray(task.progress) ? task.progress : [];
        return progress.some((item) => asObject(item as JsonBody).status === "active");
      });
      if (!active) fail(response, "Активное задание не найдено");
      activeTaskStep = Number(active.stepNumber);
    });
    await check("User", "POST /api/tasks/[id]/complete -> 200", async () => {
      if (!activeTaskStep) throw new Error("activeTaskStep отсутствует");
      const response = await requireClient(userClient, "user").post(
        `/api/tasks/${activeTaskStep}/complete`,
        {},
        { csrf: true },
      );
      expectStatus(response, 200);
    });
    await check("Exchange", "user opens /api/exchange/account", async () => {
      const response = await requireClient(userClient, "user").get("/api/exchange/account");
      expectStatus(response, 200);
      const account = asObject(asObject(response.body).account as JsonBody);
      exchangeAccountId = Number(account.id);
      exchangeExternalAccountId = String(account.externalAccountId ?? account.exchangeAccountId);
      if (!exchangeAccountId || !exchangeExternalAccountId) {
        fail(response, "Exchange account seed не загружен");
      }
    });
    await check("Exchange", "user sends connect request -> pending", async () => {
      const client = requireClient(userClient, "user");
      const externalAccountId = `EX-SMOKE-${Date.now()}`;
      const response = await client.post(
        "/api/exchange/connect",
        { externalAccountId, provider: "sandbox" },
        { csrf: true },
      );
      expectStatus(response, 200);
      const account = asObject(asObject(response.body).account as JsonBody);
      exchangeAccountId = Number(account.id);
      exchangeExternalAccountId = String(account.externalAccountId);
      if (account.status !== "pending") fail(response, "Exchange account не pending");
    });
    await check("Exchange", "user verify -> connected", async () => {
      const response = await requireClient(userClient, "user").post(
        "/api/exchange/verify",
        {},
        { csrf: true },
      );
      expectStatus(response, 200);
      const account = asObject(asObject(response.body).account as JsonBody);
      if (account.status !== "connected") fail(response, "Exchange account не connected");
      if (Number(account.depositAmount) <= 0) fail(response, "depositAmount не обновлён");
    });
    await check("Exchange", "admin lists exchange accounts", async () => {
      const response = await requireClient(adminClient, "admin").get("/api/admin/exchange/accounts?status=connected");
      expectStatus(response, 200);
      const items = asArray(asObject(response.body).items, "items");
      if (!items.some((account) => Number(account.id) === exchangeAccountId)) {
        fail(response, "Admin не видит exchange account");
      }
    });
    await check("Exchange", "admin updates balance/deposit/tradesCount", async () => {
      if (!exchangeAccountId) throw new Error("exchangeAccountId отсутствует");
      const client = requireClient(adminClient, "admin");
      await client.loadCsrf();
      const response = await client.patch(
        `/api/admin/exchange/accounts/${exchangeAccountId}`,
        { status: "connected", balance: 2000, depositAmount: 700, tradesCount: 3 },
      );
      expectStatus(response, 200);
      const account = asObject(asObject(response.body).account as JsonBody);
      if (Number(account.balance) !== 2000 || Number(account.depositAmount) !== 700 || Number(account.tradesCount) !== 3) {
        fail(response, "Admin metrics не обновлены");
      }
    });
    await check("Exchange", "postback without secret -> 403", async () => {
      const response = await new ApiClient().post("/api/exchange/postbacks/receive", {
        eventType: "deposit",
        externalAccountId: exchangeExternalAccountId,
        externalEventId: `exchange-no-secret-${Date.now()}`,
        amount: 10,
      });
      expectStatus(response, 403);
    });
    await check("Exchange", "postback with wrong secret -> 403", async () => {
      const response = await new ApiClient().post(
        "/api/exchange/postbacks/receive",
        {
          eventType: "deposit",
          externalAccountId: exchangeExternalAccountId,
          externalEventId: `exchange-wrong-secret-${Date.now()}`,
          amount: 10,
        },
        { headers: { "x-postback-secret": "wrong-secret" } },
      );
      expectStatus(response, 403);
    });
    await check("Exchange", "deposit postback updates account", async () => {
      const response = await new ApiClient().post(
        "/api/exchange/postbacks/receive",
        {
          eventType: "deposit",
          externalAccountId: exchangeExternalAccountId,
          externalEventId: `exchange-deposit-${Date.now()}`,
          amount: 125,
          rawPayload: { source: "integration-smoke" },
        },
        { headers: { "x-postback-secret": postbackSecret } },
      );
      expectStatus(response, 200);
      if (asObject(response.body).duplicate !== false) fail(response, "deposit duplicate не false");

      const accountResponse = await requireClient(userClient, "user").get("/api/exchange/account");
      expectStatus(accountResponse, 200);
      const account = asObject(asObject(accountResponse.body).account as JsonBody);
      if (Number(account.depositAmount) !== 825 || Number(account.balance) !== 2125) {
        fail(accountResponse, "Deposit postback не обновил metrics");
      }
    });
    await check("Exchange", "trade postback increments tradesCount", async () => {
      const response = await new ApiClient().post(
        "/api/exchange/postbacks/receive",
        {
          eventType: "trade",
          externalAccountId: exchangeExternalAccountId,
          externalEventId: `exchange-trade-${Date.now()}`,
          amount: 0,
          rawPayload: { source: "integration-smoke" },
        },
        { headers: { "x-postback-secret": postbackSecret } },
      );
      expectStatus(response, 200);
      const accountResponse = await requireClient(userClient, "user").get("/api/exchange/account");
      expectStatus(accountResponse, 200);
      const account = asObject(asObject(accountResponse.body).account as JsonBody);
      exchangeTradesAfterTrade = Number(account.tradesCount);
      if (exchangeTradesAfterTrade !== 4) fail(accountResponse, "tradesCount не увеличен");
    });
    await check("Exchange", "duplicate postback does not change tradesCount", async () => {
      const duplicateEventId = `exchange-duplicate-${Date.now()}`;
      const first = await new ApiClient().post(
        "/api/exchange/postbacks/receive",
        { eventType: "trade", externalAccountId: exchangeExternalAccountId, externalEventId: duplicateEventId },
        { headers: { "x-postback-secret": postbackSecret } },
      );
      expectStatus(first, 200);
      const duplicate = await new ApiClient().post(
        "/api/exchange/postbacks/receive",
        { eventType: "trade", externalAccountId: exchangeExternalAccountId, externalEventId: duplicateEventId },
        { headers: { "x-postback-secret": postbackSecret } },
      );
      expectStatus(duplicate, 200);
      if (asObject(duplicate.body).duplicate !== true) fail(duplicate, "duplicate не true");

      const accountResponse = await requireClient(userClient, "user").get("/api/exchange/account");
      expectStatus(accountResponse, 200);
      const account = asObject(asObject(accountResponse.body).account as JsonBody);
      if (Number(account.tradesCount) !== exchangeTradesAfterTrade + 1) {
        fail(accountResponse, "Duplicate postback повторно изменил tradesCount");
      }
      exchangeTradesAfterTrade = Number(account.tradesCount);
    });
    await check("Exchange", "user sees updated metrics and notifications", async () => {
      const accountResponse = await requireClient(userClient, "user").get("/api/exchange/account");
      expectStatus(accountResponse, 200);
      const account = asObject(asObject(accountResponse.body).account as JsonBody);
      if (Number(account.balance) !== 2125 || Number(account.depositAmount) !== 825 || Number(account.tradesCount) !== exchangeTradesAfterTrade) {
        fail(accountResponse, "User не видит exchange metrics");
      }
      const notifications = await getNotifications(requireClient(userClient, "user"));
      if (!notifications.items.some((item) => item.type === "exchange_connected" || item.type === "postback_received")) {
        fail(notifications.response, "Exchange notification не создана");
      }
    });
    await check("Exchange", "support cannot access admin exchange API", async () => {
      const response = await requireClient(supportClient, "support").get("/api/admin/exchange/accounts");
      expectStatus(response, 403);
    });
    await check("Exchange", "user cannot access admin exchange API", async () => {
      const response = await requireClient(userClient, "user").get("/api/admin/exchange/accounts");
      expectStatus(response, 403);
    });
    await check("Task reports", "find active task requiring report", async () => {
      const response = await requireClient(userClient, "user").get("/api/tasks");
      expectStatus(response, 200);
      const tasks = asArray(asObject(response.body).tasks, "tasks");
      const active = tasks.find((task) => {
        const progress = Array.isArray(task.progress) ? task.progress : [];
        return task.requiresReport === true && progress.some(
          (item) => asObject(item as JsonBody).status === "active",
        );
      });
      if (!active) fail(response, "Активное задание с requiresReport не найдено");
      reportTaskStep = Number(active.stepNumber);
      reportTaskXpReward = Number(active.xpReward);
    });
    await check("Task reports", "complete without report -> required error", async () => {
      if (!reportTaskStep) throw new Error("reportTaskStep отсутствует");
      const response = await requireClient(userClient, "user").post(
        `/api/tasks/${reportTaskStep}/complete`,
        {},
        { csrf: true },
      );
      expectStatus(response, 400);
      if (asObject(response.body).error !== "Для этого задания нужно отправить отчёт на проверку") {
        fail(response, "Неверная ошибка отсутствующего отчёта");
      }
    });
    await check("Files", "user uploads task_report file", async () => {
      const formData = new FormData();
      formData.set(
        "file",
        new File(["integration smoke task report"], "task-report-smoke.txt", {
          type: "text/plain",
        }),
      );
      formData.set("purpose", "task_report");
      const response = await requireClient(userClient, "user").postForm(
        "/api/files/upload",
        formData,
        { csrf: true },
      );
      expectStatus(response, 201);
      const file = asObject(asObject(response.body).file as JsonBody);
      taskReportFileAssetId = Number(file.id);
      if (file.purpose !== "task_report") fail(response, "Файл загружен не как task_report");
      if (file.storageDriver !== "local") fail(response, "storageDriver должен быть local");
    });
    await check("Task reports", "user submits report -> pending", async () => {
      if (!reportTaskStep) throw new Error("reportTaskStep отсутствует");
      if (!taskReportFileAssetId) throw new Error("taskReportFileAssetId отсутствует");
      const response = await requireClient(userClient, "user").post(
        `/api/tasks/${reportTaskStep}/report`,
        {
          reportText: `Integration smoke task report ${Date.now()}`,
          reportUrl: "https://example.com/integration-smoke-report",
          fileAssetId: taskReportFileAssetId,
        },
        { csrf: true },
      );
      expectStatus(response, 201);
      const report = asObject(asObject(response.body).report as JsonBody);
      if (report.status !== "pending") fail(response, "Отчёт не pending");
      if (Number(report.fileAssetId) !== taskReportFileAssetId) {
        fail(response, "fileAssetId не привязан к отчёту");
      }
      taskReportId = Number(report.id);
    });
    await check("Task reports", "complete while pending -> pending error", async () => {
      if (!reportTaskStep) throw new Error("reportTaskStep отсутствует");
      const response = await requireClient(userClient, "user").post(
        `/api/tasks/${reportTaskStep}/complete`,
        {},
        { csrf: true },
      );
      expectStatus(response, 400);
      if (asObject(response.body).error !== "Отчёт ожидает проверки") {
        fail(response, "Неверная ошибка pending отчёта");
      }
    });
    await check("Task reports", "mentor lists pending reports", async () => {
      const response = await requireClient(mentorClient, "mentor").get(
        "/api/admin/task-reports?status=pending&page=1&pageSize=10",
      );
      expectStatus(response, 200);
      const items = asArray(asObject(response.body).items, "items");
      if (!items.some((item) => Number(item.id) === taskReportId)) {
        fail(response, "Mentor не видит pending отчёт");
      }
    });
    await check("Files", "mentor downloads task report file", async () => {
      if (!taskReportId || !taskReportFileAssetId) {
        throw new Error("task report file identifiers отсутствуют");
      }
      const detail = await requireClient(mentorClient, "mentor").get(
        `/api/admin/task-reports/${taskReportId}`,
      );
      expectStatus(detail, 200);
      const report = asObject(asObject(detail.body).report as JsonBody);
      const fileAsset = asObject(report.fileAsset as JsonBody);
      if (Number(fileAsset.id) !== taskReportFileAssetId) {
        fail(detail, "Mentor не видит fileAsset отчёта");
      }

      const download = await requireClient(mentorClient, "mentor").get(
        `/api/files/${taskReportFileAssetId}`,
      );
      expectStatus(download, 200);
      if (typeof download.body !== "string" || !download.body.includes("integration smoke task report")) {
        fail(download, "Mentor не скачал файл отчёта");
      }
    });
    await check("Files", "unauthorized download -> 401", async () => {
      if (!taskReportFileAssetId) throw new Error("taskReportFileAssetId отсутствует");
      const response = await new ApiClient().get(`/api/files/${taskReportFileAssetId}`);
      expectStatus(response, 401);
      if (asObject(response.body).error !== "UNAUTHORIZED") {
        fail(response, "Ожидался UNAUTHORIZED");
      }
    });
    await check("Files", "support cannot download task_report file -> 403", async () => {
      if (!taskReportFileAssetId) throw new Error("taskReportFileAssetId отсутствует");
      const response = await requireClient(supportClient, "support").get(
        `/api/files/${taskReportFileAssetId}`,
      );
      expectStatus(response, 403);
      if (asObject(response.body).error !== "FORBIDDEN") {
        fail(response, "Ожидался FORBIDDEN");
      }
    });
    await check("Task reports", "mentor approves report", async () => {
      if (!taskReportId) throw new Error("taskReportId отсутствует");
      const mentor = requireClient(mentorClient, "mentor");
      await mentor.loadCsrf();
      const before = await requireClient(userClient, "user").get("/api/me");
      reportXpBeforeApproval = Number(asObject(asObject(before.body).user as JsonBody).xp);
      const response = await mentor.patch(`/api/admin/task-reports/${taskReportId}`, {
        status: "approved",
        reviewComment: "Integration smoke approved",
      });
      expectStatus(response, 200);
      if (asObject(asObject(response.body).report as JsonBody).status !== "approved") {
        fail(response, "Отчёт не approved");
      }
    });
    await check("Notifications", "task report approved notification created", async () => {
      const result = await getNotifications(requireClient(userClient, "user"));
      if (!result.items.some((item) => item.type === "task_report_approved")) {
        fail(result.response, "Нет notification task_report_approved");
      }
      if (result.unreadCount < 1) {
        fail(result.response, "unreadCount не увеличился после approve");
      }
    });
    await check("Task reports", "approval awards XP once and duplicate completion is idempotent", async () => {
      if (!reportTaskStep) throw new Error("reportTaskStep отсутствует");
      const afterApproval = await requireClient(userClient, "user").get("/api/me");
      const currentXp = Number(asObject(asObject(afterApproval.body).user as JsonBody).xp);
      if (currentXp !== reportXpBeforeApproval + reportTaskXpReward) {
        fail(afterApproval, "Mentor approval did not award task XP exactly once");
      }
      const response = await requireClient(userClient, "user").post(
        `/api/tasks/${reportTaskStep}/complete`,
        {},
        { csrf: true },
      );
      expectStatus(response, 200);
      const xpAwarded = Number(asObject(response.body).xpAwarded);
      if (xpAwarded !== 0) fail(response, "Duplicate completion awarded XP");
    });
    await check("Notifications", "reward notification created after task completion", async () => {
      const result = await getNotifications(requireClient(userClient, "user"));
      if (!result.items.some((item) => item.type === "reward_granted")) {
        fail(result.response, "Нет notification reward_granted");
      }
    });
    await check("Task reports reject", "level 11 report task becomes active", async () => {
      const client = requireClient(userClient, "user");
      expectStatus(await client.post("/api/tasks/8/verify", {}, { csrf: true }), 200);
      expectStatus(await client.post("/api/tasks/9/complete", {}, { csrf: true }), 200);
      expectStatus(await client.post("/api/tasks/10/complete", {}, { csrf: true }), 200);
      const response = await requireClient(userClient, "user").get("/api/tasks");
      expectStatus(response, 200);
      const tasks = asArray(asObject(response.body).tasks, "tasks");
      const task = tasks.find((item) => Number(item.stepNumber) === 11);
      if (!task || task.requiresReport !== true) fail(response, "Level 11 task does not require a report");
      const progress = Array.isArray(task.progress) ? task.progress : [];
      if (!progress.some((item) => asObject(item as JsonBody).status === "active")) {
        fail(response, "Level 11 task is not active");
      }
      rejectedReportTaskStep = Number(task.stepNumber);
      rejectedTaskXpReward = Number(task.xpReward);
    });
    await check("Task reports reject", "user submits task 6 report -> pending", async () => {
      if (!rejectedReportTaskStep) throw new Error("rejectedReportTaskStep отсутствует");
      const response = await requireClient(userClient, "user").post(
        `/api/tasks/${rejectedReportTaskStep}/report`,
        { reportText: `Task 6 initial report ${Date.now()}` },
        { csrf: true },
      );
      expectStatus(response, 201);
      const report = asObject(asObject(response.body).report as JsonBody);
      if (report.status !== "pending") fail(response, "Task 6 report не pending");
      rejectedTaskReportId = Number(report.id);
    });
    await check("Task reports reject", "pending report cannot be overwritten", async () => {
      if (!rejectedReportTaskStep) throw new Error("rejectedReportTaskStep отсутствует");
      const response = await requireClient(userClient, "user").post(
        `/api/tasks/${rejectedReportTaskStep}/report`,
        { reportText: "Pending overwrite attempt" },
        { csrf: true },
      );
      expectStatus(response, 400);
      if (asObject(response.body).error !== "Отчёт уже ожидает проверки") {
        fail(response, "Pending report был перезаписан");
      }
    });
    await check("Task reports reject", "mentor opens pending task 6 report", async () => {
      if (!rejectedTaskReportId) throw new Error("rejectedTaskReportId отсутствует");
      const mentor = requireClient(mentorClient, "mentor");
      const list = await mentor.get("/api/admin/task-reports?status=pending&page=1&pageSize=10");
      expectStatus(list, 200);
      const items = asArray(asObject(list.body).items, "items");
      if (!items.some((item) => Number(item.id) === rejectedTaskReportId)) {
        fail(list, "Mentor не видит task 6 report");
      }
      const detail = await mentor.get(`/api/admin/task-reports/${rejectedTaskReportId}`);
      expectStatus(detail, 200);
    });
    await check("Task reports reject", "support cannot reject task report", async () => {
      if (!rejectedTaskReportId) throw new Error("rejectedTaskReportId отсутствует");
      const support = requireClient(supportClient, "support");
      await support.loadCsrf();
      const response = await support.patch(`/api/admin/task-reports/${rejectedTaskReportId}`, {
        status: "rejected",
        reviewComment: "Support must not review",
      });
      expectStatus(response, 403);
      if (asObject(response.body).error !== "FORBIDDEN") fail(response, "Ожидался FORBIDDEN");
    });
    await check("Task reports reject", "mentor rejects task 6 report with comment", async () => {
      if (!rejectedTaskReportId) throw new Error("rejectedTaskReportId отсутствует");
      const response = await requireClient(mentorClient, "mentor").patch(
        `/api/admin/task-reports/${rejectedTaskReportId}`,
        { status: "rejected", reviewComment: "Исправьте расчёты в отчёте" },
      );
      expectStatus(response, 200);
      const report = asObject(asObject(response.body).report as JsonBody);
      if (report.status !== "rejected" || report.reviewComment !== "Исправьте расчёты в отчёте") {
        fail(response, "Отчёт не отклонён с reviewComment");
      }
    });
    await check("Notifications", "task report rejected notification created", async () => {
      const result = await getNotifications(requireClient(userClient, "user"));
      if (!result.items.some((item) => item.type === "task_report_rejected")) {
        fail(result.response, "Нет notification task_report_rejected");
      }
    });
    await check("Task reports reject", "user sees rejected status", async () => {
      if (!rejectedReportTaskStep) throw new Error("rejectedReportTaskStep отсутствует");
      const response = await requireClient(userClient, "user").get(
        `/api/tasks/${rejectedReportTaskStep}/report`,
      );
      expectStatus(response, 200);
      const report = asObject(asObject(response.body).report as JsonBody);
      if (report.status !== "rejected") fail(response, "User не видит rejected status");
    });
    await check("Task reports reject", "rejected report blocks task 6 completion", async () => {
      if (!rejectedReportTaskStep) throw new Error("rejectedReportTaskStep отсутствует");
      const response = await requireClient(userClient, "user").post(
        `/api/tasks/${rejectedReportTaskStep}/complete`,
        {},
        { csrf: true },
      );
      expectStatus(response, 400);
      if (asObject(response.body).error !== "Отчёт отклонён. Отправьте исправленный отчёт") {
        fail(response, "Rejected report не блокирует completion");
      }
    });
    await check("Task reports reject", "rejected report can be resubmitted -> pending", async () => {
      if (!rejectedReportTaskStep || !rejectedTaskReportId) {
        throw new Error("Task 6 report identifiers отсутствуют");
      }
      const response = await requireClient(userClient, "user").post(
        `/api/tasks/${rejectedReportTaskStep}/report`,
        { reportText: `Task 6 corrected report ${Date.now()}`, fileName: "task-6-corrected.pdf" },
        { csrf: true },
      );
      expectStatus(response, 200);
      const report = asObject(asObject(response.body).report as JsonBody);
      if (report.status !== "pending" || Number(report.id) !== rejectedTaskReportId) {
        fail(response, "Rejected report не обновлён в pending");
      }
    });
    await check("Task reports reject", "mentor approves resubmitted task 6 report", async () => {
      if (!rejectedTaskReportId) throw new Error("rejectedTaskReportId отсутствует");
      const before = await requireClient(userClient, "user").get("/api/me");
      rejectedXpBeforeApproval = Number(asObject(asObject(before.body).user as JsonBody).xp);
      const response = await requireClient(mentorClient, "mentor").patch(
        `/api/admin/task-reports/${rejectedTaskReportId}`,
        { status: "approved", reviewComment: "Исправленный отчёт принят" },
      );
      expectStatus(response, 200);
      if (asObject(asObject(response.body).report as JsonBody).status !== "approved") {
        fail(response, "Исправленный отчёт не approved");
      }
    });
    await check("Task reports reject", "approved report cannot be overwritten", async () => {
      if (!rejectedReportTaskStep) throw new Error("rejectedReportTaskStep отсутствует");
      const response = await requireClient(userClient, "user").post(
        `/api/tasks/${rejectedReportTaskStep}/report`,
        { reportText: "Approved overwrite attempt" },
        { csrf: true },
      );
      expectStatus(response, 400);
      if (asObject(response.body).error !== "Одобренный отчёт нельзя изменить") {
        fail(response, "Approved report был перезаписан");
      }
    });
    await check("Task reports reject", "mentor approval awards level 11 XP once", async () => {
      if (!rejectedReportTaskStep || !rejectedTaskXpReward) {
        throw new Error("Task 6 metadata отсутствует");
      }
      const afterApproval = await requireClient(userClient, "user").get("/api/me");
      const currentXp = Number(asObject(asObject(afterApproval.body).user as JsonBody).xp);
      if (currentXp !== rejectedXpBeforeApproval + rejectedTaskXpReward) {
        fail(afterApproval, `Expected ${rejectedTaskXpReward} XP from mentor approval`);
      }
      const response = await requireClient(userClient, "user").post(
        `/api/tasks/${rejectedReportTaskStep}/complete`,
        {},
        { csrf: true },
      );
      expectStatus(response, 200);
      if (Number(asObject(response.body).xpAwarded) !== 0) {
        fail(response, "Duplicate completion awarded XP");
      }
    });
    await check("User", "POST /api/chat -> 201", async () => {
      const response = await requireClient(userClient, "user").post(
        "/api/chat",
        { message: `Integration smoke chat ${Date.now()}` },
        { csrf: true },
      );
      expectStatus(response, 201);
    });
    await check("User", "POST /api/checkpoints/[id]/check -> 200", async () => {
      if (!checkpointId) throw new Error("checkpointId отсутствует");
      const response = await requireClient(userClient, "user").post(
        `/api/checkpoints/${checkpointId}/check`,
        {},
        { csrf: true },
      );
      expectStatus(response, 200);
    });
    await check("Notifications", "checkpoint frozen notification created", async () => {
      if (!checkpointId) throw new Error("checkpointId отсутствует");
      if (!exchangeAccountId) throw new Error("exchangeAccountId отсутствует");
      const admin = requireClient(adminClient, "admin");
      const balanceUpdate = await admin.patch(`/api/admin/exchange/accounts/${exchangeAccountId}`, { balance: 400 });
      expectStatus(balanceUpdate, 200);
      const response = await requireClient(userClient, "user").post(
        `/api/checkpoints/${checkpointId}/check`,
        {},
        { csrf: true },
      );
      expectStatus(response, 200);
      if (asObject(response.body).progressStatus !== "frozen") {
        fail(response, "Checkpoint не перешёл в frozen");
      }

      const notifications = await getNotifications(requireClient(userClient, "user"));
      if (!notifications.items.some((item) => item.type === "checkpoint_frozen")) {
        fail(notifications.response, "Нет notification checkpoint_frozen");
      }
    });

    await check("Files", "user uploads support_attachment file", async () => {
      const formData = new FormData();
      formData.set(
        "file",
        new File(["integration smoke support attachment"], "support-smoke.txt", {
          type: "text/plain",
        }),
      );
      formData.set("purpose", "support_attachment");
      const response = await requireClient(userClient, "user").postForm(
        "/api/files/upload",
        formData,
        { csrf: true },
      );
      expectStatus(response, 201);
      const file = asObject(asObject(response.body).file as JsonBody);
      supportFileAssetId = Number(file.id);
      if (file.storageDriver !== "local") fail(response, "storageDriver должен быть local");
      if (file.purpose !== "support_attachment") {
        fail(response, "Файл загружен не как support_attachment");
      }
    });
    await check("Support", "user creates support dialog", async () => {
      if (!supportFileAssetId) throw new Error("supportFileAssetId отсутствует");
      const response = await requireClient(userClient, "user").post(
        "/api/support/my-dialog/messages",
        {
          message: `Integration smoke support ${Date.now()}`,
          fileAssetId: supportFileAssetId,
        },
        { csrf: true },
      );
      expectStatus(response, 201);
      supportDialogId = Number(asObject(asObject(response.body).dialog as JsonBody).id);
    });
    await check("Support", "support GET /api/support/dialogs -> dialog visible", async () => {
      const response = await requireClient(supportClient, "support").get("/api/support/dialogs");
      expectStatus(response, 200);
      const dialogs = asArray(asObject(response.body).dialogs, "dialogs");
      if (!dialogs.some((dialog) => Number(dialog.id) === supportDialogId)) {
        fail(response, "Созданный dialog не найден");
      }
    });
    await check("Support", "support loads CSRF", async () => requireClient(supportClient, "support").loadCsrf());
    await check("Support", "support opens dialog", async () => {
      if (!supportDialogId) throw new Error("supportDialogId отсутствует");
      const response = await requireClient(supportClient, "support").get(`/api/support/dialogs/${supportDialogId}`);
      expectStatus(response, 200);
      const dialog = asObject(asObject(response.body).dialog as JsonBody);
      const messages = asArray(dialog.messages, "dialog.messages");
      if (
        !messages.some((message) => Number(message.fileAssetId) === supportFileAssetId)
      ) {
        fail(response, "Support не видит attachment в диалоге");
      }
    });
    await check("Files", "support downloads support attachment", async () => {
      if (!supportFileAssetId) throw new Error("supportFileAssetId отсутствует");
      const response = await requireClient(supportClient, "support").get(
        `/api/files/${supportFileAssetId}`,
      );
      expectStatus(response, 200);
      if (
        typeof response.body !== "string" ||
        !response.body.includes("integration smoke support attachment")
      ) {
        fail(response, "Support не скачал support attachment");
      }
    });
    await check("Support", "support replies", async () => {
      if (!supportDialogId) throw new Error("supportDialogId отсутствует");
      supportReply = `Integration smoke reply ${Date.now()}`;
      const response = await requireClient(supportClient, "support").post(
        `/api/support/dialogs/${supportDialogId}/messages`,
        { message: supportReply, internalNote: false },
        { csrf: true },
      );
      expectStatus(response, 201);
    });
    await check("Notifications", "support reply notification created", async () => {
      const result = await getNotifications(requireClient(userClient, "user"));
      const notification = result.items.find((item) => item.type === "support_reply");
      if (!notification) {
        fail(result.response, "Нет notification support_reply");
      }
      if (result.unreadCount < 1) {
        fail(result.response, "unreadCount не увеличился после support reply");
      }
      supportNotificationId = Number(notification.id);
    });
    await check("Notifications", "mark one notification read", async () => {
      if (!supportNotificationId) throw new Error("supportNotificationId отсутствует");
      const before = await getNotifications(requireClient(userClient, "user"));
      const response = await requireClient(userClient, "user").patch(
        `/api/notifications/${supportNotificationId}/read`,
        {},
      );
      expectStatus(response, 200);
      const unreadCount = Number(asObject(response.body).unreadCount);
      if (unreadCount !== Math.max(before.unreadCount - 1, 0)) {
        fail(response, "unreadCount не уменьшился после read");
      }
    });
    await check("Support", "support adds internal note", async () => {
      if (!supportDialogId) throw new Error("supportDialogId отсутствует");
      internalNote = `Integration smoke internal ${Date.now()}`;
      const response = await requireClient(supportClient, "support").post(
        `/api/support/dialogs/${supportDialogId}/messages`,
        { message: internalNote, internalNote: true },
        { csrf: true },
      );
      expectStatus(response, 201);
    });
    await check("Support", "support changes status", async () => {
      if (!supportDialogId) throw new Error("supportDialogId отсутствует");
      const response = await requireClient(supportClient, "support").patch(
        `/api/support/dialogs/${supportDialogId}`,
        { status: "in_progress" },
      );
      expectStatus(response, 200);
    });
    await check("Support", "user sees reply and not internal note", async () => {
      const response = await requireClient(userClient, "user").get("/api/support/my-dialog");
      expectStatus(response, 200);
      const dialog = asObject(asObject(response.body).dialog as JsonBody);
      const messages = asArray(dialog.messages, "dialog.messages");
      if (!messages.some((message) => message.message === supportReply)) fail(response, "Ответ support не виден user");
      if (messages.some((message) => message.message === internalNote || message.internalNote === true)) {
        fail(response, "Internal note виден user");
      }
    });
    await check("Support", "support closes dialog", async () => {
      if (!supportDialogId) throw new Error("supportDialogId отсутствует");
      const response = await requireClient(supportClient, "support").patch(
        `/api/support/dialogs/${supportDialogId}`,
        { status: "closed" },
      );
      expectStatus(response, 200);
      if (asObject(asObject(response.body).dialog as JsonBody).status !== "closed") fail(response, "Dialog не закрыт");
    });
    await check("Support", "closed dialog is read-only for staff", async () => {
      if (!supportDialogId) throw new Error("supportDialogId отсутствует");
      const response = await requireClient(supportClient, "support").post(
        `/api/support/dialogs/${supportDialogId}/messages`,
        { message: "Сообщение после закрытия", internalNote: false },
        { csrf: true },
      );
      expectStatus(response, 400);
      if (asObject(response.body).error !== "DIALOG_CLOSED") fail(response, "Ожидался DIALOG_CLOSED");
    });

    for (const endpoint of [
      "/api/admin/users",
      "/api/admin/tasks",
      "/api/admin/rewards",
      "/api/admin/news",
      "/api/admin/audit-logs",
      "/api/admin/task-reports",
    ]) {
      await check("Admin", `GET ${endpoint} -> 200`, async () => {
        const response = await requireClient(adminClient, "admin").get(endpoint);
        expectStatus(response, 200);
      });
    }

    for (const [role, client, endpoint, expected] of [
      ["user", userClient, "/api/admin/users", 403],
      ["user", userClient, "/api/support/dialogs", 403],
      ["support", supportClient, "/api/admin/users", 403],
      ["support", supportClient, "/api/support/dialogs", 200],
      ["admin", adminClient, "/api/admin/users", 200],
      ["admin", adminClient, "/api/support/dialogs", 200],
      ["user", userClient, "/api/admin/task-reports", 403],
      ["support", supportClient, "/api/admin/task-reports", 403],
      ["mentor", mentorClient, "/api/admin/task-reports", 200],
      ["admin", adminClient, "/api/admin/task-reports", 200],
    ] as const) {
      await check("Roles", `${role} GET ${endpoint} -> ${expected}`, async () => {
        const response = await requireClient(client, role).get(endpoint);
        expectStatus(response, expected);
        if (expected === 403 && asObject(response.body).error !== "FORBIDDEN") {
          fail(response, "Ожидался FORBIDDEN");
        }
      });
    }

    await check("Task reports", "audit contains submit, reject and approve actions", async () => {
      const response = await requireClient(adminClient, "admin").get("/api/admin/audit-logs");
      expectStatus(response, 200);
      const logs = asArray(asObject(response.body).logs, "logs");
      const actions = logs.map((log) => log.action);
      for (const action of [
        "TASK_REPORT_SUBMITTED",
        "TASK_REPORT_REJECTED",
        "TASK_REPORT_APPROVED",
      ]) {
        if (!actions.includes(action)) fail(response, `Audit не содержит ${action}`);
      }
    });

    const postbackClient = new ApiClient();
    const externalEventId = `integration-smoke-${Date.now()}`;
    const postbackPayload = {
      type: "Registration",
      userId,
      externalEventId,
      amount: 0,
      rawPayload: { source: "integration-smoke" },
    };
    await check("Security", "postback without secret -> 403", async () => {
      const response = await postbackClient.post("/api/exchange/postbacks/receive", postbackPayload);
      expectStatus(response, 403);
      if (asObject(response.body).error !== "FORBIDDEN") fail(response, "Ожидался FORBIDDEN");
    });
    await check("Security", "postback with secret -> 200 duplicate false", async () => {
      const response = await postbackClient.post("/api/exchange/postbacks/receive", postbackPayload, {
        headers: { "x-postback-secret": postbackSecret },
      });
      expectStatus(response, 200);
      if (asObject(response.body).duplicate !== false) fail(response, "Ожидался duplicate=false");
    });
    await check("Notifications", "postback received notification created", async () => {
      const result = await getNotifications(requireClient(userClient, "user"));
      if (!result.items.some((item) => item.type === "postback_received")) {
        fail(result.response, "Нет notification postback_received");
      }
    });
    await check("Security", "duplicate externalEventId -> 200 duplicate true", async () => {
      const response = await postbackClient.post("/api/exchange/postbacks/receive", postbackPayload, {
        headers: { "x-postback-secret": postbackSecret },
      });
      expectStatus(response, 200);
      if (asObject(response.body).duplicate !== true) fail(response, "Ожидался duplicate=true");
    });

    await check("Notifications", "read-all clears unreadCount", async () => {
      const response = await requireClient(userClient, "user").patch(
        "/api/notifications/read-all",
        {},
      );
      expectStatus(response, 200);
      if (Number(asObject(response.body).unreadCount) !== 0) {
        fail(response, "read-all не обнулил unreadCount");
      }

      const notifications = await getNotifications(requireClient(userClient, "user"));
      if (notifications.unreadCount !== 0) {
        fail(notifications.response, "После read-all unreadCount не равен 0");
      }
    });

    await check("Auth", "mentor logout -> 200", async () => {
      const client = requireClient(mentorClient, "mentor");
      await client.loadCsrf();
      const response = await client.post("/api/auth/logout", {}, { csrf: true });
      expectStatus(response, 200);
    });

    console.log("INFO: rate-limit threshold намеренно не исчерпывается, чтобы повторные smoke runs оставались безопасными.");
  } finally {
    await check("Cleanup", "restore seed after smoke", () => restoreSeed());
  }

  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  console.log("\nSmoke summary");
  console.log(`total checks: ${results.length}`);
  console.log(`passed: ${passed}`);
  console.log(`failed: ${failed}`);

  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

