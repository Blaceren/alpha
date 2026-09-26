import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sessionFromDto } from "@/domain/identity/session";
import { AuthenticatedSessionProvider } from "@/components/crm-shell/session-context";
import { resetClientRuntimeMode, setClientRuntimeMode } from "@/config/client-runtime-mode";
import type { CrmRole } from "@/domain/identity/roles";
import type { Permission } from "@/domain/identity/roles";
import { ApiUserProgressionSection } from "./api-user-progression";
import * as client from "@/application/api/progression-client";

/**
 * PHASE-1 ADMIN — the CRM half.
 *
 * These tests are about what an operator is SHOWN and what they can REACH. The
 * backend re-checks every permission independently, so nothing here is a
 * security assertion; it is an assertion that the screen does not lie and does
 * not offer a control that would only fail.
 */

const SNAPSHOT: client.ProgressionSnapshot = {
  kind: "enrolled",
  learnerUserId: 73,
  enrollmentId: 34,
  enrollmentStatus: "active",
  curriculumCode: "ata-v2",
  curriculumVersionId: 4,
  curriculumVersionNumber: 4,
  curriculumStatus: "published",
  totalLevels: 100,
  highestCompletedLevel: 14,
  currentLevel: 15,
  currentLevelDefinition: {
    levelNumber: 15,
    stableCode: "v2.l015.kontrolnaya-tochka",
    title: "Контрольная точка",
    type: "financial_checkpoint",
    completionMethod: "balance_check",
    xpReward: 0,
  },
  completedLevelCount: 14,
  xpTotal: 1700,
  toolsUnlockedCount: 1,
  toolsTotal: 19,
  consistent: true,
  levels: [
    {
      levelNumber: 15,
      stableCode: "v2.l015.kontrolnaya-tochka",
      title: "Контрольная точка",
      type: "financial_checkpoint",
      completionMethod: "balance_check",
      xpReward: 0,
      status: "none",
    },
    {
      levelNumber: 16,
      stableCode: "v2.l016.urok",
      title: "Урок 16",
      type: "lesson",
      completionMethod: "assessment_pass",
      xpReward: 100,
      status: "none",
    },
  ],
};

function renderSection(role: CrmRole, permissions: Permission[]) {
  const session = sessionFromDto({
    employeeId: "emp_stub_1",
    displayName: "Оператор",
    role,
    effectivePermissions: permissions,
    permissionVersion: 1,
    expiresAt: "2099-12-31T23:59:59.000Z",
  });
  return render(
    <AuthenticatedSessionProvider session={session}>
      <ApiUserProgressionSection userId="73" legacyLevel={1} legacyXp={0} />
    </AuthenticatedSessionProvider>,
  );
}

beforeEach(() => {
  setClientRuntimeMode("api");
  vi.restoreAllMocks();
});
afterEach(() => {
  resetClientRuntimeMode();
  vi.restoreAllMocks();
});

describe("canonical V2 presentation", () => {
  it("shows V2 progression, not the legacy level", async () => {
    vi.spyOn(client, "fetchProgression").mockResolvedValue({
      status: "success",
      data: SNAPSHOT,
    });

    renderSection("progression_operator", ["curriculum_progress_override"]);

    await waitFor(() => expect(screen.getByText("Прогресс Академии")).toBeInTheDocument());
    expect(screen.getByText("14 из 100")).toBeInTheDocument();
    expect(screen.getByText("L15")).toBeInTheDocument();
    // The V2 ledger total, never `User.xp`.
    expect(screen.getByText("1700")).toBeInTheDocument();
    expect(screen.getByText("1 из 19")).toBeInTheDocument();
  });

  it("labels the legacy pair as V1 and never as Academy progression", async () => {
    vi.spyOn(client, "fetchProgression").mockResolvedValue({
      status: "success",
      data: SNAPSHOT,
    });

    renderSection("progression_operator", ["curriculum_progress_override"]);

    await waitFor(() =>
      expect(screen.getByText("Уровень V1 (legacy)")).toBeInTheDocument(),
    );
    expect(screen.getByText("не прогресс Академии")).toBeInTheDocument();
    // The old heading is gone. A section headed «Прогресс» over `User.level` is
    // the exact defect this replaced.
    expect(screen.queryByText("Прогресс")).not.toBeInTheDocument();
  });

  it("warns when the enrollment is inconsistent instead of hiding it", async () => {
    vi.spyOn(client, "fetchProgression").mockResolvedValue({
      status: "success",
      data: { ...SNAPSHOT, consistent: false } as client.ProgressionSnapshot,
    });

    renderSection("progression_operator", ["curriculum_progress_override"]);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("несогласованно");
  });

  it("says so plainly when the learner is not enrolled", async () => {
    vi.spyOn(client, "fetchProgression").mockResolvedValue({
      status: "success",
      data: { kind: "not_enrolled", learnerUserId: 73 },
    });

    renderSection("progression_operator", ["curriculum_progress_override"]);

    await waitFor(() =>
      expect(screen.getByText(/не зачислен на канонический курс/)).toBeInTheDocument(),
    );
  });
});

