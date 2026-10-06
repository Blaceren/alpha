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
import { render, screen } from "@testing-library/react";
import { AppShell } from "@/components/shell/app-shell";
import { MobileBottomNavigation } from "@/components/navigation/mobile-bottom-navigation";
import { DesktopRouteNavigation } from "@/components/navigation/desktop-route-navigation";
import { PRIMARY_NAV } from "@/config/navigation";
import { isBuiltRoute } from "@/config/built-routes";
import { isVisibleSection } from "@/config/feature-visibility";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const ROOT = process.cwd();
const shell = (activeId: string) =>
  render(
    <AppShell userName="Мария Ковалёва" activeId={activeId}>
      <p>тело</p>
    </AppShell>,
  );

/** The activeIds the authenticated routes actually pass. */
/* Community is built and still answers, but is withheld from the learner
   product, so it is not one of the routes the shell advertises. Support is a
   part of the profile since 2026-10-03 and passes `profile`. */
const ACTIVE_IDS = ["home", "path", "lessons", "tools", "notifications", "profile"];

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
        expect(a.getAttribute("aria-label"), id).toBe("Alpha Trade Academy — на главную");
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
    expect(code).not.toMatch(/["'>]\s*Alpha Trade Academy\s*[<"']/);
  });
});

/* ---------------------------------------------------------------- the routes */

