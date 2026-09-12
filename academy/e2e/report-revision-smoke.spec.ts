import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * D3-C — the report revision cycle (/lessons/level.003) behavioral suite.
 *
 * Named *-smoke.spec.ts so the standard `npm run test:e2e` gate picks it up
 * automatically (DD-257). It writes nothing to disk — screenshots live in
 * report-revision-screenshots.spec.ts, which the gate deliberately excludes.
 *
 * `?scenario=report` is the DEVELOPMENT AND TEST marker adapter (DD-272) and
 * `?verdict=revision-requested` is the D3-C verdict adapter (DD-286). Both are
 * used HERE, in tests, and never in a user-facing link — dedicated cases below
 * assert that no rendered href carries either.
 */

const REPORT = "/lessons/level.003?scenario=report";
const REPORT_VERDICT = "/lessons/level.003?scenario=report&verdict=revision-requested";
const LIB = "/lessons?scenario=report";
const PATH = "/path?scenario=report";

const KEY_V1 = "ata.report-workspace.v1";
const KEY_V2 = "ata.report-workspace.v2";
// Since D3-D the store writes the v3 key (DD-296). Seeds still use the legacy v2
// key on purpose — that exercises the real v2→v3 read-time migration — but every
// read-BACK of a value the app just wrote must target v3, the key it actually
// writes. v1/v2 keys are migration sources only: never written, never deleted.
const KEY_V3 = "ata.report-workspace.v3";
// Bounded upper wait for two environment-dependent things the old fixed
// `waitForTimeout(900)` could not guarantee on a cold Linux dev server: React
// hydration of the report client component, and the 600ms autosave debounce.
// The waits below are CONDITION-based (poll the app's own state) and only use
// this value as a ceiling — never as a sleep.
const SETTLE_TIMEOUT = 10_000;

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const MOBILE_320 = { width: 320, height: 720 };
/** 200% zoom halves the CSS layout viewport of a 1440x900 window (real reflow). */
const ZOOM_200 = { width: 720, height: 450 };
const SHORT = { width: 1440, height: 650 };

/** Console errors and hydration warnings are collected on every page. */
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

/* ------------------------------------------------------------------ *
 * Deterministic seeds — the v2 record as the adapter would leave it
 * ------------------------------------------------------------------ */

const ENTRY = (ordinal: number, noticed: string) => ({
  id: `report.003.entry.${ordinal}`,
  ordinal,
  when: "",
  decided: "",
  noticed,
});

/** A ready report, filled through the model's own shape. */
function readyReport(status: string, review: object | null, extra: object = {}) {
  return {
    version: 2,
    reports: [
      {
        levelCode: "level.003",
        entries: [1, 2, 3, 4, 5].map((n) => ENTRY(n, `наблюдение по сделке ${n}`)),
        summary: "итог по всем пяти записям",
        status,
        submittedAt: "2026-07-17T10:00:00.000Z",
        revision: 6,
        meaningfulRevision: 6,
        review,
        ...extra,
      },
    ],
  };
}

const REVIEW = {
  comment:
    "Уточните, какое условие было записано до входа, и свяжите итоговое наблюдение со всеми пятью записями.",
  sections: ["report.003.entry.3.noticed", "report.003.summary"],
  receivedAt: "2026-07-18T09:00:00.000Z",
  atRevision: 6,
};

/**
 * Seed storage before the app boots — deterministic, no UI walking.
 *
 * The init script runs on EVERY navigation, so it seeds only when the key is
 * still absent: otherwise a reload would silently roll the state back over
 * whatever the test just did through the UI (found the hard way — the resubmit
 * survived the click and died on the reload).
 */
async function seedV2(page: Page, payload: object) {
  await page.addInitScript(
    ([key, value]) => {
      if (window.localStorage.getItem(key!) === null) {
        window.localStorage.setItem(key!, value!);
      }
    },
    [KEY_V2, JSON.stringify(payload)],
  );
}

const revisionSeed = () => readyReport("revision-requested", REVIEW);

