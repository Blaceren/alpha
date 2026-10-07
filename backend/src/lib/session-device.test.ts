import { describe, expect, it } from "vitest";
import { describeUserAgent } from "@/lib/session-device";

/* The device a session is on, as the learner's list names it (owner 2026-10-07).
   Real descriptions of the browsers learners use; anything else is unknown. */
describe("describeUserAgent", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      { browser: "Chrome", os: "Windows", kind: "computer" },
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      { browser: "Safari", os: "macOS", kind: "computer" },
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      { browser: "Safari", os: "iPhone", kind: "phone" },
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.46 Mobile/15E148 Safari/604.1",
      { browser: "Chrome", os: "iPhone", kind: "phone" },
    ],
    [
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      { browser: "Safari", os: "iPad", kind: "tablet" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
      { browser: "Samsung Internet", os: "Android", kind: "phone" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
      { browser: "Chrome", os: "Android", kind: "phone" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      { browser: "Chrome", os: "Android", kind: "tablet" },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 YaBrowser/24.10.0.0 Safari/537.36",
      { browser: "Яндекс Браузер", os: "Windows", kind: "computer" },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
      { browser: "Edge", os: "Windows", kind: "computer" },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0",
      { browser: "Opera", os: "Windows", kind: "computer" },
    ],
    [
      "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
      { browser: "Firefox", os: "Linux", kind: "computer" },
    ],
    [
      "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      { browser: "Chrome", os: "ChromeOS", kind: "computer" },
    ],
  ])("names %s", (ua, expected) => {
    expect(describeUserAgent(ua)).toEqual(expected);
  });

  it("knows nothing about a client that is not a browser, or about nothing", () => {
    for (const ua of [null, undefined, "", "node", "undici", "curl/8.5.0", "python-requests/2.31"]) {
      expect(describeUserAgent(ua)).toEqual({ browser: null, os: null, kind: null });
    }
  });
});
