/**
 * THE SHELL SHOWS NO WAY INTO A WITHHELD SECTION — and the «Ещё» contract that
 * was accepted for Support and Profile survives Community leaving it.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "@/components/shell/app-shell";
import { MobileBottomNavigation } from "@/components/navigation/mobile-bottom-navigation";
import { DesktopRouteNavigation } from "@/components/navigation/desktop-route-navigation";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const shell = (activeId: string) =>
  render(
    <AppShell userName="Мария Ковалёва" activeId={activeId} frozenSurface>
      <div>тело</div>
    </AppShell>,
  );

describe("Community is not reachable from the shell", () => {
  it("renders no Community link and no Community label anywhere in the shell", async () => {
    const user = userEvent.setup();
    for (const activeId of ["home", "path", "lessons", "tools", "notifications", "profile", "support"]) {
      const { container, unmount } = shell(activeId);
      expect(container.querySelectorAll('a[href="/community"]')).toHaveLength(0);
      expect(container.querySelectorAll('a[href^="/community"]')).toHaveLength(0);
      expect(container.textContent).not.toContain("Сообщество");

      // and not once the «Ещё» sheet is opened either
      await user.click(screen.getByRole("button", { name: /Ещё/ }));
      await screen.findByRole("dialog", { name: "Ещё" });
      expect(container.querySelectorAll('a[href^="/community"]')).toHaveLength(0);
      expect(container.textContent).not.toContain("Сообщество");
      unmount();
    }
  });

  it("keeps Support in both bars", async () => {
    const user = userEvent.setup();
    const { container } = shell("home");
    // desktop secondary group
    expect(container.querySelector('.rnav a[href="/support"]')).not.toBeNull();
    // and behind «Ещё» on mobile
    await user.click(screen.getByRole("button", { name: /Ещё/ }));
    const sheet = await screen.findByRole("dialog", { name: "Ещё" });
    expect(within(sheet).getByRole("link", { name: "Поддержка" })).toBeInTheDocument();
  });

  it("keeps «Ещё» — Support and Profile still live behind it", () => {
    render(<MobileBottomNavigation activeId="home" />);
    expect(screen.getByRole("button", { name: /Ещё/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ещё/ }).textContent).toContain("Ещё");
  });

  it("keeps the desktop secondary group, now Support alone", () => {
    const { container } = render(<DesktopRouteNavigation activeId="home" />);
    const secondary = container.querySelector(".rnav__group--secondary");
    expect(secondary).not.toBeNull();
    const hrefs = [...secondary!.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/support"]);
  });
});

describe("the current-state contract survives Community leaving", () => {
  const declared = (root: HTMLElement) => [...root.querySelectorAll("[aria-current]")];

  it("/support closed: «Ещё» carries the group; open: the row carries the page", async () => {
    const user = userEvent.setup();
    const { container } = render(<MobileBottomNavigation activeId="support" />);
    const more = () => screen.getByRole("button", { name: /Ещё/ });
    expect(more()).toHaveAttribute("aria-current", "true");
    expect(declared(container)).toHaveLength(1);

    await user.click(more());
    const sheet = await screen.findByRole("dialog", { name: "Ещё" });
    expect(more()).not.toHaveAttribute("aria-current");
    expect(within(sheet).getByRole("link", { name: "Поддержка" })).toHaveAttribute("aria-current", "page");
    expect(declared(container)).toHaveLength(1);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(more()).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(more()).toHaveFocus());
  });

  it("/profile closed: the avatar; open: the row, and never both", async () => {
    const user = userEvent.setup();
    const { container } = shell("profile");
    const vis = () => [...container.querySelectorAll('[aria-current="page"]')];
    expect(vis().some((e) => e.classList.contains("avatar"))).toBe(true);

    await user.click(screen.getByRole("button", { name: /Ещё/ }));
    const sheet = await screen.findByRole("dialog", { name: "Ещё" });
    expect(within(sheet).getByRole("link", { name: "Профиль" })).toHaveAttribute("aria-current", "page");
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(0);
  });

  it("never declares two currents, on any route, open or shut", async () => {
    const user = userEvent.setup();
    for (const id of ["home", "path", "lessons", "tools", "notifications", "profile", "support"]) {
      const { container, unmount } = render(<MobileBottomNavigation activeId={id} />);
      expect(declared(container).length).toBeLessThanOrEqual(1);
      await user.click(screen.getByRole("button", { name: /Ещё/ }));
      await screen.findByRole("dialog", { name: "Ещё" });
      expect(declared(container).length).toBeLessThanOrEqual(1);
      unmount();
    }
  });
});
