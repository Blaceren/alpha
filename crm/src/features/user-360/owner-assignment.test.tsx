import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import { MemoryKeyValueStorage, type KeyValueStorage } from "@/data/mock/overlay/storage";
import type { CrmDataProvider } from "@/data/contracts/CrmDataProvider";
import type { AssignPrimaryOwnerResult, CrmMutations } from "@/data/contracts/CrmMutations";
import type { Result } from "@/data/contracts/result";
import { fail, ok } from "@/data/contracts/result";
import { mockSessionForRole } from "@/domain/identity/session";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { OWNER_ASSIGN_LABEL, USER_360_LABEL, ownerLabel } from "@/config/labels";
import { OWNER_ERROR_MESSAGE } from "./lib/owner-error";
import { TooltipProvider } from "@/components/ui/tooltip";
import { User360Workspace } from "./user-360-workspace";

const SESSIONS = new Map<CrmRole, ReturnType<typeof mockSessionForRole>>();
const sessionFor = (role: CrmRole) => {
  if (!SESSIONS.has(role)) SESSIONS.set(role, mockSessionForRole(role));
  return SESSIONS.get(role)!;
};
let currentRole: CrmRole = "crm_admin";
vi.mock("@/components/crm-shell/session-context", () => ({
  useSession: () => ({ session: sessionFor(currentRole), setRole: vi.fn() }),
}));

/** Nina Chmiel — the canonical persona of the 1C/1B4-B suites. Owned by emp_sup1. */
const USER = "usr_mock_026";
const clock = new FixedMockClock();

/** ROLE_PERMISSION_MATRIX §5 "Назначить owner" — unchanged by this phase. */
const ALLOWED: readonly CrmRole[] = ["crm_admin", "crm_manager", "retention_manager"];
const DENIED: readonly CrmRole[] = [
  "mentor",
  "support",
  "moderator",
  "analyst",
  "content_manager",
  "read_only",
  // PHASE-1 ADMIN: the progression operator holds exactly one permission
  // (`curriculum_progress_override`) and therefore none of the note or owner
  // rights this suite classifies. Denied, explicitly.
  "progression_operator",
];

beforeEach(() => {
  currentRole = "crm_admin";
});

function newProvider(storage: KeyValueStorage = new MemoryKeyValueStorage()) {
  return new MockCrmDataProvider({ clock, delayMs: 0, storage });
}

function renderScreen({
  provider = newProvider(),
  mutations,
}: {
  provider?: CrmDataProvider;
  mutations?: Pick<CrmMutations, "assignPrimaryOwner">;
} = {}) {
  const full: CrmMutations | undefined = mutations
    ? {
        assignPrimaryOwner: mutations.assignPrimaryOwner,
        // This suite drives one mutation. A silent no-op for the others would let a
        // stray call through unnoticed.
        addNote: () => {
          throw new Error("the owner suite must not call addNote");
        },
        setNotePinned: () => {
          throw new Error("the owner suite must not call setNotePinned");
        },
        updateNoteBody: () => {
          throw new Error("the owner suite must not call updateNoteBody");
        },
        setNoteVisibility: () => {
          throw new Error("the owner suite must not call setNoteVisibility");
        },
        deleteNote: () => {
          throw new Error("the owner suite must not call deleteNote");
        },
      }
    : undefined;
  return render(
    <TooltipProvider>
      <User360Workspace
        userId={USER}
        providerOverride={provider}
        mutationsOverride={full ?? (provider as unknown as CrmMutations)}
      />
    </TooltipProvider>,
  );
}

const ownerSection = () => screen.getByRole("region", { name: USER_360_LABEL.ownerContext });
const select = () => screen.getByLabelText(OWNER_ASSIGN_LABEL.fieldLabel) as HTMLSelectElement;
const saveButton = () =>
  within(ownerSection()).getByRole("button", { name: OWNER_ASSIGN_LABEL.submit });

