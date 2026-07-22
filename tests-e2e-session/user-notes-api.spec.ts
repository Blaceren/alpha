import { test, expect, type Page } from "@playwright/test";
import { SESSION_E2E, BACKEND_ORIGIN_HOSTPORT, BACKEND_PORT_TOKEN } from "./support/e2e-config";

/**
 * Production CRM User Notes v1 at `/users/[userId]`, proved in a real browser
 * against the deterministic stub. The stub's Notes response and the session's
 * permission set are chosen by test-only cookies set here — the production
 * client knows nothing about them.
 *
 * These tests take no screenshots: nothing here is a tracked visual baseline.
 */

const SESSION_COOKIE = "ata_test_crm_session_state";
const USERS_COOKIE = "ata_test_crm_users_state";
const DETAIL_COOKIE = "ata_test_crm_user_detail_state";
const NOTES_COOKIE = "ata_test_crm_notes_state";
const NOTES_SESSION_COOKIE = "ata_test_crm_notes_session";

type NotesPerms = "both" | "view_only" | "create_only" | "neither" | "edit_only";
type NotesState =
  | "populated"
  | "empty"
  | "paged"
  | "duplicate_page"
  | "same_timestamp"
  | "multiline"
  | "html_text"
  | "long_note"
  | "invalid_input"
  | "unauthenticated"
  | "forbidden_list"
  | "forbidden_create"
  | "invalid_create"
  | "not_found"
  | "not_found_create"
  | "server_error_list"
  | "server_error_create"
  | "malformed_list"
  | "malformed_create"
  | "unexpected_200_create"
  | "delayed_list"
  | "delayed_create"
  | "network_failure";

async function useNotes(page: Page, perms: NotesPerms, notes: NotesState) {
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: "notes_matrix", domain: "127.0.0.1", path: "/" },
    { name: NOTES_SESSION_COOKIE, value: perms, domain: "127.0.0.1", path: "/" },
    { name: USERS_COOKIE, value: "populated", domain: "127.0.0.1", path: "/" },
    { name: DETAIL_COOKIE, value: "active", domain: "127.0.0.1", path: "/" },
    { name: NOTES_COOKIE, value: notes, domain: "127.0.0.1", path: "/" },
  ]);
}

const notesSection = (page: Page) => page.getByRole("heading", { name: "Заметки" });
const composer = (page: Page) => page.getByLabel("Новая заметка");
const submit = (page: Page) => page.getByRole("button", { name: "Добавить заметку" });
const learner = (page: Page) => page.getByRole("heading", { name: "Целевой Пользователь" });

/** Notes requests observed by the browser, for "no request" assertions. */
function trackNotesRequests(page: Page): { url: string; method: string }[] {
  const seen: { url: string; method: string }[] = [];
  page.on("request", (r) => {
    if (/\/api\/crm\/v1\/users\/[^/?]+\/notes/.test(r.url())) {
      seen.push({ url: r.url(), method: r.method() });
    }
  });
  return seen;
}

/* ------------------------------------------------------------------ proxy */

