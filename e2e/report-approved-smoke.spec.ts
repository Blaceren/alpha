import { test, expect, type Page } from "@playwright/test";

/**
 * D3-D — the approved report state (/lessons/level.003) behavioral suite.
 *
 * Named *-smoke.spec.ts so the standard `npm run test:e2e` gate picks it up
 * (DD-257). It writes nothing to disk — screenshots live in
 * report-approved-screenshots.spec.ts, which the gate excludes.
 *
 * `?scenario=report` is the DEVELOPMENT AND TEST marker adapter and
 * `?verdict=approved` is the D3-D verdict adapter (DD-298). Both are used HERE,
 * in tests, and never in a user-facing link — dedicated cases assert that no
 * rendered href carries either, and that no user button approves anything.
 */

const REPORT = "/lessons/level.003?scenario=report";
const REPORT_APPROVE = "/lessons/level.003?scenario=report&verdict=approved";
const LIB = "/lessons?scenario=report";
const PATH = "/path?scenario=report";

const KEY_V1 = "ata.report-workspace.v1";
const KEY_V2 = "ata.report-workspace.v2";
const KEY_V3 = "ata.report-workspace.v3";
const LESSON_KEY = "ata.lesson-progress.v1";

const DESKTOP = { width: 1440, height: 900 };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    const t = msg.text();
    if (msg.type() === "error") errors.push(t);
    if (/hydrat/i.test(t)) errors.push(`HYDRATION: ${t}`);
  });
  page.on("pageerror", (err) => errors.push(`PAGEERROR: ${err.message}`));
  return errors;
}

const ENTRY = (ordinal: number, noticed: string) => ({
  id: `report.003.entry.${ordinal}`,
  ordinal,
  when: "",
  decided: "",
  noticed,
});

/** A v3 record in the shape the store serialises. */
function record(status: string, extra: Record<string, unknown> = {}) {
  return {
    version: 3,
    reports: [
      {
        levelCode: "level.003",
        entries: [1, 2, 3, 4, 5].map((n) => ENTRY(n, `наблюдение по сделке ${n}`)),
        summary: "итог по всем пяти записям",
        status,
        submittedAt: "2026-07-17T10:00:00.000Z",
        revision: 7,
        meaningfulRevision: 7,
        review: null,
        approvedAt: null,
        ...extra,
      },
    ],
  };
}

const REVIEW = {
  comment: "Уточните, какое условие было записано до входа.",
  sections: ["report.003.entry.3.noticed"],
  receivedAt: "2026-07-18T09:00:00.000Z",
  atRevision: 6,
};

async function seedV3(page: Page, payload: object) {
  await page.addInitScript(
    ([key, value]) => {
      if (window.localStorage.getItem(key!) === null) {
        window.localStorage.setItem(key!, value!);
      }
    },
    [KEY_V3, JSON.stringify(payload)],
  );
}

/* ------------------------------------------------------------------ *
 * 1 — the dev/test adapter approves a pending report
 * ------------------------------------------------------------------ */