/**
 * The owner as the section STATES it, read from the definition list rather than by
 * text: the same caption also appears as an `<option>` in the picker, so a plain text
 * query would match both and could not tell "this is the owner" from "this could be".
 */
const statedOwner = () => ownerSection().querySelector("dl dd")!.textContent;

/** Wait for the aggregate AND the candidate read to land. */
async function ready() {
  await screen.findByRole("heading", { level: 1 });
  await screen.findByLabelText(OWNER_ASSIGN_LABEL.fieldLabel);
}

const assignOk = (ownerId: string | null, replayed = false): Result<AssignPrimaryOwnerResult> =>
  ok({
    userId: USER,
    ownerId,
    audit: {
      id: "audit_mock_0001",
      action: "primary_owner_changed",
      actorEmployeeId: "emp_mock_admin",
      actorRole: "crm_admin",
      targetUserId: USER,
      entityType: "user",
      entityId: USER,
      at: clock.nowIso(),
      reasonCode: "primary_owner_changed_by_employee",
      previousOwnerId: "emp_sup1",
      nextOwnerId: ownerId,
      mock: true,
    },
    replayed,
  });

/* ------------------------------------------------------------- permissions */

describe("owner assignment — permissions across all 10 roles", () => {
  it.each(ALLOWED)("%s gets the picker and the Save control", async (role) => {
    currentRole = role;
    renderScreen();
    await ready();

    expect(select()).toBeInTheDocument();
    expect(saveButton()).toBeInTheDocument();
    expect(within(ownerSection()).queryByText(OWNER_ASSIGN_LABEL.forbidden)).not.toBeInTheDocument();
  });

  it.each(DENIED)("%s gets a sentence and no form control at all", async (role) => {
    currentRole = role;
    renderScreen();
    await screen.findByRole("heading", { level: 1 });

    const section = ownerSection();
    expect(within(section).getByText(OWNER_ASSIGN_LABEL.forbidden)).toBeInTheDocument();

    // Not hidden, not disabled — absent. A dead control advertises a capability the
    // role will never have and cannot explain itself to a screen reader (D-59).
    expect(section.querySelector("select")).toBeNull();
    expect(section.querySelector("button")).toBeNull();
    expect(section.querySelector('[disabled]')).toBeNull();
    expect(screen.queryByLabelText(OWNER_ASSIGN_LABEL.fieldLabel)).not.toBeInTheDocument();
  });

  it.each(DENIED)("%s still sees who the owner is", async (role) => {
    currentRole = role;
    renderScreen();
    await screen.findByRole("heading", { level: 1 });
    expect(within(ownerSection()).getByText(ownerLabel("emp_sup1"))).toBeInTheDocument();
  });

  it("covers every role in CRM_ROLES — a new role cannot be forgotten", () => {
    expect([...ALLOWED, ...DENIED].sort()).toEqual([...CRM_ROLES].sort());
  });

  it("a denied role does not even ask for the candidate list", async () => {
    currentRole = "read_only";
    const provider = newProvider();
    const spy = vi.spyOn(provider, "getPrimaryOwnerCandidates");
    renderScreen({ provider });
    await screen.findByRole("heading", { level: 1 });
    expect(spy).not.toHaveBeenCalled();
  });
});

/* ----------------------------------------------------------------- states */

describe("owner assignment — unchanged", () => {
  it("preselects the current owner from the read model", async () => {
    renderScreen();
    await ready();
    expect(select().value).toBe("emp_sup1");
  });

  it("offers «Без ответственного» plus the five candidates", async () => {
    renderScreen();
    await ready();
    const options = within(select()).getAllByRole("option").map((o) => o.textContent);
    expect(options[0]).toBe(OWNER_ASSIGN_LABEL.unassignedOption);
    expect(options).toHaveLength(6);
    expect(options).toContain("Retention 1");
    expect(options).toContain("Support 1");
  });

  it("disables Save while nothing has changed", async () => {
    renderScreen();
    await ready();
    expect(saveButton()).toBeDisabled();
  });

  it("sends no mutation when the selection is put back to the current owner", async () => {
    const assignPrimaryOwner = vi.fn();
    renderScreen({ mutations: { assignPrimaryOwner } });
    await ready();

    await userEvent.selectOptions(select(), "emp_ret1");
    await userEvent.selectOptions(select(), "emp_sup1");

    expect(saveButton()).toBeDisabled();
    expect(assignPrimaryOwner).not.toHaveBeenCalled();
  });
});

