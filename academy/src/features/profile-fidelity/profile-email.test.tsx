import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/profile/profile-client", () => ({ saveProfileName: vi.fn(), changeProfilePassword: vi.fn() }));
vi.mock("@/lib/account/account-client", () => ({
  requestEmailChange: vi.fn(),
  cancelEmailChange: vi.fn(),
  resendVerification: vi.fn(),
}));

import * as client from "@/lib/account/account-client";
import * as profileClient from "@/lib/profile/profile-client";
import type { AccountView } from "@/lib/account/account-types";
import { ProfileFidelity } from "@/features/profile-fidelity/profile-fidelity";
import { COPY } from "@/features/profile-fidelity/profile-state";

/**
 * ACCOUNT RECOVERY — the profile's email row on a deployment that can send mail.
 * (Where it cannot, the row is unchanged and profile-fidelity.test.tsx holds it.)
 */

const requestMock = vi.mocked(client.requestEmailChange);
const cancelMock = vi.mocked(client.cancelEmailChange);
const resendMock = vi.mocked(client.resendVerification);
const passwordMock = vi.mocked(profileClient.changeProfilePassword);

const ABLE = { passwordRecovery: true, emailVerification: true, emailChange: true };
function view(account: Partial<AccountView["account"]> = {}, capabilities = ABLE): AccountView {
  return { account: { email: "maria@example.invalid", emailVerified: false, pendingEmail: null, ...account }, capabilities };
}
const role = (name: string) => document.querySelector(`[data-role="${name}"]`) as HTMLElement | null;

beforeEach(() => {
  for (const mock of [requestMock, cancelMock, resendMock, passwordMock]) mock.mockReset();
});

describe("the email row, where mail can be sent", () => {
  it("shows the address and its state instead of a handoff to support", () => {
    render(<ProfileFidelity canonical="Мария" account={view()} />);
    expect(role("email-value")!.textContent).toContain("maria@example.invalid");
    expect(role("email-state")!.textContent).toContain(COPY.email_state_unverified);
    expect(role("email-support-link")).toBeNull();
    expect(document.querySelector('a[href*="support"]')).toBeNull();
    expect(role("email-affordance")!.textContent).toBe(COPY.email_edit);
  });

  /* 2026-10-03 — A NORMAL PROFILE SHOWS A PERSON THEIR ADDRESS (owner: «наполни
     как нормальный профиль на платформе»). Where the Backend cannot change it,
     the row still offers no control and names support for a change; it now
     prints the learner's own address beside that, which it had in hand and
     hid. Without an address (an unreadable account) it is the old row. */
  it("prints the address and names support where the Backend cannot change it", () => {
    render(<ProfileFidelity canonical="Мария" account={view({}, { passwordRecovery: false, emailVerification: false, emailChange: false })} />);
    expect(role("email-value")!.textContent).toContain("maria@example.invalid");
    expect(role("email-note")!.textContent).toContain(COPY.email_via_support_short);
    expect(role("email-support-link")!.getAttribute("href")).toBe("/profile/support");
    // No control, no confirmation request, no state the learner cannot act on.
    for (const r of ["email-affordance", "email-editor", "email-verify-row", "email-state"]) expect(role(r), r).toBeNull();
  });

  it("is the old row without an address", () => {
    render(<ProfileFidelity canonical="Мария" account={null} />);
    expect(role("email-note")!.textContent).toBe(COPY.email_via_support);
    expect(role("email-value")).toBeNull();
  });

  it("asks an unconfirmed address to confirm itself, and says what was actually sent", async () => {
    resendMock.mockResolvedValueOnce({ ok: false, failure: "RATE_LIMITED" }).mockResolvedValueOnce({ ok: true, alreadyVerified: false });
    render(<ProfileFidelity canonical="Мария" account={view()} />);
    expect(role("email-verify-note")!.textContent).toBe(COPY.email_verify_lead);
    await userEvent.click(role("email-verify-send")!);
    await waitFor(() => expect(role("email-verify-note")!.textContent).toBe(COPY.email_verify_limited));
    await userEvent.click(role("email-verify-send")!);
    await waitFor(() => expect(role("email-verify-note")!.textContent).toBe(COPY.email_verify_sent));
    // Sent once: the button is gone rather than inviting a second message.
    expect(role("email-verify-send")).toBeNull();
  });

  it("asks nothing of a confirmed address", () => {
    render(<ProfileFidelity canonical="Мария" account={view({ emailVerified: true })} />);
    expect(role("email-state")!.textContent).toContain(COPY.email_state_verified);
    expect(role("email-verify-row")).toBeNull();
  });

  it("learns from the Backend that the address was already confirmed", async () => {
    resendMock.mockResolvedValue({ ok: true, alreadyVerified: true });
    render(<ProfileFidelity canonical="Мария" account={view()} />);
    await userEvent.click(role("email-verify-send")!);
    await waitFor(() => expect(role("email-state")!.textContent).toContain(COPY.email_state_verified));
    expect(role("email-verify-row")).toBeNull();
  });
});

