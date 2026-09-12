import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import { MemoryKeyValueStorage, type KeyValueStorage } from "@/data/mock/overlay/storage";
import { MUTATION_OVERLAY_STORAGE_KEY } from "@/data/mock/overlay/mutation-overlay";
import type { CrmContext, CrmDataProvider } from "@/data/contracts/CrmDataProvider";
import type { AddNoteResult, CrmMutations } from "@/data/contracts/CrmMutations";
import type { CrmErrorCode, Result } from "@/data/contracts/result";
import { empty, fail, ok } from "@/data/contracts/result";
import { NOTE_BODY_MAX_LENGTH } from "@/domain/notes/note";
import { mockSessionForRole } from "@/domain/identity/session";
import type { CrmRole } from "@/domain/identity/roles";
import { NOTES_LABEL } from "@/config/labels";
import { NOTE_ERROR_MESSAGE, NOTE_VALIDATION_MESSAGE } from "./lib/note-error";
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
const UNKNOWN = "usr_mock_does_not_exist";
const FIXTURE_NOTE = /Синтетическая заметка: демонстрационная запись/;
const clock = new FixedMockClock();

function newProvider(storage: KeyValueStorage = new MemoryKeyValueStorage(), delayMs = 0) {
  return new MockCrmDataProvider({ clock, delayMs, storage });
}

/**
 * The notes section drives exactly one mutation. `assignPrimaryOwner` joined the
 * contract in Phase 1B4-C, so the stub has to supply it — and it throws rather
 * than resolving quietly: nothing in this section has any business assigning an
 * owner, and a silent no-op would let a future edit reach for it unnoticed.
 */
function notesMutations(addNote: CrmMutations["addNote"]): CrmMutations {
  return {
    addNote,
    assignPrimaryOwner: () => {
      throw new Error("the notes section must not call assignPrimaryOwner");
    },
    // These tests never pin; a throwing stub keeps a stray pin call from passing
    // unnoticed. Pin behaviour has its own suite (note-pin.test.tsx).
    setNotePinned: () => {
      throw new Error("this suite must not call setNotePinned");
    },
    // Body editing has its own suite (user-notes-edit.test.tsx); a throwing stub
    // keeps a stray edit call from passing unnoticed here.
    updateNoteBody: () => {
      throw new Error("this suite must not call updateNoteBody");
    },
    // Visibility change has its own suite (note-visibility.test.tsx).
    setNoteVisibility: () => {
      throw new Error("this suite must not call setNoteVisibility");
    },
    // Deletion has its own suite (note-delete.test.tsx).
    deleteNote: () => {
      throw new Error("this suite must not call deleteNote");
    },
  };
}

function renderNotes({
  userId = USER,
  provider,
  mutations,
}: {
  userId?: string;
  provider: CrmDataProvider;
  mutations?: Pick<CrmMutations, "addNote">;
}) {
  return render(
    <TooltipProvider>
      <UserNotes
        userId={userId}
        providerOverride={provider}
        mutationsOverride={
          mutations ? notesMutations(mutations.addNote) : (provider as unknown as CrmMutations)
        }
      />
    </TooltipProvider>,
  );
}

const textarea = () => screen.getByLabelText(NOTES_LABEL.composerLabel) as HTMLTextAreaElement;

/**
 * The submit control, found structurally rather than by name: its accessible
 * name deliberately changes to "Сохраняем…" while the write is in flight, which
 * is how pending is announced without relying on colour.
 */
const submitIn = (container: HTMLElement) =>
  container.querySelector('form button[type="submit"]') as HTMLButtonElement;

/** Types without userEvent's per-character cost — needed for 2000-char bodies. */
const setBody = (value: string) => fireEvent.change(textarea(), { target: { value } });

const addNoteOk = (body: string, replayed = false): Result<AddNoteResult> =>
  ok({
    note: {
      id: "note_mock_0001",
      userId: USER,
      caseId: null,
      authorEmployeeId: "emp_mock_admin",
      body,
      visibility: "team",
      pinned: false,
      createdAt: clock.nowIso(),
      updatedAt: clock.nowIso(),
      mock: true,
    },
    audit: {
      id: "audit_mock_0001",
      action: "note_added",
      actorEmployeeId: "emp_mock_admin",
      actorRole: "crm_admin",
      targetUserId: USER,
      entityType: "note",
      entityId: "note_mock_0001",
      at: clock.nowIso(),
      reasonCode: "note_added_by_employee",
      mock: true,
    },
    replayed,
  });

