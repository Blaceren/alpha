/**
 * AFD-3A — responsive and accessibility verification for the public
 * registration surface, against a real browser.
 *
 * Runs against an Academy started in `fixture`-independent `api` mode; the
 * Backend is never contacted because these checks never submit the form.
 */
import { test, expect, type Page } from "@playwright/test";

const WIDTHS = [1440, 1280, 768, 390] as const;

async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    // 1px of tolerance for sub-pixel rounding.
    return doc.scrollWidth <= doc.clientWidth + 1;
  });
}

test.describe("/register — responsive", () => {
  for (const width of WIDTHS) {
    test(`renders without horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/register");

      await expect(page.getByRole("heading", { name: "Создать аккаунт" })).toBeVisible();
      expect(await noHorizontalOverflow(page)).toBe(true);

      // Every control stays inside the viewport.
      for (const name of ["Email", "Пароль", "Повторите пароль"]) {
        const box = await page.getByLabel(name, { exact: true }).boundingBox();
        expect(box, name).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      }

      // The submit action and the login link both remain reachable.
      await expect(page.getByRole("button", { name: "Создать аккаунт" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Войти" })).toBeVisible();
    });
  }

  test("touch targets are large enough on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/register");

    for (const name of ["Email", "Пароль", "Повторите пароль"]) {
      const box = await page.getByLabel(name, { exact: true }).boundingBox();
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
    }
    const submit = await page.getByRole("button", { name: "Создать аккаунт" }).boundingBox();
    expect(submit!.height).toBeGreaterThanOrEqual(44);
  });

  test("a long error message wraps instead of widening the page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/register");

    // Client-side validation produces a real error without any network call.
    await page.getByLabel("Email", { exact: true }).fill("nope");
    await page.getByLabel("Пароль", { exact: true }).fill("Passw0rd");
    await page.getByLabel("Повторите пароль", { exact: true }).fill("Passw0rd");
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    await expect(page.getByText("Введите корректный email.")).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test("the referral notice does not dominate the page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/register?ref=ABC123");

    const notice = await page.getByTestId("referral-valid").boundingBox();
    expect(notice).not.toBeNull();
    expect(notice!.height).toBeLessThan(160);
    expect(await noHorizontalOverflow(page)).toBe(true);
  });
});

test.describe("/register — accessibility", () => {
  test("every field has an explicit label and a new-account autocomplete", async ({ page }) => {
    await page.goto("/register");

    await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("autocomplete", "email");
    await expect(page.getByLabel("Пароль", { exact: true })).toHaveAttribute("autocomplete", "new-password");
    await expect(page.getByLabel("Повторите пароль", { exact: true })).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  test("tab order follows the visual order", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Email", { exact: true }).focus();

    const order: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      order.push(await page.evaluate(() => document.activeElement?.getAttribute("name") ?? document.activeElement?.tagName ?? ""));
      await page.keyboard.press("Tab");
    }

    expect(order.slice(0, 4)).toEqual(["email", "name", "password", "confirmPassword"]);
  });

  test("focus is visible on the submit control", async ({ page }) => {
    await page.goto("/register");
    const submit = page.getByRole("button", { name: "Создать аккаунт" });
    await submit.focus();

    const outline = await submit.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  });

  test("the form submits from the keyboard", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Email", { exact: true }).fill("nope");
    await page.getByLabel("Пароль", { exact: true }).fill("Passw0rd");
    await page.getByLabel("Повторите пароль", { exact: true }).fill("Passw0rd");
    await page.keyboard.press("Enter");

    // Reaching validation proves the form was submitted without a mouse.
    await expect(page.getByText("Введите корректный email.")).toBeVisible();
  });

  test("errors are not communicated by colour alone", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Email", { exact: true }).fill("nope");
    await page.getByLabel("Пароль", { exact: true }).fill("Passw0rd");
    await page.getByLabel("Повторите пароль", { exact: true }).fill("Passw0rd");
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    const field = page.getByLabel("Email", { exact: true });
    // A programmatic invalid state plus text, not just a colour change.
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Введите корректный email.")).toBeVisible();
  });

  test("the page never places secrets in the URL", async ({ page }) => {
    await page.goto("/register?ref=ABC123");
    await page.getByLabel("Пароль", { exact: true }).fill("Passw0rd");
    expect(page.url()).not.toContain("Passw0rd");
  });
});