test.describe("approved — the dev/test verdict adapter", () => {
  test("1. ?verdict=approved turns a pending report into «Одобрено»", async ({ page }) => {
    const errors = collectErrors(page);
    await seedV3(page, record("pending-review"));
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT_APPROVE);

    await expect(page.getByText("Одобрено")).toBeVisible();
    await expect(page.getByText("Отчёт принят. Уровень 3 завершён.")).toBeVisible();

    const stored = await page.evaluate((k) => window.localStorage.getItem(k), KEY_V3);
    expect(stored).toContain('"status":"approved"');
    expect(stored).toContain('"approvedAt":"');
    // The verdict writes the report workspace ONLY — never lesson progress.
    const lesson = await page.evaluate(
      (l) => window.sessionStorage.getItem(l) ?? window.localStorage.getItem(l),
      LESSON_KEY,
    );
    expect(lesson).toBeNull();
    expect(errors).toEqual([]);
  });

  test("2. a hard reload preserves the approved state", async ({ page }) => {
    await seedV3(page, record("pending-review"));
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT_APPROVE);
    await expect(page.getByText("Одобрено")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Одобрено")).toBeVisible();
    await expect(page.getByText("Отчёт принят. Уровень 3 завершён.")).toBeVisible();
  });

  test("3. no automatic approval — a pending report without the query stays pending", async ({
    page,
  }) => {
    await seedV3(page, record("pending-review"));
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await expect(page.getByText("На проверке")).toBeVisible();
    await expect(page.getByText("Одобрено")).toHaveCount(0);
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), KEY_V3);
    expect(stored).toContain('"status":"pending-review"');
  });

  test("4. no user button approves — the approved screen has no «Одобрить» control", async ({
    page,
  }) => {
    await seedV3(page, record("approved", { approvedAt: "2026-07-18T12:00:00.000Z" }));
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await expect(page.getByRole("button", { name: /Одобрить/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Отправить/ })).toHaveCount(0);
  });

  test("5. repeated ?verdict=approved on an approved report is a no-op", async ({ page }) => {
    await seedV3(page, record("approved", { approvedAt: "2026-07-18T12:00:00.000Z" }));
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT_APPROVE);
    await expect(page.getByText("Одобрено")).toBeVisible();
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), KEY_V3);
    // approvedAt unchanged — the second verdict did nothing.
    expect(stored).toContain('"approvedAt":"2026-07-18T12:00:00.000Z"');
  });

  test("6. ?verdict=approved on a draft or without ?scenario=report is a no-op", async ({
    page,
  }) => {
    await seedV3(page, record("draft", { submittedAt: null }));
    await page.setViewportSize(DESKTOP);
    await page.goto("/lessons/level.003?verdict=approved"); // no scenario → canonical
    await expect(page.getByText(/уже пройден в текущем профиле/)).toBeVisible();
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), KEY_V3);
    expect(stored).not.toContain('"status":"approved"');
  });

  test("7. a storage-write failure leaves the report pending — no fabricated success", async ({
    page,
  }) => {
    await seedV3(page, record("pending-review"));
    // Make setItem throw AFTER the seed init script has run.
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      let armed = false;
      // Arm only once the page has booted, so the seed still lands.
      queueMicrotask(() => {
        armed = true;
      });
      Storage.prototype.setItem = function (key: string, value: string) {
        if (armed && key === "ata.report-workspace.v3") throw new Error("QuotaExceeded");
        return original.call(this, key, value);
      };
    });
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT_APPROVE);

    await expect(page.getByText("На проверке")).toBeVisible();
    await expect(page.getByText("Одобрено")).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------ *
 * 8–10 — surfaces after approval
 * ------------------------------------------------------------------ */