describe("owner assignment — changed and submitted", () => {
  it("enables Save once a different owner is picked", async () => {
    renderScreen();
    await ready();
    await userEvent.selectOptions(select(), "emp_ret1");
    expect(saveButton()).toBeEnabled();
  });

  it("sends the picked owner and the owner it read as expectedOwnerId", async () => {
    const assignPrimaryOwner = vi.fn().mockResolvedValue(assignOk("emp_ret1"));
    renderScreen({ mutations: { assignPrimaryOwner } });
    await ready();

    await userEvent.selectOptions(select(), "emp_ret1");
    await userEvent.click(saveButton());

    await waitFor(() => expect(assignPrimaryOwner).toHaveBeenCalledTimes(1));
    const command = assignPrimaryOwner.mock.calls[0]![1];
    expect(command.userId).toBe(USER);
    expect(command.ownerId).toBe("emp_ret1");
    expect(command.expectedOwnerId).toBe("emp_sup1");
    expect(typeof command.idempotencyKey).toBe("string");
  });

  it("sends null for «Без ответственного»", async () => {
    const assignPrimaryOwner = vi.fn().mockResolvedValue(assignOk(null));
    renderScreen({ mutations: { assignPrimaryOwner } });
    await ready();

    await userEvent.selectOptions(select(), OWNER_ASSIGN_LABEL.unassignedOption);
    await userEvent.click(saveButton());

    await waitFor(() => expect(assignPrimaryOwner).toHaveBeenCalled());
    expect(assignPrimaryOwner.mock.calls[0]![1].ownerId).toBeNull();
  });

  it("renders the new owner from the provider, not from the selection", async () => {
    // A real provider: the section must state what was actually stored.
    renderScreen();
    await ready();
    expect(statedOwner()).toBe(ownerLabel("emp_sup1"));

    await userEvent.selectOptions(select(), "emp_ret1");
    await userEvent.click(saveButton());

    await waitFor(() => expect(statedOwner()).toBe(ownerLabel("emp_ret1")));
  });

  it("unassigning shows «Не назначен» and the same success sentence", async () => {
    renderScreen();
    await ready();

    await userEvent.selectOptions(select(), OWNER_ASSIGN_LABEL.unassignedOption);
    await userEvent.click(saveButton());

    expect(await screen.findByText(OWNER_ASSIGN_LABEL.success)).toBeInTheDocument();
    await waitFor(() => expect(statedOwner()).toBe("Не назначен"));
  });

  it("announces success politely, with no employee id or audit metadata", async () => {
    const { container } = renderScreen();
    await ready();
    await userEvent.selectOptions(select(), "emp_ret1");
    await userEvent.click(saveButton());

    const status = await screen.findByText(OWNER_ASSIGN_LABEL.success);
    expect(status).toHaveAttribute("role", "status");
    // The message is the fact, not our bookkeeping.
    expect(status.textContent).toBe(OWNER_ASSIGN_LABEL.success);
    expect(container.innerHTML).not.toContain("audit_mock");
    // Nothing VISIBLE carries an id. `<option value="emp_ret1">` legitimately does —
    // that is the value the form has to submit — so the check is on rendered text.
    expect(ownerSection().textContent).not.toMatch(/emp_/);
  });

  it("returns focus to the select after success", async () => {
    renderScreen();
    await ready();
    await userEvent.selectOptions(select(), "emp_ret1");
    await userEvent.click(saveButton());

    await screen.findByText(OWNER_ASSIGN_LABEL.success);
    await waitFor(() => expect(select()).toHaveFocus());
  });

  it("re-reads the aggregate after a success — no optimistic insert (D-60)", async () => {
    const provider = newProvider();
    const spy = vi.spyOn(provider, "getUser360");
    renderScreen({ provider });
    await ready();
    const initial = spy.mock.calls.length;

    await userEvent.selectOptions(select(), "emp_ret1");
    await userEvent.click(saveButton());

    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(initial));
  });

  it("Save goes back to disabled once the read model catches up", async () => {
    renderScreen();
    await ready();
    await userEvent.selectOptions(select(), "emp_ret1");
    await userEvent.click(saveButton());

    await screen.findByText(OWNER_ASSIGN_LABEL.success);
    // The selection now equals the stored owner, so there is nothing to save.
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(select().value).toBe("emp_ret1");
  });

  it("submits from the keyboard", async () => {
    const assignPrimaryOwner = vi.fn().mockResolvedValue(assignOk("emp_ret1"));
    renderScreen({ mutations: { assignPrimaryOwner } });
    await ready();

    await userEvent.selectOptions(select(), "emp_ret1");
    saveButton().focus();
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(assignPrimaryOwner).toHaveBeenCalledTimes(1));
  });
});

