import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RootError from "./error";

describe("root error boundary (2026-10-04)", () => {
  it("says what happened in the product's words, never the server's, and offers a way forward", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    const { container } = render(<RootError error={Object.assign(new Error("ECONNREFUSED 127.0.0.1:3100"), { digest: "abc123" })} reset={reset} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Страница не загрузилась" })).toBeInTheDocument();
    expect(container.textContent).not.toContain("ECONNREFUSED");
    expect(container.textContent).not.toContain("abc123");
    fireEvent.click(screen.getByRole("button", { name: "Попробовать ещё раз" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "На главную" }).getAttribute("href")).toBe("/");
  });
});
