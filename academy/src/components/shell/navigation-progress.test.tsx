/**
 * The line across the top while the next page is on its way (2026-10-04).
 * Lit from an internal link's click until the address changes; never for an
 * external link, a new tab, a fragment on the same page or a modified click.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";

let pathname = "/home";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

import { NavigationProgress } from "@/components/shell/navigation-progress";

function mount() {
  const view = render(
    <div>
      <a href="/path">Путь</a>
      <a href="https://pocket.invalid/register">Pocket</a>
      <a href="/tools" target="_blank">В новой вкладке</a>
      <a href="#task">К заданию</a>
      <NavigationProgress />
    </div>,
  );
  const bar = () => view.container.querySelector(".nav-progress")!.getAttribute("data-active");
  return { view, bar };
}

beforeEach(() => {
  pathname = "/home";
  window.history.replaceState(null, "", "/home");
});

describe("NavigationProgress", () => {
  it("lights on an internal link and goes out when the address changes", () => {
    const { view, bar } = mount();
    expect(bar()).toBe("false");
    fireEvent.click(view.getByText("Путь"));
    expect(bar()).toBe("true");
    pathname = "/path";
    view.rerender(
      <div>
        <a href="/path">Путь</a>
        <NavigationProgress />
      </div>,
    );
    expect(view.container.querySelector(".nav-progress")!.getAttribute("data-active")).toBe("false");
  });

  it("stays dark for an external link, a new tab, a fragment and a modified click", () => {
    const { view, bar } = mount();
    fireEvent.click(view.getByText("Pocket"));
    fireEvent.click(view.getByText("В новой вкладке"));
    fireEvent.click(view.getByText("К заданию"));
    fireEvent.click(view.getByText("Путь"), { ctrlKey: true });
    expect(bar()).toBe("false");
  });

  it("is decoration for assistive technology", () => {
    const { view } = mount();
    expect(view.container.querySelector(".nav-progress")!.getAttribute("aria-hidden")).toBe("true");
  });
});