test.describe("approved — library and path", () => {
  const approved = () => record("approved", { approvedAt: "2026-07-18T12:00:00.000Z" });

  test("8. the library shows L3 «Завершён» and the L4 checkpoint next step", async ({ page }) => {
    const errors = collectErrors(page);
    await seedV3(page, approved());
    await page.setViewportSize(DESKTOP);
    await page.goto(LIB);

    await expect(page.getByText("Следующий шаг — контрольная точка · Уровень 4.")).toBeVisible();
    await expect(page.getByText("Одобрено")).toHaveCount(0);
    // No href into the unbuilt L4 lesson.
    await expect(page.locator('a[href="/lessons/level.004"]')).toHaveCount(0);
    // L3 row reads «Завершён».
    await expect(page.getByText("Завершён").first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("9. the path shows L4 as the current checkpoint after approval", async ({ page }) => {
    const errors = collectErrors(page);
    await seedV3(page, approved());
    await page.setViewportSize(DESKTOP);
    await page.goto(PATH);

    await page.getByRole("button", { name: /Уровень 4/ }).first().click();
    await expect(page.getByRole("heading", { name: /Контрольная точка · Уровень 4/ })).toBeVisible();
    await expect(page.getByText(/Баланс Pocket от \$50/)).toBeVisible();
    // L3 no longer carries a report label — the completed rule hides it.
    await page.getByRole("button", { name: /Уровень 3/ }).first().click();
    await expect(page.getByText(/Состояние: пройден/)).toBeVisible();
    await expect(page.getByText(/Отчёт:/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("10. the approved after a resubmit keeps the last feedback as history", async ({ page }) => {
    await seedV3(page, record("approved", { approvedAt: "2026-07-18T12:00:00.000Z", review: REVIEW }));
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    await expect(page.getByText("Одобрено")).toBeVisible();
    await expect(page.getByText("Комментарий последней проверки")).toBeVisible();
    await expect(page.getByText(/Уточните, какое условие/)).toBeVisible();
    // History only — no jump links.
    await expect(page.getByRole("button", { name: /Запись 03 ·/ })).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------ *
 * 11–13 — the canonical profile and honest links
 * ------------------------------------------------------------------ */

test.describe("approved — canonical profile and honest links", () => {
  test("11. canonical (no query) L18 stays a neutral archive with a stored approved", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await seedV3(page, record("approved", { approvedAt: "2026-07-18T12:00:00.000Z" }));
    await page.setViewportSize(DESKTOP);
    await page.goto("/lessons/level.003");

    await expect(page.getByText(/уже пройден в текущем профиле/)).toBeVisible();
    await expect(page.getByText("Одобрено")).toHaveCount(0);
    await expect(page.getByText(/Отчёт принят/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("12. no rendered href carries a scenario or verdict", async ({ page }) => {
    await seedV3(page, record("approved", { approvedAt: "2026-07-18T12:00:00.000Z" }));
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await expect(page.getByText("Одобрено")).toBeVisible();

    for (const href of await page
      .locator("a")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""))) {
      expect(href).not.toContain("scenario");
      expect(href).not.toContain("verdict");
    }
    // The primary CTA is exactly /path.
    await expect(page.getByRole("link", { name: "Посмотреть Путь" })).toHaveAttribute("href", "/path");
  });

  test("13. approval never writes v1/v2 or the lesson-progress key", async ({ page }) => {
    await seedV3(page, record("pending-review"));
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT_APPROVE);
    await expect(page.getByText("Одобрено")).toBeVisible();

    const keys = await page.evaluate(
      ([k1, k2, lk]) => ({
        v1: window.localStorage.getItem(k1!),
        v2: window.localStorage.getItem(k2!),
        lessonLocal: window.localStorage.getItem(lk!),
        lessonSession: window.sessionStorage.getItem(lk!),
      }),
      [KEY_V1, KEY_V2, LESSON_KEY],
    );
    expect(keys.v1).toBeNull();
    expect(keys.v2).toBeNull();
    expect(keys.lessonLocal).toBeNull();
    expect(keys.lessonSession).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 14–16 — geometry and accessibility (§14, §16)
 * ------------------------------------------------------------------ */

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("approved — geometry and accessibility", () => {
  const approved = () => record("approved", { approvedAt: "2026-07-18T12:00:00.000Z" });

  for (const [name, viewport] of [
    ["mobile 390x844", { width: 390, height: 844 }],
    ["mobile 320x720", { width: 320, height: 720 }],
    ["zoom 200% (720x450)", { width: 720, height: 450 }],
  ] as const) {
    test(`14. ${name}: no horizontal overflow, CTA clears the bottom nav`, async ({ page }) => {
      const errors = collectErrors(page);
      await seedV3(page, approved());
      await page.setViewportSize(viewport);
      await page.goto(REPORT);
      await noHorizontalOverflow(page);

      const cta = page.getByRole("link", { name: "Посмотреть Путь" });
      await cta.scrollIntoViewIfNeeded();
      await page.waitForTimeout(120);
      const box = await cta.boundingBox();
      const nav = await page.locator(".bottomnav").boundingBox();
      expect(box).not.toBeNull();
      expect(nav).not.toBeNull();
      const gap = nav!.y - (box!.y + box!.height);
      expect(gap, `CTA must clear the bottom nav, got ${Math.round(gap)}px`).toBeGreaterThanOrEqual(
        12,
      );
      // Touch target ≥ 44px.
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(errors).toEqual([]);
    });
  }

  test("15. exactly one h1, status expressed in words, checkpoint requirement readable", async ({
    page,
  }) => {
    await seedV3(page, approved());
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    expect(await page.getByRole("heading", { level: 1 }).count()).toBe(1);
    await expect(page.getByText("Одобрено")).toBeVisible();
    await expect(page.getByText(/Требуется: Баланс Pocket от \$50/)).toBeVisible();
  });

  test("16. a plain reload of an approved archive makes no aria-live announcement", async ({
    page,
  }) => {
    await seedV3(page, approved());
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await expect(page.getByText("Одобрено")).toBeVisible();
    // The «Одобрено» chip and headline are not inside any aria-live region.
    const live = await page
      .locator('[aria-live]')
      .filter({ hasText: "Одобрено" })
      .count();
    expect(live).toBe(0);
  });
});