const noticedField = (page: Page) => page.getByLabel("Что заметил после сделки");
const summaryField = (page: Page) => page.getByRole("textbox", { name: "Итоговое наблюдение" });
const resubmitButton = (page: Page) =>
  page.getByRole("button", { name: "Отправить на проверку повторно" });
const jumpToEntry = (page: Page) =>
  page.getByRole("button", { name: "Запись 03 · Что заметил после сделки" });
const jumpToSummary = (page: Page) =>
  page.getByRole("button", { name: "Итоговое наблюдение", exact: true });

/**
 * Edit the currently-open flagged field so the change actually REGISTERS in the
 * hydrated app, then wait for the app's own reaction (resubmit enabled).
 *
 * Why the retry: in this Chromium/dev build a `fill()` dispatched before React
 * attaches its controlled `onChange` is reverted to the seeded value on
 * hydration, so the change never registers and the button stays disabled — the
 * exact Linux failure this file is hardening. `canResubmit` is derived from
 * in-memory draft state on the change event (no debounce), so re-applying the
 * fill until the button enables converges the moment hydration lands. This never
 * conceals a product defect: it can only succeed when the product itself enables
 * resubmit in response to a real, present edit.
 */
async function editMarkedUntilResubmitReady(page: Page, value: string) {
  const field = noticedField(page);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value);
    await expect(resubmitButton(page)).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: SETTLE_TIMEOUT });
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const NAV_CLEARANCE_PX = 12;

/** Geometry, not CSS presence: the control must clear the fixed bottom bar. */
async function assertClearsBottomNav(page: Page, target: Locator, label: string) {
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(120);

  const box = await target.boundingBox();
  const nav = await page.locator(".bottomnav").boundingBox();
  expect(box, `${label}: no bounding box`).not.toBeNull();
  expect(nav, "bottom navigation missing").not.toBeNull();

  const gap = nav!.y - (box!.y + box!.height);
  expect(
    gap,
    `${label} must clear the bottom navigation by ≥${NAV_CLEARANCE_PX}px, got ${Math.round(gap)}px`,
  ).toBeGreaterThanOrEqual(NAV_CLEARANCE_PX);
}

/* ------------------------------------------------------------------ *
 * 1 — the explicit dev/test adapter produces the verdict
 * ------------------------------------------------------------------ */

test.describe("revision — the dev/test verdict adapter", () => {
  test("1. the explicit query turns a pending report into «Нужна доработка»", async ({ page }) => {
    const errors = collectErrors(page);
    await seedV2(page, readyReport("pending-review", null));
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT_VERDICT);

    await expect(page.getByText("Нужна доработка")).toBeVisible();
    await expect(page.getByText("Комментарий проверки")).toBeVisible();

    const stored = await page.evaluate((key) => window.localStorage.getItem(key), KEY_V3);
    expect(stored).toContain('"status":"revision-requested"');
    // The verdict writes the report workspace ONLY — never lesson progress.
    const lesson = await page.evaluate(() =>
      window.sessionStorage.getItem("ata.lesson-progress.v1"),
    );
    expect(lesson).toBeNull();
    expect(errors).toEqual([]);
  });

  test("an unknown verdict fails closed — approved cannot be minted", async ({ page }) => {
    await seedV2(page, readyReport("pending-review", null));
    await page.goto("/lessons/level.003?scenario=report&verdict=approved");

    await expect(page.getByText("На проверке")).toBeVisible();
    const stored = await page.evaluate((key) => window.localStorage.getItem(key), KEY_V2);
    expect(stored).toContain('"status":"pending-review"');
    expect(stored).not.toContain("approved");
  });
});

/* ------------------------------------------------------------------ *
 * 2–5 — revision-requested presentation and the pass
 * ------------------------------------------------------------------ */

