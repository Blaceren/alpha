import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const baseUrl = process.env.SMOKE_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3000";
const password = "PocketRegression123!";
const email = `pocket-regression-${Date.now()}@example.com`;
const runIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

function readEnvValue(name: string) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(".env")) return undefined;

  const line = readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));

  return line?.slice(name.length + 1).replace(/^['"]|['"]$/g, "");
}

class Client {
  private cookies = new Map<string, string>();

  setCookie(cookie: string) {
    this.storeCookie(cookie);
  }

  private storeCookie(cookie: string) {
    const pair = cookie.split(";")[0];
    const separator = pair.indexOf("=");
    if (separator <= 0) return;
    this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }

  private cookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    const cookie = this.cookieHeader();
    if (cookie) headers.set("cookie", cookie);
    headers.set("x-forwarded-for", runIp);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers, redirect: "manual" });
    const setCookies = response.headers.getSetCookie?.() ?? [];
    const fallbackSetCookie = response.headers.get("set-cookie");
    for (const setCookie of setCookies.length ? setCookies : fallbackSetCookie ? [fallbackSetCookie] : []) {
      this.storeCookie(setCookie);
    }
    return response;
  }

  async json(path: string, init: RequestInit = {}) {
    const response = await this.request(path, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
    }
    return body;
  }

  async csrf() {
    const body = await this.json("/api/csrf");
    return body.csrfToken as string;
  }

  async post(path: string, body: unknown, csrfToken?: string) {
    return this.json(path, {
      method: "POST",
      headers: csrfToken ? { "x-csrf-token": csrfToken } : undefined,
      body: JSON.stringify(body),
    });
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function createSessionCookie(userId: number) {
  const sessionSecret = readEnvValue("SESSION_SECRET");
  assert(sessionSecret, "SESSION_SECRET is required for authenticated smoke requests");
  const expiresAt = Date.now() + 60 * 60 * 24 * 7 * 1000;
  const payload = `${userId}.user.${expiresAt}`;
  const signature = crypto.createHmac("sha256", sessionSecret).update(payload).digest("hex");
  return `trading_platform_session=${payload}.${signature}`;
}

async function main() {
  const client = new Client();
  const csrf = await client.csrf();
  const registered = await client.post("/api/auth/register", { email, password, captchaToken: "dev-captcha-ok" }, csrf);
  client.setCookie(createSessionCookie(registered.user.id));
  const authedCsrf = await client.csrf();
  const referral = await client.post("/api/exchange/referral-link", {}, authedCsrf);
  const referralUrl = new URL(referral.referralUrl);
  const clickId = referralUrl.searchParams.get("click_id");
  assert(clickId?.startsWith("tq-"), `missing click_id in ${referral.referralUrl}`);
  const confirmedClickId = clickId as string;
  assert(referralUrl.searchParams.get("clickid") === confirmedClickId, "clickid compatibility param missing");
  assert(referralUrl.searchParams.get("landing") === "Landing_1", "landing param missing");

  const traderId = `regression-${Date.now()}`;
  const postback = new URL(`${baseUrl}/api/postbacks/pocket`);
  postback.searchParams.set("clickid", confirmedClickId);
  postback.searchParams.set("goal", "reg");
  postback.searchParams.set("playerid", traderId);
  // Authentication is header-only: the Pocket route rejects any request that
  // carries a secret alias in the query string.
  const postbackSecret = readEnvValue("POSTBACK_SECRET");
  assert(postbackSecret, "POSTBACK_SECRET is required to authenticate the Pocket postback");
  const postbackResponse = await fetch(postback, {
    redirect: "manual",
    headers: { "x-postback-secret": postbackSecret },
  });
  const postbackBody = await postbackResponse.json().catch(() => ({}));
  assert(postbackResponse.ok, `postback failed ${postbackResponse.status}: ${JSON.stringify(postbackBody)}`);

  const me = await client.json("/api/me");
  assert(me.user.level === 2, `expected level 2, got ${me.user.level}`);
  assert(me.user.xp === 15, `expected XP 15, got ${me.user.xp}`);
  assert(me.user.exchangeAccount?.registrationStatus === true, "registrationStatus should be true");
  assert(me.user.exchangeAccount?.status === "connected", `exchange status should be connected, got ${me.user.exchangeAccount?.status}`);

  const tasks = await client.json("/api/tasks");
  const lvl01 = tasks.tasks.find((task: { code?: string }) => task.code === "lvl_01_pocket_registration");
  const lvl02 = tasks.tasks.find((task: { code?: string }) => task.code === "lvl_02_platform_intro_lesson");
  assert(lvl01?.progress?.[0]?.status === "completed", `lvl_01 should be completed: ${JSON.stringify(lvl01)}`);
  assert(lvl02?.progress?.[0]?.status === "active", `lvl_02 should be active: ${JSON.stringify(lvl02)}`);

  console.log(JSON.stringify({ ok: true, email, clickId: confirmedClickId, traderId }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
