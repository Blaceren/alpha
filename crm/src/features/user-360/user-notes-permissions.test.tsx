import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import { MemoryKeyValueStorage } from "@/data/mock/overlay/storage";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { canEditUserNotes } from "@/domain/identity/access";
import { mockSessionForRole } from "@/domain/identity/session";
import { NOTES_LABEL } from "@/config/labels";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserNotes } from "./components/user-notes";

const SESSIONS = new Map<CrmRole, ReturnType<typeof mockSessionForRole>>();
const sessionFor = (role: CrmRole) => {
  if (!SESSIONS.has(role)) SESSIONS.set(role, mockSessionForRole(role));
  return SESSIONS.get(role)!;
};
let currentRole: CrmRole = "crm_admin";
vi.mock("@/components/crm-shell/session-context", () => ({
  useSession: () => ({ session: sessionFor(currentRole), setRole: vi.fn() }),
}));

const USER = "usr_mock_026";
const clock = new FixedMockClock();

/** Storage is injected: no unit test touches the host localStorage. */
function newProvider() {
  return new MockCrmDataProvider({ clock, delayMs: 0, storage: new MemoryKeyValueStorage() });
}

async function renderAs(role: CrmRole) {
  currentRole = role;
  const provider = newProvider();
  const utils = render(
    <TooltipProvider>
      <UserNotes userId={USER} providerOverride={provider} mutationsOverride={provider} />
    </TooltipProvider>,
  );
  await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Заметки" })).toBeInTheDocument());
  return utils;
}

/**
 * The composer's submit button. On a phone the collapsed disclosure carries the
 * same words, and jsdom applies no CSS, so both are in the tree here; in a
 * browser `sm:hidden` removes the disclosure from the accessibility tree
 * entirely, so a real user never meets two controls of this name. Scoping to the
 * form keeps the assertion about the real control.
 */
const submitIn = (container: HTMLElement) => {
  const form = container.querySelector("form");
  return form ? within(form).queryByRole("button", { name: NOTES_LABEL.submit }) : null;
};

describe("User 360 notes — permission across every role", () => {
  it("covers the whole matrix, so a role cannot be forgotten", () => {
    // PHASE-1 ADMIN added `progression_operator`, which holds exactly one
    // permission and no note rights — so the matrix grew by one on the DENIED
    // side and not at all on the allowed side.
    expect(CRM_ROLES).toHaveLength(10);
    // The split is read from the canonical helper, not restated here: a literal
    // list in the test would be a second permission matrix to keep in sync.
    expect(CRM_ROLES.filter(canEditUserNotes)).toHaveLength(4);
    expect(CRM_ROLES.filter((r) => !canEditUserNotes(r))).toHaveLength(6);
  });

  for (const role of CRM_ROLES) {
    const mayEdit = canEditUserNotes(role);

    it(`${role}: ${mayEdit ? "gets the composer" : "gets an explanation and no form controls"}`, async () => {
      const { container } = await renderAs(role);

      if (mayEdit) {
        expect(screen.getByLabelText(NOTES_LABEL.composerLabel)).toBeInTheDocument();
        expect(submitIn(container)).toBeInTheDocument();
        expect(screen.queryByText(NOTES_LABEL.forbidden)).not.toBeInTheDocument();
      } else {
        // Absent, not disabled and not hidden: a dead control would advertise a
        // capability this role will never have, and cannot explain itself.
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
        expect(container.querySelector("textarea")).toBeNull();
        expect(container.querySelector("form")).toBeNull();
        expect(screen.queryByRole("button", { name: NOTES_LABEL.submit })).not.toBeInTheDocument();
        expect(container.querySelector("[disabled]")).toBeNull();
        expect(screen.getByText(NOTES_LABEL.forbidden)).toBeInTheDocument();
      }
    });

    it(`${role}: still reads the notes the projector allows`, async () => {
      // Reading notes is "View User 360", which every role has; visibility is
      // decided per note by the provider, so no role loses the list itself.
      await renderAs(role);
      expect(
        await screen.findByText(/Синтетическая заметка: демонстрационная запись/),
      ).toBeInTheDocument();
    });
  }
});

describe("User 360 notes — role change while the composer is open", () => {
  it("drops the form as soon as the session role may not write", async () => {
    const provider = newProvider();
    currentRole = "crm_admin";
    const { container, rerender } = render(
      <TooltipProvider>
        <UserNotes userId={USER} providerOverride={provider} mutationsOverride={provider} />
      </TooltipProvider>,
    );
    await waitFor(() => expect(submitIn(container)).toBeInTheDocument());

    currentRole = "read_only";
    rerender(
      <TooltipProvider>
        <UserNotes userId={USER} providerOverride={provider} mutationsOverride={provider} />
      </TooltipProvider>,
    );

    await waitFor(() => expect(container.querySelector("textarea")).toBeNull());
    expect(screen.getByText(NOTES_LABEL.forbidden)).toBeInTheDocument();
  });
});