describe("owner assignment — pending", () => {
  it("says «Сохраняем…», marks busy and guards both controls", async () => {
    let release: (v: Result<AssignPrimaryOwnerResult>) => void = () => {};
    const assignPrimaryOwner = vi.fn().mockReturnValue(
      new Promise<Result<AssignPrimaryOwnerResult>>((r) => {
        release = r;
      }),
    );
    renderScreen({ mutations: { assignPrimaryOwner } });
    await ready();

    await userEvent.selectOptions(select(), "emp_ret1");
    await userEvent.click(saveButton());

    // Pending is announced through the control's own name — the same way the note
    // composer does it — so the button is found by its pending name.
    const pendingButton = await within(ownerSection()).findByRole("button", {
      name: OWNER_ASSIGN_LABEL.submitPending,
    });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");
    expect(select()).toBeDisabled();

    release(assignOk("emp_ret1"));
    await screen.findByText(OWNER_ASSIGN_LABEL.success);
  });

  it("a double submit results in exactly one provider call", async () => {
    let release: (v: Result<AssignPrimaryOwnerResult>) => void = () => {};
    const assignPrimaryOwner = vi.fn().mockReturnValue(
      new Promise<Result<AssignPrimaryOwnerResult>>((r) => {
        release = r;
      }),
    );
    renderScreen({ mutations: { assignPrimaryOwner } });
    await ready();

    await userEvent.selectOptions(select(), "emp_ret1");
    // Scoped to this section's form: the notes composer renders a form too, and it
    // comes first in DOM order.
    const form = ownerSection().querySelector("form")!;
    const button = saveButton();
    // Fire in the same tick — past `disabled`, straight at the handler. The ref-guard
    // is what has to stop the second: both would otherwise see a not-yet-rerendered
    // "idle".
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.submit(form);

    expect(assignPrimaryOwner).toHaveBeenCalledTimes(1);
    release(assignOk("emp_ret1"));
    await screen.findByText(OWNER_ASSIGN_LABEL.success);
  });
});

/* ----------------------------------------------------------------- errors */

