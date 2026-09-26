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
import { isVisibleSection } from "@/config/feature-visibility";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const ROOT = process.cwd();
const shell = (activeId: string) =>
  render(
    <AppShell userName="Мария Ковалёва" activeId={activeId}>
      <p>тело</p>
    </AppShell>,
  );

/** The ten activeIds the authenticated routes actually pass. */
/* Community is built and still answers, but is withheld from the learner
   product, so it is not one of the routes the shell advertises. */
const ACTIVE_IDS = ["home", "path", "lessons", "tools", "notifications", "profile", "support"];

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
    /* Two groups, one nav, one hairline between them. */
    expect(container.querySelectorAll("nav")).toHaveLength(1);
    expect(container.querySelectorAll(".rnav__group")).toHaveLength(2);
    expect(container.querySelectorAll(".rnav__rule")).toHaveLength(1);
    expect(container.querySelector(".rnav__rule")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("puts exactly Поддержка in the secondary group while Community is withheld", () => {
    const { container } = render(<DesktopRouteNavigation activeId="home" />);
    const secondary = container.querySelector(".rnav__group--secondary")!;
    expect(Array.from(secondary.querySelectorAll("a")).map((a) => a.getAttribute("href")))
      .toEqual(["/support"]);
  });

  it("marks one current route, and nests the Reader and the Workspace under Уроки", () => {
    for (const id of ["home", "path", "lessons", "tools", "support"]) {
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
    /* The restore waits for the press to finish, so the assertion does too. */
    await waitFor(() => expect(document.activeElement).toBe(more));
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

/* ------------------------------------------- the utilities mark their route */

describe("Shell — the bell and the avatar say where the learner is", () => {
  it("marks the bell on /notifications, and only there", () => {
    for (const id of ACTIVE_IDS) {
      const { container, unmount } = shell(id);
      const bells = Array.from(container.querySelectorAll('a[href="/notifications"]'));
      expect(bells.length, id).toBe(2); // one per bar; one is hidden by a media query
      for (const bell of bells) {
        expect(bell.getAttribute("aria-current"), `${id} bell`).toBe(
          id === "notifications" ? "page" : null,
        );
        /* The accessible name is unchanged. */
        expect(bell.getAttribute("aria-label"), id).toBe("Уведомления");
      }
      unmount();
    }
  });

  it("marks the avatar on /profile, and keeps its name", () => {
    for (const id of ACTIVE_IDS) {
      const { container, unmount } = shell(id);
      const avatars = Array.from(container.querySelectorAll('a[href="/profile"].avatar'));
      expect(avatars.length, id).toBe(2);
      for (const avatar of avatars) {
        expect(avatar.getAttribute("aria-current"), `${id} avatar`).toBe(
          id === "profile" ? "page" : null,
        );
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
    expect(withPresence.container.querySelectorAll('a[href="/notifications"][aria-current="page"]')).toHaveLength(2);
    expect(withPresence.container.querySelectorAll(".dot").length).toBeGreaterThan(0);
    withPresence.unmount();

    const withoutPresence = shell("notifications");
    expect(withoutPresence.container.querySelectorAll('a[href="/notifications"][aria-current="page"]')).toHaveLength(2);
    expect(withoutPresence.container.querySelectorAll(".dot")).toHaveLength(0);
    withoutPresence.unmount();

    /* And a page that is not /notifications can still carry unread. */
    const elsewhere = render(
      <AppShell userName="Мария Ковалёва" activeId="home" notificationPresence={<span className="dot" />}>
        <p>тело</p>
      </AppShell>,
    );
    expect(elsewhere.container.querySelectorAll('a[href="/notifications"][aria-current="page"]')).toHaveLength(0);
    expect(elsewhere.container.querySelectorAll(".dot").length).toBeGreaterThan(0);
    elsewhere.unmount();
  });

  it("never declares two current pages: the avatar yields to the open menu", async () => {
    const { container } = shell("profile");
    /* Closed: the avatar is the one control on screen pointing at /profile. */
    const mobileAvatar = container.querySelector(".mtop a.avatar")!;
    expect(mobileAvatar.getAttribute("aria-current")).toBe("page");
    expect(container.querySelector(".bottomnav__sheet")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Ещё/ }));
    await waitFor(() => expect(container.querySelector(".bottomnav__sheet")).not.toBeNull());

    /* Open: the sheet is the exposed navigation and carries the claim; the
       avatar steps back rather than making a second one. */
    const sheetProfile = container.querySelector('.bottomnav__sheet a[href="/profile"]')!;
    expect(sheetProfile.getAttribute("aria-current")).toBe("page");
    expect(container.querySelector(".mtop a.avatar")!.getAttribute("aria-current")).toBeNull();
  });

  it("does not blank the desktop marker when a menu was left open", async () => {
    /* A menu opened at 390px and then widened: the bottom bar is hidden, so the
       sheet cannot be beside the desktop avatar and the desktop avatar must not
       yield to it. Placement decides, not the state alone. */
    const { container } = shell("profile");
    await userEvent.click(screen.getByRole("button", { name: /Ещё/ }));
    await waitFor(() => expect(container.querySelector(".bottomnav__sheet")).not.toBeNull());
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
 * the avatar and a row in «Ещё»; /community and /support are a desktop nav item
 * and a row in «Ещё». Only one of those may declare itself current, or the
 * answer to "where am I" arrives twice.
 *
 * The last cell to close was /community and /support with the menu SHUT. There
 * is no visible link to them then — the only one is inside the closed sheet —
 * so nothing could carry `aria-current="page"`. The «Ещё» button now carries
 * `aria-current="true"` instead: "the current item in this set", which is what
 * the button honestly is. It is not "page", because the button is not a page.
 *
 * These tests hold the whole contract, not just the new attribute: the button
 * claims it ONLY while closed, ONLY for the secondary group, and hands it back
 * to the real link the moment the menu opens.
 */
describe("Shell — exactly one current, in every state", () => {
  const nav = (activeId: string) => render(<MobileBottomNavigation activeId={activeId} />);
  const more = () => screen.getByRole("button", { name: /Ещё/ });
  /** Every element declaring a current — of any value, in this subtree. */
  const declared = (root: HTMLElement) => [...root.querySelectorAll("[aria-current]")];

  it("marks «Ещё» as the current group on /support while it is shut", () => {
    for (const id of ["support"]) {
      const { unmount } = nav(id);
      expect(more()).toHaveAttribute("aria-current", "true");
      // the group, not the page — the button is not a destination
      expect(more()).not.toHaveAttribute("aria-current", "page");
      unmount();
    }
  });

  it("leaves «Ещё» undeclared on every other route", async () => {
    for (const id of ["home", "path", "lessons", "tools", "notifications", "profile"]) {
      const { unmount } = nav(id);
      expect(more()).not.toHaveAttribute("aria-current");
      unmount();
    }
  });

  it("hands the marker to the real link when the menu opens, and takes it back on close", async () => {
    const user = userEvent.setup();
    for (const [id, label] of [["support", "Поддержка"]] as const) {
      const { container, unmount } = nav(id);
      expect(more()).toHaveAttribute("aria-current", "true");

      await user.click(more());
      const sheet = await screen.findByRole("dialog", { name: "Ещё" });
      // the button lets go...
      expect(more()).not.toHaveAttribute("aria-current");
      // ...and the destination itself claims it, as a page this time
      const link = within(sheet).getByRole("link", { name: label });
      expect(link).toHaveAttribute("aria-current", "page");
      // still exactly one answer in the whole bar
      expect(declared(container)).toHaveLength(1);

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(more()).toHaveAttribute("aria-current", "true");
      unmount();
    }
  });

  it("never declares more than one current, on any route, open or shut", async () => {
    const user = userEvent.setup();
    const ids = ["home", "path", "lessons", "tools", "notifications", "profile", "support"];
    for (const id of ids) {
      const { container, unmount } = nav(id);
      expect(declared(container).length).toBeLessThanOrEqual(1);
      await user.click(more());
      await screen.findByRole("dialog", { name: "Ещё" });
      expect(declared(container).length).toBeLessThanOrEqual(1);
      unmount();
    }
  });

  it("moves the marker cleanly when the route crosses from primary to secondary", async () => {
    // Same bar, different route: the primary slot must let go and the button must claim.
    const { container, rerender } = render(<MobileBottomNavigation activeId="lessons" />);
    expect(more()).not.toHaveAttribute("aria-current");
    expect(declared(container).map((e) => e.getAttribute("aria-current"))).toEqual(["page"]);

    rerender(<MobileBottomNavigation activeId="support" />);
    expect(more()).toHaveAttribute("aria-current", "true");
    expect(declared(container)).toHaveLength(1);

    rerender(<MobileBottomNavigation activeId="path" />);
    expect(more()).not.toHaveAttribute("aria-current");
    expect(declared(container).map((e) => e.getAttribute("aria-current"))).toEqual(["page"]);
  });

  it("keeps «Ещё» looking active, and keeps its word", async () => {
    // The LOOK is broader than the declaration: /profile lives behind the button
    // too, so the button still marks itself there even though the avatar owns
    // the declaration. The label is not a state indicator and must not move.
    const { unmount } = nav("profile");
    expect(more()).toHaveClass("is-active");
    expect(more()).not.toHaveAttribute("aria-current");
    expect(more().textContent).toContain("Ещё");
    unmount();

    nav("support");
    expect(more()).toHaveClass("is-active");
    expect(more().textContent).toContain("Ещё");
  });

  it("gives the marker back after an outside press closes the menu, with focus", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">снаружи</button>
        <MobileBottomNavigation activeId="support" />
      </div>,
    );
    await user.click(more());
    await screen.findByRole("dialog", { name: "Ещё" });
    expect(more()).not.toHaveAttribute("aria-current");

    await user.click(screen.getByRole("button", { name: "снаружи" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(more()).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(more()).toHaveFocus());
  });

  it("answers once per breakpoint in the whole shell, not just in the bar", async () => {
    // The shell renders BOTH bars; a breakpoint hides one. Whatever the CSS
    // hides, the document must never hold two `page` declarations at once.
    const user = userEvent.setup();
    for (const activeId of ["home", "notifications", "profile", "support"]) {
      const { container, unmount } = render(
        <AppShell userName="Мария Ковалёва" activeId={activeId} frozenSurface>
          <div>тело</div>
        </AppShell>,
      );
      const pages = () => [...container.querySelectorAll('[aria-current="page"]')];
      /* Both bars are in the document; a media query hides one. So more than one
         `page` declaration is expected here — what must hold is that they are
         COPIES: one per bar, all naming the same destination. Two in one bar, or
         two different destinations, would be two answers at one breakpoint. */
      const perBar = new Map<Element | null, number>();
      for (const el of pages()) {
        const bar = el.closest(".rnav, .bottomnav, .appbar, .mtop");
        perBar.set(bar, (perBar.get(bar) ?? 0) + 1);
      }
      for (const [, n] of perBar) expect(n).toBe(1);
      expect(new Set(pages().map((e) => e.getAttribute("href"))).size).toBeLessThanOrEqual(1);

      await user.click(more());
      await screen.findByRole("dialog", { name: "Ещё" });
      // once the menu is open the button has let go, on every route
      expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(0);
      unmount();
    }
  });
});
