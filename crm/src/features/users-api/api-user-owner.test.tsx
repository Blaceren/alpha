import * as React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OwnerCandidatesOutcome,
  OwnerMutationOutcome,
  OwnerReadOutcome,
} from "@/application/api/user-owner-client";
import type { CrmUsersReadCapability } from "@/data/api/api-crm-data-provider";
import { pristineOwnerMethods } from "./owner-provider-test-stub";
import { ApiUserOwnerSection } from "./api-user-owner";

const alpha = { employeeId: "emp_alpha", displayName: "Владелец Альфа" };
const beta = { employeeId: "emp_beta", displayName: "Владелец Бета" };

const readOk = (owner: typeof alpha | null, ownerVersion: number): OwnerReadOutcome => ({
  status: "success",
  owner: { owner, ownerVersion },
});
const mutOk = (owner: typeof alpha | null, ownerVersion: number): OwnerMutationOutcome => ({
  status: "success",
  owner: { owner, ownerVersion },
});
const candidates = (items: (typeof alpha)[], nextCursor: string | null = null): OwnerCandidatesOutcome => ({
  status: "success",
  page: { items, nextCursor },
});

interface Harness {
  provider: CrmUsersReadCapability;
  readCalls: string[];
  candidateCalls: { cursor?: string }[];
  setCalls: { ownerEmployeeId: string | null; expectedVersion: number }[];
}

function harness(opts: {
  reads: OwnerReadOutcome[];
  candidateOutcomes?: OwnerCandidatesOutcome[];
  mutations?: OwnerMutationOutcome[];
}): Harness {
  const readCalls: string[] = [];
  const candidateCalls: { cursor?: string }[] = [];
  const setCalls: { ownerEmployeeId: string | null; expectedVersion: number }[] = [];
  let ri = 0;
  let ci = 0;
  let mi = 0;
  return {
    readCalls,
    candidateCalls,
    setCalls,
    provider: {
      ...pristineOwnerMethods(),
      listUsers: () => { throw new Error("no"); },
      getUserDetail: () => { throw new Error("no"); },
      listUserNotes: () => { throw new Error("no"); },
      createUserNote: () => { throw new Error("no"); },
      async getUserOwner(userId: string) {
        readCalls.push(userId);
        const out = opts.reads[Math.min(ri, opts.reads.length - 1)] ?? { status: "malformed_response" as const };
        ri += 1;
        return out;
      },
      async listOwnerCandidates(input?: { cursor?: string }) {
        candidateCalls.push({ cursor: input?.cursor });
        const list = opts.candidateOutcomes ?? [candidates([alpha, beta])];
        const out = list[Math.min(ci, list.length - 1)] ?? candidates([alpha, beta]);
        ci += 1;
        return out;
      },
      async setUserOwner(_userId: string, ownerEmployeeId: string | null, expectedVersion: number) {
        setCalls.push({ ownerEmployeeId, expectedVersion });
        const out = (opts.mutations ?? [])[Math.min(mi, (opts.mutations?.length ?? 1) - 1)];
        mi += 1;
        if (!out) throw new Error("mutation fixture exhausted");
        return out;
      },
    },
  };
}

const noop = () => {};

