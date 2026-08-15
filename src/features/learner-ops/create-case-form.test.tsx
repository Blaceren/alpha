/**
 * LO-UI-CASE-CREATE-1 — regressions for the create affordance.
 *
 * Each of these fails against the pre-fix CRM, where the component did not
 * exist and the queue rendered no create control at all. The two that matter
 * most are the ones that are NOT about the happy path: that the anchor-required
 * types are never offered, and that hiding the button is not the permission
 * boundary.
 */
import * as React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createCase = vi.fn();
const fetchUsers = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/application/api/users-client", () => ({
  fetchUsers: (...args: unknown[]) => fetchUsers(...args),
}));
vi.mock("@/application/api/learner-ops-client", () => ({
  createCase: (...args: unknown[]) => createCase(...args),
}));

import {
  ANCHOR_REQUIRED_TYPES,
  CreateCaseForm,
  STAFF_ORIGINATABLE_TYPES,
} from "./create-case-form";

const CONFIG = {
  queues: [
    { key: "support", name: "Поддержка", description: null },
    { key: "escalation", name: "Эскалации", description: null },
  ],
  reasonCodes: [
    { code: "complaint", category: "complaint", label: "Жалоба" },
    { code: "followup", category: "operations", label: "Операционное сопровождение" },
  ],
  slaPolicies: [],
  assignableStaff: [],
};

const LEARNER_PAGE = {
  status: "success",
  page: {
    items: [
      {
        userId: "71",
        displayName: "LO Support Learner (synthetic)",
        email: { value: "l***@l***.invalid", visibility: "masked" },
        status: "active",
        level: 1,
        emailConfirmed: true,
        createdAt: "2026-08-15T00:00:00.000Z",
        owner: null,
      },
    ],
    nextCursor: null,
  },
};

async function pickLearner(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Ученик"), "Support");
  await waitFor(() => expect(fetchUsers).toHaveBeenCalled());
  await user.click(await screen.findByRole("button", { name: /LO Support Learner/ }));
}

function renderForm(onCreated = vi.fn()) {
  return render(
    <CreateCaseForm config={CONFIG as never} onCreated={onCreated} onCancel={vi.fn()} />,
  );
}

describe("create case — the staff-originatable vocabulary", () => {
  beforeEach(() => {
    createCase.mockReset().mockResolvedValue({ status: "success", data: { id: "case_new" } });
    fetchUsers.mockReset().mockResolvedValue(LEARNER_PAGE);
    push.mockReset();
  });

  it("offers exactly the five types the domain can create without an anchor", () => {
    renderForm();
    const select = screen.getByLabelText("Тип");
    const values = within(select)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual([...STAFF_ORIGINATABLE_TYPES]);
    expect(values).toHaveLength(5);
  });

  it("NEVER offers a type that requires a canonical anchor", () => {
    // report_review needs a ReportSubmission and mentor_review needs a
    // UserLevelProgress — enforced by the domain and by a CHECK constraint. A
    // blank form cannot supply either, so offering them would be a control that
    // can only fail.
    renderForm();
    const values = within(screen.getByLabelText("Тип"))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    for (const forbidden of ANCHOR_REQUIRED_TYPES) {
      expect(values, `${forbidden} must not be offered`).not.toContain(forbidden);
    }
  });

  it("draws queues and reason codes from the canonical config read, not a hardcoded list", () => {
    renderForm();
    expect(
      within(screen.getByLabelText("Очередь"))
        .getAllByRole("option")
        .map((o) => (o as HTMLOptionElement).value),
    ).toEqual(["support", "escalation"]);
    expect(
      within(screen.getByLabelText("Причина"))
        .getAllByRole("option")
        .map((o) => (o as HTMLOptionElement).value),
    ).toEqual(["", "complaint", "followup"]);
  });
});

