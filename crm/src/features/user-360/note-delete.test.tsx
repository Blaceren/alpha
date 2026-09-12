import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import { MemoryKeyValueStorage, type KeyValueStorage } from "@/data/mock/overlay/storage";
import type {
  CrmContext,
  CrmDataProvider,
  CrmNote,
  CrmNoteListItem,
} from "@/data/contracts/CrmDataProvider";
import type { CrmMutations, DeleteNoteResult } from "@/data/contracts/CrmMutations";
import type { NoteDeletedAuditRecord } from "@/domain/audit/audit";
import { fail, ok, type Result } from "@/data/contracts/result";
import { mockSessionForRole } from "@/domain/identity/session";
import type { CrmRole } from "@/domain/identity/roles";
import { NOTE_DELETE_LABEL, NOTE_VISIBILITY_EDIT_LABEL } from "@/config/labels";
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
const ACTOR = "emp_mock_admin";
const clock = new FixedMockClock();

function ctx(role: CrmRole = "crm_admin"): CrmContext {
  return { actorId: ACTOR, role, now: clock.nowIso() };
}

function newProvider(storage: KeyValueStorage = new MemoryKeyValueStorage(), delayMs = 0) {
  return new MockCrmDataProvider({ clock, delayMs, storage });
}

/** Mutations that throw for everything except the given `deleteNote`. */
function delMutations(deleteNote: CrmMutations["deleteNote"]): CrmMutations {
  const boom = (name: string) => () => {
    throw new Error(`this suite must not call ${name}`);
  };
  return {
    addNote: boom("addNote"),
    assignPrimaryOwner: boom("assignPrimaryOwner"),
    setNotePinned: boom("setNotePinned"),
    updateNoteBody: boom("updateNoteBody"),
    setNoteVisibility: boom("setNoteVisibility"),
    deleteNote,
  };
}

function renderNotes(opts: { provider: CrmDataProvider; mutations?: CrmMutations }) {
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

function note(overrides: Partial<CrmNote> = {}): CrmNote {
  return {
    id: "note_mock_0001",
    userId: USER,
    caseId: null,
    authorEmployeeId: ACTOR,
    body: "Тело заметки",
    visibility: "team",
    pinned: false,
    createdAt: clock.nowIso(),
    updatedAt: clock.nowIso(),
    mock: true,
    ...overrides,
  };
}

/** A provider that returns exactly the given view items, on every read. */
function viewProvider(items: CrmNoteListItem[]): CrmDataProvider {
  return {
    getUserNotesView: () =>
      Promise.resolve(
        ok({ items, page: { cursor: null, nextCursor: null, total: items.length, pageSize: 50 } }),
      ),
  } as unknown as CrmDataProvider;
}

const deletedAudit = (id = "note_mock_0001"): NoteDeletedAuditRecord => ({
  id: "audit_mock_0001",
  action: "note_deleted",
  actorEmployeeId: ACTOR,
  actorRole: "crm_admin",
  targetUserId: USER,
  entityType: "note",
  entityId: id,
  at: clock.nowIso(),
  reasonCode: "note_deleted_by_employee",
  mock: true,
});

const delOk = (id = "note_mock_0001"): Result<DeleteNoteResult> =>
  ok({ noteId: id, deletedAt: clock.nowIso(), audit: deletedAudit(id), replayed: false });

const cap = (over: Partial<CrmNoteListItem["capabilities"]> = {}) => ({
  canEditBody: false,
  canChangeVisibility: false,
  canDelete: true,
  ...over,
});

/* --------------------------------------------------------- control gating */

describe("UserNotes — delete control gating (provider-owned)", () => {
  it("renders the delete control only when canDelete is true", async () => {
    const provider = viewProvider([{ note: note(), capabilities: cap({ canDelete: true }) }]);
    renderNotes({ provider, mutations: delMutations(vi.fn()) });
    expect(await screen.findByRole("button", { name: NOTE_DELETE_LABEL.deleteAction })).toBeInTheDocument();
  });

  it("does not render the control when canDelete is false (fixture / foreign / forbidden)", async () => {
    const provider = viewProvider([
      { note: note({ id: FIXTURE_NOTE_ID, body: "Видна, но не удаляется" }), capabilities: cap({ canDelete: false }) },
    ]);
    renderNotes({ provider, mutations: delMutations(vi.fn()) });
    await screen.findByText("Видна, но не удаляется");
    expect(screen.queryByRole("button", { name: NOTE_DELETE_LABEL.deleteAction })).toBeNull();
  });

  it("decides purely from the capability — never from the note id", async () => {
    // A fixture-looking id with canDelete:true still gets the control; an authored-
    // looking id with canDelete:false does not. React reads the flag, not the id.
    const provider = viewProvider([
      { note: note({ id: `${USER}_note_1` }), capabilities: cap({ canDelete: true }) },
    ]);
    renderNotes({ provider, mutations: delMutations(vi.fn()) });
    expect(await screen.findByRole("button", { name: NOTE_DELETE_LABEL.deleteAction })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------- confirm UI */

describe("UserNotes — delete confirmation", () => {
  it("opens an inline confirm with the heading, body and both buttons; the note text stays visible", async () => {
    const user = userEvent.setup();
    const provider = viewProvider([{ note: note(), capabilities: cap() }]);
    renderNotes({ provider, mutations: delMutations(vi.fn()) });

    await user.click(await screen.findByRole("button", { name: NOTE_DELETE_LABEL.deleteAction }));

    expect(screen.getByText(NOTE_DELETE_LABEL.confirmTitle)).toBeInTheDocument();
    expect(screen.getByText(NOTE_DELETE_LABEL.confirmBody)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: NOTE_DELETE_LABEL.confirm })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: NOTE_DELETE_LABEL.cancel })).toBeInTheDocument();
    // The body is not hidden before it is removed.
    expect(screen.getByText("Тело заметки")).toBeInTheDocument();
    // No dialog is used — the confirm is a plain in-row group.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Cancel closes the confirm and returns focus to the delete control, without deleting", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(() => Promise.resolve(delOk()));
    const provider = viewProvider([{ note: note(), capabilities: cap() }]);
    renderNotes({ provider, mutations: delMutations(submit) });

    const control = await screen.findByRole("button", { name: NOTE_DELETE_LABEL.deleteAction });
    await user.click(control);
    await user.click(screen.getByRole("button", { name: NOTE_DELETE_LABEL.cancel }));

    expect(screen.queryByText(NOTE_DELETE_LABEL.confirmTitle)).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: NOTE_DELETE_LABEL.deleteAction })).toHaveFocus(),
    );
  });

  it("Escape closes the confirm without deleting", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(() => Promise.resolve(delOk()));
    const provider = viewProvider([{ note: note(), capabilities: cap() }]);
    renderNotes({ provider, mutations: delMutations(submit) });

    await user.click(await screen.findByRole("button", { name: NOTE_DELETE_LABEL.deleteAction }));
    await user.keyboard("{Escape}");

    expect(screen.queryByText(NOTE_DELETE_LABEL.confirmTitle)).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });
});

