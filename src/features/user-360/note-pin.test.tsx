import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import { MemoryKeyValueStorage, type KeyValueStorage } from "@/data/mock/overlay/storage";
import type { CrmContext, CrmDataProvider } from "@/data/contracts/CrmDataProvider";
import type {
  CrmMutations,
  SetNotePinnedCommand,
  SetNotePinnedResult,
} from "@/data/contracts/CrmMutations";
import { fail, ok, type Result } from "@/data/contracts/result";
import { mockSessionForRole } from "@/domain/identity/session";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { NOTE_PIN_LABEL } from "@/config/labels";
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
const FIXTURE_NOTE_ID = `${USER}_note_1`;
const clock = new FixedMockClock();
const EDIT_ROLES: CrmRole[] = ["crm_admin", "crm_manager", "retention_manager", "support"];
const DENIED_ROLES: CrmRole[] = CRM_ROLES.filter((r) => !EDIT_ROLES.includes(r));

function newProvider(storage: KeyValueStorage = new MemoryKeyValueStorage(), delayMs = 0) {
  return new MockCrmDataProvider({ clock, delayMs, storage });
}

/** Mutations that throw for everything except the given `setNotePinned`. */
function pinMutations(setNotePinned: CrmMutations["setNotePinned"]): CrmMutations {
  return {
    addNote: () => {
      throw new Error("this suite must not call addNote");
    },
    assignPrimaryOwner: () => {
      throw new Error("this suite must not call assignPrimaryOwner");
    },
    setNotePinned,
    updateNoteBody: () => {
      throw new Error("this suite must not call updateNoteBody");
    },
    setNoteVisibility: () => {
      throw new Error("this suite must not call setNoteVisibility");
    },
    deleteNote: () => {
      throw new Error("this suite must not call deleteNote");
    },
  };
}

function renderNotes(opts: {
  provider: CrmDataProvider;
  mutations?: CrmMutations;
}) {
  return render(
    <TooltipProvider>
      <UserNotes
        userId={USER}
        providerOverride={opts.provider}
        mutationsOverride={opts.mutations ?? (opts.provider as unknown as CrmMutations)}
      />
    </TooltipProvider>,
  );
}

const pinButton = () => screen.getByRole("button", { name: NOTE_PIN_LABEL.pinAction });
const unpinButton = () => screen.getByRole("button", { name: NOTE_PIN_LABEL.unpinAction });

async function waitForNotes() {
  await screen.findByText(/Синтетическая заметка/);
}

/* --------------------------------------------------------- role visibility */

describe("pin control — role visibility", () => {
  it.each(EDIT_ROLES)("%s sees a pin control on every note", async (role) => {
    currentRole = role;
    renderNotes({ provider: newProvider() });
    await waitForNotes();
    expect(pinButton()).toBeInTheDocument();
  });

  it.each(DENIED_ROLES)("%s sees no pin control at all", async (role) => {
    currentRole = role;
    renderNotes({ provider: newProvider() });
    await waitForNotes();
    expect(screen.queryByRole("button", { name: NOTE_PIN_LABEL.pinAction })).toBeNull();
    expect(screen.queryByRole("button", { name: NOTE_PIN_LABEL.unpinAction })).toBeNull();
  });

  it("the pin control is a real button with a full accessible name and aria-pressed", async () => {
    currentRole = "crm_admin";
    renderNotes({ provider: newProvider() });
    await waitForNotes();
    const btn = pinButton();
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    // The name is the instruction, not the glyph.
    expect(btn).toHaveAccessibleName(NOTE_PIN_LABEL.pinAction);
  });
});

/* --------------------------------------------------------- happy path */

