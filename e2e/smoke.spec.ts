import { test, expect, type Page } from "@playwright/test";

const CONCEPTS = [
  { name: "Product Portal", url: "/concepts/product-portal" },
  { name: "Market Atlas", url: "/concepts/market-atlas" },
  { name: "Editorial Academy", url: "/concepts/editorial-academy" },
] as const;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  // Ignore dev-server-only noise (HMR websocket) — not an application error.
  const devNoise = /favicon|_next\/webpack-hmr|WebSocket connection to 'ws|hot-reloader/i;
  page.on("console", (m) => {
    if (m.type() === "error" && !devNoise.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

test("concepts board renders and lists the three directions", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/concepts", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Три направления Главной" })).toBeVisible();
  for (const c of CONCEPTS) {
    await expect(page.getByRole("heading", { name: c.name })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

for (const c of CONCEPTS) {
  test(`${c.name}: shared content + financial-privacy invariants`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(c.url, { waitUntil: "networkidle" });

    // Shared navigation labels (RU).
    for (const label of ["Сообщество", "Ментор", "Поддержка", "Инструменты"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }

    // Checkpoint target is shown...
    await expect(page.getByText(/требуется баланс Pocket от/).first()).toBeVisible();
    await expect(page.getByText("$200").first()).toBeVisible();

    const body = (await page.locator("body").innerText()).toLowerCase();
    // ...but no user balance / "remaining $X" / deposits.
    expect(body).not.toMatch(/осталось|ваш баланс|депозит|вывод средств/);
    // No raw internal codes leak to the user.
    expect(body).not.toMatch(/level\.\d{3}|tool\.[a-z_]+|rank\.[a-z_]+/);

    // No Pocket CTA (button or link).
    expect(await page.getByRole("button", { name: /pocket/i }).count()).toBe(0);
    expect(await page.getByRole("link", { name: /pocket/i }).count()).toBe(0);

    // A single primary action.
    expect(await page.getByRole("button", { name: /Продолжить урок/ }).count()).toBe(1);

    expect(errors).toEqual([]);
  });

  test(`${c.name}: mobile nav + no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(c.url, { waitUntil: "networkidle" });

    const nav = page.getByRole("navigation", { name: "Мобильная навигация" });
    for (const label of ["Главная", "Путь", "Уроки", "Инструменты", "Ещё"]) {
      await expect(nav.getByText(label, { exact: true })).toBeVisible();
    }

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  });
}