/* --------------------------------------------------------------- pending */

describe("UserNotes — delete pending", () => {
  it("announces Удаляем… with aria-busy and guards against a double submit", async () => {
    const user = userEvent.setup();
    let resolve!: (r: Result<DeleteNoteResult>) => void;
    const submit = vi.fn(() => new Promise<Result<DeleteNoteResult>>((r) => (resolve = r)));
    const provider = viewProvider([{ note: note(), capabilities: cap() }]);
    renderNotes({ provider, mutations: delMutations(submit) });

    await user.click(await screen.findByRole("button", { name: NOTE_DELETE_LABEL.deleteAction }));
    const confirm = screen.getByRole("button", { name: NOTE_DELETE_LABEL.confirm });
    await user.click(confirm);

    const pendingBtn = await screen.findByRole("button", { name: NOTE_DELETE_LABEL.pending });
    expect(pendingBtn).toHaveAttribute("aria-busy", "true");
    // A second click while pending must not call through again.
    await user.click(pendingBtn);
    expect(submit).toHaveBeenCalledTimes(1);

    resolve(delOk());
  });
});

/* --------------------------------------------------------------- success */

describe("UserNotes — delete success (end to end via the real provider)", () => {
  it("removes the row, shrinks the count, and shows the calm section success", async () => {
    const user = userEvent.setup();
    const provider = newProvider();
    const add = await (provider as unknown as CrmMutations).addNote(ctx(), {
      userId: USER,
      body: "Удаляемая заметка",
      idempotencyKey: "seed",
    });
    expect(add.status).toBe("ok");

    renderNotes({ provider });
    await screen.findByText("Удаляемая заметка");

    await user.click(screen.getByRole("button", { name: NOTE_DELETE_LABEL.deleteAction }));
    await user.click(screen.getByRole("button", { name: NOTE_DELETE_LABEL.confirm }));

    // The row disappears after the canonical refetch.
    await waitFor(() => expect(screen.queryByText("Удаляемая заметка")).toBeNull());
    // The calm section success line appears (role=status).
    expect(await screen.findByText(NOTE_DELETE_LABEL.success)).toBeInTheDocument();
  });

  it("moves focus to the composer after the row vanishes", async () => {
    const user = userEvent.setup();
    const provider = newProvider();
    await (provider as unknown as CrmMutations).addNote(ctx(), {
      userId: USER,
      body: "Удаляемая заметка",
      idempotencyKey: "seed",
    });
    renderNotes({ provider });
    await screen.findByText("Удаляемая заметка");

    await user.click(screen.getByRole("button", { name: NOTE_DELETE_LABEL.deleteAction }));
    await user.click(screen.getByRole("button", { name: NOTE_DELETE_LABEL.confirm }));

    await waitFor(() => expect(screen.queryByText("Удаляемая заметка")).toBeNull());
    // The composer textarea (the natural next place to act) receives focus.
    const composer = screen.getByLabelText("Текст заметки");
    await waitFor(() => expect(composer).toHaveFocus());
  });
});