function renderSection(h: Harness, canAssign = true, cbs: Partial<{
  onUnauthenticated: () => void;
  onLearnerNotFound: () => void;
  onForbidden: () => void;
}> = {}, userId = "12") {
  return render(
    <ApiUserOwnerSection
      userId={userId}
      canAssign={canAssign}
      provider={h.provider}
      onUnauthenticated={cbs.onUnauthenticated ?? noop}
      onLearnerNotFound={cbs.onLearnerNotFound ?? noop}
      onForbidden={cbs.onForbidden ?? noop}
    />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const editButton = () => screen.findByRole("button", { name: "Изменить ответственного" });
const select = () => screen.getByLabelText("Ответственный") as HTMLSelectElement;

/* --------------------------------------------------------------- read states */

describe("read states", () => {
  it("shows a loading status first", async () => {
    const h = harness({ reads: [] });
    h.provider.getUserOwner = () => new Promise(() => {});
    renderSection(h);
    expect(await screen.findByText("Загружаем ответственного")).toBeInTheDocument();
  });

  it("renders the assigned owner display name", async () => {
    renderSection(harness({ reads: [readOk(alpha, 1)] }));
    expect(await screen.findByText("Владелец Альфа")).toBeInTheDocument();
  });

  it("renders «Не назначен» for the pristine null/0 state", async () => {
    renderSection(harness({ reads: [readOk(null, 0)] }), false);
    expect(await screen.findByText("Не назначен")).toBeInTheDocument();
  });

  it("renders «Не назначен» for a persisted unassigned non-zero version", async () => {
    const h = harness({ reads: [readOk(null, 3)], mutations: [mutOk(alpha, 4)] });
    renderSection(h);
    expect(await screen.findByText("Не назначен")).toBeInTheDocument();
    // The next assignment must send expectedVersion 3, not 0 — proving the
    // non-zero version was retained.
    await userEvent.click(await editButton());
    await userEvent.selectOptions(await screen.findByLabelText("Ответственный"), "emp_alpha");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await userEvent.click(await screen.findByRole("button", { name: "Назначить" }));
    await waitFor(() => expect(h.setCalls[0]).toEqual({ ownerEmployeeId: "emp_alpha", expectedVersion: 3 }));
  });

  it("shows an owner-only error with retry on 500, then recovers", async () => {
    const h = harness({ reads: [{ status: "upstream_unavailable" }, readOk(alpha, 1)] });
    renderSection(h);
    expect(await screen.findByText("Не удалось загрузить ответственного.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Владелец Альфа")).toBeInTheDocument();
  });

  it("fails closed on a malformed 200", async () => {
    renderSection(harness({ reads: [{ status: "malformed_response" }] }));
    expect(await screen.findByText(/не прошёл проверку/)).toBeInTheDocument();
  });

  it("escalates a read 401 to onUnauthenticated", async () => {
    const onUnauthenticated = vi.fn();
    renderSection(harness({ reads: [{ status: "unauthenticated" }] }), true, { onUnauthenticated });
    await waitFor(() => expect(onUnauthenticated).toHaveBeenCalled());
  });

  it("escalates a read 404 to onLearnerNotFound", async () => {
    const onLearnerNotFound = vi.fn();
    renderSection(harness({ reads: [{ status: "not_found" }] }), true, { onLearnerNotFound });
    await waitFor(() => expect(onLearnerNotFound).toHaveBeenCalled());
  });

  it("escalates a read 403 to onForbidden", async () => {
    const onForbidden = vi.fn();
    renderSection(harness({ reads: [{ status: "forbidden" }] }), true, { onForbidden });
    await waitFor(() => expect(onForbidden).toHaveBeenCalled());
  });
});

/* --------------------------------------------------------- permission gating */

describe("permission gating", () => {
  it("shows no edit control without assign_owner and never requests candidates", async () => {
    const h = harness({ reads: [readOk(alpha, 1)] });
    renderSection(h, false);
    expect(await screen.findByText("Владелец Альфа")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Изменить ответственного" })).not.toBeInTheDocument();
    expect(h.candidateCalls).toHaveLength(0);
  });

  it("shows the edit control with assign_owner", async () => {
    renderSection(harness({ reads: [readOk(alpha, 1)] }), true);
    expect(await editButton()).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------- candidates */

describe("candidate loading", () => {
  it("loads candidates on edit and lists «Без ответственного» plus each name", async () => {
    const h = harness({ reads: [readOk(null, 0)], candidateOutcomes: [candidates([alpha, beta])] });
    renderSection(h);
    await screen.findByText("Не назначен");
    await userEvent.click(await editButton());
    await screen.findByLabelText("Ответственный");
    const options = within(select()).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Без ответственного", "Владелец Альфа", "Владелец Бета"]);
  });

  it("walks pages in order and deduplicates by employeeId", async () => {
    const h = harness({
      reads: [readOk(null, 0)],
      candidateOutcomes: [candidates([alpha], "c2"), candidates([alpha, beta])],
    });
    renderSection(h);
    await screen.findByText("Не назначен");
    await userEvent.click(await editButton());
    await screen.findByLabelText("Ответственный");
    const options = within(select()).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Без ответственного", "Владелец Альфа", "Владелец Бета"]);
    expect(h.candidateCalls).toHaveLength(2);
  });

  it("shows a candidate unavailable state with retry on 500", async () => {
    const h = harness({
      reads: [readOk(null, 0)],
      candidateOutcomes: [{ status: "upstream_unavailable" }, candidates([alpha])],
    });
    renderSection(h);
    await screen.findByText("Не назначен");
    await userEvent.click(await editButton());
    expect(await screen.findByText("Не удалось загрузить список сотрудников.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByLabelText("Ответственный")).toBeInTheDocument();
  });

  it("removes controls when candidates return 403", async () => {
    const h = harness({ reads: [readOk(alpha, 1)], candidateOutcomes: [{ status: "forbidden" }] });
    renderSection(h);
    await userEvent.click(await editButton());
    expect(await screen.findByText("Нет доступа к назначению ответственного")).toBeInTheDocument();
  });
});

/* ----------------------------------------------------------- assignment */

describe("assignment", () => {
  it("keeps Save disabled while the selection equals the current owner", async () => {
    renderSection(harness({ reads: [readOk(alpha, 1)], candidateOutcomes: [candidates([alpha, beta])] }));
    await userEvent.click(await editButton());
    await screen.findByLabelText("Ответственный");
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();
  });

  it("opens an accessible confirmation dialog (never window.confirm) and sends on confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const h = harness({
      reads: [readOk(null, 0)],
      candidateOutcomes: [candidates([alpha, beta])],
      mutations: [mutOk(beta, 1)],
    });
    renderSection(h);
    await screen.findByText("Не назначен");
    await userEvent.click(await editButton());
    await userEvent.selectOptions(await screen.findByLabelText("Ответственный"), "emp_beta");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Назначить ответственного?")).toBeInTheDocument();
    expect(within(dialog).getByText("Ответственным станет: Владелец Бета.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Назначить" }));

    await waitFor(() => expect(h.setCalls[0]).toEqual({ ownerEmployeeId: "emp_beta", expectedVersion: 0 }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await screen.findByText("Ответственный обновлён")).toBeInTheDocument();
    // The new owner is rendered from the server response, not the selection.
    expect(screen.getByText("Владелец Бета")).toBeInTheDocument();
  });

  it("cancel in the dialog sends no mutation", async () => {
    const h = harness({ reads: [readOk(null, 0)], candidateOutcomes: [candidates([alpha])], mutations: [] });
    renderSection(h);
    await screen.findByText("Не назначен");
    await userEvent.click(await editButton());
    await userEvent.selectOptions(await screen.findByLabelText("Ответственный"), "emp_alpha");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Отмена" }));
    expect(h.setCalls).toHaveLength(0);
  });

  it("confirms an unassignment with the unassign copy and sends null", async () => {
    const h = harness({
      reads: [readOk(alpha, 1)],
      candidateOutcomes: [candidates([alpha, beta])],
      mutations: [mutOk(null, 2)],
    });
    renderSection(h);
    await userEvent.click(await editButton());
    await userEvent.selectOptions(await screen.findByLabelText("Ответственный"), "__unassigned__");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Снять ответственного?")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Снять" }));
    await waitFor(() => expect(h.setCalls[0]).toEqual({ ownerEmployeeId: null, expectedVersion: 1 }));
    expect(await screen.findByText("Не назначен")).toBeInTheDocument();
  });

  it("shows a candidate-unavailable message on a candidate 404 and keeps the owner", async () => {
    const h = harness({
      reads: [readOk(alpha, 1)],
      candidateOutcomes: [candidates([alpha, beta]), candidates([alpha])],
      mutations: [{ status: "candidate_not_found" }],
    });
    renderSection(h);
    await userEvent.click(await editButton());
    await userEvent.selectOptions(await screen.findByLabelText("Ответственный"), "emp_beta");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await userEvent.click(await screen.findByRole("button", { name: "Назначить" }));
    expect(await screen.findByText("Сотрудник недоступен для назначения")).toBeInTheDocument();
    // The editor stays open (list reloading), so read the stated owner from its
    // stable element rather than by matching the name (also a hidden option).
    expect(screen.getByTestId("crm-owner-current")).toHaveTextContent("Владелец Альфа");
  });

  it("escalates a mutation learner 404 to onLearnerNotFound", async () => {
    const onLearnerNotFound = vi.fn();
    const h = harness({
      reads: [readOk(alpha, 1)],
      candidateOutcomes: [candidates([alpha, beta])],
      mutations: [{ status: "not_found" }],
    });
    renderSection(h, true, { onLearnerNotFound });
    await userEvent.click(await editButton());
    await userEvent.selectOptions(await screen.findByLabelText("Ответственный"), "emp_beta");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await userEvent.click(await screen.findByRole("button", { name: "Назначить" }));
    await waitFor(() => expect(onLearnerNotFound).toHaveBeenCalled());
  });

  it("removes controls on a mutation 403", async () => {
    const h = harness({
      reads: [readOk(alpha, 1)],
      candidateOutcomes: [candidates([alpha, beta])],
      mutations: [{ status: "forbidden" }],
    });
    renderSection(h);
    await userEvent.click(await editButton());
    await userEvent.selectOptions(await screen.findByLabelText("Ответственный"), "emp_beta");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await userEvent.click(await screen.findByRole("button", { name: "Назначить" }));
    expect(await screen.findByText("Нет доступа к назначению ответственного")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Изменить ответственного" })).not.toBeInTheDocument(),
    );
  });
});

/* ------------------------------------------------------------- conflict */

describe("conflict handling", () => {
  it("refetches the current owner on 409 and does not apply the attempted owner", async () => {
    const h = harness({
      reads: [readOk(alpha, 1), readOk(beta, 2)], // initial, then the refetch after conflict
      candidateOutcomes: [candidates([alpha, beta])],
      mutations: [{ status: "conflict" }],
    });
    renderSection(h);
    await screen.findByText("Владелец Альфа");
    await userEvent.click(await editButton());
    await userEvent.selectOptions(await screen.findByLabelText("Ответственный"), "emp_beta");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await userEvent.click(await screen.findByRole("button", { name: "Назначить" }));

    expect(await screen.findByText("Ответственный уже изменён другим сотрудником. Данные обновлены.")).toBeInTheDocument();
    // The refetched owner is shown (beta/2), not the attempted selection applied blindly.
    expect(screen.getByText("Владелец Бета")).toBeInTheDocument();
    // Exactly one mutation attempt: no automatic retry.
    expect(h.setCalls).toHaveLength(1);
    // Two reads: the initial and the post-conflict refetch.
    expect(h.readCalls).toHaveLength(2);
  });
});

/* --------------------------------------------------------- stale + hygiene */

describe("stale route and hygiene", () => {
  it("clears the previous owner and refetches when the userId changes", async () => {
    const h = harness({ reads: [readOk(alpha, 1), readOk(beta, 5)] });
    const { rerender } = renderSection(h);
    expect(await screen.findByText("Владелец Альфа")).toBeInTheDocument();
    rerender(
      <ApiUserOwnerSection
        userId="34"
        canAssign
        provider={h.provider}
        onUnauthenticated={noop}
        onLearnerNotFound={noop}
        onForbidden={noop}
      />,
    );
    expect(await screen.findByText("Владелец Бета")).toBeInTheDocument();
    expect(screen.queryByText("Владелец Альфа")).not.toBeInTheDocument();
    expect(h.readCalls).toEqual(["12", "34"]);
  });

  it("writes nothing to storage", async () => {
    renderSection(harness({ reads: [readOk(alpha, 1)] }));
    await screen.findByText("Владелец Альфа");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("never leaks employeeId, version or forbidden metadata into the DOM", async () => {
    renderSection(harness({ reads: [readOk(alpha, 7)] }), false);
    await screen.findByText("Владелец Альфа");
    const html = document.body.innerHTML;
    expect(html).not.toContain("emp_alpha");
    expect(html).not.toContain("ownerVersion");
    // The version value 7 must not surface as owner metadata text.
    expect(screen.queryByText("7")).not.toBeInTheDocument();
  });
});
