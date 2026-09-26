"use client";

/**
 * PHASE-1 ADMIN — «Прогресс Академии» on the CRM learner detail.
 *
 * WHAT IT REPLACES. The detail used to carry a section headed «Прогресс» whose
 * two rows were `User.level` and `User.xp` — the LEGACY V1 columns, which read 1
 * and 0 for every PREPROD learner including the two who have completed fourteen
 * V2 levels. An operator was reading a number that had no relationship to the
 * learner's Academy progress. This section reads the canonical V2 owner instead,
 * and the legacy pair is kept only where it is explicitly labelled V1.
 *
 * THE BUTTON IS NOT THE AUTHORIZATION. It is mounted only when the session's
 * `effectivePermissions` contain `curriculum_progress_override`, but the backend
 * re-checks the same permission on the preview and on the mutation, and neither
 * trusts anything this component sends. Hiding a control is a courtesy to the
 * operator, never a security boundary.
 */

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useSession } from "@/components/crm-shell/session-context";
import { sessionGrants } from "@/domain/identity/access";
import {
  fetchProgression,
  type ProgressionOutcome,
  type ProgressionSnapshot,
  type ProgressionSnapshotEnrolled,
} from "@/application/api/progression-client";
import { ProgressionAdjustDialog } from "./api-user-progression-adjust";

const LEVEL_TYPE_LABEL: Record<string, string> = {
  lesson: "Урок",
  report: "Отчёт",
  mentor_review: "Проверка ментора",
  financial_checkpoint: "Финансовая контрольная точка",
  external_event: "Внешнее событие",
  final_exam: "Итоговый экзамен",
  scenario: "Сценарий",
  practice: "Практика",
};

export function levelTypeLabel(type: string): string {
  return LEVEL_TYPE_LABEL[type] ?? type;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 last:border-0">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right text-text-primary">{children}</dd>
    </div>
  );
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; snapshot: ProgressionSnapshot }
  | { kind: "error"; outcome: ProgressionOutcome<ProgressionSnapshot> };

export function ApiUserProgressionSection({
  userId,
  legacyLevel,
  legacyXp,
}: {
  userId: string;
  /** V1 storage, shown only under an explicit LEGACY label. */
  legacyLevel: number;
  legacyXp: number;
}) {
  const { session } = useSession();
  const canAdjust = sessionGrants(session, "curriculum_progress_override");

  const [state, setState] = React.useState<LoadState>({ kind: "loading" });
  const [nonce, setNonce] = React.useState(0);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetchProgression(userId).then((outcome) => {
      if (cancelled) return;
      setState(
        outcome.status === "success"
          ? { kind: "ready", snapshot: outcome.data }
          : { kind: "error", outcome },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [userId, nonce]);

  // After a successful correction the canonical state is REFETCHED. Nothing is
  // optimistically applied: the only number an operator should ever see here is
  // one the progression owner just confirmed.
  const refetch = React.useCallback(() => setNonce((n) => n + 1), []);

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
          Прогресс Академии
        </h2>
        {state.kind === "ready" && state.snapshot.kind === "enrolled" ? (
          <span className="text-2xs text-text-muted">
            Программа {state.snapshot.curriculumCode} · версия{" "}
            {state.snapshot.curriculumVersionNumber}
          </span>
        ) : null}
      </div>

      {state.kind === "loading" ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Загружаем прогресс</span>
          <SkeletonRows rows={3} />
        </div>
      ) : null}

      {state.kind === "error" ? (
        <p role="status" aria-live="polite" className="text-sm text-text-secondary">
          {state.outcome.status === "forbidden"
            ? "Нет доступа к прогрессу Академии."
            : "Не удалось загрузить прогресс Академии."}
        </p>
      ) : null}

      {state.kind === "ready" && state.snapshot.kind === "not_enrolled" ? (
        <p className="text-sm text-text-secondary">
          Учащийся не зачислен на канонический курс — прогресс V2 отсутствует.
        </p>
      ) : null}

      {state.kind === "ready" && state.snapshot.kind === "enrolled" ? (
        <EnrolledView
          snapshot={state.snapshot}
          userId={userId}
          canAdjust={canAdjust}
          legacyLevel={legacyLevel}
          legacyXp={legacyXp}
          onOpenDialog={() => setDialogOpen(true)}
        />
      ) : null}

      {dialogOpen && state.kind === "ready" && state.snapshot.kind === "enrolled" ? (
        <ProgressionAdjustDialog
          userId={userId}
          snapshot={state.snapshot}
          onClose={() => setDialogOpen(false)}
          onApplied={() => {
            setDialogOpen(false);
            refetch();
          }}
        />
      ) : null}
    </section>
  );
}

function EnrolledView({
  snapshot,
  userId,
  canAdjust,
  legacyLevel,
  legacyXp,
  onOpenDialog,
}: {
  snapshot: ProgressionSnapshotEnrolled;
  userId: string;
  canAdjust: boolean;
  legacyLevel: number;
  legacyXp: number;
  onOpenDialog: () => void;
}) {
  const current = snapshot.currentLevelDefinition;
  return (
    <>
      {!snapshot.consistent ? (
        <p
          role="alert"
          className="mb-3 rounded border border-danger-border bg-danger-surface p-2 text-xs text-danger-text"
        >
          Состояние прогресса несогласованно: счётчики уровня не совпадают с
          завершёнными уровнями. Корректировка может быть отклонена — сначала
          разберите причину.
        </p>
      ) : null}

      <dl className="text-sm">
        <Row label="Пройдено уровней">
          <span className="tabular-nums">
            {snapshot.highestCompletedLevel} из {snapshot.totalLevels}
          </span>
        </Row>
        <Row label="Текущий уровень">
          <span className="tabular-nums">L{snapshot.currentLevel}</span>
          {current ? (
            <>
              <span className="text-text-muted"> · {current.title}</span>
              <span className="ml-2 text-2xs text-text-muted">
                {levelTypeLabel(current.type)}
              </span>
            </>
          ) : (
            <span className="text-text-muted"> · курс завершён</span>
          )}
        </Row>
        <Row label="XP (V2)">
          <span className="tabular-nums">
            {snapshot.xpTotal === null ? "—" : snapshot.xpTotal}
          </span>
        </Row>
        <Row label="Инструменты">
          <span className="tabular-nums">
            {snapshot.toolsUnlockedCount} из {snapshot.toolsTotal}
          </span>
        </Row>
        <Row label="Уровень V1 (legacy)">
          <span className="tabular-nums text-text-muted">{legacyLevel}</span>
          <Badge tone="neutral">
            <span className="text-2xs">не прогресс Академии</span>
          </Badge>
        </Row>
        <Row label="XP V1 (legacy)">
          <span className="tabular-nums text-text-muted">{legacyXp}</span>
        </Row>
      </dl>

      {canAdjust ? (
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="secondary" onClick={onOpenDialog}>
            Скорректировать прогресс
          </Button>
        </div>
      ) : null}

      <p className="sr-only" data-testid="progression-learner-id">
        {userId}
      </p>
    </>
  );
}
