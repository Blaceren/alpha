import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import { MemoryKeyValueStorage, type KeyValueStorage } from "@/data/mock/overlay/storage";
import { MUTATION_OVERLAY_STORAGE_KEY } from "@/data/mock/overlay/mutation-overlay";
import type {
  CrmContext,
  CrmDataProvider,
  CrmNote,
  CrmNoteListItem,
} from "@/data/contracts/CrmDataProvider";
import type { CrmMutations, UpdateNoteBodyResult } from "@/data/contracts/CrmMutations";
import { fail, ok, type Result } from "@/data/contracts/result";
import { mockSessionForRole } from "@/domain/identity/session";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { NOTE_EDIT_LABEL, NOTES_LABEL } from "@/config/labels";
import { NOTE_EDIT_ERROR_MESSAGE } from "./lib/note-edit-error";
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
const ACTOR = "emp_mock_admin"; // every mock role shares this id
const clock = new FixedMockClock();
const EDIT_ROLES: CrmRole[] = ["crm_admin", "crm_manager", "retention_manager", "support"];
const DENIED_ROLES: CrmRole[] = CRM_ROLES.filter((r) => !EDIT_ROLES.includes(r));

function newProvider(storage: KeyValueStorage = new MemoryKeyValueStorage(), delayMs = 0) {
  return new MockCrmDataProvider({ clock, delayMs, storage });
}