beforeEach(() => {
  currentRole = "crm_admin";
});

/* ------------------------------------------------------------------ list */

describe("User 360 notes — list states", () => {
  it("shows a local skeleton while loading, without touching the rest of the screen", async () => {
    renderNotes({ provider: newProvider(new MemoryKeyValueStorage(), 50) });
    expect(screen.getByRole("status", { name: NOTES_LABEL.loading })).toBeInTheDocument();
    expect(await screen.findByText(FIXTURE_NOTE)).toBeInTheDocument();
  });

  it("renders the notes the provider returned", async () => {
    renderNotes({ provider: newProvider() });
    expect(await screen.findByText(FIXTURE_NOTE)).toBeInTheDocument();
    expect(screen.getByText("Командная заметка")).toBeInTheDocument();
  });

  it("says this role has nothing to show, not that no note exists", async () => {
    renderNotes({ userId: UNKNOWN, provider: newProvider() });
    expect(await screen.findByText(NOTES_LABEL.empty)).toBeInTheDocument();
    expect(screen.queryByText(/не существует|нет заметок у пользователя/i)).not.toBeInTheDocument();
  });

  it("keeps a read failure inline and offers retry only when retriable", async () => {
    const provider = {
      getUserNotesView: () =>
        Promise.resolve(fail({ code: "internal", message: "Mock overlay exploded.", retriable: true })),
    } as unknown as CrmDataProvider;
    const { container } = renderNotes({ provider });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(NOTE_ERROR_MESSAGE.internal);
    expect(within(container).getByRole("button", { name: NOTES_LABEL.retry })).toBeInTheDocument();
  });

  it("hides retry for an error the provider says is not retriable", async () => {
    const provider = {
      getUserNotesView: () =>
        Promise.resolve(fail({ code: "not_found", message: "gone", retriable: false })),
    } as unknown as CrmDataProvider;
    renderNotes({ provider });
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: NOTES_LABEL.retry })).not.toBeInTheDocument();
  });

  it("retry re-reads through the provider", async () => {
    const getUserNotesView = vi
      .fn()
      .mockResolvedValue(fail({ code: "internal", message: "boom", retriable: true }));
    renderNotes({ provider: { getUserNotesView } as unknown as CrmDataProvider });
    await userEvent.click(await screen.findByRole("button", { name: NOTES_LABEL.retry }));
    await waitFor(() => expect(getUserNotesView).toHaveBeenCalledTimes(2));
  });

  it("never renders the author id or any storage bookkeeping", async () => {
    const { container } = renderNotes({ provider: newProvider() });
    await screen.findByText(FIXTURE_NOTE);
    expect(container.innerHTML).not.toContain("emp_mock_admin");
    expect(container.innerHTML).not.toContain("_note_1");
    expect(container.innerHTML).not.toContain(MUTATION_OVERLAY_STORAGE_KEY);
  });

  it("takes its order from the provider, not from React", async () => {
    const provider = newProvider();
    const ctx: CrmContext = { actorId: "emp_mock_admin", role: "crm_admin", now: clock.nowIso() };
    await provider.addNote(ctx, { userId: USER, body: "Первая", idempotencyKey: "k1" });
    await provider.addNote(ctx, { userId: USER, body: "Вторая", idempotencyKey: "k2" });

    const { container } = renderNotes({ provider });
    await screen.findByText("Вторая");

    const expected = (await provider.getUserNotes(ctx, { userId: USER })).data!.items.map((n) => n.body);
    const rendered = [...container.querySelectorAll("ol > li p")].map((p) => p.textContent);
    expect(rendered).toEqual(expected);
  });

  it("does not render a note the projector hides from this actor", async () => {
    // A private note authored by somebody else: dropped by the projector, so it
    // must not reach the DOM by any path.
    const seeded = new MemoryKeyValueStorage({
      [MUTATION_OVERLAY_STORAGE_KEY]: JSON.stringify({
        version: 1,
        sequence: 1,
        notes: [
          {
            id: "note_mock_0001",
            userId: USER,
            caseId: null,
            authorEmployeeId: "emp_someone_else",
            body: "СКРЫТОЕ-ТЕЛО",
            visibility: "private",
            pinned: false,
            createdAt: clock.nowIso(),
            updatedAt: clock.nowIso(),
            mock: true,
          },
        ],
        auditRecords: [],
        idempotencyReceipts: [],
      }),
    });
    const { container } = renderNotes({ provider: newProvider(seeded) });
    await screen.findByText(FIXTURE_NOTE);
    expect(container.innerHTML).not.toContain("СКРЫТОЕ-ТЕЛО");
  });
});