describe("owner assignment — conflict", () => {
  it("shows the canonical value and drops the selection instead of overwriting", async () => {
    const storage = new MemoryKeyValueStorage();
    const provider = newProvider(storage);
    renderScreen({ provider });
    await ready();

    await userEvent.selectOptions(select(), "emp_ret1");

    // Someone else wins the race between our read and our write.
    const other = new MockCrmDataProvider({ clock, storage });
    await other.assignPrimaryOwner(
      { actorId: "emp_other", role: "crm_admin", now: clock.nowIso() },
      { userId: USER, ownerId: "emp_men1", expectedOwnerId: "emp_sup1", idempotencyKey: "other" },
    );

    await userEvent.click(saveButton());

    expect(await screen.findByText(OWNER_ASSIGN_LABEL.conflict)).toBeInTheDocument();
    // The winner is shown, and our pick is gone — not applied on top.
    await waitFor(() => expect(statedOwner()).toBe(ownerLabel("emp_men1")));
    await waitFor(() => expect(select().value).toBe("emp_men1"));
  });

  it("does not silently apply last-write-wins", async () => {
    const storage = new MemoryKeyValueStorage();
    const provider = newProvider(storage);
    renderScreen({ provider });
    await ready();

    await userEvent.selectOptions(select(), "emp_ret1");
    const other = new MockCrmDataProvider({ clock, storage });
    await other.assignPrimaryOwner(
      { actorId: "emp_other", role: "crm_admin", now: clock.nowIso() },
      { userId: USER, ownerId: "emp_men1", expectedOwnerId: "emp_sup1", idempotencyKey: "other" },
    );
    await userEvent.click(saveButton());
    await screen.findByText(OWNER_ASSIGN_LABEL.conflict);

    const stored = await other.getUser360(
      { actorId: "emp_other", role: "crm_admin", now: clock.nowIso() },
      { userId: USER },
    );
    expect(stored.data!.owner.ownerId).toBe("emp_men1");
  });

  it("reports the conflict through role=alert", async () => {
    const assignPrimaryOwner = vi
      .fn()
      .mockResolvedValue(fail({ code: "conflict", message: "Primary owner changed since it was read.", retriable: false }));
    renderScreen({ mutations: { assignPrimaryOwner } });
    await ready();
    await userEvent.selectOptions(select(), "emp_ret1");
    await userEvent.click(saveButton());

    const alert = await within(ownerSection()).findByRole("alert");
    expect(alert).toHaveTextContent(OWNER_ASSIGN_LABEL.conflict);
  });
});

describe("owner assignment — storage failure and retry", () => {
  it("says local saving is unavailable, in Russian", async () => {
    const assignPrimaryOwner = vi
      .fn()
      .mockResolvedValue(fail({ code: "internal", message: "Mock overlay could not be persisted.", retriable: true }));
    const { container } = renderScreen({ mutations: { assignPrimaryOwner } });
    await ready();

    await userEvent.selectOptions(select(), "emp_ret1");
    await userEvent.click(saveButton());

    const alert = await within(ownerSection()).findByRole("alert");
    expect(alert).toHaveTextContent(OWNER_ERROR_MESSAGE.internal);
    expect(container.innerHTML).not.toContain("Mock overlay could not be persisted.");
  });

  it("a retry after a storage failure repeats the key and the expectation", async () => {
    const assignPrimaryOwner = vi
      .fn()
      .mockResolvedValueOnce(fail({ code: "internal", message: "boom", retriable: true }))
      .mockResolvedValueOnce(assignOk("emp_ret1"));
    renderScreen({ mutations: { assignPrimaryOwner } });
    await ready();

    await userEvent.selectOptions(select(), "emp_ret1");
    await userEvent.click(saveButton());
    await within(ownerSection()).findByRole("alert");

    await userEvent.click(saveButton());
    await waitFor(() => expect(assignPrimaryOwner).toHaveBeenCalledTimes(2));

    const first = assignPrimaryOwner.mock.calls[0]![1];
    const second = assignPrimaryOwner.mock.calls[1]![1];
    // Nothing was written, so repeating the key is what makes the retry safe.
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.expectedOwnerId).toBe(first.expectedOwnerId);
  });

  it("a retry after a conflict uses a fresh key", async () => {
    const assignPrimaryOwner = vi
      .fn()
      .mockResolvedValueOnce(fail({ code: "conflict", message: "taken", retriable: false }))
      .mockResolvedValueOnce(assignOk("emp_ret1"));
    renderScreen({ mutations: { assignPrimaryOwner } });
    await ready();

    await userEvent.selectOptions(select(), "emp_ret1");
    await userEvent.click(saveButton());
    await within(ownerSection()).findByRole("alert");

    await userEvent.selectOptions(select(), "emp_ret2");
    await userEvent.click(saveButton());
    await waitFor(() => expect(assignPrimaryOwner).toHaveBeenCalledTimes(2));

    // The key was accepted for a different command and would conflict forever.
    expect(assignPrimaryOwner.mock.calls[1]![1].idempotencyKey).not.toBe(
      assignPrimaryOwner.mock.calls[0]![1].idempotencyKey,
    );
  });
});

