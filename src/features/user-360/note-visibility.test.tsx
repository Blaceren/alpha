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
import type { CrmMutations, SetNoteVisibilityResult } from "@/data/contracts/CrmMutations";
import { fail, ok, type Result } from "@/data/contracts/result";
import { mockSessionForRole } from "@/domain/identity/session";
import type { CrmRole } from "@/domain/identity/roles";
import {
  NOTE_EDIT_LABEL,
  NOTE_PIN_LABEL,
  NOTE_VISIBILITY_EDIT_LABEL,
  NOTE_VISIBILITY_LABEL,
} from "@/config/labels";
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

function newProvider(storage: KeyValueStorage = new MemoryKeyValueStorage(), delayMs = 0) {
  return new MockCrmDataProvider({ clock, delayMs, storage });
}

/** Mutations that throw for everything except the given `setNoteVisibility`. */
function visMutations(setNoteVisibility: CrmMutations["setNoteVisibility"]): CrmMutations {
  return {
    addNote: () => {
      throw new Error("this suite must not call addNote");
    },
    assignPrimaryOwner: () => {
      throw new Error("this suite must not call assignPrimaryOwner");
    },
    setNotePinned: () => {
      throw new Error("this suite must not call setNotePinned");
    },
    updateNoteBody: () => {
      throw new Error("this suite must not call updateNoteBody");
    },
    deleteNote: () => {
      throw new Error("this suite must not call deleteNote");
    },
    setNoteVisibility,
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

/** A provider that returns exactly the given view items and nothing else. */
function viewProvider(items: CrmNoteListItem[]): CrmDataProvider {
  return {
    getUserNotesView: () =>
      Promise.resolve(
        ok({ items, page: { cursor: null, nextCursor: null, total: items.length, pageSize: 50 } }),
      ),
  } as unknown as CrmDataProvider;
}

const visOk = (
  updatedAt = clock.nowIso(),
  next: "team" | "private" = "private",
  replayed = false,
): Result<SetNoteVisibilityResult> =>
  ok({
    noteId: "note_mock_0001",
    updatedAt,
    audit: {
      id: "audit_mock_0001",
      action: "note_visibility_changed",
      actorEmployeeId: ACTOR,
      actorRole: "crm_admin",
      targetUserId: USER,
      entityType: "note",
      entityId: "note_mock_0001",
      at: updatedAt,
      reasonCode: "note_visibility_changed_by_employee",
      previousVisibility: "team",
      nextVisibility: next,
      mock: true,
    },
    replayed,
  });

const visButton = () => screen.getByRole("button", { name: NOTE_VISIBILITY_EDIT_LABEL.editAction });
const findVisButton = () => screen.findByRole("button", { name: NOTE_VISIBILITY_EDIT_LABEL.editAction });
const visSelect = () => screen.getByLabelText(NOTE_VISIBILITY_EDIT_LABEL.fieldLabel) as HTMLSelectElement;
const visSave = () =>
  screen.getByRole("button", {
    name: new RegExp(`${NOTE_VISIBILITY_EDIT_LABEL.save}|${NOTE_VISIBILITY_EDIT_LABEL.pending}`),
  });
const visCancel = () => screen.getByRole("button", { name: NOTE_VISIBILITY_EDIT_LABEL.cancel });

async function seedAuthoredNote(provider: MockCrmDataProvider, body = "Первоначальный текст"): Promise<string> {
  const ctx: CrmContext = { actorId: ACTOR, role: "crm_admin", now: clock.nowIso() };
  const res = await provider.addNote(ctx, { userId: USER, body, idempotencyKey: "seed" });
  return res.data!.note.id;
}

/* ------------------------------------------- provider-owned capability */

describe("note visibility — capability is provider-owned", () => {
  it("renders the control only when canChangeVisibility is true", async () => {
    const items: CrmNoteListItem[] = [
      { note: note(), capabilities: { canEditBody: true, canChangeVisibility: true, canDelete: true } },
    ];
    renderNotes({ provider: viewProvider(items) });
    expect(await findVisButton()).toBeInTheDocument();
  });

  it("does not render the control when canChangeVisibility is false", async () => {
    const items: CrmNoteListItem[] = [
      { note: note({ body: "Видна, но не редактируется" }), capabilities: { canEditBody: false, canChangeVisibility: false, canDelete: false } },
    ];
    renderNotes({ provider: viewProvider(items) });
    await screen.findByText("Видна, но не редактируется");
    expect(screen.queryByRole("button", { name: NOTE_VISIBILITY_EDIT_LABEL.editAction })).not.toBeInTheDocument();
  });

  it("real provider: the fixture note gets no visibility control; an authored one does", async () => {
    currentRole = "crm_admin";
    const provider = newProvider();
    await seedAuthoredNote(provider);
    renderNotes({ provider });

    await screen.findByText("Первоначальный текст");
    // Exactly one visibility control — the authored note, never the fixture note.
    expect(screen.getAllByRole("button", { name: NOTE_VISIBILITY_EDIT_LABEL.editAction })).toHaveLength(1);
    expect(screen.getByText(/Синтетическая заметка/)).toBeInTheDocument();
  });

  it("React never inspects a note id — the capability decides", async () => {
    // A note whose id LOOKS like a fixture note but is marked changeable is still
    // changeable; the component reads the flag, not the id shape.
    const items: CrmNoteListItem[] = [
      { note: note({ id: `${USER}_note_1` }), capabilities: { canEditBody: true, canChangeVisibility: true, canDelete: true } },
    ];
    renderNotes({ provider: viewProvider(items) });
    expect(await findVisButton()).toBeInTheDocument();
  });
});

/* ------------------------------------------- inline editor */

describe("note visibility — inline editor", () => {
  it("opens a native select with team/private options and Save disabled while unchanged", async () => {
    const items: CrmNoteListItem[] = [
      { note: note({ visibility: "team" }), capabilities: { canEditBody: true, canChangeVisibility: true, canDelete: true } },
    ];
    renderNotes({ provider: viewProvider(items) });

    await userEvent.click(await findVisButton());
    const select = visSelect();
    expect(select.value).toBe("team");
    expect(select).toHaveDisplayValue(NOTE_VISIBILITY_EDIT_LABEL.optionTeam);
    // Unchanged → Save disabled (no round-trip).
    expect(visSave()).toBeDisabled();

    await userEvent.selectOptions(select, "private");
    expect(visSave()).toBeEnabled();
  });

  it("does not auto-submit on selection — only an explicit Save writes", async () => {
    const submit = vi.fn(() => Promise.resolve(visOk()));
    const items: CrmNoteListItem[] = [
      { note: note(), capabilities: { canEditBody: true, canChangeVisibility: true, canDelete: true } },
    ];
    renderNotes({ provider: viewProvider(items), mutations: visMutations(submit) });

    await userEvent.click(await findVisButton());
    await userEvent.selectOptions(visSelect(), "private");
    expect(submit).not.toHaveBeenCalled();
    await userEvent.click(visSave());
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("hides the body-edit and pin controls of the row while the visibility editor is open", async () => {
    const items: CrmNoteListItem[] = [
      { note: note(), capabilities: { canEditBody: true, canChangeVisibility: true, canDelete: true } },
    ];
    renderNotes({ provider: viewProvider(items) });

    await userEvent.click(await findVisButton());
    // One editor per row: the other controls are gone, so a second editor can never
    // be opened over an open one and a draft is never silently discarded.
    expect(screen.queryByRole("button", { name: NOTE_EDIT_LABEL.editAction })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: NOTE_PIN_LABEL.pinAction })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: NOTE_VISIBILITY_EDIT_LABEL.editAction })).not.toBeInTheDocument();
  });

  it("Escape cancels the editor without saving and restores the control", async () => {
    const submit = vi.fn(() => Promise.resolve(visOk()));
    const items: CrmNoteListItem[] = [
      { note: note(), capabilities: { canEditBody: true, canChangeVisibility: true, canDelete: true } },
    ];
    renderNotes({ provider: viewProvider(items), mutations: visMutations(submit) });

    await userEvent.click(await findVisButton());
    await userEvent.selectOptions(visSelect(), "private");
    await userEvent.keyboard("{Escape}");

    expect(submit).not.toHaveBeenCalled();
    await waitFor(() => expect(visButton()).toHaveFocus());
  });

  it("Cancel closes the editor and returns focus to the control", async () => {
    const items: CrmNoteListItem[] = [
      { note: note(), capabilities: { canEditBody: true, canChangeVisibility: true, canDelete: true } },
    ];
    renderNotes({ provider: viewProvider(items) });

    await userEvent.click(await findVisButton());
    await userEvent.click(visCancel());
    await waitFor(() => expect(visButton()).toHaveFocus());
  });
});

