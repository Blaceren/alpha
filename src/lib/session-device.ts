/**
 * Which device a session is on, as the learner's list of sessions names it
 * (owner 2026-10-07: «в профиле … сеансы … должны быть там показаны»).
 *
 * Read from the browser's own description, kept at sign-in. Only three coarse
 * facts leave this file — the browser's family, the system's and the kind of
 * device — so the list says «Chrome на Windows», never the raw string. Anything
 * that is not a browser (a script, a server-side client) is simply unknown.
 *
 * Order matters below: most browsers carry the names of the ones they grew out
 * of («Chrome» in Edge, Opera and Yandex; «Safari» in Chrome), so the specific
 * names are tested before the general ones.
 */
export type SessionDeviceKind = "phone" | "tablet" | "computer";

export type SessionDevice = {
  browser: string | null;
  os: string | null;
  kind: SessionDeviceKind | null;
};

const BROWSERS: Array<[RegExp, string]> = [
  [/YaBrowser\//, "Яндекс Браузер"],
  [/Edg(?:e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/CriOS\/|Chrome\/|Chromium\//, "Chrome"],
  [/Version\/[\d.]+.*Safari\//, "Safari"],
];

export function describeUserAgent(userAgent: string | null | undefined): SessionDevice {
  const ua = userAgent ?? "";
  if (!/Mozilla\/5\.0/.test(ua)) return { browser: null, os: null, kind: null };

  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;

  let os: string | null = null;
  let kind: SessionDeviceKind | null = null;
  if (/iPhone|iPod/.test(ua)) {
    os = "iPhone";
    kind = "phone";
  } else if (/iPad/.test(ua)) {
    os = "iPad";
    kind = "tablet";
  } else if (/Android/.test(ua)) {
    os = "Android";
    kind = /Mobile/.test(ua) ? "phone" : "tablet";
  } else if (/Windows NT/.test(ua)) {
    os = "Windows";
    kind = "computer";
  } else if (/CrOS/.test(ua)) {
    os = "ChromeOS";
    kind = "computer";
  } else if (/Mac OS X|Macintosh/.test(ua)) {
    os = "macOS";
    kind = "computer";
  } else if (/Linux/.test(ua)) {
    os = "Linux";
    kind = "computer";
  }

  return { browser, os, kind };
}