test.describe("same-origin proxy", () => {
  test("the exact nested notes path is proxied for GET", async ({ request }) => {
    const response = await request.get("/api/crm/v1/users/101/notes", {
      headers: { cookie: `${NOTES_COOKIE}=populated` },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-request-id"]).toBeTruthy();
  });

  test("the exact nested notes path is proxied for POST", async ({ request }) => {
    const response = await request.post("/api/crm/v1/users/101/notes", {
      headers: { cookie: `${NOTES_COOKIE}=populated`, "content-type": "application/json" },
      data: { body: "через прокси" },
    });
    expect(response.status()).toBe(201);
    expect((await response.json()).body).toBe("через прокси");
  });

  test("/notes/extra is NOT proxied", async ({ request }) => {
    const response = await request.get("/api/crm/v1/users/101/notes/extra");
    expect(response.status()).toBe(404);
  });

  test("/notes/{noteId} is NOT proxied", async ({ request }) => {
    const response = await request.get("/api/crm/v1/users/101/notes/note_stub_1");
    expect(response.status()).toBe(404);
  });

  test("PUT on the notes path is unsupported", async ({ request }) => {
    const response = await request.put("/api/crm/v1/users/101/notes", { data: { body: "x" } });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).not.toBe(200);
  });

  test("PATCH on the notes path is unsupported", async ({ request }) => {
    const response = await request.patch("/api/crm/v1/users/101/notes", { data: { body: "x" } });
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test("DELETE on the notes path is unsupported", async ({ request }) => {
    const response = await request.delete("/api/crm/v1/users/101/notes");
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });
});

/* ------------------------------------------------------------ permissions */

test.describe("permission-bounded surface", () => {
  test("both permissions render list and composer", async ({ page }) => {
    await useNotes(page, "both", "populated");
    await page.goto("/users/101");
    await expect(notesSection(page)).toBeVisible();
    await expect(page.getByText("Заметка номер 1")).toBeVisible();
    await expect(composer(page)).toBeVisible();
  });

  test("view-only lists notes with no composer", async ({ page }) => {
    await useNotes(page, "view_only", "populated");
    await page.goto("/users/101");
    await expect(page.getByText("Заметка номер 1")).toBeVisible();
    await expect(composer(page)).toHaveCount(0);
  });

  test("create-only shows the composer and makes NO list request", async ({ page }) => {
    await useNotes(page, "create_only", "populated");
    const seen = trackNotesRequests(page);
    await page.goto("/users/101");
    await expect(composer(page)).toBeVisible();
    await expect(page.getByText("Заметка номер 1")).toHaveCount(0);
    expect(seen.filter((r) => r.method === "GET")).toHaveLength(0);
  });

  test("neither permission mounts no Notes surface and sends no request", async ({ page }) => {
    await useNotes(page, "neither", "populated");
    const seen = trackNotesRequests(page);
    await page.goto("/users/101");
    await expect(learner(page)).toBeVisible();
    await expect(notesSection(page)).toHaveCount(0);
    expect(seen).toHaveLength(0);
  });

  test("edit_user_notes alone mounts no Notes surface and sends no request", async ({ page }) => {
    await useNotes(page, "edit_only", "populated");
    const seen = trackNotesRequests(page);
    await page.goto("/users/101");
    await expect(learner(page)).toBeVisible();
    await expect(notesSection(page)).toHaveCount(0);
    expect(seen).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------- list */

test.describe("list rendering", () => {
  test("shows the empty state", async ({ page }) => {
    await useNotes(page, "both", "empty");
    await page.goto("/users/101");
    await expect(page.getByText("Заметок пока нет")).toBeVisible();
  });

  test("shows author display name and a UTC timestamp", async ({ page }) => {
    await useNotes(page, "both", "populated");
    await page.goto("/users/101");
    await expect(page.getByText("Нина Чмиль").first()).toBeVisible();
    await expect(page.getByText(/\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} UTC/).first()).toBeVisible();
  });

  test("preserves multiline bodies", async ({ page }) => {
    await useNotes(page, "both", "multiline");
    await page.goto("/users/101");
    const body = page.getByText(/первая строка/);
    await expect(body).toBeVisible();
    expect(await body.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("pre-wrap");
  });

  test("HTML-looking text is rendered as text and never executed", async ({ page }) => {
    await useNotes(page, "both", "html_text");
    await page.goto("/users/101");
    await expect(page.getByText(/не разметка/)).toBeVisible();
    expect(await page.evaluate(() => (window as { __ataNotesPwned?: boolean }).__ataNotesPwned)).toBeUndefined();
    expect(await page.locator("section script").count()).toBe(0);
  });

  test("a long note causes no horizontal overflow", async ({ page }) => {
    await useNotes(page, "both", "long_note");
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto("/users/101");
    await expect(page.getByText(/Очень длинная заметка/)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("remains usable at 200% zoom", async ({ page }) => {
    await useNotes(page, "both", "populated");
    await page.setViewportSize({ width: 640, height: 720 });
    await page.goto("/users/101");
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "32px";
    });
    await expect(page.getByText("Заметка номер 1")).toBeVisible();
    await expect(composer(page)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("preserves server order for identical timestamps", async ({ page }) => {
    await useNotes(page, "both", "same_timestamp");
    await page.goto("/users/101");
    await expect(page.getByText("Одновременная 3")).toBeVisible();
    const bodies = await page.getByText(/Одновременная/).allTextContents();
    expect(bodies).toEqual(["Одновременная 1", "Одновременная 2", "Одновременная 3"]);
  });
});

/* ------------------------------------------------------------- pagination */

test.describe("pagination", () => {
  test("loads the next page and keeps order", async ({ page }) => {
    await useNotes(page, "both", "paged");
    await page.goto("/users/101");
    await expect(page.getByText("Заметка номер 1")).toBeVisible();
    await page.getByRole("button", { name: "Показать ещё" }).click();
    await expect(page.getByText("Заметка номер 3")).toBeVisible();
    const bodies = await page.getByText(/Заметка номер/).allTextContents();
    expect(bodies).toEqual([
      "Заметка номер 1",
      "Заметка номер 2",
      "Заметка номер 3",
      "Заметка номер 4",
    ]);
  });

  test("removes the action when exhausted", async ({ page }) => {
    await useNotes(page, "both", "paged");
    await page.goto("/users/101");
    await page.getByRole("button", { name: "Показать ещё" }).click();
    await expect(page.getByText("Заметка номер 4")).toBeVisible();
    await expect(page.getByRole("button", { name: "Показать ещё" })).toHaveCount(0);
  });

  test("a repeated noteId across pages is not rendered twice", async ({ page }) => {
    await useNotes(page, "both", "duplicate_page");
    await page.goto("/users/101");
    await page.getByRole("button", { name: "Показать ещё" }).click();
    await expect(page.getByText("Заметка номер 3")).toBeVisible();
    await expect(page.getByText("Заметка номер 1")).toHaveCount(1);
  });
});

/* ---------------------------------------------------------------- create */

test.describe("create", () => {
  test("creates a note, normalizes the body and inserts it at the top", async ({ page }) => {
    await useNotes(page, "both", "populated");
    await page.goto("/users/101");
    await composer(page).fill("  новая заметка  ");
    await submit(page).click();
    // The stub echoes exactly what the client sent — proving normalization.
    await expect(page.getByText("новая заметка", { exact: true })).toBeVisible();
    const bodies = await page.locator("section li p").allTextContents();
    expect(bodies[0]).toBe("новая заметка");
  });

  test("clears the draft after a validated 201", async ({ page }) => {
    await useNotes(page, "both", "populated");
    await page.goto("/users/101");
    await composer(page).fill("сохранится");
    await submit(page).click();
    await expect(composer(page)).toHaveValue("");
  });

  test("a 2000-code-point note is accepted", async ({ page }) => {
    await useNotes(page, "both", "empty");
    await page.goto("/users/101");
    await composer(page).fill("я".repeat(2000));
    await expect(submit(page)).toBeEnabled();
    await submit(page).click();
    await expect(composer(page)).toHaveValue("");
  });

  test("2001 code points is rejected locally with no request", async ({ page }) => {
    await useNotes(page, "both", "empty");
    const seen = trackNotesRequests(page);
    await page.goto("/users/101");
    await expect(composer(page)).toBeVisible();
    const before = seen.length;
    await composer(page).fill("я".repeat(2001));
    await expect(submit(page)).toBeDisabled();
    await expect(page.getByText(/длиннее/)).toBeVisible();
    expect(seen.filter((r) => r.method === "POST")).toHaveLength(0);
    expect(seen.length).toBe(before);
  });

  test("a control character is rejected locally with no request", async ({ page }) => {
    await useNotes(page, "both", "empty");
    const seen = trackNotesRequests(page);
    await page.goto("/users/101");
    await expect(composer(page)).toBeVisible();
    await composer(page).evaluate((el: HTMLTextAreaElement) => {
      // NUL, built from its code point so intent survives any file encoding.
      el.value = `плохой${String.fromCodePoint(0)}текст`;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(submit(page)).toBeDisabled();
    expect(seen.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  test("a delayed create is single-flight", async ({ page }) => {
    await useNotes(page, "both", "delayed_create");
    const seen = trackNotesRequests(page);
    await page.goto("/users/101");
    await composer(page).fill("подождём");
    await submit(page).click();
    await expect(page.getByRole("button", { name: "Добавляем…" })).toBeDisabled();
    // The disabled control cannot be clicked again; prove only one POST exists.
    await page.waitForTimeout(500);
    expect(seen.filter((r) => r.method === "POST")).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------- errors */

test.describe("errors", () => {
  test("403 on the list keeps the learner detail visible", async ({ page }) => {
    await useNotes(page, "both", "forbidden_list");
    await page.goto("/users/101");
    await expect(page.getByText("Нет доступа к заметкам")).toBeVisible();
    await expect(learner(page)).toBeVisible();
    await expect(page.getByText("Идентификация")).toBeVisible();
  });

  test("403 on create keeps the draft and the learner detail", async ({ page }) => {
    await useNotes(page, "both", "forbidden_create");
    await page.goto("/users/101");
    await composer(page).fill("черновик остаётся");
    await submit(page).click();
    await expect(page.getByText("Нет доступа к добавлению заметок")).toBeVisible();
    await expect(learner(page)).toBeVisible();
  });

  test("404 from notes transitions the whole detail", async ({ page }) => {
    await useNotes(page, "both", "not_found");
    await page.goto("/users/101");
    await expect(page.getByText("Пользователь не найден")).toBeVisible();
    await expect(page.getByText("Идентификация")).toHaveCount(0);
  });

  test("401 from notes redirects to login", async ({ page }) => {
    await useNotes(page, "both", "unauthenticated");
    await page.goto("/users/101");
    await page.waitForURL(/\/login\?reason=session_required/);
    expect(page.url()).toContain("/login?reason=session_required");
  });

  test("500 on the list is notes-only with a retry", async ({ page }) => {
    await useNotes(page, "both", "server_error_list");
    await page.goto("/users/101");
    await expect(page.getByText("Не удалось загрузить заметки.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
    await expect(learner(page)).toBeVisible();
  });

  test("500 on create keeps the draft", async ({ page }) => {
    await useNotes(page, "both", "server_error_create");
    await page.goto("/users/101");
    await composer(page).fill("не потеряется");
    await submit(page).click();
    await expect(page.getByText(/Не удалось добавить заметку/)).toBeVisible();
    await expect(composer(page)).toHaveValue("не потеряется");
  });

  test("400 on the list shows the safe notes error", async ({ page }) => {
    await useNotes(page, "both", "invalid_input");
    await page.goto("/users/101");
    await expect(page.getByText("Некорректный запрос заметок")).toBeVisible();
  });

  test("a malformed list fails closed with no rows", async ({ page }) => {
    await useNotes(page, "both", "malformed_list");
    await page.goto("/users/101");
    await expect(page.getByText(/Заметки не показаны/)).toBeVisible();
    await expect(page.getByText(/Заметка номер/)).toHaveCount(0);
  });

  test("a malformed 201 does not clear the draft", async ({ page }) => {
    await useNotes(page, "both", "malformed_create");
    await page.goto("/users/101");
    await composer(page).fill("остаётся после кривого 201");
    await submit(page).click();
    await expect(page.getByText(/не прошёл проверку/)).toBeVisible();
    await expect(composer(page)).toHaveValue("остаётся после кривого 201");
  });

  test("an unexpected 200 is not treated as a create", async ({ page }) => {
    await useNotes(page, "both", "unexpected_200_create");
    await page.goto("/users/101");
    await composer(page).fill("не создано");
    await submit(page).click();
    await expect(page.getByText(/не прошёл проверку/)).toBeVisible();
    await expect(composer(page)).toHaveValue("не создано");
  });

  test("never renders a backend messageKey", async ({ page }) => {
    await useNotes(page, "both", "forbidden_list");
    await page.goto("/users/101");
    await expect(page.getByText("Нет доступа к заметкам")).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("crm.users.notes");
  });
});

/* --------------------------------------------------------- privacy/stale */

test.describe("privacy and stale data", () => {
  test("no employeeId, authorId, email or deferred metadata is rendered", async ({ page }) => {
    await useNotes(page, "both", "populated");
    await page.goto("/users/101");
    await expect(page.getByText("Заметка номер 1")).toBeVisible();
    const section = page.locator("section").filter({ hasText: "Заметки" }).first();
    const text = await section.innerText();
    for (const forbidden of [
      "note_stub", "emp_", "@", "authorId", "employeeId",
      "Закрепить", "Изменить", "Удалить", "Приватная", "Командная",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  test("no backend origin is visible to the browser", async ({ page }) => {
    await useNotes(page, "both", "populated");
    const external: string[] = [];
    page.on("request", (r) => {
      if (!r.url().includes("127.0.0.1:3000")) external.push(r.url());
    });
    await page.goto("/users/101");
    await expect(page.getByText("Заметка номер 1")).toBeVisible();
    expect(external.filter((u) => u.includes(BACKEND_PORT_TOKEN))).toHaveLength(0);
    expect(await page.content()).not.toContain(BACKEND_PORT_TOKEN);
  });

  test("no note draft is persisted to local storage", async ({ page }) => {
    await useNotes(page, "both", "populated");
    await page.goto("/users/101");
    await composer(page).fill("черновик");
    const stored = await page.evaluate(() => JSON.stringify(window.localStorage));
    expect(stored).not.toContain("черновик");
  });

  test("changing learner clears the previous notes", async ({ page }) => {
    await useNotes(page, "both", "populated");
    await page.goto("/users/101");
    await expect(page.getByText("Заметка номер 1")).toBeVisible();
    await composer(page).fill("черновик 101");
    await page.goto("/users/202");
    await expect(learner(page)).toBeVisible();
    await expect(composer(page)).toHaveValue("");
  });
});