test.describe("revision — presentation and pass", () => {
  test("2. initial revision-requested desktop: status, kept work, comment, links", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await seedV2(page, revisionSeed());
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    await expect(page.getByText("Нужна доработка")).toBeVisible();
    await expect(page.getByText(/Все записи и итоговое наблюдение сохранены/)).toBeVisible();
    await expect(page.getByText(/Вердикт записан только в этом браузере/)).toBeVisible();
    await expect(page.getByText(/Уточните, какое условие было записано до входа/)).toBeVisible();
    await expect(page.getByText(/Доработка 1 из 2/)).toBeVisible();

    // The first flagged section is current — entry 3 is open.
    await expect(page.getByRole("heading", { level: 3, name: "Запись 3" })).toBeVisible();
    await expect(page.getByText(/требует внимания · доработка 1 из 2/)).toBeVisible();

    // Raw section ids never render.
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("report.003.entry");
    expect(body).not.toContain("report.003.summary");
    expect(body).not.toContain("без пометок");

    await assertNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test("3. the jump link to entry 03 focuses the flagged field", async ({ page }) => {
    await seedV2(page, revisionSeed());
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    await jumpToEntry(page).click();
    await expect(noticedField(page)).toBeFocused();
  });

  test("4. the jump link to the summary focuses it and completes the pass 2 из 2", async ({
    page,
  }) => {
    await seedV2(page, revisionSeed());
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    await jumpToSummary(page).click();
    await expect(summaryField(page)).toBeFocused();
    await expect(page.getByText(/Доработка 2 из 2/)).toBeVisible();
    await expect(page.getByText(/просмотрены — работа снова целиком ваша/)).toBeVisible();
  });

  test("5. an ordinary entry stays accessible and calm during the revision", async ({ page }) => {
    await seedV2(page, revisionSeed());
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    await page.getByRole("button", { name: /^Запись 1: заполнена/ }).click();
    await expect(page.getByRole("heading", { level: 3, name: "Запись 1" })).toBeVisible();
    await expect(noticedField(page)).toHaveValue("наблюдение по сделке 1");
    // The flagged entry, now collapsed, still says so in words.
    await expect(page.getByRole("button", { name: /^Запись 3: требует внимания/ })).toBeVisible();
  });
});

/* ------------------------------------------------------------------ *
 * 6–9 — editing, the resubmit rule, confirmation
 * ------------------------------------------------------------------ */

test.describe("revision — editing and resubmit", () => {
  test("6. editing the MARKED field unlocks resubmit after autosave", async ({ page }) => {
    await seedV2(page, revisionSeed());
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    await expect(page.getByText("Внесите изменения после комментария проверки.")).toBeVisible();
    await expect(resubmitButton(page)).toBeDisabled();

    await editMarkedUntilResubmitReady(page, "наблюдение по сделке 3 — условие записано до входа");

    await expect(
      page.getByText("Есть изменения после вердикта — можно отправить на проверку повторно."),
    ).toBeVisible();
  });

  test("7. editing an UNMARKED field also counts — guidance, not a validator", async ({ page }) => {
    await seedV2(page, revisionSeed());
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    // Opening entry 1 is a client-only accordion transition; retry until the app
    // actually switches (a click dispatched before hydration is a no-op).
    await expect(async () => {
      await page.getByRole("button", { name: /^Запись 1: заполнена/ }).click();
      await expect(page.getByRole("heading", { level: 3, name: "Запись 1" })).toBeVisible({
        timeout: 1_000,
      });
    }).toPass({ timeout: SETTLE_TIMEOUT });

    await editMarkedUntilResubmitReady(page, "наблюдение по сделке 1 — дополнено");
  });

  test("8. a whitespace-only edit does NOT unlock resubmit", async ({ page }) => {
    await seedV2(page, revisionSeed());
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    const original = await noticedField(page).inputValue();
    // Prove the field is interactive with a real change (button enables), THEN
    // show that reverting to whitespace-only does not keep it enabled. Without
    // the first step a lost pre-hydration fill could leave the button disabled
    // for the wrong reason and pass vacuously.
    await editMarkedUntilResubmitReady(page, `${original} — существенное изменение`);

    await noticedField(page).fill(`${original}   `);
    await expect(resubmitButton(page)).toBeDisabled();
    await expect(page.getByText("Внесите изменения после комментария проверки.")).toBeVisible();
  });

  test("9. confirmation dialog: honest consequences, cancel keeps the revision", async ({
    page,
  }) => {
    await seedV2(page, revisionSeed());
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    await editMarkedUntilResubmitReady(page, "наблюдение по сделке 3 — условие записано");
    await resubmitButton(page).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Отправить отчёт на проверку повторно?" }),
    ).toBeVisible();

    const text = await dialog.innerText();
    expect(text).toMatch(/Редактирование снова будет заблокировано/);
    expect(text).toMatch(/только в этом браузере/);
    expect(text).toMatch(/останется закрыт до результата проверки/);
    expect(text).toMatch(/Автоматического одобрения нет/);
    expect(text).not.toMatch(/наставнику/i);

    // Cancel keeps everything editable.
    await dialog.getByRole("button", { name: "Продолжить доработку" }).click();
    await expect(dialog).toBeHidden();
    const stored = await page.evaluate((key) => window.localStorage.getItem(key), KEY_V2);
    expect(stored).toContain('"status":"revision-requested"');

    // Escape closes it too.
    await resubmitButton(page).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});

/* ------------------------------------------------------------------ *
 * 10–12 — after resubmit
 * ------------------------------------------------------------------ */

test.describe("revision — after resubmit", () => {
  async function resubmit(page: Page) {
    await editMarkedUntilResubmitReady(page, "наблюдение по сделке 3 — условие записано до входа");
    await resubmitButton(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "Отправить повторно" }).click();
  }

  test("10. resubmit returns the report to «На проверке», read-only, feedback kept", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await seedV2(page, revisionSeed());
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await resubmit(page);

    await expect(page.getByText("На проверке")).toBeVisible();
    await expect(
      page.getByText(/Исправления отмечены как отправленные только в этом браузере/),
    ).toBeVisible();
    await expect(noticedField(page)).toHaveAttribute("readonly", "");
    await expect(summaryField(page)).toHaveAttribute("readonly", "");
    await expect(resubmitButton(page)).toHaveCount(0);

    // The former feedback stays as quiet context — no jump links any more.
    await expect(page.getByText("Комментарий последней проверки")).toBeVisible();
    await expect(jumpToEntry(page)).toHaveCount(0);

    const stored = await page.evaluate((key) => window.localStorage.getItem(key), KEY_V3);
    expect(stored).toContain('"status":"pending-review"');
    expect(stored).toContain("Уточните, какое условие");

    // Progression untouched: no lesson completion, level 4 still locked.
    const lesson = await page.evaluate(() =>
      window.sessionStorage.getItem("ata.lesson-progress.v1"),
    );
    expect(lesson ?? "").not.toContain("level.003");
    await expect(
      page.getByText("Уровень 4 «Контрольная точка $50» откроется после одобрения отчёта."),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("11. a hard reload keeps the v2 state", async ({ page }) => {
    await seedV2(page, revisionSeed());
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await resubmit(page);

    await page.reload();
    await expect(page.getByText("На проверке")).toBeVisible();
    await expect(page.getByText("Комментарий последней проверки")).toBeVisible();

    // After the reload the read-only ledger opens on entry 1 again; the edited
    // text lives in entry 3 — open its row to verify the edit survived.
    await page.getByRole("button", { name: /^Запись 3: заполнена/ }).click();
    await expect(noticedField(page)).toHaveValue(
      "наблюдение по сделке 3 — условие записано до входа",
    );
  });

  test("12. the library and the path agree after the resubmit", async ({ page }) => {
    await seedV2(page, revisionSeed());
    await page.goto(REPORT);
    await resubmit(page);

    await page.goto(LIB);
    await expect(page.getByText("На проверке").first()).toBeVisible();
    await expect(page.locator('a[href="/lessons/level.004"]')).toHaveCount(0);

    await page.goto(PATH);
    await page.getByRole("button", { name: /Уровень 3/ }).click();
    await expect(page.getByText("Отчёт: На проверке")).toBeVisible();
  });
});

/* ------------------------------------------------------------------ *
 * 13–15 — storage: migration and corruption in a real browser
 * ------------------------------------------------------------------ */

test.describe("revision — storage", () => {
  test("13. a valid v1 record migrates: draft carries, v1 key survives", async ({ page }) => {
    const v1 = {
      version: 1,
      reports: [
        {
          levelCode: "level.003",
          entries: [1, 2].map((n) => ENTRY(n, `запись из v1 номер ${n}`)),
          summary: "",
          status: "draft",
          submittedAt: null,
          revision: 2,
        },
      ],
    };
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key!, value!),
      [KEY_V1, JSON.stringify(v1)],
    );
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    // The migrated draft is live work again.
    await expect(page.getByText("Заполнено 2 из 5 записей").first()).toBeVisible();
    await expect(noticedField(page)).toHaveValue("запись из v1 номер 1");

    // Editing writes v3; the legacy v1 key stays on disk untouched, and v2 — a key
    // this migration path never went through — is never created.
    // Re-apply the edit until it has actually autosaved to v3. The retry absorbs
    // the pre-hydration fill-revert; the ≥700ms spacing lets the 600ms autosave
    // debounce fire between attempts (a tighter loop would keep resetting it).
    await expect(async () => {
      await noticedField(page).fill("запись из v1 номер 1 — дополнено");
      const v3 = await page.evaluate((k) => window.localStorage.getItem(k) ?? "", KEY_V3);
      expect(v3).toContain("дополнено");
    }).toPass({ timeout: SETTLE_TIMEOUT, intervals: [700, 700, 700, 700, 700] });
    const keys = await page.evaluate(
      ([k1, k2, k3]) => ({
        v1: window.localStorage.getItem(k1!),
        v2: window.localStorage.getItem(k2!),
        v3: window.localStorage.getItem(k3!),
      }),
      [KEY_V1, KEY_V2, KEY_V3],
    );
    // The legacy v1 record survives verbatim — migration never deletes or rewrites it.
    expect(keys.v1).toContain("запись из v1 номер 1");
    expect(keys.v1).not.toContain("дополнено");
    // The store writes only v3; v2 was never part of this record's history.
    expect(keys.v2).toBeNull();
    // The edit lands in the canonical v3 workspace.
    expect(keys.v3).toContain("дополнено");
  });

  test("14. a corrupt v2 fails closed — and does not fall back to v1", async ({ page }) => {
    await page.addInitScript(
      ([k1, k2, v1]) => {
        window.localStorage.setItem(k2!, "{{{ corrupt");
        window.localStorage.setItem(k1!, v1!);
      },
      [
        KEY_V1,
        KEY_V2,
        JSON.stringify({
          version: 1,
          reports: [
            {
              levelCode: "level.003",
              entries: [ENTRY(1, "старый валидный v1")],
              summary: "",
              status: "draft",
              submittedAt: null,
              revision: 1,
            },
          ],
        }),
      ],
    );
    const errors = collectErrors(page);
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    // Empty workspace: no v1 resurrection, no crash, an honest empty draft.
    await expect(page.getByText("Заполнено 0 из 5 записей").first()).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("старый валидный v1");
    expect(errors).toEqual([]);
  });

  test("15. a forged approved status in v2 is refused outright", async ({ page }) => {
    await seedV2(page, readyReport("approved", null));
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);

    // The record is dropped: an empty draft, no verdict anywhere.
    await expect(page.getByText("Заполнено 0 из 5 записей").first()).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("Одобрен");
  });
});

