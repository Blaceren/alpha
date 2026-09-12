"use client";

import * as React from "react";
import type { CrmApiOwnerCandidate } from "@/data/contracts/api/user-owner";
import type { CrmUsersReadCapability } from "@/data/api/api-crm-data-provider";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useApiUserOwner } from "./use-api-user-owner";

/**
 * Production Owner v1 — the single current owner of one learner.
 *
 * Deliberately NOT the mock owner UI. The production contract carries exactly
 * two fields (employeeId + displayName). There is no StaffRole, email, workload,
 * team, history or audit, and none is invented here. Ownership is informational
 * only: this section grants no other authority.
 *
 * Every affordance is decided by `assign_owner` from the validated session,
 * handed down as `canAssign` — never by a role name. The current owner is shown
 * to every StaffProfile; the editing controls mount only for `canAssign`.
 */

const UNASSIGNED_VALUE = "__unassigned__";

/** The value a native <option> carries for a candidate — kept an exact string. */
function optionValue(employeeId: string): string {
  return employeeId;
}

export function ApiUserOwnerSection({
  userId,
  canAssign,
  provider,
  onUnauthenticated,
  onLearnerNotFound,
  onForbidden,
  sessionKey,
}: {
  userId: string;
  canAssign: boolean;
  provider?: CrmUsersReadCapability;
  onUnauthenticated: () => void;
  onLearnerNotFound: () => void;
  onForbidden: () => void;
  sessionKey?: string;
}) {
  const owner = useApiUserOwner(
    userId,
    canAssign,
    provider,
    { onUnauthenticated, onLearnerNotFound, onForbidden },
    sessionKey,
  );

  const [editing, setEditing] = React.useState(false);
  // "" is never a valid employeeId; the sentinel keeps "unassigned" a first-class
  // selectable value distinct from "nothing chosen".
  const [selected, setSelected] = React.useState<string>(UNASSIGNED_VALUE);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const currentValue = owner.owner ? optionValue(owner.owner.employeeId) : UNASSIGNED_VALUE;

  // Reset the editing surface whenever the learner changes.
  React.useEffect(() => {
    setEditing(false);
    setSelected(UNASSIGNED_VALUE);
    setConfirmOpen(false);
  }, [userId]);

  // A validated success or a conflict both end the editing session. A conflict
  // has already refetched the owner; the employee must choose again explicitly.
  React.useEffect(() => {
    if (
      owner.mutationState.kind === "success" ||
      owner.mutationState.kind === "conflict" ||
      owner.mutationState.kind === "conflict_refetch_failed"
    ) {
      setEditing(false);
      setConfirmOpen(false);
      setSelected(UNASSIGNED_VALUE);
    }
    // A candidate that turned out unavailable keeps the editor open (the list is
    // reloading); close only the dialog.
    if (owner.mutationState.kind === "candidate_unavailable") setConfirmOpen(false);
  }, [owner.mutationState.kind]);

  // When the backend withdraws assignment (candidate or mutation 403), leave the
  // editor so the read-only current owner is shown again rather than vanishing.
  React.useEffect(() => {
    if (owner.assignForbidden) {
      setEditing(false);
      setConfirmOpen(false);
    }
  }, [owner.assignForbidden]);

  const startEditing = React.useCallback(() => {
    owner.resetMutation();
    setSelected(currentValue);
    setEditing(true);
    owner.loadCandidates();
  }, [owner, currentValue]);

  const cancelEditing = React.useCallback(() => {
    setEditing(false);
    setConfirmOpen(false);
    setSelected(UNASSIGNED_VALUE);
    owner.resetMutation();
  }, [owner]);

  // Build the select options. The current owner is always representable, even if
  // it is no longer an eligible candidate (e.g. a now-blocked owner), so the
  // select can show the real current selection.
  const options = React.useMemo<CrmApiOwnerCandidate[]>(() => {
    const list = [...owner.candidates];
    if (owner.owner && !list.some((c) => c.employeeId === owner.owner!.employeeId)) {
      list.unshift(owner.owner);
    }
    return list;
  }, [owner.candidates, owner.owner]);

  const changed = selected !== currentValue;
  const selectedCandidate = options.find((c) => optionValue(c.employeeId) === selected) ?? null;
  const willUnassign = selected === UNASSIGNED_VALUE;

  const openConfirm = React.useCallback(() => {
    if (!changed) return;
    owner.resetMutation();
    setConfirmOpen(true);
  }, [changed, owner]);

  const confirm = React.useCallback(() => {
    // Single-flight is enforced in the hook; disabling the button is the UI half.
    owner.assign(willUnassign ? null : selected);
  }, [owner, willUnassign, selected]);

  const pending = owner.mutationState.kind === "pending";

  const statusMessage =
    owner.mutationState.kind === "success"
      ? "Ответственный обновлён"
      : owner.mutationState.kind === "conflict"
        ? "Ответственный уже изменён другим сотрудником. Данные обновлены."
        : null;

  const errorMessage =
    owner.mutationState.kind === "candidate_unavailable"
      ? "Сотрудник недоступен для назначения"
      : owner.mutationState.kind === "forbidden"
        ? "Нет доступа к назначению ответственного"
        : owner.mutationState.kind === "invalid_input"
          ? "Не удалось проверить запрос. Попробуйте ещё раз."
          : owner.mutationState.kind === "failed"
            ? "Не удалось обновить ответственного. Попробуйте ещё раз."
            : owner.mutationState.kind === "conflict_refetch_failed"
              ? "Ответственный изменён, но обновить данные не удалось. Обновите раздел."
              : null;

  const showControls = canAssign && !owner.assignForbidden;

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-text-muted">
        Ответственный
      </h2>

      {owner.readState.kind === "loading" ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Загружаем ответственного</span>
          <SkeletonRows rows={1} />
        </div>
      ) : null}

      {owner.readState.kind === "upstream_unavailable" || owner.readState.kind === "malformed" ? (
        <div role="alert">
          <p className="text-xs text-danger">
            {owner.readState.kind === "malformed"
              ? "Ответ сервиса не прошёл проверку. Ответственный не показан."
              : "Не удалось загрузить ответственного."}
          </p>
          <Button variant="secondary" className="mt-2" onClick={owner.retryOwner}>
            Повторить
          </Button>
        </div>
      ) : null}

      {owner.readState.kind === "invalid_input" ? (
        <p role="alert" className="text-xs text-danger">
          Некорректный запрос ответственного
        </p>
      ) : null}

      {owner.readState.kind === "ready" ? (
        <>
          {/* The stated current owner is ALWAYS rendered (even while editing),
              so it is unambiguous to read and never disappears when controls are
              withdrawn. The <select> options repeat these names, so callers must
              read the owner from this element, not by matching the name text. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <dl className="text-sm">
              <dt className="sr-only">Текущий ответственный</dt>
              <dd className="text-text-primary" data-testid="crm-owner-current">
                {owner.owner ? (
                  <span className="break-words">{owner.owner.displayName}</span>
                ) : (
                  <span className="text-text-secondary">Не назначен</span>
                )}
              </dd>
            </dl>
            {showControls && !editing ? (
              <Button variant="secondary" onClick={startEditing}>
                Изменить ответственного
              </Button>
            ) : null}
          </div>

          {editing && showControls ? (
            <OwnerEditor
              candidatesState={owner.candidatesState}
              options={options}
              selected={selected}
              onSelect={setSelected}
              changed={changed}
              pending={pending}
              onSave={openConfirm}
              onCancel={cancelEditing}
              onRetryCandidates={owner.loadCandidates}
            />
          ) : null}

          {/* Polite status: announced even though the owner row also updates. */}
          <p role="status" aria-live="polite" className="mt-2 text-2xs text-text-secondary">
            {statusMessage ?? ""}
          </p>

          {/* Section-level denial: the backend forbade assignment (candidate or
              mutation 403). Controls are withdrawn and the current owner stays
              visible. Rendered here because the editor itself has unmounted. */}
          {canAssign && owner.assignForbidden ? (
            <p role="alert" className="mt-1 text-2xs text-danger">
              Нет доступа к назначению ответственного
            </p>
          ) : errorMessage ? (
            <p role="alert" className="mt-1 text-2xs text-danger">
              {errorMessage}
            </p>
          ) : null}
        </>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={(open) => (open ? null : setConfirmOpen(false))}>
        {confirmOpen ? (
          <DialogContent
            title={willUnassign ? "Снять ответственного?" : "Назначить ответственного?"}
            description={
              willUnassign
                ? "У пользователя не будет назначенного ответственного."
                : `Ответственным станет: ${selectedCandidate?.displayName ?? ""}.`
            }
          >
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={pending}>
                Отмена
              </Button>
              <Button variant={willUnassign ? "danger" : "primary"} onClick={confirm} disabled={pending}>
                {pending ? "Сохраняем…" : willUnassign ? "Снять" : "Назначить"}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </section>
  );
}

function OwnerEditor({
  candidatesState,
  options,
  selected,
  onSelect,
  changed,
  pending,
  onSave,
  onCancel,
  onRetryCandidates,
}: {
  candidatesState: ReturnType<typeof useApiUserOwner>["candidatesState"];
  options: CrmApiOwnerCandidate[];
  selected: string;
  onSelect: (value: string) => void;
  changed: boolean;
  pending: boolean;
  onSave: () => void;
  onCancel: () => void;
  onRetryCandidates: () => void;
}) {
  const id = React.useId();
  const selectId = `${id}-owner`;

  return (
    <div className="mt-1 space-y-3">
      {candidatesState.kind === "loading" ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Загружаем сотрудников</span>
          <SkeletonRows rows={1} />
        </div>
      ) : null}

      {candidatesState.kind === "forbidden" ? (
        <p role="alert" className="text-xs text-danger">
          Нет доступа к назначению ответственного
        </p>
      ) : null}

      {candidatesState.kind === "unavailable" ? (
        <div role="alert">
          <p className="text-xs text-danger">Не удалось загрузить список сотрудников.</p>
          <Button variant="secondary" className="mt-2" onClick={onRetryCandidates}>
            Повторить
          </Button>
        </div>
      ) : null}

      {candidatesState.kind === "loaded" ? (
        <div className="space-y-2">
          <label htmlFor={selectId} className="block text-xs font-medium text-text-primary">
            Ответственный
          </label>
          <select
            id={selectId}
            value={selected}
            disabled={pending}
            onChange={(event) => onSelect(event.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <option value={UNASSIGNED_VALUE}>Без ответственного</option>
            {options.map((candidate) => (
              <option key={candidate.employeeId} value={optionValue(candidate.employeeId)}>
                {candidate.displayName}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onSave} disabled={pending || !changed || candidatesState.kind !== "loaded"}>
          Сохранить
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