/** Mutations that throw for everything except the given `updateNoteBody`. */
function editMutations(updateNoteBody: CrmMutations["updateNoteBody"]): CrmMutations {
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
    updateNoteBody,
    setNoteVisibility: () => {
      throw new Error("this suite must not call setNoteVisibility");
    },
    deleteNote: () => {
      throw new Error("this suite must not call deleteNote");
    },
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

const editOk = (updatedAt = clock.nowIso(), replayed = false): Result<UpdateNoteBodyResult> =>
  ok({
    noteId: "note_mock_0001",
    updatedAt,
    audit: {
      id: "audit_mock_0001",
      action: "note_body_changed",
      actorEmployeeId: ACTOR,
      actorRole: "crm_admin",
      targetUserId: USER,
      entityType: "note",
      entityId: "note_mock_0001",
      at: updatedAt,
      reasonCode: "note_body_changed_by_employee",
      mock: true,
    },
    replayed,
  });

const editButton = () => screen.getByRole("button", { name: NOTE_EDIT_LABEL.editAction });
const saveButton = () => screen.getByRole("button", { name: new RegExp(`${NOTE_EDIT_LABEL.save}|${NOTE_EDIT_LABEL.pending}`) });
const cancelButton = () => screen.getByRole("button", { name: NOTE_EDIT_LABEL.cancel });
const editTextarea = () => screen.getByLabelText(NOTE_EDIT_LABEL.editLabel) as HTMLTextAreaElement;

/** Seed an authored note (author = ACTOR) so the real provider marks it editable. */
async function seedAuthoredNote(provider: MockCrmDataProvider, body = "Первоначальный текст"): Promise<string> {
  const ctx: CrmContext = { actorId: ACTOR, role: "crm_admin", now: clock.nowIso() };
  const res = await provider.addNote(ctx, { userId: USER, body, idempotencyKey: "seed" });
  return res.data!.note.id;
}

/* ------------------------------------------- provider-owned capability */

describe("note body edit — capability is provider-owned", () => {
  it("shows the edit control from the canEditBody FLAG, not from the note id shape", async () => {
    // A fixture-SHAPED id flagged editable, and an authored-SHAPED id flagged not.
    // If React parsed ids it would get both backwards; it must trust the provider.
    renderNotes({
      provider: viewProvider([
        { note: note({ id: FIXTURE_NOTE_ID, body: "Похоже на фикстуру" }), capabilities: { canEditBody: true, canChangeVisibility: true, canDelete: true } },
        { note: note({ id: "note_mock_0001", body: "Похоже на авторскую" }), capabilities: { canEditBody: false, canChangeVisibility: false, canDelete: false } },
      ]),
    });
    await screen.findByText("Похоже на фикстуру");

    // Exactly one edit control — on the flagged-editable row.
    const controls = screen.getAllByRole("button", { name: NOTE_EDIT_LABEL.editAction });
    expect(controls).toHaveLength(1);
    const editableRow = screen.getByText("Похоже на фикстуру").closest("li")!;
    expect(within(editableRow).getByRole("button", { name: NOTE_EDIT_LABEL.editAction })).toBeInTheDocument();
    const nonEditableRow = screen.getByText("Похоже на авторскую").closest("li")!;
    expect(within(nonEditableRow).queryByRole("button", { name: NOTE_EDIT_LABEL.editAction })).toBeNull();
  });

  it("shows no edit control on the real fixture note, only on the authored one", async () => {
    const provider = newProvider();
    const id = await seedAuthoredNote(provider);
    renderNotes({ provider });
    await screen.findByText("Первоначальный текст");

    const authoredRow = screen.getByText("Первоначальный текст").closest("li")!;
    expect(within(authoredRow).getByRole("button", { name: NOTE_EDIT_LABEL.editAction })).toBeInTheDocument();

    const fixtureRow = screen.getByText(/Синтетическая заметка/).closest("li")!;
    expect(within(fixtureRow).queryByRole("button", { name: NOTE_EDIT_LABEL.editAction })).toBeNull();
    expect(id).toBe("note_mock_0001");
  });

  it.each(DENIED_ROLES)("%s sees no edit control at all", async (role) => {
    currentRole = role;
    const provider = newProvider();
    await seedAuthoredNote(provider);
    renderNotes({ provider });
    await screen.findByText(/Синтетическая заметка/);
    expect(screen.queryByRole("button", { name: NOTE_EDIT_LABEL.editAction })).toBeNull();
    currentRole = "crm_admin";
  });

  it("shows no edit control on a note authored by someone else", async () => {
    renderNotes({
      provider: viewProvider([
        { note: note({ authorEmployeeId: "emp_someone_else", body: "Чужая заметка" }), capabilities: { canEditBody: false, canChangeVisibility: false, canDelete: false } },
      ]),
    });
    await screen.findByText("Чужая заметка");
    expect(screen.queryByRole("button", { name: NOTE_EDIT_LABEL.editAction })).toBeNull();
  });
});

/* ------------------------------------------------------ editing state */

describe("note body edit — entering and leaving edit mode", () => {
  it("opens an inline editor prefilled with the body, hiding the pin control for that row", async () => {
    const provider = newProvider();
    await seedAuthoredNote(provider, "Черновик для правки");
    renderNotes({ provider });
    await screen.findByText("Черновик для правки");

    // The pin control is present before editing.
    const row = screen.getByText("Черновик для правки").closest("li")!;
    expect(within(row).getByRole("button", { name: /Закрепить заметку/ })).toBeInTheDocument();

    await userEvent.click(editButton());

    expect(editTextarea().value).toBe("Черновик для правки");
    expect(saveButton()).toBeInTheDocument();
    expect(cancelButton()).toBeInTheDocument();
    // Pin control hidden while editing.
    expect(within(row).queryByRole("button", { name: /Закрепить заметку/ })).toBeNull();
  });

  it("disables Save until the normalized body actually changes", async () => {
    const provider = newProvider();
    await seedAuthoredNote(provider, "Без изменений");
    renderNotes({ provider });
    await screen.findByText("Без изменений");
    await userEvent.click(editButton());

    // Prefilled with the current body → unchanged → Save disabled.
    expect(saveButton()).toBeDisabled();

    // Same text with extra whitespace still normalizes to the same body.
    fireEvent.change(editTextarea(), { target: { value: "  Без изменений  " } });
    expect(saveButton()).toBeDisabled();

    // A real change enables it.
    fireEvent.change(editTextarea(), { target: { value: "Теперь иначе" } });
    expect(saveButton()).toBeEnabled();

    // Emptying it disables again.
    fireEvent.change(editTextarea(), { target: { value: "   " } });
    expect(saveButton()).toBeDisabled();
  });

  it("cancel discards the draft and restores focus to the edit control", async () => {
    const provider = newProvider();
    await seedAuthoredNote(provider, "Оригинал");
    renderNotes({ provider });
    await screen.findByText("Оригинал");
    await userEvent.click(editButton());

    fireEvent.change(editTextarea(), { target: { value: "Выброшенный черновик" } });
    await userEvent.click(cancelButton());

    // Editor gone, original body still shown, focus back on the control.
    expect(screen.queryByLabelText(NOTE_EDIT_LABEL.editLabel)).toBeNull();
    expect(screen.getByText("Оригинал")).toBeInTheDocument();
    await waitFor(() => expect(editButton()).toHaveFocus());
  });

  it("Escape cancels editing and restores focus", async () => {
    const provider = newProvider();
    await seedAuthoredNote(provider, "Текст");
    renderNotes({ provider });
    await screen.findByText("Текст");
    await userEvent.click(editButton());

    fireEvent.change(editTextarea(), { target: { value: "изменение" } });
    fireEvent.keyDown(editTextarea(), { key: "Escape" });

    expect(screen.queryByLabelText(NOTE_EDIT_LABEL.editLabel)).toBeNull();
    await waitFor(() => expect(editButton()).toHaveFocus());
  });
});

/* ------------------------------------------------------ submit outcomes */

describe("note body edit — submit outcomes", () => {
  it("on success: re-reads, confirms calmly, closes the editor and restores focus", async () => {
    const provider = newProvider();
    await seedAuthoredNote(provider, "Старый текст");
    renderNotes({ provider }); // real provider drives the edit end to end
    await screen.findByText("Старый текст");
    await userEvent.click(editButton());

    fireEvent.change(editTextarea(), { target: { value: "Новый текст" } });
    await userEvent.click(saveButton());

    // The new body is present because the provider was re-read.
    expect(await screen.findByText("Новый текст")).toBeInTheDocument();
    expect(screen.queryByLabelText(NOTE_EDIT_LABEL.editLabel)).toBeNull();
    expect(screen.getByText(NOTE_EDIT_LABEL.success)).toBeInTheDocument();
    await waitFor(() => expect(editButton()).toHaveFocus());
  });

  it("states pending in words and keeps the draft while the write is in flight", async () => {
    const provider = newProvider();
    await seedAuthoredNote(provider, "До");
    let release: (v: Result<UpdateNoteBodyResult>) => void = () => {};
    const updateNoteBody = vi.fn(() => new Promise<Result<UpdateNoteBodyResult>>((r) => (release = r)));
    renderNotes({ provider, mutations: editMutations(updateNoteBody) });
    await screen.findByText("До");
    await userEvent.click(editButton());

    fireEvent.change(editTextarea(), { target: { value: "После" } });
    await userEvent.click(saveButton());

    const btn = saveButton();
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(NOTE_EDIT_LABEL.pending);
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(editTextarea().value).toBe("После");

    release(editOk());
    await waitFor(() => expect(screen.queryByLabelText(NOTE_EDIT_LABEL.editLabel)).toBeNull());
  });

  it("a conflict re-reads, closes the editor and shows the actual-state message", async () => {
    const provider = newProvider();
    await seedAuthoredNote(provider, "Текст");
    const getSpy = vi.spyOn(provider, "getUserNotesView");
    const updateNoteBody = vi.fn(async () =>
      fail<UpdateNoteBodyResult>({ code: "conflict", message: "raced", retriable: false }),
    );
    renderNotes({ provider, mutations: editMutations(updateNoteBody) });
    await screen.findByText("Текст");
    const before = getSpy.mock.calls.length;
    await userEvent.click(editButton());

    fireEvent.change(editTextarea(), { target: { value: "Моя версия" } });
    await userEvent.click(saveButton());

    expect(await screen.findByText(NOTE_EDIT_LABEL.conflict)).toBeInTheDocument();
    // Editor closed and the list re-read.
    expect(screen.queryByLabelText(NOTE_EDIT_LABEL.editLabel)).toBeNull();
    await waitFor(() => expect(getSpy.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(editButton()).toHaveFocus());
  });

  it("a storage failure keeps the draft open for a retry under the same key", async () => {
    const provider = newProvider();
    await seedAuthoredNote(provider, "Текст");
    const keys: string[] = [];
    const updateNoteBody = vi.fn(async (_ctx: CrmContext, cmd: { idempotencyKey: string }) => {
      keys.push(cmd.idempotencyKey);
      return fail<UpdateNoteBodyResult>({ code: "internal", message: "Mock overlay could not be persisted.", retriable: true });
    });
    renderNotes({ provider, mutations: editMutations(updateNoteBody) });
    await screen.findByText("Текст");
    await userEvent.click(editButton());

    fireEvent.change(editTextarea(), { target: { value: "Не сохранится" } });
    await userEvent.click(saveButton());

    // The editor stays open with the draft intact and shows the safe message.
    expect(await screen.findByRole("alert")).toHaveTextContent(NOTE_EDIT_ERROR_MESSAGE.internal);
    expect(editTextarea().value).toBe("Не сохранится");

    // Retry reuses the SAME idempotency key — nothing was written.
    await userEvent.click(saveButton());
    await waitFor(() => expect(updateNoteBody).toHaveBeenCalledTimes(2));
    expect(keys[1]).toBe(keys[0]);
    // The diagnostic never reaches the DOM.
    expect(document.body.innerHTML).not.toContain("Mock overlay could not be persisted");
  });

  it("does not optimistically replace the body — it comes from the re-read", async () => {
    // The provider keeps returning the OLD body; a successful edit must not make the
    // screen show the typed text on its own.
    const getUserNotesView = vi.fn().mockResolvedValue(
      ok({
        items: [{ note: note({ body: "Всегда старое" }), capabilities: { canEditBody: true, canChangeVisibility: true, canDelete: true } }],
        page: { cursor: null, nextCursor: null, total: 1, pageSize: 50 },
      }),
    );
    const updateNoteBody = vi.fn().mockResolvedValue(editOk());
    renderNotes({
      provider: { getUserNotesView } as unknown as CrmDataProvider,
      mutations: editMutations(updateNoteBody),
    });
    await screen.findByText("Всегда старое");
    await userEvent.click(editButton());

    fireEvent.change(editTextarea(), { target: { value: "Оптимистичный текст" } });
    await userEvent.click(saveButton());

    await waitFor(() => expect(getUserNotesView).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Всегда старое")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("Оптимистичный текст");
  });
});

/* ---------------------------------------------------------- role change */

describe("note body edit — role change discards the draft", () => {
  it("closes the editor and drops the draft when the session identity changes", async () => {
    currentRole = "crm_admin";
    const provider = newProvider();
    await seedAuthoredNote(provider, "Под админом");
    const { rerender } = renderNotes({ provider });
    await screen.findByText("Под админом");
    await userEvent.click(editButton());
    fireEvent.change(editTextarea(), { target: { value: "Незаконченная правка" } });

    currentRole = "crm_manager";
    rerender(
      <TooltipProvider>
        <UserNotes userId={USER} providerOverride={provider} mutationsOverride={provider as unknown as CrmMutations} />
      </TooltipProvider>,
    );

    // The editor is gone; the draft was discarded (its text is nowhere).
    await waitFor(() => expect(screen.queryByLabelText(NOTE_EDIT_LABEL.editLabel)).toBeNull());
    expect(document.body.innerHTML).not.toContain("Незаконченная правка");
    currentRole = "crm_admin";
  });
});

/* ----------------------------------------------------------- error safety */

describe("note body edit — error mapping is safe", () => {
  const CODES = Object.keys(NOTE_EDIT_ERROR_MESSAGE) as (keyof typeof NOTE_EDIT_ERROR_MESSAGE)[];

  it("maps every CrmErrorCode and never reads like an English diagnostic", () => {
    expect(CODES.sort()).toEqual(
      ["conflict", "internal", "invalid_input", "not_found", "rate_limited", "stale_data", "unauthorized", "upstream_unavailable"].sort(),
    );
    for (const text of Object.values(NOTE_EDIT_ERROR_MESSAGE)) {
      expect(text).not.toMatch(/[a-z]{4,}\s[a-z]{4,}/i);
    }
  });

  it("never leaks a raw diagnostic, the overlay key, or the typed body on failure", async () => {
    const provider = newProvider();
    await seedAuthoredNote(provider, "Текст");
    const diagnostic = `Raw diagnostic: overlay ${MUTATION_OVERLAY_STORAGE_KEY} exploded.`;
    const updateNoteBody = vi.fn().mockResolvedValue(fail({ code: "internal", message: diagnostic, retriable: true }));
    renderNotes({ provider, mutations: editMutations(updateNoteBody) });
    await screen.findByText("Текст");
    await userEvent.click(editButton());

    fireEvent.change(editTextarea(), { target: { value: "СЕКРЕТ-В-ЧЕРНОВИКЕ" } });
    await userEvent.click(saveButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(NOTE_EDIT_ERROR_MESSAGE.internal);
    expect(document.body.innerHTML).not.toContain(diagnostic);
    expect(document.body.innerHTML).not.toContain(MUTATION_OVERLAY_STORAGE_KEY);
    // The alert never quotes the draft back at the user.
    expect(alert.textContent).not.toContain("СЕКРЕТ-В-ЧЕРНОВИКЕ");
  });
});

/* -------------------------------------------------------------- a11y */

describe("note body edit — accessibility", () => {
  it("associates a visible label and a live character count with the textarea", async () => {
    const provider = newProvider();
    await seedAuthoredNote(provider, "Текст");
    renderNotes({ provider });
    await screen.findByText("Текст");
    await userEvent.click(editButton());

    const ta = editTextarea();
    // Labelled control (getByLabelText above already proves association).
    expect(ta).toHaveAttribute("aria-describedby");
    const describedby = ta.getAttribute("aria-describedby")!.split(" ")[0]!;
    const counter = document.getElementById(describedby)!;
    expect(counter.textContent).toMatch(/\d+ \/ 2000/);

    fireEvent.change(ta, { target: { value: "abc" } });
    expect(counter.textContent).toContain("3 / 2000");
  });

  it("the edit control is a real button with the full instruction as its name", async () => {
    const provider = newProvider();
    await seedAuthoredNote(provider, "Текст");
    renderNotes({ provider });
    await screen.findByText("Текст");
    const btn = editButton();
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).toHaveAccessibleName(NOTE_EDIT_LABEL.editAction);
  });
});