/* ------------------------------------------------------------------ *
 * 16–18 — library, path, canonical profile, honest links
 * ------------------------------------------------------------------ */

test.describe("revision — surfaces and the canonical profile", () => {
  test("16. the library shows the revision lifecycle and clean links", async ({ page }) => {
    await seedV2(page, revisionSeed());
    await page.goto(LIB);

    await expect(page.getByText("Нужна доработка").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Перейти к отчёту/ }).first()).toHaveAttribute(
      "href",
      "/lessons/level.003",
    );
    for (const href of await page
      .locator("a")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""))) {
      expect(href).not.toContain("scenario");
      expect(href).not.toContain("verdict");
    }
  });

  test("the library shows «Готов к повторной отправке» once a change landed", async ({ page }) => {
    const changed = readyReport("revision-requested", REVIEW, { meaningfulRevision: 7 });
    await seedV2(page, changed);
    await page.goto(LIB);
    await expect(page.getByText("Готов к повторной отправке").first()).toBeVisible();
  });

  test("17. the path shows «Отчёт: Нужна доработка» on the level detail", async ({ page }) => {
    await seedV2(page, revisionSeed());
    await page.goto(PATH);
    await page.getByRole("button", { name: /Уровень 3/ }).click();
    await expect(page.getByText("Отчёт: Нужна доработка")).toBeVisible();
  });

  test("18. the canonical profile is untouched by a stored revision", async ({ page }) => {
    const errors = collectErrors(page);
    await seedV2(page, revisionSeed());

    // Home and the canonical report route: L18 stands, level 3 is history.
    await page.goto("/lessons/level.003");
    await expect(page.getByText(/уже пройден в текущем профиле/)).toBeVisible();
    await expect(page.getByText("Нужна доработка")).toHaveCount(0);
    await expect(resubmitButton(page)).toHaveCount(0);

    await page.goto("/lessons");
    await expect(page.getByText("Продолжить обучение")).toBeVisible();
    await expect(page.getByText(/Уровень 18|Психология рынка/).first()).toBeVisible();
    await expect(page.getByText("Нужна доработка")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 19–22 — responsive: mobile, zoom, short viewport, no overlap
 * ------------------------------------------------------------------ */

test.describe("revision — responsive geometry", () => {
  for (const [name, viewport] of [
    ["mobile 390x844", MOBILE],
    ["mobile 320x720", MOBILE_320],
    ["zoom 200% (720x450)", ZOOM_200],
  ] as const) {
    test(`19. ${name}: pass works, nothing hides under the bottom navigation`, async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await seedV2(page, revisionSeed());
      await page.setViewportSize(viewport);
      await page.goto(REPORT);

      await expect(page.getByText("Нужна доработка")).toBeVisible();
      await expect(page.getByText(/Доработка 1 из 2/)).toBeVisible();
      await assertNoHorizontalOverflow(page);

      // The pass movement works on the small viewport too.
      await jumpToSummary(page).click();
      await expect(summaryField(page)).toBeFocused();
      await expect(page.getByText(/Доработка 2 из 2/)).toBeVisible();

      // Geometry: the flagged field, the steps nav and the CTA all clear the bar.
      await assertClearsBottomNav(page, summaryField(page), "итоговое наблюдение");
      await assertClearsBottomNav(page, resubmitButton(page), "CTA повторной отправки");
      await assertClearsBottomNav(
        page,
        page.getByRole("button", { name: /Следующая запись/ }),
        "навигация по записям",
      );
      expect(errors).toEqual([]);
    });
  }

  test("20. short viewport 1440x650: revision chrome present, no overflow", async ({ page }) => {
    const errors = collectErrors(page);
    await seedV2(page, revisionSeed());
    await page.setViewportSize(SHORT);
    await page.goto(REPORT);

    await expect(page.getByText("Нужна доработка")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // The CTA is reachable by scroll and fully visible.
    await resubmitButton(page).scrollIntoViewIfNeeded();
    await expect(resubmitButton(page)).toBeInViewport();
    expect(errors).toEqual([]);
  });

  test("21. mobile: the flagged entry says so in words, not colour alone", async ({ page }) => {
    await seedV2(page, revisionSeed());
    await page.setViewportSize(MOBILE);
    await page.goto(REPORT);

    await expect(page.getByText(/требует внимания · доработка 1 из 2/)).toBeVisible();
    // The five dots remain the entry indicator (never a verdict meter): all five
    // exist regardless of the verdict.
    await expect(page.locator(".rl-sd")).toHaveCount(5);
  });

  test("22. mobile: ordinary entries stay reachable through the existing walk", async ({
    page,
  }) => {
    await seedV2(page, revisionSeed());
    await page.setViewportSize(MOBILE);
    await page.goto(REPORT);

    // From entry 3 (auto-opened) back to entry 2 — the ordinary walk.
    await page.getByRole("button", { name: /Предыдущая запись/ }).click();
    await expect(page.getByRole("heading", { level: 3, name: "Запись 2" })).toBeVisible();
    await expect(noticedField(page)).toHaveValue("наблюдение по сделке 2");
  });
});
