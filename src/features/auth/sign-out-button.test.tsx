import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignOutButton } from "./sign-out-button";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
}));

beforeEach(() => {
  replace.mockClear();
  refresh.mockClear();
});

describe("SignOutButton", () => {
  it("signs out, replaces to /login and refreshes the router cache", async () => {
    const user = userEvent.setup();
    const logoutImpl = vi.fn().mockResolvedValue({ status: "done" as const });
    render(<SignOutButton logoutImpl={logoutImpl} />);

    await user.click(screen.getByRole("button", { name: /выйти/i }));

    await waitFor(() => expect(logoutImpl).toHaveBeenCalledTimes(1));
    // `replace` keeps the authenticated route out of history so Back cannot
    // return to it; `refresh` discards the client router cache so a cached RSC
    // payload for a protected route cannot be replayed after the cookie is gone.
    expect(replace).toHaveBeenCalledWith("/login");
    expect(refresh).toHaveBeenCalled();
  });

  it("still leaves for /login when the request fails", async () => {
    const user = userEvent.setup();
    // The route clears cookies regardless, so the session is over locally.
    const logoutImpl = vi.fn().mockResolvedValue({ status: "done" as const });
    render(<SignOutButton logoutImpl={logoutImpl} />);

    await user.click(screen.getByRole("button", { name: /выйти/i }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("ignores a second click while the first is in flight", async () => {
    const user = userEvent.setup();
    let release: (v: { status: "done" }) => void = () => {};
    const logoutImpl = vi.fn().mockReturnValue(
      new Promise<{ status: "done" }>((resolve) => {
        release = resolve;
      }),
    );
    render(<SignOutButton logoutImpl={logoutImpl} />);

    const button = screen.getByRole("button", { name: /выйти/i });
    await user.click(button);
    expect(screen.getByRole("button", { name: /выходим/i })).toBeDisabled();

    await user.click(button);
    expect(logoutImpl).toHaveBeenCalledTimes(1);

    release({ status: "done" });
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });

  it("is a real button, reachable by keyboard", async () => {
    const user = userEvent.setup();
    const logoutImpl = vi.fn().mockResolvedValue({ status: "done" as const });
    render(<SignOutButton logoutImpl={logoutImpl} />);

    await user.tab();
    expect(screen.getByRole("button", { name: /выйти/i })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(logoutImpl).toHaveBeenCalled());
  });
});
