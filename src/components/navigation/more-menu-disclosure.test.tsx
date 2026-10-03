/**
 * «ЕЩЁ» — THE BAR THE DAY TWO DESTINATIONS ARE BEHIND IT AGAIN.
 *
 * Since 2026-10-03 the product shows no «Ещё»: support moved into the profile
 * (owner: «что бы написать в поддержку можно было только из профиля, не по
 * ссылке из хеда»), Community is withheld, and the one destination left behind
 * the button — «Профиль» — took the fifth slot (`mobile-slots.ts`). The
 * disclosure is still the bar's answer the moment a second destination comes
 * back, and the contract it was rebuilt under must not rot unexercised. So
 * this file shows Community — the one switch that would bring it back — and
 * holds everything the disclosure promised: five slots, every section one tap
 * away, no section twice or nowhere, a real control that reports its state,
 * focus that goes in and comes back, and exactly one answer to «where am I».
 *
 * These tests used to live in mobile-bottom-navigation.test.tsx and
 * shell-polish.test.tsx, written against «Поддержка» as the secondary row.
 * They are the same tests with «Сообщество» in that place.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/config/feature-visibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/feature-visibility")>();
  return { ...actual, COMMUNITY_ENABLED: true, isVisibleSection: () => true };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { MobileBottomNavigation } from "@/components/navigation/mobile-bottom-navigation";
import { AppShell } from "@/components/shell/app-shell";
import { MORE_MENU, PRIMARY_NAV } from "@/config/navigation";
import { isBuiltRoute } from "@/config/built-routes";
import { mobileBarLayout } from "@/components/navigation/mobile-slots";

const BUILT = PRIMARY_NAV.filter((item) => isBuiltRoute(item.id));
const DELIVERABLE = new Set([...PRIMARY_NAV, ...MORE_MENU].filter((item) => isBuiltRoute(item.id)).map((item) => item.href));
const more = () => screen.getByRole("button", { name: /Ещё/ });

describe("«Ещё» — with two destinations behind it", () => {
  it("is what the layout gives once Community is shown: Сообщество and Профиль", () => {
    const layout = mobileBarLayout();
    expect(layout.slots.map((item) => item.id)).toEqual(["home", "path", "lessons", "tools"]);
    expect(layout.overflow.map((item) => item.id)).toEqual(["community", "profile"]);
  });

  it("keeps the bar to five slots, the fifth being «Ещё»", () => {
    render(<MobileBottomNavigation activeId="home" />);
    const bar = screen.getByRole("navigation", { name: "Мобильная навигация" });
    expect(within(bar).getAllByRole("link")).toHaveLength(4);
    expect(more()).toBeInTheDocument();
  });

  it("reaches EVERY built section, in the bar or one tap inside «Ещё»", async () => {
    const user = userEvent.setup();
    render(<MobileBottomNavigation activeId="home" />);
    const reachable = new Set(screen.getAllByRole("link").map((a) => a.getAttribute("href")));
    await user.click(more());
    for (const a of screen.getAllByRole("link")) reachable.add(a.getAttribute("href"));
    for (const item of BUILT) expect(reachable.has(item.href), item.href).toBe(true);
  });

  it("puts Сообщество and Профиль behind «Ещё», and they are real links", async () => {
    const user = userEvent.setup();
    render(<MobileBottomNavigation activeId="home" />);
    expect(screen.queryByRole("link", { name: /Сообщество/ })).toBeNull();
    await user.click(more());
    expect(screen.getByRole("link", { name: /Сообщество/ })).toHaveAttribute("href", "/community");
    expect(screen.getByRole("link", { name: /Профиль/ })).toHaveAttribute("href", "/profile");
  });

  it("never puts a section in both places, and never in neither", async () => {
    const user = userEvent.setup();
    render(<MobileBottomNavigation activeId="home" />);
    const inBar = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    await user.click(more());
    const all = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    const inSheet = all.filter((href) => !inBar.includes(href));
    expect(inBar.filter((href) => inSheet.includes(href))).toEqual([]);
    expect(new Set([...inBar, ...inSheet])).toEqual(DELIVERABLE);
  });

  it("renders no disabled control", () => {
    render(<MobileBottomNavigation activeId="home" />);
    for (const button of screen.getAllByRole("button")) {
      expect(button).not.toBeDisabled();
      expect(button).not.toHaveAttribute("aria-disabled", "true");
    }
  });

  it("reports its own state to assistive technology", async () => {
    const user = userEvent.setup();
    render(<MobileBottomNavigation activeId="home" />);
    expect(more()).toHaveAttribute("aria-expanded", "false");
    expect(more()).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(more());
    expect(more()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Ещё" })).toBeInTheDocument();
  });

  it("marks «Ещё» active when the open section lives inside it", () => {
    render(<MobileBottomNavigation activeId="community" />);
    expect(more()).toHaveClass("is-active");
  });
});

describe("«Ещё» — the disclosure", () => {
  it("keeps its destinations out of the document while it is closed", () => {
    const { container } = render(<MobileBottomNavigation activeId="home" />);
    expect(container.querySelector(".bottomnav__sheet")).toBeNull();
    expect(screen.queryByRole("link", { name: /Сообщество/ })).toBeNull();
  });

  it("opens with Enter and with Space", async () => {
    for (const key of ["{Enter}", " "]) {
      const view = render(<MobileBottomNavigation activeId="home" />);
      expect(more().getAttribute("aria-expanded")).toBe("false");
      more().focus();
      await userEvent.keyboard(key);
      await waitFor(() => expect(more().getAttribute("aria-expanded")).toBe("true"));
      view.unmount();
    }
  });

  it("moves focus into the menu when it opens", async () => {
    const view = render(<MobileBottomNavigation activeId="home" />);
    await userEvent.click(more());
    await waitFor(() => {
      const sheet = view.container.querySelector(".bottomnav__sheet")!;
      expect(sheet.contains(document.activeElement)).toBe(true);
    });
  });

  it("closes on Escape and gives focus back to the control that opened it", async () => {
    const view = render(<MobileBottomNavigation activeId="home" />);
    await userEvent.click(more());
    await waitFor(() => expect(view.container.querySelector(".bottomnav__sheet")).not.toBeNull());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(view.container.querySelector(".bottomnav__sheet")).toBeNull());
    expect(document.activeElement).toBe(more());
  });

  it("closes on a press outside it, and gives focus back", async () => {
    const outside = document.createElement("div");
    outside.textContent = "снаружи";
    document.body.appendChild(outside);
    const view = render(<MobileBottomNavigation activeId="home" />);
    await userEvent.click(more());
    await waitFor(() => expect(view.container.querySelector(".bottomnav__sheet")).not.toBeNull());
    await userEvent.click(outside);
    await waitFor(() => expect(view.container.querySelector(".bottomnav__sheet")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(more()));
    outside.remove();
  });

  it("separates primary from secondary in the menu, without reordering it", async () => {
    const view = render(<MobileBottomNavigation activeId="home" />);
    await userEvent.click(more());
    await waitFor(() => expect(view.container.querySelector(".bottomnav__sheet")).not.toBeNull());
    const items = Array.from(view.container.querySelectorAll(".bottomnav__sheet li"));
    expect(items.map((li) => li.getAttribute("data-group"))).toEqual(["secondary", "primary"]);
    expect(items.map((li) => li.querySelector("a")!.getAttribute("href"))).toEqual(["/community", "/profile"]);
  });
});

describe("«Ещё» — exactly one current, in every state", () => {
  const declared = (root: HTMLElement) => [...root.querySelectorAll("[aria-current]")];

  it("marks «Ещё» as the current group on /community while it is shut", () => {
    render(<MobileBottomNavigation activeId="community" />);
    expect(more()).toHaveAttribute("aria-current", "true");
    expect(more()).not.toHaveAttribute("aria-current", "page");
  });

  it("leaves «Ещё» undeclared on every other route", () => {
    for (const id of ["home", "path", "lessons", "tools", "notifications", "profile"]) {
      const { unmount } = render(<MobileBottomNavigation activeId={id} />);
      expect(more()).not.toHaveAttribute("aria-current");
      unmount();
    }
  });

  it("hands the marker to the real link when the menu opens, and takes it back on close", async () => {
    const user = userEvent.setup();
    const { container } = render(<MobileBottomNavigation activeId="community" />);
    await user.click(more());
    const sheet = await screen.findByRole("dialog", { name: "Ещё" });
    expect(more()).not.toHaveAttribute("aria-current");
    expect(within(sheet).getByRole("link", { name: "Сообщество" })).toHaveAttribute("aria-current", "page");
    expect(declared(container)).toHaveLength(1);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(more()).toHaveAttribute("aria-current", "true");
  });

  it("never declares more than one current, on any route, open or shut", async () => {
    const user = userEvent.setup();
    for (const id of ["home", "path", "lessons", "tools", "notifications", "profile", "community"]) {
      const { container, unmount } = render(<MobileBottomNavigation activeId={id} />);
      expect(declared(container).length).toBeLessThanOrEqual(1);
      await user.click(more());
      await screen.findByRole("dialog", { name: "Ещё" });
      expect(declared(container).length).toBeLessThanOrEqual(1);
      unmount();
    }
  });

  it("keeps «Ещё» looking active on /profile while the avatar owns the declaration", () => {
    render(<MobileBottomNavigation activeId="profile" />);
    expect(more()).toHaveClass("is-active");
    expect(more()).not.toHaveAttribute("aria-current");
    expect(more().textContent).toContain("Ещё");
  });

  it("never declares two current pages: the avatar yields to the open menu", async () => {
    const { container } = render(
      <AppShell userName="Мария Ковалёва" activeId="profile">
        <p>тело</p>
      </AppShell>,
    );
    expect(container.querySelector(".mtop a.avatar")!.getAttribute("aria-current")).toBe("page");
    await userEvent.click(more());
    await waitFor(() => expect(container.querySelector(".bottomnav__sheet")).not.toBeNull());
    expect(container.querySelector('.bottomnav__sheet a[href="/profile"]')!.getAttribute("aria-current")).toBe("page");
    expect(container.querySelector(".mtop a.avatar")!.getAttribute("aria-current")).toBeNull();
    // The desktop avatar never yields: its bar is never beside the sheet.
    expect(container.querySelector(".appbar a.avatar")!.getAttribute("aria-current")).toBe("page");
  });
});
