import { describe, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileFidelity } from "@/features/profile-fidelity/profile-fidelity";
import { COPY } from "@/features/profile-fidelity/profile-state";

/**
 * THE PROFILE HARNESS CAPTURE.
 *
 * `/profile` is behind the session guard and this phase may not create one, so
 * the surface cannot be reached in a browser by signing in. What CAN be done
 * without a session is to drive the REAL component through its real states with
 * real user events — mocking only the two request functions — and record the DOM
 * it produces. The recorded markup is then laid out in a real browser against
 * the candidate's real production CSS, which is where the geometry questions
 * (overflow, overlap, target size, bottom navigation) are actually answered.
 *
 * Nothing here is written by hand: every state below is whatever the component
 * rendered after the interaction named in its title.
 */

const saveProfileName = vi.fn();
const changeProfilePassword = vi.fn();
vi.mock("@/lib/profile/profile-client", () => ({
  saveProfileName: (...a: unknown[]) => saveProfileName(...a),
  changeProfilePassword: (...a: unknown[]) => changeProfilePassword(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const NAME = "Мария Ковалёва";
const states: Record<string, string> = {};

function capture(key: string) {
  states[key] = document.querySelector(".pf")!.outerHTML;
}

describe("capture the profile states", () => {
  it("records ten states as the component actually renders them", async () => {
    /* 1 — default */
    let view = render(<ProfileFidelity canonical={NAME} />);
    capture("default");

    /* 2 — name edit */
    await userEvent.click(screen.getByRole("button", { name: COPY.edit }));
    capture("name-edit");

    /* 3 — name pending */
    let resolveName: (v: unknown) => void = () => {};
    saveProfileName.mockReturnValue(new Promise((r) => (resolveName = r)));
    await userEvent.click(screen.getByRole("button", { name: COPY.save_name }));
    capture("name-pending");

    /* 4 — name error (server refused) */
    resolveName({ ok: false, error: { code: "BACKEND_UNAVAILABLE" } });
    await waitFor(() => document.querySelector('[data-role="mutation-failure"]'));
    capture("name-error");
    view.unmount();

    /* 5 — name validation error */
    view = render(<ProfileFidelity canonical={NAME} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.edit }));
    await userEvent.clear(screen.getByLabelText(COPY.identity_label));
    await userEvent.type(screen.getByLabelText(COPY.identity_label), "Я");
    await userEvent.click(screen.getByRole("button", { name: COPY.save_name }));
    await waitFor(() => document.querySelector('[data-role="field-error"]'));
    capture("name-invalid");

    /* 6 — name success */
    saveProfileName.mockResolvedValue({ ok: true, name: "Мария К" });
    await userEvent.clear(screen.getByLabelText(COPY.identity_label));
    await userEvent.type(screen.getByLabelText(COPY.identity_label), "Мария К");
    await userEvent.click(screen.getByRole("button", { name: COPY.save_name }));
    await waitFor(() => screen.getByText("Мария К"));
    capture("name-success");
    view.unmount();

    /* 7 — password edit */
    view = render(<ProfileFidelity canonical={NAME} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.password_edit }));
    await userEvent.type(screen.getByLabelText(COPY.password_current), "current-value");
    await userEvent.type(screen.getByLabelText(COPY.password_new), "abcdef");
    await userEvent.type(screen.getByLabelText(COPY.password_confirm), "abcdef");
    capture("password-edit");

    /* 8 — password pending */
    let resolvePw: (v: unknown) => void = () => {};
    changeProfilePassword.mockReturnValue(new Promise((r) => (resolvePw = r)));
    await userEvent.click(screen.getByRole("button", { name: COPY.password_submit }));
    capture("password-pending");

    /* 9 — wrong current password */
    resolvePw({ ok: false, wrongCurrent: true });
    await waitFor(() => screen.getByText(COPY.password_wrong_current));
    capture("password-wrong-current");
    view.unmount();

    /* 10 — password validation error */
    view = render(<ProfileFidelity canonical={NAME} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.password_edit }));
    await userEvent.type(screen.getByLabelText(COPY.password_current), "current-value");
    await userEvent.type(screen.getByLabelText(COPY.password_new), "abcdef");
    await userEvent.type(screen.getByLabelText(COPY.password_confirm), "abcdeg");
    await userEvent.click(screen.getByRole("button", { name: COPY.password_submit }));
    await waitFor(() => screen.getByText(COPY.password_mismatch));
    capture("password-invalid");
    view.unmount();

    /* 11 — password success */
    view = render(<ProfileFidelity canonical={NAME} />);
    changeProfilePassword.mockResolvedValue({ ok: true });
    await userEvent.click(screen.getByRole("button", { name: COPY.password_edit }));
    await userEvent.type(screen.getByLabelText(COPY.password_current), "current-value");
    await userEvent.type(screen.getByLabelText(COPY.password_new), "abcdef");
    await userEvent.type(screen.getByLabelText(COPY.password_confirm), "abcdef");
    await userEvent.click(screen.getByRole("button", { name: COPY.password_submit }));
    await waitFor(() => screen.getByText(COPY.password_changed));
    capture("password-success");

    writeFileSync(join(tmpdir(), "profile-states.json"), JSON.stringify(states, null, 0));
  }, 120_000);
});