describe("pin control — pin and unpin against the real provider", () => {
  it("pinning flips aria-pressed and shows the pinned badge, via a re-read", async () => {
    currentRole = "crm_admin";
    const user = userEvent.setup();
    renderNotes({ provider: newProvider() });
    await waitForNotes();

    await user.click(pinButton());

    // The control now offers the opposite action and reports pressed.
    const un = await screen.findByRole("button", { name: NOTE_PIN_LABEL.unpinAction });
    expect(un).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(NOTE_PIN_LABEL.pinnedBadge)).toBeInTheDocument();
    expect(screen.getByText(NOTE_PIN_LABEL.successPinned)).toBeInTheDocument();
  });

  it("unpinning returns the control to its unpinned state", async () => {
    currentRole = "crm_admin";
    const user = userEvent.setup();
    renderNotes({ provider: newProvider() });
    await waitForNotes();

    await user.click(pinButton());
    await user.click(await screen.findByRole("button", { name: NOTE_PIN_LABEL.unpinAction }));

    const again = await screen.findByRole("button", { name: NOTE_PIN_LABEL.pinAction });
    expect(again).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(NOTE_PIN_LABEL.successUnpinned)).toBeInTheDocument();
  });

  it("does not optimistically flip — a success whose re-read is unchanged shows no pin", async () => {
    currentRole = "crm_admin";
    const user = userEvent.setup();
    // The provider read never reports the note pinned, even though the mutation
    // reports success: the UI must follow the read model, not the command.
    const provider = newProvider();
    const okResult: Result<SetNotePinnedResult> = ok({
      note: {
        id: FIXTURE_NOTE_ID,
        userId: USER,
        caseId: null,
        authorEmployeeId: "emp_mock_admin",
        body: "x",
        visibility: "team",
        pinned: true,
        createdAt: clock.nowIso(),
        updatedAt: clock.nowIso(),
        mock: true,
      },
      audit: {
        id: "audit_mock_0001",
        action: "note_pin_changed",
        actorEmployeeId: "emp_mock_admin",
        actorRole: "crm_admin",
        targetUserId: USER,
        entityType: "note",
        entityId: FIXTURE_NOTE_ID,
        at: clock.nowIso(),
        reasonCode: "note_pin_changed_by_employee",
        previousPinned: false,
        nextPinned: true,
        mock: true,
      },
      replayed: false,
    });
    renderNotes({ provider, mutations: pinMutations(async () => okResult) });
    await waitForNotes();

    await user.click(pinButton());
    await screen.findByText(NOTE_PIN_LABEL.successPinned);
    // The read still says unpinned, so no badge and the control is still "pin".
    expect(screen.queryByText(NOTE_PIN_LABEL.pinnedBadge)).toBeNull();
    expect(screen.getByRole("button", { name: NOTE_PIN_LABEL.pinAction })).toBeInTheDocument();
  });
});

/* --------------------------------------------------------- guards / focus */

describe("pin control — double submit and focus", () => {
  it("a double click while pending calls the mutation once", async () => {
    currentRole = "crm_admin";
    const user = userEvent.setup();
    let resolve!: (r: Result<SetNotePinnedResult>) => void;
    const calls: SetNotePinnedCommand[] = [];
    const gate = new Promise<Result<SetNotePinnedResult>>((r) => (resolve = r));
    const setNotePinned = vi.fn(async (_ctx: CrmContext, cmd: SetNotePinnedCommand) => {
      calls.push(cmd);
      return gate;
    });
    renderNotes({ provider: newProvider(), mutations: pinMutations(setNotePinned) });
    await waitForNotes();

    const btn = pinButton();
    await user.click(btn);
    // Second click while the first is still pending — the guard must swallow it.
    await user.click(btn).catch(() => {});
    expect(setNotePinned).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);

    // Resolve the in-flight call so no promise is left dangling.
    resolve(
      ok<SetNotePinnedResult>({
        note: {
          id: FIXTURE_NOTE_ID,
          userId: USER,
          caseId: null,
          authorEmployeeId: "emp_mock_admin",
          body: "x",
          visibility: "team",
          pinned: true,
          createdAt: clock.nowIso(),
          updatedAt: clock.nowIso(),
          mock: true,
        },
        audit: {
          id: "audit_mock_0001",
          action: "note_pin_changed",
          actorEmployeeId: "emp_mock_admin",
          actorRole: "crm_admin",
          targetUserId: USER,
          entityType: "note",
          entityId: FIXTURE_NOTE_ID,
          at: clock.nowIso(),
          reasonCode: "note_pin_changed_by_employee",
          previousPinned: false,
          nextPinned: true,
          mock: true,
        },
        replayed: false,
      }),
    );
    // The real provider read is unchanged (the stub wrote nothing), so success is
    // observed through the confirmation line, not an optimistic button flip.
    await screen.findByText(NOTE_PIN_LABEL.successPinned);
  });

  it("returns focus to the acted note's control after a re-read that reorders it", async () => {
    currentRole = "crm_admin";
    const user = userEvent.setup();
    // Two notes: an authored one (newer) and the seeded fixture note (older).
    const storage = new MemoryKeyValueStorage();
    const provider = newProvider(storage);
    await provider.addNote(
      { actorId: "emp_mock_admin", role: "crm_admin", now: clock.nowIso() },
      { userId: USER, body: "Authored newer note.", idempotencyKey: "seed" },
    );
    renderNotes({ provider, mutations: provider as unknown as CrmMutations });
    await waitForNotes();

    // Pin the OLDER fixture note; it will jump to the top of the re-read list.
    const buttons = screen.getAllByRole("button", { name: NOTE_PIN_LABEL.pinAction });
    // The fixture note trails (newest-first), so its control is the last one.
    const fixtureBtn = buttons.at(-1)!;
    await user.click(fixtureBtn);

    const un = await screen.findByRole("button", { name: NOTE_PIN_LABEL.unpinAction });
    await waitFor(() => expect(un).toHaveFocus());
  });

  it("returns focus after an unpin too", async () => {
    currentRole = "crm_admin";
    const user = userEvent.setup();
    renderNotes({ provider: newProvider() });
    await waitForNotes();

    await user.click(pinButton());
    const un = await screen.findByRole("button", { name: NOTE_PIN_LABEL.unpinAction });
    await user.click(un);
    const again = await screen.findByRole("button", { name: NOTE_PIN_LABEL.pinAction });
    await waitFor(() => expect(again).toHaveFocus());
  });
});