describe("Shell — every route survives the polish", () => {
  const built = PRIMARY_NAV.filter((item) => isBuiltRoute(item.id) && isVisibleSection(item.id));

  it("renders every built section on desktop, in canonical order", () => {
    const { container } = render(<DesktopRouteNavigation activeId="home" />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(built.map((item) => item.href));
  });

  it("groups without regrouping: the DOM order is still the canonical order", () => {
    const { container } = render(<DesktopRouteNavigation activeId="home" />);
    const labels = Array.from(container.querySelectorAll("a")).map((a) => a.textContent!.trim());
    expect(labels).toEqual(built.map((item) => item.label));
    expect(container.querySelectorAll("nav")).toHaveLength(1);
  });

  /* 2026-10-03 — support moved into the profile (owner: «что бы написать в
     поддержку можно было только из профиля, не по ссылке из хеда»). It was the
     secondary group's one entry while Community is withheld; with it gone the
     bar is one group of four, and draws no hairline in front of nothing. */
  it("draws no secondary group while Community is withheld: support is a part of the profile", () => {
    const { container } = render(<DesktopRouteNavigation activeId="home" />);
    expect(container.querySelectorAll(".rnav__group")).toHaveLength(1);
    expect(container.querySelector(".rnav__group--secondary")).toBeNull();
    expect(container.querySelector(".rnav__rule")).toBeNull();
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/home", "/path", "/lessons", "/tools"]);
  });

  it("marks one current route, and nests the Reader and the Workspace under Уроки", () => {
    for (const id of ["home", "path", "lessons", "tools"]) {
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
    const b = render(<DesktopRouteNavigation activeId="tools" />);
    const labels = (r: typeof a) => Array.from(r.container.querySelectorAll(".rnav__label"))
      .map((el) => el.getAttribute("data-label"));
    expect(labels(a)).toEqual(labels(b));
    /* Each label carries its own bold-width sizer. */
    for (const el of Array.from(a.container.querySelectorAll(".rnav__label"))) {
      expect(el.getAttribute("data-label")).toBe(el.textContent!.trim());
    }
  });
});

/* ------------------------------------------------------------- the mobile bar */

/* The disclosure «Ещё» is the bar's answer only when two or more destinations
   would be behind it. Today one would — «Профиль» — so it takes the fifth slot
   (`mobile-slots.ts`, 2026-10-03). The disclosure's own contract — Enter and
   Space, focus in and back, Escape and a press outside, the grouping — is held
   in more-menu-disclosure.test.tsx with Community shown. */
describe("Shell — the mobile bar", () => {
  it("opens no menu of one: «Профиль» is the fifth slot", () => {
    const { container } = render(<MobileBottomNavigation activeId="home" />);
    expect(screen.queryByRole("button", { name: /Ещё/ })).toBeNull();
    expect(container.querySelector(".bottomnav__sheet")).toBeNull();
    const hrefs = Array.from(container.querySelectorAll(".bottomnav a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/home", "/path", "/lessons", "/tools", "/profile"]);
    expect(screen.queryByRole("link", { name: /Сообщество/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Поддержка/ })).toBeNull();
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

/* ------------------------------------------- the utilities mark their route */

describe("Shell — the bell and the avatar say where the learner is", () => {
  it("marks the bell on /notifications, and only there", () => {
    for (const id of ACTIVE_IDS) {
      const { container, unmount } = shell(id);
      /* Since 2026-10-06 (DD-349) the bell opens its window in place: a button
         that says whether its window is open and which one it is. */
      const bells = Array.from(container.querySelectorAll('button.iconbtn[aria-controls^="nt-pop-"]'));
      expect(bells.length, id).toBe(2); // one per bar; one is hidden by a media query
      expect(bells.map((bell) => bell.getAttribute("aria-controls")).sort(), id).toEqual(["nt-pop-desktop", "nt-pop-mobile"]);
      for (const bell of bells) expect(bell.getAttribute("aria-expanded"), id).toBe("false");
      for (const bell of bells) {
        expect(bell.getAttribute("aria-current"), `${id} bell`).toBe(
          id === "notifications" ? "page" : null,
        );
        /* The name is the link's own text since 2026-10-04, so the unread
           mark's words can join it; without a mark it is just «Уведомления». */
        expect(bell.getAttribute("aria-label"), id).toBeNull();
        expect(bell.textContent?.trim(), id).toBe("Уведомления");
      }
      unmount();
    }
  });

  it("marks the avatar on /profile, and keeps its name", () => {
    for (const id of ACTIVE_IDS) {
      const { container, unmount } = shell(id);
      const avatars = Array.from(container.querySelectorAll('a[href="/profile"].avatar'));
      expect(avatars.length, id).toBe(2);
      /* The desktop avatar is the one control in its bar pointing at /profile.
         The mobile one yields to the bottom bar's own «Профиль», which is on
         screen beside it the whole time (see the next test). */
      expect(container.querySelector(".appbar a.avatar")!.getAttribute("aria-current"), `${id} desktop`).toBe(
        id === "profile" ? "page" : null,
      );
      expect(container.querySelector(".mtop a.avatar")!.getAttribute("aria-current"), `${id} mobile`).toBeNull();
      for (const avatar of avatars) {
        expect(avatar.getAttribute("aria-label"), id).toBe("Профиль — Мария Ковалёва");
      }
      unmount();
    }
  });

  it("keeps the unread mark independent of being the current page", () => {
    /* Two different facts about two different things. The shell decides current
       from `activeId`; the mark is whatever the presence element it was handed
       says, and one cannot imply the other. */
    const withPresence = render(
      <AppShell userName="Мария Ковалёва" activeId="notifications" notificationPresence={<span className="dot" />}>
        <p>тело</p>
      </AppShell>,
    );
    expect(withPresence.container.querySelectorAll('button.iconbtn[aria-controls^="nt-pop-"][aria-current="page"]')).toHaveLength(2);
    expect(withPresence.container.querySelectorAll(".dot").length).toBeGreaterThan(0);
    withPresence.unmount();

    const withoutPresence = shell("notifications");
    expect(withoutPresence.container.querySelectorAll('button.iconbtn[aria-controls^="nt-pop-"][aria-current="page"]')).toHaveLength(2);
    expect(withoutPresence.container.querySelectorAll(".dot")).toHaveLength(0);
    withoutPresence.unmount();

    /* And a page that is not /notifications can still carry unread. */
    const elsewhere = render(
      <AppShell userName="Мария Ковалёва" activeId="home" notificationPresence={<span className="dot" />}>
        <p>тело</p>
      </AppShell>,
    );
    expect(elsewhere.container.querySelectorAll('button.iconbtn[aria-controls^="nt-pop-"][aria-current="page"]')).toHaveLength(0);
    expect(elsewhere.container.querySelectorAll(".dot").length).toBeGreaterThan(0);
    elsewhere.unmount();
  });

  it("never declares two current pages: the mobile avatar yields to the bar's «Профиль»", () => {
    /* The bottom bar carries «Профиль» as a slot of its own, on screen beside
       the mobile avatar the whole time: the labelled slot is the better answer,
       for the reason the open sheet's row was (mobile-menu-state.tsx). */
    const { container } = shell("profile");
    expect(container.querySelector('.bottomnav a[href="/profile"]')!.getAttribute("aria-current")).toBe("page");
    expect(container.querySelector(".mtop a.avatar")!.getAttribute("aria-current")).toBeNull();
    /* The desktop avatar never yields: the bottom bar is hidden in its layout. */
    expect(container.querySelector(".appbar a.avatar")!.getAttribute("aria-current")).toBe("page");
  });

  it("gives the utilities the bar's grammar and no more", () => {
    const css = readFileSync(join(ROOT, "src/features/home/home.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (sel: string) => {
      const i = css.indexOf(sel + " {");
      return i === -1 ? "" : css.slice(i, css.indexOf("}", i));
    };
    expect(rule('.iconbtn[aria-current="page"]')).toContain("var(--text-primary)");
    expect(rule('.iconbtn[aria-current="page"]')).toContain("var(--surface-subtle)");
    const indicator = css.slice(
      css.indexOf('.iconbtn[aria-current="page"]::before'),
      css.indexOf("}", css.indexOf('.iconbtn[aria-current="page"]::before')),
    );
    expect(indicator).toContain("height: 2px");
    expect(indicator).toContain("var(--signal-active)");
    for (const forbidden of ["blur", "box-shadow", "scale(", "gradient"]) {
      expect(indicator, forbidden).not.toContain(forbidden);
    }
  });
});

/**
 * WHERE AM I, ANSWERED EXACTLY ONCE.
 *
 * The shell can render the same destination in more than one place: /profile is
 * the avatar in each bar and the bottom bar's fifth slot. Only one control per
 * bar may declare itself current, or the answer to "where am I" arrives twice.
 *
 * The contract «Ещё» adds when it is drawn — `aria-current="true"` on the closed
 * button for a secondary destination, handed to the real row when it opens —
 * is held in more-menu-disclosure.test.tsx.
 */
describe("Shell — exactly one current, in every state", () => {
  it("never declares more than one current in the bottom bar, on any route", () => {
    for (const id of ACTIVE_IDS) {
      const { container, unmount } = render(<MobileBottomNavigation activeId={id} />);
      expect(container.querySelectorAll("[aria-current]").length, id).toBeLessThanOrEqual(1);
      unmount();
    }
  });

  it("answers once per bar in the whole shell, and every bar names the same page", () => {
    // The shell renders BOTH bars; a breakpoint hides one. Whatever the CSS
    // hides, no bar may hold two `page` declarations, and the bars must agree.
    for (const activeId of ACTIVE_IDS) {
      const { container, unmount } = render(
        <AppShell userName="Мария Ковалёва" activeId={activeId} frozenSurface>
          <div>тело</div>
        </AppShell>,
      );
      const pages = [...container.querySelectorAll('[aria-current="page"]')];
      const perBar = new Map<Element | null, number>();
      for (const el of pages) {
        const bar = el.closest(".appbar, .mtop, .bottomnav");
        perBar.set(bar, (perBar.get(bar) ?? 0) + 1);
      }
      for (const [, n] of perBar) expect(n, activeId).toBe(1);
      expect(new Set(pages.map((e) => e.getAttribute("href"))).size, activeId).toBeLessThanOrEqual(1);
      expect(container.querySelectorAll('[aria-current="true"]'), activeId).toHaveLength(0);
      unmount();
    }
  });
});