describe("changing the address", () => {
  async function open() {
    render(<ProfileFidelity canonical="Мария" account={view({ emailVerified: true })} />);
    await userEvent.click(role("email-affordance")!);
  }

  it("is one editor at a time: the other two affordances stand down", async () => {
    await open();
    expect(role("email-editor")).not.toBeNull();
    expect(document.activeElement).toBe(role("new-email"));
    expect((role("edit-affordance") as HTMLButtonElement).disabled).toBe(true);
    expect((role("password-affordance") as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(role("email-cancel")!);
    expect(role("email-editor")).toBeNull();
    expect((role("edit-affordance") as HTMLButtonElement).disabled).toBe(false);
  });

  it("checks the address and the password before it spends a request", async () => {
    await open();
    await userEvent.type(role("new-email")!, "not-an-address");
    await userEvent.click(role("email-submit")!);
    expect(role("email-error")!.textContent).toBe(COPY.email_error_invalid);
    await userEvent.clear(role("new-email")!);
    await userEvent.type(role("new-email")!, "new@example.invalid");
    await userEvent.click(role("email-submit")!);
    expect(role("email-error")!.textContent).toBe(COPY.email_error_password);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("sends the new address with the current password, and shows the change as PENDING", async () => {
    requestMock.mockResolvedValue({ ok: true, pendingEmail: "new@example.invalid" });
    await open();
    await userEvent.type(role("new-email")!, " New@Example.invalid ");
    await userEvent.type(role("email-password")!, "Password-1");
    await userEvent.click(role("email-submit")!);
    expect(requestMock).toHaveBeenCalledWith({ newEmail: "new@example.invalid", currentPassword: "Password-1" });
    await waitFor(() => expect(role("email-pending")).not.toBeNull());
    expect(role("email-pending")!.textContent).toBe(COPY.email_pending.replace("{email}", "new@example.invalid"));
    // The account's address has NOT changed, and the page does not say it has.
    expect(role("email-value")!.textContent).toContain("maria@example.invalid");
    expect(role("email-editor")).toBeNull();
    expect(document.body.innerHTML).not.toContain("Password-1");
  });

  it("names each refusal, and never keeps a wrong password in the field", async () => {
    await open();
    const cases = [
      ["INVALID_PASSWORD", COPY.email_error_password],
      ["SAME_EMAIL", COPY.email_error_same],
      ["EMAIL_IN_USE", COPY.email_error_in_use],
      ["RATE_LIMITED", COPY.email_error_limited],
      ["FAILED", COPY.email_error_failed],
    ] as const;
    for (const [failure, text] of cases) {
      requestMock.mockResolvedValueOnce({ ok: false, failure });
      await userEvent.clear(role("new-email")!);
      await userEvent.type(role("new-email")!, "new@example.invalid");
      await userEvent.type(role("email-password")!, "Password-1");
      await userEvent.click(role("email-submit")!);
      await waitFor(() => expect(role("email-error")!.textContent).toBe(text));
      expect((role("email-password") as HTMLInputElement).value).toBe("");
    }
    expect(role("email-pending")).toBeNull();
  });

  it("withdraws a pending change, and keeps it when the withdrawal failed", async () => {
    cancelMock.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    render(<ProfileFidelity canonical="Мария" account={view({ emailVerified: true, pendingEmail: "new@example.invalid" })} />);
    expect(role("email-pending")!.textContent).toContain("new@example.invalid");
    await userEvent.click(role("email-pending-cancel")!);
    await waitFor(() => expect(cancelMock).toHaveBeenCalledTimes(1));
    expect(role("email-pending")).not.toBeNull();
    await userEvent.click(role("email-pending-cancel")!);
    await waitFor(() => expect(role("email-pending-row")).toBeNull());
  });

  it("a new password withdraws the pending change, and the page says so once", async () => {
    passwordMock.mockResolvedValue({ ok: true });
    render(<ProfileFidelity canonical="Мария" account={view({ emailVerified: true, pendingEmail: "new@example.invalid" })} />);
    await userEvent.click(role("password-affordance")!);
    await userEvent.type(role("current-password")!, "Password-1");
    await userEvent.type(role("new-password")!, "Password-2");
    await userEvent.type(role("confirm-password")!, "Password-2");
    await userEvent.click(role("password-submit")!);
    await waitFor(() => expect(role("password-note")!.textContent).toBe(COPY.password_changed_email_dropped));
    // The Backend dropped the request with the old password; the page does not go on saying it waits.
    expect(role("email-pending-row")).toBeNull();
    expect(role("email-value")!.textContent).toContain("maria@example.invalid");
  });

  it("says only that the password changed when nothing was pending", async () => {
    passwordMock.mockResolvedValue({ ok: true });
    render(<ProfileFidelity canonical="Мария" account={view({ emailVerified: true })} />);
    await userEvent.click(role("password-affordance")!);
    await userEvent.type(role("current-password")!, "Password-1");
    await userEvent.type(role("new-password")!, "Password-2");
    await userEvent.type(role("confirm-password")!, "Password-2");
    await userEvent.click(role("password-submit")!);
    await waitFor(() => expect(role("password-note")!.textContent).toBe(COPY.password_changed));
  });

  it("does not ask a pending address to confirm the old one as well", () => {
    render(<ProfileFidelity canonical="Мария" account={view({ pendingEmail: "new@example.invalid" })} />);
    expect(role("email-pending-row")).not.toBeNull();
    expect(role("email-verify-row")).toBeNull();
    expect(screen.queryByText(COPY.email_verify_lead)).toBeNull();
  });
});