describe("the adjust affordance", () => {
  it("is absent without curriculum_progress_override", async () => {
    vi.spyOn(client, "fetchProgression").mockResolvedValue({
      status: "success",
      data: SNAPSHOT,
    });

    // Every role that must NOT see the control, including the ones that hold
    // broad Learner Operations authority.
    for (const [role, permissions] of [
      ["support", ["learner_ops_view", "learner_ops_handle"]],
      ["moderator", ["community_moderate"]],
      ["mentor", ["learner_ops_view", "learner_ops_mentor_review"]],
      ["crm_admin", ["manage_settings", "view_audit", "learner_ops_admin"]],
      ["crm_manager", ["view_audit", "learner_ops_view"]],
      ["analyst", ["learner_ops_analytics"]],
      ["read_only", ["learner_ops_view"]],
    ] as [CrmRole, Permission[]][]) {
      const view = renderSection(role, permissions);
      await waitFor(() =>
        expect(screen.getAllByText("Прогресс Академии").length).toBeGreaterThan(0),
      );
      expect(
        screen.queryByRole("button", { name: "Скорректировать прогресс" }),
        `${role} must not be offered the control`,
      ).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("is present for the progression operator", async () => {
    vi.spyOn(client, "fetchProgression").mockResolvedValue({
      status: "success",
      data: SNAPSHOT,
    });

    renderSection("progression_operator", ["curriculum_progress_override"]);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Скорректировать прогресс" }),
      ).toBeInTheDocument(),
    );
  });
});

describe("the correction dialog", () => {
  async function openDialog() {
    vi.spyOn(client, "fetchProgression").mockResolvedValue({
      status: "success",
      data: SNAPSHOT,
    });
    renderSection("progression_operator", ["curriculum_progress_override"]);
    const button = await screen.findByRole("button", { name: "Скорректировать прогресс" });
    await userEvent.click(button);
    return screen.getByRole("dialog");
  }

  it("offers only forward targets and no decrement control", async () => {
    await openDialog();
    // L16 is ahead; L15 (the current level) is not a target.
    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options.some((text) => text.includes("L16"))).toBe(true);
    expect(options.some((text) => text.includes("L15 ·"))).toBe(false);
    // No minus/plus stepper exists — backward is not a disabled affordance.
    expect(screen.queryByRole("button", { name: "−" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "-" })).not.toBeInTheDocument();
  });

  it("completes the whole operator flow: preview → confirm → refetch", async () => {
    await openDialog();

    const applicablePlan = {
      learnerUserId: 73,
      enrollmentId: 34,
      curriculumCode: "ata-v2",
      curriculumVersionId: 4,
      curriculumVersionNumber: 4,
      totalLevels: 100,
      fromCurrentLevel: 15,
      fromHighestCompletedLevel: 14,
      targetCurrentLevel: 16,
      targetStableCode: "v2.l016.urok",
      levels: [
        {
          levelNumber: 15,
          stableCode: "v2.l015.kontrolnaya-tochka",
          title: "Урок 15",
          type: "lesson",
          completionMethod: "assessment_pass",
          xpReward: 100,
          currentStatus: "none" as const,
        },
      ],
      xpTotal: 100,
      toolsUnlocked: [],
      communitySpacesOpened: [],
      warnings: [],
      blocker: null,
      canApply: true,
      refusalCode: null,
    };
    vi.spyOn(client, "previewProgression").mockResolvedValue({
      status: "success",
      data: applicablePlan,
    });
    const adjust = vi.spyOn(client, "adjustProgression").mockResolvedValue({
      status: "success",
      data: {
        created: true,
        learnerUserId: 73,
        enrollmentId: 34,
        curriculumVersionId: 4,
        fromCurrentLevel: 15,
        toCurrentLevel: 16,
        levelsCompleted: [15],
        xpAwarded: 100,
        xpTransactionIds: [901],
        auditLogId: 5001,
        adjustedAt: "2026-08-30T12:00:00.000Z",
      },
    });

    await userEvent.selectOptions(screen.getAllByRole("combobox")[0]!, "v2.l016.urok");
    // The reason textarea; the reference input is the other textbox.
    const reason = screen
      .getAllByRole("textbox")
      .find((node) => node.tagName.toLowerCase() === "textarea")!;
    await userEvent.type(reason, "Корректирую состояние после сбоя импорта.");
    await userEvent.click(screen.getByRole("button", { name: "Проверить последствия" }));

    const confirm = await screen.findByRole("button", { name: "Подтвердить корректировку" });
    await userEvent.click(confirm);

    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(1));
    // The plan's own from-state travels with the confirm — never a value the
    // component recomputed, and never one the operator could edit.
    const [, body] = adjust.mock.calls[0]!;
    expect(body.expectedCurrentLevel).toBe(15);
    expect(body.expectedCurriculumVersionId).toBe(4);
    expect(body.targetStableCode).toBe("v2.l016.urok");
    expect(body.reasonCode).toBe("preprod_qa");
    expect(body.reasonText.length).toBeGreaterThanOrEqual(10);
    expect(body.requestId).toMatch(/^crm-progression-/);

    await screen.findByText(/Учащийся переведён на L16/);
  });

  it("does not offer confirm until the server previewed an applicable plan", async () => {
    await openDialog();
    expect(
      screen.queryByRole("button", { name: "Подтвердить корректировку" }),
    ).not.toBeInTheDocument();

    vi.spyOn(client, "previewProgression").mockResolvedValue({
      status: "success",
      data: {
        learnerUserId: 73,
        enrollmentId: 34,
        curriculumCode: "ata-v2",
        curriculumVersionId: 4,
        curriculumVersionNumber: 4,
        totalLevels: 100,
        fromCurrentLevel: 15,
        fromHighestCompletedLevel: 14,
        targetCurrentLevel: 16,
        targetStableCode: "v2.l016.urok",
        levels: [],
        xpTotal: 0,
        toolsUnlocked: [],
        communitySpacesOpened: [],
        warnings: [],
        blocker: {
          levelNumber: 15,
          stableCode: "v2.l015.kontrolnaya-tochka",
          title: "Контрольная точка",
          type: "financial_checkpoint",
          reason: "protected_authority_gate",
        },
        canApply: false,
        refusalCode: "PROGRESSION_ADJUST_GATE_LEVEL_REFUSED",
      },
    });

    // The first combobox is the target selector; the second is the reason code.
    await userEvent.selectOptions(screen.getAllByRole("combobox")[0]!, "v2.l016.urok");
    await userEvent.click(screen.getByRole("button", { name: "Проверить последствия" }));

    await waitFor(() =>
      expect(screen.getByText(/подтверждается отдельной authority/)).toBeInTheDocument(),
    );
    // A blocked plan never yields a confirm button, and there is no override.
    expect(
      screen.queryByRole("button", { name: "Подтвердить корректировку" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/override anyway/i)).not.toBeInTheDocument();
  });
});