describe("create case — the learner picker", () => {
  beforeEach(() => {
    createCase.mockReset().mockResolvedValue({ status: "success", data: { id: "case_new" } });
    fetchUsers.mockReset().mockResolvedValue(LEARNER_PAGE);
    push.mockReset();
  });

  it("does not fetch anybody until a real search term is typed", async () => {
    const user = userEvent.setup();
    renderForm();
    // A dropdown that loads the whole user table is the thing this must not be.
    expect(fetchUsers).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Ученик"), "L");
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchUsers).not.toHaveBeenCalled();
  });

  it("searches with a bounded limit once the term is long enough", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Ученик"), "Support");
    await waitFor(() => expect(fetchUsers).toHaveBeenCalled());
    expect(fetchUsers).toHaveBeenCalledWith({ search: "Support", limit: 10 });
  });

  it("shows that an address is masked rather than presenting it as the whole one", async () => {
    const user = userEvent.setup();
    renderForm();
    await pickLearner(user);
    expect(screen.getByText(/скрыт/)).toBeInTheDocument();
  });
});

describe("create case — submission", () => {
  beforeEach(() => {
    createCase.mockReset().mockResolvedValue({ status: "success", data: { id: "case_new" } });
    fetchUsers.mockReset().mockResolvedValue(LEARNER_PAGE);
    push.mockReset();
  });

  it("refuses to submit until learner, subject and description are all present", async () => {
    const user = userEvent.setup();
    renderForm();
    const submit = screen.getByRole("button", { name: "Создать кейс" });
    expect(submit).toBeDisabled();

    await pickLearner(user);
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("Тема"), "Тема");
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("Описание"), "Описание");
    expect(submit).toBeEnabled();
  });

  it("calls the CANONICAL create endpoint with exactly what the operator chose", async () => {
    const user = userEvent.setup();
    renderForm();
    await pickLearner(user);
    await user.selectOptions(screen.getByLabelText("Тип"), "operational_followup");
    await user.selectOptions(screen.getByLabelText("Приоритет"), "high");
    await user.selectOptions(screen.getByLabelText("Причина"), "followup");
    await user.type(screen.getByLabelText("Тема"), "Сопровождение");
    await user.type(screen.getByLabelText("Описание"), "Контекст");
    await user.click(screen.getByRole("button", { name: "Создать кейс" }));

    await waitFor(() => expect(createCase).toHaveBeenCalledTimes(1));
    expect(createCase).toHaveBeenCalledWith({
      userId: 71,
      type: "operational_followup",
      queueKey: "support",
      subject: "Сопровождение",
      details: "Контекст",
      priority: "high",
      reasonCode: "followup",
    });
  });

  it("opens the canonical case-detail route after a successful create", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    renderForm(onCreated);
    await pickLearner(user);
    await user.type(screen.getByLabelText("Тема"), "Тема");
    await user.type(screen.getByLabelText("Описание"), "Описание");
    await user.click(screen.getByRole("button", { name: "Создать кейс" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/cases/case_new"));
    expect(onCreated).toHaveBeenCalled();
  });

  it("cannot create two cases from a double click", async () => {
    let resolve!: (v: unknown) => void;
    createCase.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    renderForm();
    await pickLearner(user);
    await user.type(screen.getByLabelText("Тема"), "Тема");
    await user.type(screen.getByLabelText("Описание"), "Описание");

    const submit = screen.getByRole("button", { name: "Создать кейс" });
    await user.click(submit);
    await user.click(submit);
    await user.click(submit);

    expect(createCase).toHaveBeenCalledTimes(1);
    resolve({ status: "success", data: { id: "case_new" } });
  });

  it("surfaces a server refusal instead of pretending the case was created", async () => {
    createCase.mockResolvedValue({ status: "forbidden" });
    const user = userEvent.setup();
    renderForm();
    await pickLearner(user);
    await user.type(screen.getByLabelText("Тема"), "Тема");
    await user.type(screen.getByLabelText("Описание"), "Описание");
    await user.click(screen.getByRole("button", { name: "Создать кейс" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/нет прав/i);
    // And it must NOT navigate as though something had been created.
    expect(push).not.toHaveBeenCalled();
  });

  it("surfaces a validation refusal from the server", async () => {
    createCase.mockResolvedValue({ status: "invalid_input", detail: "subject must not be empty" });
    const user = userEvent.setup();
    renderForm();
    await pickLearner(user);
    await user.type(screen.getByLabelText("Тема"), "Тема");
    await user.type(screen.getByLabelText("Описание"), "Описание");
    await user.click(screen.getByRole("button", { name: "Создать кейс" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Некорректные данные/);
    expect(push).not.toHaveBeenCalled();
  });
});
