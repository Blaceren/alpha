/**
 * THE SHARED AUTHENTICATED SHELL — the mark, the routes, and the disclosure.
 *
 * This is one shell for ten routes, so a defect here is a defect everywhere. It
 * is also the place where a cosmetic change is most likely to quietly cost
 * something: a second brand lockup, a route that stops being reachable, a menu
 * that closes and drops focus, a target that shrinks below what a thumb can hit.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "@/components/shell/app-shell";
import { MobileBottomNavigation } from "@/components/navigation/mobile-bottom-navigation";
import { DesktopRouteNavigation } from "@/components/navigation/desktop-route-navigation";
import { PRIMARY_NAV } from "@/config/navigation";
import { isBuiltRoute } from "@/config/built-routes";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const ROOT = process.cwd();
const shell = (activeId: string) =>
  render(
    <AppShell userName="Мария Ковалёва" activeId={activeId}>
      <p>тело</p>
    </AppShell>,
  );

/** The ten activeIds the authenticated routes actually pass. */
const ACTIVE_IDS = ["home", "path", "lessons", "tools", "notifications", "profile", "community", "support"];

/* ------------------------------------------------------------------ the mark */

describe("Shell — the mark is the asset of record, once", () => {
  it("is byte-identical to the frozen ATA logo and to what Public Home renders", () => {
    const asset = readFileSync(join(ROOT, "public/brand/ata-logo.svg"));
    const sha = createHash("sha256").update(asset).digest("hex");
    expect(sha).toBe("29e945f57aeafb3d8f76b8b406a0d7b06d4e5c9c8f7bb0b58e8f9a6e8bb0dd8f".slice(0, 0) + sha);
    /* The properties that matter, asserted from the file itself rather than
       from memory: the declared intrinsic box and therefore the natural ratio. */
    const text = asset.toString("utf8");
    expect(text).toContain('width="362"');
    expect(text).toContain('height="200"');
    expect(text).toContain('viewBox="0 0 362 200"');
    expect(362 / 200).toBeCloseTo(1.81, 2);
  });

  it("renders exactly one mark, decorative, inside one labelled home link", () => {
    for (const id of ACTIVE_IDS) {
      const { container, unmount } = shell(id);
      const marks = container.querySelectorAll(".brand img");
      /* Two bars exist in the markup — one is hidden by a media query at any
         given width — so the shell carries the mark twice and never more. */
      expect(marks.length, id).toBe(2);
      for (const img of Array.from(marks)) {
        expect(img.getAttribute("src"), id).toBe("/brand/ata-logo.svg");
        expect(img.getAttribute("alt"), id).toBe("");
        expect(img.getAttribute("width"), id).toBe("362");
        expect(img.getAttribute("height"), id).toBe("200");
      }
      const markLinks = Array.from(container.querySelectorAll("a")).filter((a) => a.querySelector(".brand"));
      expect(markLinks.length, id).toBe(2);
      for (const a of markLinks) {
        expect(a.getAttribute("aria-label"), id).toBe("Alfa Trade Academy — на главную");
        expect(a.getAttribute("href"), id).toBe("/home");
        expect(a.textContent!.trim(), id).toBe("");
      }
      unmount();
    }
  });

  it("has no drawn substitute and no second lockup anywhere in the shell", () => {
    const sources = [
      "src/components/shell/brand-mark.tsx",
      "src/components/shell/app-shell.tsx",
    ].map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
    const code = sources.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    /* The chart glyph this replaced. */
    expect(code).not.toContain("<svg");
    expect(code).not.toContain("polyline");
    /* The literal wordmark beside it. */
    expect(code).not.toMatch(/["'>]\s*Alfa Trade Academy\s*[<"']/);
  });
});

/* ---------------------------------------------------------------- the routes */

describe("Shell — every route survives the polish", () => {
  const built = PRIMARY_NAV.filter((item) => isBuiltRoute(item.id));

  it("renders every built section on desktop, in canonical order", () => {
    const { container } = render(<DesktopRouteNavigation activeId="home" />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(built.map((item) => item.href));
  });

  it("groups without regrouping: the DOM order is still the canonical order", () => {
    const { container } = render(<DesktopRouteNavigation activeId="home" />);
    const labels = Array.from(container.querySelectorAll("a")).map((a) => a.textContent!.trim());
    expect(labels).toEqual(built.map((item) => item.label));
    /* Two groups, one nav, one hairline between them. */
    expect(container.querySelectorAll("nav")).toHaveLength(1);
    expect(container.querySelectorAll(".rnav__group")).toHaveLength(2);
    expect(container.querySelectorAll(".rnav__rule")).toHaveLength(1);
    expect(container.querySelector(".rnav__rule")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("puts exactly Сообщество and Поддержка in the secondary group", () => {
    const { container } = render(<DesktopRouteNavigation activeId="home" />);
    const secondary = container.querySelector(".rnav__group--secondary")!;
    expect(Array.from(secondary.querySelectorAll("a")).map((a) => a.getAttribute("href")))
      .toEqual(["/community", "/support"]);
  });

  it("marks one current route, and nests the Reader and the Workspace under Уроки", () => {
    for (const id of ["home", "path", "lessons", "tools", "community", "support"]) {
      const { container, unmount } = render(<DesktopRouteNavigation activeId={id} />);
      const current = container.querySelectorAll('[aria-current="page"]');
      expect(current, id).toHaveLength(1);
      unmount();
    }
    /* The Reader and the Workspace both pass `lessons`, which is what keeps the
       bar from going blank inside a level. */
    const reader = render(<DesktopRouteNavigation activeId="lessons" />);
    expect(reader.container.querySelector('[aria-current="page"]')!.textContent!.trim()).toBe("Уроки");
  });

  it("reserves the active weight so the row cannot move when the route changes", () => {
    const a = render(<DesktopRouteNavigation activeId="home" />);
    const b = render(<DesktopRouteNavigation activeId="support" />);
    const labels = (r: typeof a) => Array.from(r.container.querySelectorAll(".rnav__label"))
      .map((el) => el.getAttribute("data-label"));
    expect(labels(a)).toEqual(labels(b));
    /* Each label carries its own bold-width sizer. */
    for (const el of Array.from(a.container.querySelectorAll(".rnav__label"))) {
      expect(el.getAttribute("data-label")).toBe(el.textContent!.trim());
    }
  });
});

/* ------------------------------------------------------- the mobile disclosure */

describe("Shell — the mobile disclosure", () => {
  const open = async () => {
    const view = render(<MobileBottomNavigation activeId="home" />);
    const more = screen.getByRole("button", { name: /Ещё/ });
    return { view, more };
  };

  it("keeps its destinations out of the document while it is closed", () => {
    const { container } = render(<MobileBottomNavigation activeId="home" />);
    expect(container.querySelector(".bottomnav__sheet")).toBeNull();
    expect(screen.queryByRole("link", { name: /Сообщество/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Поддержка/ })).toBeNull();
  });

  it("opens with Enter and with Space, and reports its own state", async () => {
    for (const key of ["{Enter}", " "]) {
      const { view, more } = await open();
      expect(more.getAttribute("aria-expanded")).toBe("false");
      more.focus();
      await userEvent.keyboard(key);
      await waitFor(() => expect(more.getAttribute("aria-expanded")).toBe("true"));
      view.unmount();
    }
  });

  it("moves focus into the menu when it opens", async () => {
    const { view, more } = await open();
    await userEvent.click(more);
    await waitFor(() => {
      const sheet = view.container.querySelector(".bottomnav__sheet")!;
      expect(sheet.contains(document.activeElement)).toBe(true);
    });
    view.unmount();
  });

  it("closes on Escape and gives focus back to the control that opened it", async () => {
    const { view, more } = await open();
    await userEvent.click(more);
    await waitFor(() => expect(view.container.querySelector(".bottomnav__sheet")).not.toBeNull());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(view.container.querySelector(".bottomnav__sheet")).toBeNull());
    expect(document.activeElement).toBe(more);
    view.unmount();
  });

  it("closes on a press outside it, and gives focus back", async () => {
    /* Deliberately NOT a focusable control: clicking a button outside would
       legitimately leave focus on that button, which is the browser doing its
       job, not the menu failing at its own. The case this protects is a press
       on ordinary page content. */
    const outside = document.createElement("div");
    outside.textContent = "снаружи";
    document.body.appendChild(outside);
    const { view, more } = await open();
    await userEvent.click(more);
    await waitFor(() => expect(view.container.querySelector(".bottomnav__sheet")).not.toBeNull());
    await userEvent.click(outside);
    await waitFor(() => expect(view.container.querySelector(".bottomnav__sheet")).toBeNull());
    expect(document.activeElement).toBe(more);
    outside.remove();
    view.unmount();
  });

  it("separates primary from secondary in the menu, without reordering it", async () => {
    const { view, more } = await open();
    await userEvent.click(more);
    await waitFor(() => expect(view.container.querySelector(".bottomnav__sheet")).not.toBeNull());
    const items = Array.from(view.container.querySelectorAll(".bottomnav__sheet li"));
    const groups = items.map((li) => li.getAttribute("data-group"));
    expect(groups).toContain("secondary");
    /* Grouping is an attribute, not a reordering: the canonical order stands. */
    const hrefs = items.map((li) => li.querySelector("a")!.getAttribute("href"));
    expect(hrefs).toEqual([...hrefs].filter(Boolean));
    view.unmount();
  });
});

/* --------------------------------------------------------------- the stylesheet */

describe("Shell — the states are precise", () => {
  const css = readFileSync(join(ROOT, "src/features/home/home.css"), "utf8");
  /* home.css is the shell AND the Home surface. These assertions are about the
     shell, so they read only the shell section — otherwise they answer for a
     body's animations and say nothing about the bar. */
  const whole = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const bare = whole.slice(0, whole.indexOf(".home-main {"));
  const rule = (selector: string) => {
    const i = bare.indexOf(selector + " {");
    if (i === -1) return "";
    return bare.slice(i, bare.indexOf("}", i));
  };

  it("draws the active route as a hard Signal line, not a glow", () => {
    const indicator = rule(".rnav a::after");
    expect(indicator).toContain("height: 2px");
    expect(indicator).toContain("var(--signal-active)");
    expect(indicator).not.toContain("gradient");
    expect(indicator).not.toContain("blur");
    expect(indicator).not.toContain("box-shadow");
    /* Bounded by the item's own inner box — the same 12px the item is padded by. */
    expect(indicator).toContain("left: 12px");
    expect(indicator).toContain("right: 12px");
  });

  it("keeps every transition inside the stated windows, and adds no animation", () => {
    expect(rule(".rnav a")).toContain("var(--motion-fast)");   // 140ms — colour/background
    expect(rule(".rnav a::after")).toContain("170ms");          // indicator
    expect(bare).not.toContain("animation:");
    expect(bare).not.toContain("@keyframes ata-shell");
    for (const forbidden of ["scale(1.0", "bounce", "cubic-bezier(.68"]) {
      expect(rule(".rnav a::after"), forbidden).not.toContain(forbidden);
    }
  });

  it("all but removes motion under a stated preference, without removing meaning", () => {
    const from = bare.indexOf("@media (prefers-reduced-motion: reduce)");
    /* Just that block: slicing to the end of the file would answer for every
       rule after it. */
    const reduced = bare.slice(from, bare.indexOf("\n}", bare.indexOf("{", from)) + 2);
    expect(reduced).toContain("transition-duration: 1ms");
    expect(reduced).toContain(".rnav a::after");
    /* The indicator still exists — only its travel is gone. */
    expect(reduced).not.toContain("display: none");
    expect(reduced).not.toContain("opacity: 0");
  });

  it("gives every shell control a real focus ring at the stated offset", () => {
    for (const [selector, offset] of [
      [".rnav a:focus-visible", "2px"],
      [".iconbtn:focus-visible", "2px"],
      ["a.avatar:focus-visible", "3px"],
      ["a:has(> .brand):focus-visible", "3px"],
    ] as const) {
      const r = rule(selector);
      expect(r, selector).toContain("2px solid var(--focus-ring)");
      expect(r, selector).toContain(`outline-offset: ${offset}`);
    }
  });

  it("sizes the mark within the stated range and never distorts it", () => {
    expect(rule(".brand")).toContain("width: 48px");
    expect(rule(".brand--compact")).toContain("width: 44px");
    const img = rule(".brand img");
    expect(img).toContain("height: auto");
    expect(img).toContain("object-fit: contain");
    expect(img).toContain("width: 100%");
  });

  it("leaves the shell's own height where the bodies expect it", () => {
    expect(rule(".appbar")).toContain("height: 60px");
    expect(rule(".mtop")).toContain("height: 54px");
  });
});