/* ------------------------------------------- states */

describe("note visibility — states", () => {
  it("announces pending in words, then a calm success line", async () => {
    let resolve!: (r: Result<SetNoteVisibilityResult>) => void;
    const submit = vi.fn(() => new Promise<Result<SetNoteVisibilityResult>>((r) => (resolve = r)));
    const provider = viewProvider([
      { note: note(), capabilities: { canEditBody: true, canChangeVisibility: true, canDelete: true } },
    ]);
    renderNotes({ provider, mutations: visMutations(submit) });

    await userEvent.click(await findVisButton());
    await userEvent.selectOptions(visSelect(), "private");
    await userEvent.click(visSave());

    // Pending is announced in words and aria-busy, never colour-only.
    const pendingBtn = screen.getByRole("button", { name: NOTE_VISIBILITY_EDIT_LABEL.pending });
    expect(pendingBtn).toHaveAttribute("aria-busy", "true");

    resolve(visOk());
    expect(await screen.findByText(NOTE_VISIBILITY_EDIT_LABEL.success)).toBeInTheDocument();
  });

  it("on conflict, closes the editor and re-reads (shows what is stored)", async () => {
    const submit = vi.fn(() =>
      Promise.resolve(fail<SetNoteVisibilityResult>({ code: "conflict", message: "x", retriable: false })),
    );
    const provider = viewProvider([
      { note: note(), capabilities: { canEditBody: true, canChangeVisibility: true, canDelete: true } },
    ]);
    renderNotes({ provider, mutations: visMutations(submit) });

    await userEvent.click(await findVisButton());
    await userEvent.selectOptions(visSelect(), "private");
    await userEvent.click(visSave());

    // The editor closes (re-read) and the conflict copy is shown on the row.
    await waitFor(() =>
      expect(screen.queryByLabelText(NOTE_VISIBILITY_EDIT_LABEL.fieldLabel)).not.toBeInTheDocument(),
    );
    expect(screen.getByText(NOTE_VISIBILITY_EDIT_LABEL.conflict)).toBeInTheDocument();
  });

  it("on a storage failure keeps the editor open with the draft for a retry", async () => {
    const submit = vi.fn(() =>
      Promise.resolve(fail<SetNoteVisibilityResult>({ code: "internal", message: "x", retriable: true })),
    );
    const provider = viewProvider([
      { note: note(), capabilities: { canEditBody: true, canChangeVisibility: true, canDelete: true } },
    ]);
    renderNotes({ provider, mutations: visMutations(submit) });

    await userEvent.click(await findVisButton());
    await userEvent.selectOptions(visSelect(), "private");
    await userEvent.click(visSave());

    // Editor stays open, the draft (private) is preserved, and a safe error shows.
    expect(await screen.findByText("Локальное сохранение недоступно. Попробуйте ещё раз")).toBeInTheDocument();
    expect(visSelect().value).toBe("private");
  });

  it("never renders a raw CrmError.message", async () => {
    const submit = vi.fn(() =>
      Promise.resolve(
        fail<SetNoteVisibilityResult>({ code: "internal", message: "Mock overlay could not be persisted.", retriable: true }),
      ),
    );
    const provider = viewProvider([
      { note: note(), capabilities: { canEditBody: true, canChangeVisibility: true, canDelete: true } },
    ]);
    const { container } = renderNotes({ provider, mutations: visMutations(submit) });

    await userEvent.click(await findVisButton());
    await userEvent.selectOptions(visSelect(), "private");
    await userEvent.click(visSave());
    await screen.findByText("Локальное сохранение недоступно. Попробуйте ещё раз");
    expect(container.innerHTML).not.toContain("Mock overlay could not be persisted");
  });
});