/* ------------------------------------------------------------ validation */

describe("User 360 notes — client validation", () => {
  it("refuses an empty body without calling the provider", async () => {
    const addNote = vi.fn();
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote } });
    await screen.findByText(FIXTURE_NOTE);

    await userEvent.click(submitIn(container));

    expect(await screen.findByRole("alert")).toHaveTextContent(NOTE_VALIDATION_MESSAGE.empty);
    expect(addNote).not.toHaveBeenCalled();
  });

  it("refuses a whitespace-only body without calling the provider", async () => {
    const addNote = vi.fn();
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote } });
    await screen.findByText(FIXTURE_NOTE);

    setBody("    ");
    await userEvent.click(submitIn(container));

    expect(await screen.findByRole("alert")).toHaveTextContent(NOTE_VALIDATION_MESSAGE.empty);
    expect(addNote).not.toHaveBeenCalled();
  });

  it("refuses an over-limit body without calling the provider", async () => {
    const addNote = vi.fn();
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote } });
    await screen.findByText(FIXTURE_NOTE);

    setBody("я".repeat(NOTE_BODY_MAX_LENGTH + 1));
    await userEvent.click(submitIn(container));

    expect(await screen.findByRole("alert")).toHaveTextContent(NOTE_VALIDATION_MESSAGE.too_long);
    expect(addNote).not.toHaveBeenCalled();
  });

  it("accepts a body exactly at the limit", async () => {
    const addNote = vi.fn().mockResolvedValue(addNoteOk("x"));
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote } });
    await screen.findByText(FIXTURE_NOTE);

    setBody("я".repeat(NOTE_BODY_MAX_LENGTH));
    await userEvent.click(submitIn(container));

    await waitFor(() => expect(addNote).toHaveBeenCalledTimes(1));
  });

  it("trims before sending, so padding is not a different note", async () => {
    const addNote = vi.fn().mockResolvedValue(addNoteOk("Текст"));
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote } });
    await screen.findByText(FIXTURE_NOTE);

    setBody("   Текст   ");
    await userEvent.click(submitIn(container));

    await waitFor(() => expect(addNote.mock.calls[0]![1].body).toBe("Текст"));
  });

  it("retires the validation message quietly once the draft changes", async () => {
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote: vi.fn() } });
    await screen.findByText(FIXTURE_NOTE);

    await userEvent.click(submitIn(container));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    setBody("Теперь есть текст");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("never repeats the note body in a validation message", async () => {
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote: vi.fn() } });
    await screen.findByText(FIXTURE_NOTE);

    setBody("я".repeat(NOTE_BODY_MAX_LENGTH + 1));
    await userEvent.click(submitIn(container));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("яяяя");
  });
});

/* -------------------------------------------------------------- mutation */

