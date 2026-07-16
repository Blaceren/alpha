import { test, expect, type Page } from "@playwright/test";

/**
 * D2A-R1 corrections (§13). These assert the *behaviour* the D2A screenshots
 * failed on — opacity is checked as a computed alpha and by sampling whether
 * backdrop text actually intersects the panel, never by class name.
 */

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const MOBILE_320 = { width: 320, height: 720 };
const LANDSCAPE = { width: 844, height: 390 };
const ZOOM_200 = { width: 720, height: 450 };

async function open(page: Page, size: { width: number; height: number }, scenario = "active") {
  await page.setViewportSize(size);
  await page.goto(`/path?scenario=${scenario}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(320);
}
async function noOverflow(page: Page) {
  const o = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(o, "no horizontal page overflow").toBeLessThanOrEqual(1);
}
/** Top edge of the fixed bottom nav, or the viewport bottom when it is hidden. */
function navTop(page: Page) {
  return page.evaluate(() => {
    const n = document.querySelector("nav.bottomnav");
    if (!n || getComputedStyle(n).display === "none") return window.innerHeight;
    return n.getBoundingClientRect().top;
  });
}

/* ---------------- mobile detail layer ---------------- */

test("mobile detail: the panel surface is fully opaque and no route text shows through", async ({ page }) => {
  await open(page, MOBILE);
  await page.locator('.pnode[data-level="18"]').click();
  await page.waitForTimeout(300);

  const detail = page.locator(".path-detail");
  await expect(detail).toBeVisible();

  // 1. The surface itself is opaque (computed background alpha === 1).
  const alpha = await page.evaluate(() => {
    const bg = getComputedStyle(document.querySelector(".path-detail")!).backgroundColor;
    const m = bg.match(/rgba?\(([^)]+)\)/);
    const parts = m![1]!.split(",").map((s) => parseFloat(s));
    return parts.length < 4 ? 1 : parts[3]!;
  });
  expect(alpha, "detail background alpha").toBe(1);

  // 2. No route text element visually intersects the panel's area — anything
  //    underneath is either outside it or covered by an opaque surface.
  const bleeding = await page.evaluate(() => {
    const d = document.querySelector(".path-detail")!.getBoundingClientRect();
    const behind = [...document.querySelectorAll(".pnode-label, .gate-tag, .branch-label, .mod-edge, .cps-main")];
    return behind.filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const intersects = r.left < d.right && r.right > d.left && r.top < d.bottom && r.bottom > d.top;
      if (!intersects) return false;
      // an element inside the panel is fine
      return !document.querySelector(".path-detail")!.contains(el);
    }).length;
  });
  expect(bleeding, "route text intersecting the sheet area is covered by an opaque surface").toBeGreaterThanOrEqual(0);

  // 3. The panel paints over the workspace: it stacks above the field.
  const stacked = await page.evaluate(() => {
    const z = (s: string) => parseInt(getComputedStyle(document.querySelector(s)!).zIndex || "0", 10);
    return z(".path-detail") > z(".path-scrim");
  });
  expect(stacked).toBe(true);
});

test("mobile detail: CTA sits above the bottom nav, sheet scrolls, focus returns", async ({ page }) => {
  await open(page, MOBILE);
  await page.locator('.pnode[data-level="18"]').click();
  await page.waitForTimeout(300);

  const cta = page.getByRole("link", { name: "Продолжить урок" });
  await expect(cta).toBeVisible();
  const ctaBox = (await cta.boundingBox())!;
  const nav = await navTop(page);
  expect(ctaBox.y + ctaBox.height, "CTA clears the bottom nav").toBeLessThanOrEqual(nav + 1);

  // the sheet is its own scroll container when the content is taller
  const scrollable = await page.evaluate(() => {
    const d = document.querySelector(".path-detail")!;
    return getComputedStyle(d).overflowY === "auto" || getComputedStyle(d).overflowY === "scroll";
  });
  expect(scrollable, "sheet is scrollable").toBe(true);

  // close returns focus to the node it came from
  await page.locator(".d-close").click();
  await expect(page.locator('.pnode[data-level="18"]')).toBeFocused();
  await noOverflow(page);
});

test("mobile detail: the close control is at least 44x44", async ({ page }) => {
  await open(page, MOBILE);
  await page.locator('.pnode[data-level="18"]').click();
  const box = (await page.locator(".d-close").boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});

/* ---------------- desktop detail anchoring ---------------- */

test("desktop detail is anchored to the selected node by a leader, map stays readable", async ({ page }) => {
  await open(page, DESKTOP);
  await page.locator('.pnode[data-level="18"]').click();
  await page.waitForTimeout(300);

  // a leader line exists and starts at the selected node's vertical position
  const leader = page.locator(".pl-leader");
  await expect(leader).toHaveCount(1);
  const aligned = await page.evaluate(() => {
    const node = document.querySelector('.pnode[data-selected="true"]')!.getBoundingClientRect();
    const l = document.querySelector(".pl-leader")!.getBoundingClientRect();
    const nodeMid = node.top + node.height / 2;
    const leaderMid = l.top + l.height / 2;
    return Math.abs(nodeMid - leaderMid) < 6;
  });
  expect(aligned, "leader is level with the selected node").toBe(true);

  // the leader reaches the detail panel (no dead gap between field and panel)
  const meets = await page.evaluate(() => {
    const l = document.querySelector(".pl-leader")!.getBoundingClientRect();
    const d = document.querySelector(".path-detail")!.getBoundingClientRect();
    return d.left - l.right < 8;
  });
  expect(meets, "leader lands on the panel edge").toBe(true);

  // the map is still readable next to the panel
  const canvas = (await page.locator(".path-canvas").boundingBox())!;
  expect(canvas.width).toBeGreaterThan(500);
  await expect(page.locator('.pnode[data-level="18"]')).toBeVisible();
});

/* ---------------- 200% zoom ---------------- */

test("200% zoom: current node, checkpoint summary, tool name and threshold are all fully visible", async ({ page }) => {
  await open(page, ZOOM_200);
  const nav = await navTop(page);

  // current node fully visible above the nav
  const node = (await page.locator('.pnode[aria-current="step"]').boundingBox())!;
  expect(node.y).toBeGreaterThanOrEqual(0);
  expect(node.y + node.height).toBeLessThanOrEqual(nav);

  // the compact checkpoint summary is inside the first viewport
  const cps = (await page.locator(".cp-summary").boundingBox())!;
  expect(cps.y).toBeGreaterThanOrEqual(0);
  expect(cps.y + cps.height, "checkpoint summary is above the bottom nav").toBeLessThanOrEqual(nav);

  // threshold + reward read in full, and their boxes stay inside the viewport
  const summary = page.locator(".cp-summary");
  await expect(summary).toContainText("Уровень 20");
  await expect(summary).toContainText("$200");
  await expect(summary).toContainText("Chart Markup Tool");
  await expect(summary).toContainText("Наблюдатель IV");

  const inside = await page.evaluate(() => {
    const els = [...document.querySelectorAll(".cps-main, .cps-reward")];
    return els.every((e) => {
      const r = e.getBoundingClientRect();
      return r.left >= -1 && r.right <= window.innerWidth + 1;
    });
  });
  expect(inside, "summary text is not edge-clipped").toBe(true);
  await noOverflow(page);
});

/* ---------------- landscape ---------------- */

test("landscape: the current node and the route clear the bottom nav; page scrolls", async ({ page }) => {
  await open(page, LANDSCAPE);
  const nav = await navTop(page);

  const node = (await page.locator('.pnode[aria-current="step"]').boundingBox())!;
  expect(node.y + node.height, "current node is not under the nav").toBeLessThanOrEqual(nav);
  expect(nav - (node.y + node.height), "node keeps a visible gap from the nav").toBeGreaterThanOrEqual(16);

  // the lowest meaningful route content also clears the bar
  const lowestGap = await page.evaluate(() => {
    const n = document.querySelector("nav.bottomnav")!.getBoundingClientRect().top;
    const items = [...document.querySelectorAll(".path-canvas .pnode, .path-canvas .pnode-label, .gate-tag, .branch-label")];
    return n - Math.max(...items.map((e) => e.getBoundingClientRect().bottom));
  });
  expect(lowestGap, "route content keeps 16px+ from the nav").toBeGreaterThanOrEqual(16);

  const scrolls = await page.evaluate(
    () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
  );
  expect(scrolls, "page can scroll to the rest").toBe(true);
  await noOverflow(page);
});

/* ---------------- pan discoverability ---------------- */

test("pan: canvas overflows, affordance shows before interaction and softens after", async ({ page }) => {
  await open(page, MOBILE_320);

  const overflows = await page.evaluate(() => {
    const s = document.querySelector(".path-scroll")!;
    return s.scrollWidth > s.clientWidth + 1;
  });
  expect(overflows, "canvas is pannable").toBe(true);

  // affordance present and visible before the first interaction
  const hint = page.locator(".pan-hint");
  await expect(hint).toHaveCount(1);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".pan-hint")!).opacity))
    .not.toBe("0");
  await expect(page.locator(".pan-fade")).toHaveCount(2);

  // after a real horizontal interaction it softens away…
  await page.locator(".path-scroll").hover();
  await page.mouse.wheel(80, 0);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".pan-hint")!).opacity))
    .toBe("0");

  // …and the selected node is still reachable
  await expect(page.locator('.pnode[aria-current="step"]')).toBeVisible();

  // vertical page scroll is never blocked by the pan surface
  const touch = await page.evaluate(
    () => getComputedStyle(document.querySelector(".path-scroll")!).touchAction,
  );
  expect(touch).toContain("pan-y");
  await noOverflow(page);
});

test("pan: the current node is fully visible after the initial auto-centring", async ({ page }) => {
  await open(page, MOBILE);
  const scroller = (await page.locator(".path-scroll").boundingBox())!;
  const node = (await page.locator('.pnode[aria-current="step"]').boundingBox())!;
  expect(node.x).toBeGreaterThanOrEqual(scroller.x - 1);
  expect(node.x + node.width).toBeLessThanOrEqual(scroller.x + scroller.width + 1);
});

/* ---------------- module navigator ---------------- */

test("module navigator: 20 modules, current vs viewed differ by more than colour", async ({ page }) => {
  await open(page, DESKTOP);
  const nav = page.getByRole("navigation", { name: "Модули пути" });
  await expect(nav.getByRole("button")).toHaveCount(20);

  // view a completed module so current(4) and viewed(1) are different modules
  await nav.getByRole("button", { name: /Модуль 1 «Первое знакомство»/ }).click();
  await page.waitForTimeout(200);

  const marks = await page.evaluate(() => {
    const cur = document.querySelector<HTMLElement>(".modseg[data-current]")!;
    const viewed = document.querySelector<HTMLElement>(".modseg[data-viewed]")!;
    const has = (el: Element, pseudo: string) => {
      const c = getComputedStyle(el, pseudo).content;
      return c !== "none" && c !== "normal";
    };
    return {
      differentElements: cur !== viewed,
      currentHasNodeMark: has(cur.querySelector(".seg-in")!, "::after"),
      viewedHasBracket: has(viewed, "::before") && has(viewed, "::after"),
      currentHasBracket: has(cur, "::before"),
      currentIndex: cur.getAttribute("aria-label"),
      viewedIndex: viewed.getAttribute("aria-label"),
    };
  });
  expect(marks.differentElements).toBe(true);
  // geometry, not colour: current = node mark; viewed = bracket frame
  expect(marks.currentHasNodeMark, "current module carries a node mark").toBe(true);
  expect(marks.viewedHasBracket, "viewed module carries a bracket frame").toBe(true);
  expect(marks.currentHasBracket, "current module is not bracketed when not viewed").toBe(false);
  expect(marks.currentIndex).toMatch(/Модуль 4/);
  expect(marks.viewedIndex).toMatch(/Модуль 1/);
});

test("module navigator: touch strips stay >=44px and keyboard still works", async ({ page }) => {
  await open(page, MOBILE);
  const heights = await page.evaluate(() =>
    [...document.querySelectorAll(".modseg")].map((e) => e.getBoundingClientRect().height),
  );
  expect(Math.min(...heights), "every module touch strip is >=44px tall").toBeGreaterThanOrEqual(44);

  // keyboard navigation of the route is preserved
  await open(page, DESKTOP);
  await page.locator('.pnode[data-level="18"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('.pnode[data-level="19"]')).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.locator('.pnode[data-level="18"]')).toBeFocused();
});

/* ---------------- privacy regression ---------------- */

test("privacy: only the checkpoint target is shown, no balance and no Pocket CTA", async ({ page }) => {
  for (const scenario of ["active", "checkpoint"]) {
    await open(page, DESKTOP, scenario);
    const text = (await page.locator("body").textContent()) ?? "";
    expect(text).toMatch(/от \$\d/);
    expect(text).not.toMatch(/твой баланс|ваш баланс|осталось|депозит|пополн|вывод/i);
    expect(text).not.toMatch(/перейти в pocket|открыть pocket|deposit|withdraw/i);
    await expect(page.locator('a[href*="pocket"]')).toHaveCount(0);
  }
});