/* ------------------------------------------- badge + role change */

describe("note visibility — badge and role change", () => {
  it("shows a calm «Приватная заметка» badge for a private note", async () => {
    const items: CrmNoteListItem[] = [
      { note: note({ visibility: "private" }), capabilities: { canEditBody: true, canChangeVisibility: true, canDelete: true } },
    ];
    renderNotes({ provider: viewProvider(items) });
    expect(await screen.findByText(NOTE_VISIBILITY_LABEL.private)).toBeInTheDocument();
    expect(NOTE_VISIBILITY_LABEL.private).toBe("Приватная заметка");
  });

  it("closes the editor and drops the control when the role loses edit rights", async () => {
    currentRole = "crm_admin";
    const provider = newProvider();
    await seedAuthoredNote(provider);
    const { rerender } = renderNotes({ provider });

    await userEvent.click(await findVisButton());
    expect(visSelect()).toBeInTheDocument();

    // Same actorId (emp_mock_admin), a DIFFERENT role without edit rights.
    currentRole = "read_only";
    rerender(
      <TooltipProvider>
        <UserNotes userId={USER} providerOverride={provider} mutationsOverride={provider as unknown as CrmMutations} />
      </TooltipProvider>,
    );

    // The editor is gone and no control is offered — but the note stays readable.
    await waitFor(() =>
      expect(screen.queryByLabelText(NOTE_VISIBILITY_EDIT_LABEL.fieldLabel)).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: NOTE_VISIBILITY_EDIT_LABEL.editAction })).not.toBeInTheDocument();
    expect(screen.getByText("Первоначальный текст")).toBeInTheDocument();
  });
});