describe("User 360 notes — submit behaviour", () => {
  it("states pending in words and keeps the draft readable", async () => {
    let release: (v: Result<AddNoteResult>) => void = () => {};
    const addNote = vi.fn(() => new Promise<Result<AddNoteResult>>((r) => (release = r)));
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote } });
    await screen.findByText(FIXTURE_NOTE);

    setBody("Черновик");
    await userEvent.click(submitIn(container));

    const button = submitIn(container);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(NOTES_LABEL.submitPending);
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(textarea().value).toBe("Черновик");

    release(addNoteOk("Черновик"));
    await waitFor(() => expect(textarea().value).toBe(""));
  });

  it("a double submit makes exactly one provider call", async () => {
    let release: (v: Result<AddNoteResult>) => void = () => {};
    const addNote = vi.fn(() => new Promise<Result<AddNoteResult>>((r) => (release = r)));
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote } });
    await screen.findByText(FIXTURE_NOTE);

    setBody("Дважды");
    const button = submitIn(container);
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.submit(container.querySelector("form")!);

    expect(addNote).toHaveBeenCalledTimes(1);
    release(addNoteOk("Дважды"));
    await waitFor(() => expect(textarea().value).toBe(""));
  });

  it("on success: clears the draft, confirms calmly, re-reads and restores focus", async () => {
    const provider = newProvider();
    const { container } = renderNotes({ provider });
    await screen.findByText(FIXTURE_NOTE);

    setBody("Позвонил пользователю, ждёт ответа поддержки");
    await userEvent.click(submitIn(container));

    // Present because the provider was re-read — not because React inserted it.
    expect(await screen.findByText("Позвонил пользователю, ждёт ответа поддержки")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent(NOTES_LABEL.success);
    expect(textarea().value).toBe("");
    expect(textarea()).toHaveFocus();
  });

  it("treats a replayed result as an ordinary success, with no talk of replays", async () => {
    const addNote = vi.fn().mockResolvedValue(addNoteOk("Повтор", true));
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote } });
    await screen.findByText(FIXTURE_NOTE);

    setBody("Повтор");
    await userEvent.click(submitIn(container));

    expect(await screen.findByText(NOTES_LABEL.success)).toBeInTheDocument();
    expect(textarea().value).toBe("");
    expect(container.textContent).not.toMatch(/replay|повтор отправ|идемпотент/i);
  });

  it("does not insert the created note itself — the list comes from the re-read", async () => {
    const getUserNotesView = vi.fn().mockResolvedValue(
      empty({ items: [], page: { cursor: null, nextCursor: null, total: 0, pageSize: 50 } }),
    );
    const addNote = vi.fn().mockResolvedValue(addNoteOk("Невидимая"));
    const { container } = renderNotes({
      provider: { getUserNotesView } as unknown as CrmDataProvider,
      mutations: { addNote },
    });
    await screen.findByText(NOTES_LABEL.empty);

    setBody("Невидимая");
    await userEvent.click(submitIn(container));

    // The provider kept saying "no notes", so the screen says "no notes". An
    // optimistic insert would have shown a note the provider does not report.
    await waitFor(() => expect(getUserNotesView).toHaveBeenCalledTimes(2));
    expect(screen.getByText(NOTES_LABEL.empty)).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("Невидимая");
  });
});

/* ------------------------------------------------------- idempotency key */