describe("owner assignment — diagnostics never reach the screen", () => {
  it.each([
    ["unauthorized", OWNER_ERROR_MESSAGE.unauthorized],
    ["not_found", OWNER_ERROR_MESSAGE.not_found],
    ["invalid_input", OWNER_ERROR_MESSAGE.invalid_input],
    ["conflict", OWNER_ERROR_MESSAGE.conflict],
    ["internal", OWNER_ERROR_MESSAGE.internal],
    ["rate_limited", OWNER_ERROR_MESSAGE.rate_limited],
    ["upstream_unavailable", OWNER_ERROR_MESSAGE.upstream_unavailable],
    ["stale_data", OWNER_ERROR_MESSAGE.stale_data],
  ])("%s renders its safe text and no diagnostic", async (code, expected) => {
    const diagnostic = "RAW-DIAGNOSTIC-emp_secret-{\"overlay\":true}";
    const assignPrimaryOwner = vi
      .fn()
      .mockResolvedValue(fail({ code: code as never, message: diagnostic, retriable: true }));
    const { container } = renderScreen({ mutations: { assignPrimaryOwner } });
    await ready();

    await userEvent.selectOptions(select(), "emp_ret1");
    await userEvent.click(saveButton());

    const alert = await within(ownerSection()).findByRole("alert");
    expect(alert).toHaveTextContent(expected);
    expect(container.innerHTML).not.toContain(diagnostic);
    expect(container.innerHTML).not.toContain("RAW-DIAGNOSTIC");
    expect(container.innerHTML).not.toContain("ata-crm.mutation-overlay");
  });

  it("a failing candidate read is explained without its diagnostic", async () => {
    const provider = newProvider();
    vi.spyOn(provider, "getPrimaryOwnerCandidates").mockResolvedValue(
      fail({ code: "upstream_unavailable", message: "Mock error mode.", retriable: true }),
    );
    const { container } = renderScreen({ provider });
    await screen.findByRole("heading", { level: 1 });

    const alert = await within(ownerSection()).findByRole("alert");
    expect(alert).toHaveTextContent(OWNER_ERROR_MESSAGE.upstream_unavailable);
    expect(container.innerHTML).not.toContain("Mock error mode.");
    // No half-built picker when the list could not be loaded.
    expect(screen.queryByLabelText(OWNER_ASSIGN_LABEL.fieldLabel)).not.toBeInTheDocument();
  });

  it("never prints a raw employee id in a healthy section", async () => {
    renderScreen();
    await ready();
    const section = ownerSection();
    // Option values carry ids — the visible text must not.
    expect(section.textContent).not.toMatch(/emp_/);
  });
});

/* ----------------------------------------------------------- role change */