/* ------------------------------------------------------ conflict / storage */

describe("UserNotes — delete conflict & storage failure", () => {
  it("on conflict, closes the confirm and re-reads (no raw error text)", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(() =>
      Promise.resolve(fail<DeleteNoteResult>({ code: "conflict", message: "Note changed since it was read.", retriable: false })),
    );
    const provider = viewProvider([{ note: note(), capabilities: cap() }]);
    renderNotes({ provider, mutations: delMutations(submit) });

    await user.click(await screen.findByRole("button", { name: NOTE_DELETE_LABEL.deleteAction }));
    await user.click(screen.getByRole("button", { name: NOTE_DELETE_LABEL.confirm }));

    // Confirm closes; the row is shown again (re-read). The developer diagnostic is
    // never rendered.
    await waitFor(() => expect(screen.queryByText(NOTE_DELETE_LABEL.confirmTitle)).toBeNull());
    expect(screen.queryByText(/Note changed since it was read/)).toBeNull();
  });

  it("on a storage failure, keeps the confirm open, shows a safe error, and retries under the SAME key", async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    let call = 0;
    const submit = vi.fn((_ctx: CrmContext, command: { idempotencyKey: string }) => {
      keys.push(command.idempotencyKey);
      call += 1;
      return Promise.resolve(
        call === 1
          ? fail<DeleteNoteResult>({ code: "internal", message: "Mock overlay could not be persisted.", retriable: true })
          : delOk(),
      );
    });
    const provider = viewProvider([{ note: note(), capabilities: cap() }]);
    renderNotes({ provider, mutations: delMutations(submit as unknown as CrmMutations["deleteNote"]) });

    await user.click(await screen.findByRole("button", { name: NOTE_DELETE_LABEL.deleteAction }));
    await user.click(screen.getByRole("button", { name: NOTE_DELETE_LABEL.confirm }));

    // The confirm stays open with a safe Russian error; the raw diagnostic is absent.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(NOTE_DELETE_LABEL.confirmTitle)).toBeInTheDocument();
    expect(screen.queryByText(/Mock overlay could not be persisted/)).toBeNull();

    // Retry — same key (nothing was written the first time).
    await user.click(screen.getByRole("button", { name: NOTE_DELETE_LABEL.confirm }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(keys[0]).toBe(keys[1]);
  });
});

/* ------------------------------------------------- single active mode / roles */

describe("UserNotes — one active surface per row & role change", () => {
  it("hides the other controls while the delete confirm is open (no simultaneous editors)", async () => {
    const user = userEvent.setup();
    const provider = viewProvider([
      { note: note(), capabilities: cap({ canChangeVisibility: true, canDelete: true }) },
    ]);
    renderNotes({ provider, mutations: delMutations(vi.fn()) });

    await user.click(await screen.findByRole("button", { name: NOTE_DELETE_LABEL.deleteAction }));
    // While the delete confirm is open, the visibility control is not rendered.
    expect(screen.queryByRole("button", { name: NOTE_VISIBILITY_EDIT_LABEL.editAction })).toBeNull();
  });

  it("hides the delete control while the visibility editor is open", async () => {
    const user = userEvent.setup();
    const provider = viewProvider([
      { note: note(), capabilities: cap({ canChangeVisibility: true, canDelete: true }) },
    ]);
    renderNotes({ provider, mutations: delMutations(vi.fn()) });

    await user.click(await screen.findByRole("button", { name: NOTE_VISIBILITY_EDIT_LABEL.editAction }));
    expect(screen.queryByRole("button", { name: NOTE_DELETE_LABEL.deleteAction })).toBeNull();
  });

  it("closes an open confirm when the session role changes", async () => {
    const user = userEvent.setup();
    const provider = viewProvider([{ note: note(), capabilities: cap() }]);
    const { rerender } = renderNotes({ provider, mutations: delMutations(vi.fn()) });

    await user.click(await screen.findByRole("button", { name: NOTE_DELETE_LABEL.deleteAction }));
    expect(screen.getByText(NOTE_DELETE_LABEL.confirmTitle)).toBeInTheDocument();

    // A role switch must discard the open confirm.
    currentRole = "support";
    rerender(
      <TooltipProvider>
        <UserNotes
          userId={USER}
          providerOverride={provider}
          mutationsOverride={delMutations(vi.fn())}
        />
      </TooltipProvider>,
    );
    await waitFor(() => expect(screen.queryByText(NOTE_DELETE_LABEL.confirmTitle)).toBeNull());
    currentRole = "crm_admin";
  });
});
