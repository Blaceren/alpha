import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixedMockClock, MOCK_NOW } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import { MemoryKeyValueStorage, type KeyValueStorage } from "@/data/mock/overlay/storage";
import type { CrmContext, CrmDataProvider } from "@/data/contracts/CrmDataProvider";
import { fail, ok } from "@/data/contracts/result";
import type { Paginated, Result } from "@/data/contracts/result";
import type { AuditRecordView } from "@/domain/audit/audit-view";
import { mockSessionForRole } from "@/domain/identity/session";
import type { CrmRole } from "@/domain/identity/roles";
import { AUDIT_LABEL } from "@/config/labels";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuditWorkspace } from "./audit-workspace";

const SESSIONS = new Map<CrmRole, ReturnType<typeof mockSessionForRole>>();
const sessionFor = (role: CrmRole) => {
  if (!SESSIONS.has(role)) SESSIONS.set(role, mockSessionForRole(role));
  return SESSIONS.get(role)!;
};
let currentRole: CrmRole = "crm_admin";
vi.mock("@/components/crm-shell/session-context", () => ({
  useSession: () => ({ session: sessionFor(currentRole), setRole: vi.fn() }),
}));

const clock = new FixedMockClock();
const ACTOR = "emp_mock_admin";

beforeEach(() => {
  currentRole = "crm_admin";
});

function ctx(role: CrmRole = "crm_admin"): CrmContext {
  return { actorId: ACTOR, role, now: MOCK_NOW };
}

function newProvider(storage: KeyValueStorage = new MemoryKeyValueStorage()) {
  return new MockCrmDataProvider({ clock, storage });
}

const USER_ID = "usr_mock_026";

/** Build a rich, real overlay: all four actions, both pin directions, both owner labels. */
async function seedRich(provider: MockCrmDataProvider) {
  const add = await provider.addNote(ctx(), {
    userId: USER_ID,
    body: "Первичный текст заметки",
    idempotencyKey: "a1",
  });
  const noteId = add.data!.note.id;
  const updatedAt0 = add.data!.note.updatedAt;

  const cur = await provider.getUserById(ctx(), { userId: USER_ID });
  const owner0 = cur.data?.ownerId ?? null;
  const candidate = owner0 === "emp_ret1" ? "emp_men1" : "emp_ret1";

  await provider.assignPrimaryOwner(ctx(), {
    userId: USER_ID,
    ownerId: candidate,
    expectedOwnerId: owner0,
    idempotencyKey: "a2",
  });
  await provider.assignPrimaryOwner(ctx(), {
    userId: USER_ID,
    ownerId: null,
    expectedOwnerId: candidate,
    idempotencyKey: "a3",
  });
  await provider.setNotePinned(ctx(), {
    userId: USER_ID,
    noteId,
    pinned: true,
    expectedPinned: false,
    idempotencyKey: "a4",
  });
  await provider.setNotePinned(ctx(), {
    userId: USER_ID,
    noteId,
    pinned: false,
    expectedPinned: true,
    idempotencyKey: "a5",
  });
  await provider.updateNoteBody(ctx(), {
    userId: USER_ID,
    noteId,
    body: "Изменённый текст заметки",
    expectedUpdatedAt: updatedAt0,
    idempotencyKey: "a6",
  });
}

/** Minimal stub exposing only getAuditRecords — the sole method the workspace calls. */
function stubProvider(
  impl: (ctx: CrmContext) => Promise<Result<Paginated<AuditRecordView>>>,
): CrmDataProvider {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "getAuditRecords") return impl;
        return () => {
          throw new Error(`unexpected provider call: ${String(prop)}`);
        };
      },
    },
  ) as CrmDataProvider;
}

function renderWorkspace(provider: CrmDataProvider) {
  return render(
    <TooltipProvider>
      <AuditWorkspace providerOverride={provider} />
    </TooltipProvider>,
  );
}