describe("User 360 notes — idempotency key lifecycle", () => {
  const keyOf = (addNote: ReturnType<typeof vi.fn>, call: number) =>
    addNote.mock.calls[call]![1].idempotencyKey as string;

  it("repeats the key on a retry after a storage failure, and editing does not mint one", async () => {
    const addNote = vi
      .fn()
      .mockResolvedValueOnce(fail({ code: "internal", message: "Mock overlay could not be persisted.", retriable: true }))
      .mockResolvedValueOnce(addNoteOk("Вторая попытка"));
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote } });
    await screen.findByText(FIXTURE_NOTE);

    setBody("Первая попытка");
    await userEvent.click(submitIn(container));
    await screen.findByRole("alert");

    // Nothing was written, so the same command may be re-sent under the same key.
    setBody("Вторая попытка");
    await userEvent.click(submitIn(container));
    await waitFor(() => expect(addNote).toHaveBeenCalledTimes(2));

    expect(keyOf(addNote, 1)).toBe(keyOf(addNote, 0));
  });

  it("mints a new key after success, so the next note is a new command", async () => {
    const addNote = vi.fn().mockResolvedValue(addNoteOk("x"));
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote } });
    await screen.findByText(FIXTURE_NOTE);

    setBody("Одна");
    await userEvent.click(submitIn(container));
    await screen.findByText(NOTES_LABEL.success);

    setBody("Другая");
    await userEvent.click(submitIn(container));
    await waitFor(() => expect(addNote).toHaveBeenCalledTimes(2));

    expect(keyOf(addNote, 1)).not.toBe(keyOf(addNote, 0));
  });

  /**
   * Regression (Phase 1B4-C). The provider fingerprints the actor's ROLE along with
   * the body, so a key minted under crm_admin and submitted under crm_manager
   * describes a different command and comes back as a `conflict` the employee did
   * nothing to cause. Both roles may write notes, so the composer does not unmount on
   * the switch and used to carry the spent key straight into the next submit.
   */
  it("mints a new key when the session identity changes", async () => {
    // The first attempt fails to persist, which is the one case that deliberately
    // KEEPS the key: nothing was written, so repeating it is what makes the retry
    // safe. That is exactly the state in which a role switch used to carry a key
    // minted under the old role into a command sent under the new one — after a
    // success the key advances anyway, and the bug would hide.
    const addNote = vi
      .fn()
      .mockResolvedValueOnce(fail({ code: "internal", message: "boom", retriable: true }))
      .mockResolvedValue(addNoteOk("x"));
    const provider = newProvider();
    const { container, rerender } = renderNotes({ provider, mutations: { addNote } });
    await screen.findByText(FIXTURE_NOTE);

    setBody("Под админом");
    await userEvent.click(submitIn(container));
    await waitFor(() => expect(addNote).toHaveBeenCalledTimes(1));
    await screen.findByRole("alert");

    currentRole = "crm_manager";
    rerender(
      <TooltipProvider>
        <UserNotes
          userId={USER}
          providerOverride={provider}
          mutationsOverride={notesMutations(addNote)}
        />
      </TooltipProvider>,
    );
    await screen.findByText(FIXTURE_NOTE);

    setBody("Под менеджером");
    await userEvent.click(submitIn(container));
    await waitFor(() => expect(addNote).toHaveBeenCalledTimes(2));

    expect(keyOf(addNote, 1)).not.toBe(keyOf(addNote, 0));
    // The second call really did go out under the new role.
    expect(addNote.mock.calls[1]![0].role).toBe("crm_manager");
  });

  it("mints a new key after a conflict, because the old one is spent", async () => {
    const addNote = vi
      .fn()
      .mockResolvedValueOnce(fail({ code: "conflict", message: "reused", retriable: false }))
      .mockResolvedValueOnce(addNoteOk("Снова"));
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote } });
    await screen.findByText(FIXTURE_NOTE);

    setBody("Снова");
    await userEvent.click(submitIn(container));
    await screen.findByRole("alert");

    await userEvent.click(submitIn(container));
    await waitFor(() => expect(addNote).toHaveBeenCalledTimes(2));

    expect(keyOf(addNote, 1)).not.toBe(keyOf(addNote, 0));
  });

  it("reuses the key for a double submit", async () => {
    let release: (v: Result<AddNoteResult>) => void = () => {};
    const addNote = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Result<AddNoteResult>>((r) => (release = r)))
      .mockResolvedValue(addNoteOk("x"));
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote } });
    await screen.findByText(FIXTURE_NOTE);

    setBody("Одно нажатие из двух");
    const button = submitIn(container);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(addNote).toHaveBeenCalledTimes(1);

    release(addNoteOk("Одно нажатие из двух"));
    await waitFor(() => expect(textarea().value).toBe(""));
  });

  it("stays inside the provider's key limit and never shows the key", async () => {
    const addNote = vi.fn().mockResolvedValue(addNoteOk("x"));
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote } });
    await screen.findByText(FIXTURE_NOTE);

    setBody("Ключ");
    await userEvent.click(submitIn(container));
    await waitFor(() => expect(addNote).toHaveBeenCalledTimes(1));

    const key = keyOf(addNote, 0);
    expect(key.length).toBeLessThanOrEqual(200);
    expect(key.length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toContain(key);
  });

  it("derives the key without reaching for randomness", async () => {
    // Only Math.random is asserted directly. `Date.now` cannot be: React and
    // testing-library call it dozens of times per render, so a spy on it would
    // report their work, not ours. Determinism is proven below instead, which is
    // the property the clock ban exists to protect.
    const random = vi.spyOn(Math, "random");
    const addNote = vi.fn().mockResolvedValue(addNoteOk("x"));
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote } });
    await screen.findByText(FIXTURE_NOTE);

    setBody("Детерминированный ключ");
    await userEvent.click(submitIn(container));
    await waitFor(() => expect(addNote).toHaveBeenCalledTimes(1));

    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it("is a pure function of the composer, the user and the attempt", async () => {
    // The shape is the evidence: one stable prefix from useId, the user it is
    // about, and a counter that only advances. Nothing here can vary between two
    // runs of the same attempt, which is what "no entropy, no clock" buys.
    //
    // Note the key is NOT reproducible across separate mounts: React's useId
    // draws from a per-realm counter, so a remounted composer gets a new prefix.
    // That is right for an idempotency key — a fresh composer must not inherit a
    // spent key — and it costs nothing elsewhere, because the key is never an
    // entity id and never rendered (MUTATION_OVERLAY §4).
    const addNote = vi.fn().mockResolvedValue(addNoteOk("x"));
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote } });
    await screen.findByText(FIXTURE_NOTE);

    setBody("Одна");
    await userEvent.click(submitIn(container));
    await screen.findByText(NOTES_LABEL.success);
    setBody("Другая");
    await userEvent.click(submitIn(container));
    await waitFor(() => expect(addNote).toHaveBeenCalledTimes(2));

    const shape = new RegExp(`^(.+):${USER}:(\\d+)$`);
    const first = keyOf(addNote, 0).match(shape);
    const second = keyOf(addNote, 1).match(shape);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first![2]).toBe("0");
    expect(second![2]).toBe("1");
    expect(second![1]).toBe(first![1]);
  });
});