describe("owner assignment — role change", () => {
  it("drops an unsaved selection when the role switches", async () => {
    const { rerender } = renderScreen();
    await ready();
    await userEvent.selectOptions(select(), "emp_ret1");
    expect(select().value).toBe("emp_ret1");

    currentRole = "crm_manager";
    rerender(
      <TooltipProvider>
        <User360Workspace userId={USER} providerOverride={newProvider()} />
      </TooltipProvider>,
    );

    await waitFor(() => expect(select().value).toBe("emp_sup1"));
  });

  it("removes the form when the new role may not assign", async () => {
    const provider = newProvider();
    const { rerender } = renderScreen({ provider });
    await ready();

    currentRole = "read_only";
    rerender(
      <TooltipProvider>
        <User360Workspace userId={USER} providerOverride={provider} />
      </TooltipProvider>,
    );

    await waitFor(() =>
      expect(screen.queryByLabelText(OWNER_ASSIGN_LABEL.fieldLabel)).not.toBeInTheDocument(),
    );
    expect(within(ownerSection()).getByText(OWNER_ASSIGN_LABEL.forbidden)).toBeInTheDocument();
  });

  it("re-reads the candidate list for the new role", async () => {
    const provider = newProvider();
    const spy = vi.spyOn(provider, "getPrimaryOwnerCandidates");
    const { rerender } = renderScreen({ provider });
    await ready();
    const initial = spy.mock.calls.length;

    currentRole = "retention_manager";
    rerender(
      <TooltipProvider>
        <User360Workspace userId={USER} providerOverride={provider} />
      </TooltipProvider>,
    );

    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(initial));
    expect(spy.mock.calls.at(-1)![0].role).toBe("retention_manager");
  });

  it("mints a fresh idempotency key after the switch", async () => {
    const assignPrimaryOwner = vi.fn().mockResolvedValue(assignOk("emp_ret1"));
    const provider = newProvider();
    const mutations = { assignPrimaryOwner };
    const { rerender } = renderScreen({ provider, mutations });
    await ready();

    await userEvent.selectOptions(select(), "emp_ret1");
    await userEvent.click(saveButton());
    await waitFor(() => expect(assignPrimaryOwner).toHaveBeenCalledTimes(1));

    currentRole = "crm_manager";
    rerender(
      <TooltipProvider>
        <User360Workspace
          userId={USER}
          providerOverride={provider}
          mutationsOverride={{
            assignPrimaryOwner,
            addNote: () => {
              throw new Error("unused");
            },
            setNotePinned: () => {
              throw new Error("unused");
            },
            updateNoteBody: () => {
              throw new Error("unused");
            },
            setNoteVisibility: () => {
              throw new Error("unused");
            },
            deleteNote: () => {
              throw new Error("unused");
            },
          }}
        />
      </TooltipProvider>,
    );
    await ready();

    await userEvent.selectOptions(select(), "emp_ret2");
    await userEvent.click(saveButton());
    await waitFor(() => expect(assignPrimaryOwner).toHaveBeenCalledTimes(2));

    // The provider fingerprints the actor's role: a key minted under crm_admin and
    // sent under crm_manager would come back as a conflict that means nothing.
    expect(assignPrimaryOwner.mock.calls[1]![1].idempotencyKey).not.toBe(
      assignPrimaryOwner.mock.calls[0]![1].idempotencyKey,
    );
  });

  it("clears stale success text on the switch", async () => {
    const provider = newProvider();
    const { rerender } = renderScreen({ provider });
    await ready();
    await userEvent.selectOptions(select(), "emp_ret1");
    await userEvent.click(saveButton());
    await screen.findByText(OWNER_ASSIGN_LABEL.success);

    currentRole = "crm_manager";
    rerender(
      <TooltipProvider>
        <User360Workspace userId={USER} providerOverride={provider} />
      </TooltipProvider>,
    );

    await waitFor(() =>
      expect(screen.queryByText(OWNER_ASSIGN_LABEL.success)).not.toBeInTheDocument(),
    );
  });
});

/* ------------------------------------------------------------------ a11y */

describe("owner assignment — accessibility", () => {
  it("the select has a visible label tied to it", async () => {
    renderScreen();
    await ready();
    const label = within(ownerSection()).getByText(OWNER_ASSIGN_LABEL.fieldLabel, {
      selector: "label",
    });
    expect(label).toHaveAttribute("for", select().id);
  });

  it("the submit has an accessible name", async () => {
    renderScreen();
    await ready();
    expect(saveButton()).toHaveAccessibleName(OWNER_ASSIGN_LABEL.submit);
  });

  it("the select is reachable and operable from the keyboard", async () => {
    renderScreen();
    await ready();
    select().focus();
    expect(select()).toHaveFocus();
    await userEvent.selectOptions(select(), "emp_ret1");
    expect(select().value).toBe("emp_ret1");
  });
});