describe("AuditWorkspace — states", () => {
  it("shows a loading skeleton before the read lands", () => {
    const provider = stubProvider(() => new Promise(() => {}));
    renderWorkspace(provider);
    expect(screen.getByRole("status", { name: AUDIT_LABEL.loading })).toBeInTheDocument();
  });

  it("shows the empty state for a permitted role with no records", async () => {
    renderWorkspace(newProvider());
    expect(await screen.findByText(AUDIT_LABEL.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(AUDIT_LABEL.emptyText)).toBeInTheDocument();
    // The empty state is NOT the restricted one.
    expect(screen.queryByText(AUDIT_LABEL.restrictedTitle)).not.toBeInTheDocument();
  });

  it("shows the restricted state for a role without canViewAudit", async () => {
    currentRole = "support";
    renderWorkspace(newProvider());
    expect(await screen.findByText(AUDIT_LABEL.restrictedTitle)).toBeInTheDocument();
    expect(screen.getByText(AUDIT_LABEL.restrictedText)).toBeInTheDocument();
    // Distinct from empty: no empty copy, no skeleton, no records.
    expect(screen.queryByText(AUDIT_LABEL.emptyTitle)).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("shows a localized error with retry and never the raw CrmError.message", async () => {
    let calls = 0;
    const provider = stubProvider(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(
          fail<Paginated<AuditRecordView>>({
            code: "upstream_unavailable",
            message: "Mock error mode.",
            retriable: true,
          }),
        );
      }
      return Promise.resolve(
        ok<Paginated<AuditRecordView>>({
          items: [],
          page: { cursor: null, nextCursor: null, total: 0, pageSize: 20 },
        }),
      );
    });

    renderWorkspace(provider);
    expect(await screen.findByText(AUDIT_LABEL.errorTitle)).toBeInTheDocument();
    // Raw diagnostic text must not reach the DOM.
    expect(screen.queryByText("Mock error mode.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: AUDIT_LABEL.retry }));
    // Retry re-runs the provider read; the second call returns empty.
    await waitFor(() => expect(screen.getByText(AUDIT_LABEL.emptyTitle)).toBeInTheDocument());
    expect(calls).toBe(2);
  });
});

describe("AuditWorkspace — populated ledger", () => {
  it("renders all four actions with both pin directions and both owner labels", async () => {
    const provider = newProvider();
    await seedRich(provider);
    renderWorkspace(provider);

    // note_added, pin, unpin, body, and two owner changes.
    expect(
      await screen.findByText(/добавил заметку для/),
    ).toBeInTheDocument();
    expect(screen.getByText(/изменил текст заметки у/)).toBeInTheDocument();

    // Pin and unpin are DIFFERENT words, not a colour.
    expect(screen.getByText(/закрепил заметку у/)).toBeInTheDocument();
    expect(screen.getByText(/открепил заметку у/)).toBeInTheDocument();

    // Owner change sentence plus the transition detail with both labels.
    expect(screen.getAllByText(/изменил ответственного у/).length).toBeGreaterThanOrEqual(1);
    // Unassigned label appears as an owner-transition target.
    expect(screen.getByText(/Не назначен$/)).toBeInTheDocument();

    // Total is shown in the section metadata.
    expect(screen.getByText(new RegExp(`${AUDIT_LABEL.totalLabel}: 6`))).toBeInTheDocument();
  });

  it("renders a note_deleted row as a neutral fact, without the deleted body or id", async () => {
    const provider = newProvider();
    const add = await provider.addNote(ctx(), {
      userId: USER_ID,
      body: "Секретное тело удалённой заметки",
      idempotencyKey: "d1",
    });
    const noteId = add.data!.note.id;
    await provider.deleteNote(ctx(), {
      userId: USER_ID,
      noteId,
      expectedUpdatedAt: add.data!.note.updatedAt,
      idempotencyKey: "d2",
    });
    const { container } = renderWorkspace(provider);

    // The neutral delete sentence appears; the note_added record for the same note
    // survives too (append-only), so both rows are present.
    expect(await screen.findByText(/удалил заметку у/)).toBeInTheDocument();
    expect(screen.getByText(/добавил заметку для/)).toBeInTheDocument();

    const html = container.innerHTML;
    expect(html).not.toContain("Секретное тело удалённой заметки");
    expect(html).not.toContain(noteId);
    expect(html).not.toContain("audit_mock_");
  });

  it("never prints a raw id, note body or overlay key", async () => {
    const provider = newProvider();
    await seedRich(provider);
    const { container } = renderWorkspace(provider);
    await screen.findByText(/добавил заметку для/);

    const html = container.innerHTML;
    expect(html).not.toContain(ACTOR);
    expect(html).not.toContain(USER_ID);
    expect(html).not.toContain("note_mock_");
    expect(html).not.toContain("audit_mock_");
    expect(html).not.toContain("Первичный текст заметки");
    expect(html).not.toContain("Изменённый текст заметки");
    expect(html).not.toContain("ata-crm.mutation-overlay");
  });
});

describe("AuditWorkspace — pagination", () => {
  it("shows 20 rows and pages to the rest", async () => {
    const provider = newProvider();
    for (let i = 0; i < 23; i += 1) {
      await provider.addNote(ctx(), {
        userId: USER_ID,
        body: `Заметка №${i}`,
        idempotencyKey: `p-${i}`,
      });
    }
    renderWorkspace(provider);

    await screen.findByText(new RegExp(`${AUDIT_LABEL.totalLabel}: 23`));
    expect(screen.getAllByRole("listitem")).toHaveLength(20);

    await userEvent.click(screen.getByRole("button", { name: "Следующая страница" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
  });

  it("shows no pagination control when a single page holds everything", async () => {
    const provider = newProvider();
    await provider.addNote(ctx(), { userId: USER_ID, body: "одна", idempotencyKey: "s1" });
    renderWorkspace(provider);

    await screen.findByText(/добавил заметку для/);
    expect(screen.queryByRole("button", { name: "Следующая страница" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Предыдущая страница" })).not.toBeInTheDocument();
  });
});

describe("AuditWorkspace — structure", () => {
  it("has exactly one h1", async () => {
    const provider = newProvider();
    await seedRich(provider);
    renderWorkspace(provider);
    await screen.findByText(/добавил заметку для/);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