/* ---------------------------------------------------------- error mapping */

describe("User 360 notes — error mapping", () => {
  const CODES: CrmErrorCode[] = [
    "unauthorized",
    "not_found",
    "invalid_input",
    "conflict",
    "internal",
    "rate_limited",
    "upstream_unavailable",
    "stale_data",
  ];

  for (const code of CODES) {
    it(`${code}: shows safe Russian text and no provider diagnostics`, async () => {
      const diagnostic = `Raw diagnostic for ${code}: overlay ${MUTATION_OVERLAY_STORAGE_KEY} exploded.`;
      const addNote = vi.fn().mockResolvedValue(fail({ code, message: diagnostic, retriable: true }));
      const { container } = renderNotes({ provider: newProvider(), mutations: { addNote } });
      await screen.findByText(FIXTURE_NOTE);

      setBody("Тело заметки-СЕКРЕТ");
      await userEvent.click(submitIn(container));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(NOTE_ERROR_MESSAGE[code]);
      // The message the provider wrote for developers stays with developers.
      expect(container.innerHTML).not.toContain(diagnostic);
      expect(container.innerHTML).not.toContain("Raw diagnostic");
      expect(container.innerHTML).not.toContain(MUTATION_OVERLAY_STORAGE_KEY);
      // A failure never quotes what the user typed back at them.
      expect(alert.textContent).not.toContain("Тело заметки-СЕКРЕТ");
    });
  }

  it("maps every code the project's union actually contains", () => {
    // Total Record<CrmErrorCode, string>: this asserts the map is not a subset
    // someone guessed. A new code fails to compile in note-error.ts.
    expect(Object.keys(NOTE_ERROR_MESSAGE).sort()).toEqual([...CODES].sort());
    for (const text of Object.values(NOTE_ERROR_MESSAGE)) {
      expect(text).not.toMatch(/[a-z]{4,}\s[a-z]{4,}/i);
    }
  });

  it("keeps the real provider's own internal diagnostic off the screen", async () => {
    // The genuine string addNote produces when the overlay cannot be persisted.
    const failing: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("storage disabled");
      },
      removeItem: () => {},
    };
    const provider = newProvider(failing);
    const { container } = renderNotes({ provider });
    await screen.findByText(FIXTURE_NOTE);

    setBody("Не сохранится");
    await userEvent.click(submitIn(container));

    expect(await screen.findByRole("alert")).toHaveTextContent(NOTE_ERROR_MESSAGE.internal);
    expect(container.innerHTML).not.toContain("Mock overlay could not be persisted");
  });

  it("shows the permission refusal text if a forbidden write is somehow attempted", async () => {
    const addNote = vi
      .fn()
      .mockResolvedValue(fail({ code: "unauthorized", message: "Role may not edit notes.", retriable: false }));
    const { container } = renderNotes({ provider: newProvider(), mutations: { addNote } });
    await screen.findByText(FIXTURE_NOTE);

    setBody("Попытка");
    await userEvent.click(submitIn(container));

    expect(await screen.findByRole("alert")).toHaveTextContent(NOTES_LABEL.forbidden);
    expect(container.innerHTML).not.toContain("Role may not edit notes");
  });
});