/* --------------------------------------------------------- error handling */

describe("pin control — conflict and storage failure", () => {
  it("a conflict re-reads and shows the actual-state message", async () => {
    currentRole = "crm_admin";
    const user = userEvent.setup();
    const provider = newProvider();
    const getSpy = vi.spyOn(provider, "getUserNotesView");
    const setNotePinned = vi.fn(async () =>
      fail<SetNotePinnedResult>({ code: "conflict", message: "raced", retriable: false }),
    );
    renderNotes({ provider, mutations: pinMutations(setNotePinned) });
    await waitForNotes();
    const callsBefore = getSpy.mock.calls.length;

    await user.click(pinButton());

    expect(await screen.findByText(NOTE_PIN_LABEL.conflict)).toBeInTheDocument();
    // Conflict triggered a re-read.
    await waitFor(() => expect(getSpy.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("a storage failure retries with the SAME idempotency key and never leaks diagnostics", async () => {
    currentRole = "crm_admin";
    const user = userEvent.setup();
    const provider = newProvider();
    const keys: string[] = [];
    let broken = true;
    const setNotePinned = vi.fn(async (_ctx: CrmContext, cmd: SetNotePinnedCommand) => {
      keys.push(cmd.idempotencyKey);
      if (broken) {
        return fail<SetNotePinnedResult>({
          code: "internal",
          message: "Mock overlay could not be persisted.",
          retriable: true,
        });
      }
      return ok<SetNotePinnedResult>({
        note: {
          id: FIXTURE_NOTE_ID,
          userId: USER,
          caseId: null,
          authorEmployeeId: "emp_mock_admin",
          body: "x",
          visibility: "team",
          pinned: true,
          createdAt: clock.nowIso(),
          updatedAt: clock.nowIso(),
          mock: true,
        },
        audit: {
          id: "audit_mock_0001",
          action: "note_pin_changed",
          actorEmployeeId: "emp_mock_admin",
          actorRole: "crm_admin",
          targetUserId: USER,
          entityType: "note",
          entityId: FIXTURE_NOTE_ID,
          at: clock.nowIso(),
          reasonCode: "note_pin_changed_by_employee",
          previousPinned: false,
          nextPinned: true,
          mock: true,
        },
        replayed: false,
      });
    });
    const { container } = renderNotes({ provider, mutations: pinMutations(setNotePinned) });
    await waitForNotes();

    await user.click(pinButton());
    expect(
      await screen.findByText("Локальное сохранение недоступно. Попробуйте ещё раз"),
    ).toBeInTheDocument();

    // The developer diagnostic never reached the DOM.
    expect(container.innerHTML).not.toContain("Mock overlay could not be persisted");
    expect(container.innerHTML).not.toContain("ata-crm.mutation-overlay");
    expect(container.innerHTML).not.toContain("audit_mock_0001");
    expect(container.innerHTML).not.toContain(FIXTURE_NOTE_ID);

    // Retry succeeds, and both attempts carried the identical key. The confirmation
    // line reports success; the stub wrote nothing, so the read stays unpinned.
    broken = false;
    await user.click(screen.getByRole("button", { name: NOTE_PIN_LABEL.pinAction }));
    await screen.findByText(NOTE_PIN_LABEL.successPinned);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});

/* --------------------------------------------------------- role change */

describe("pin control — role change", () => {
  it("clears prior feedback and drops the control for a forbidden role", async () => {
    currentRole = "crm_admin";
    const user = userEvent.setup();
    const { rerender } = renderNotes({ provider: newProvider() });
    await waitForNotes();
    await user.click(pinButton());
    await screen.findByText(NOTE_PIN_LABEL.successPinned);

    // Switch to a role that cannot edit notes and re-render.
    currentRole = "read_only";
    rerender(
      <TooltipProvider>
        <UserNotes userId={USER} providerOverride={newProvider()} mutationsOverride={newProvider()} />
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: NOTE_PIN_LABEL.unpinAction })).toBeNull();
      expect(screen.queryByRole("button", { name: NOTE_PIN_LABEL.pinAction })).toBeNull();
    });
    // The success line from the previous role is gone.
    expect(screen.queryByText(NOTE_PIN_LABEL.successPinned)).toBeNull();
  });
});
