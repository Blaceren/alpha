import type { AcademyCheckpointState } from "@/lib/curriculum/academy-view";
import { buildCheckpointInfo } from "@/features/lessons-library/model/lessons-library-model";
import { CheckpointGate } from "@/components/progression/checkpoint-gate";
import "@/features/checkpoint/level-checkpoint.css";

/**
 * Backend-driven financial checkpoint (L4HG-1 — honest gate).
 *
 * The learner has reached a checkpoint the platform cannot verify: there is no
 * authoritative balance source, and simulating one is forbidden. This screen
 * says exactly that.
 *
 * WHAT IT SHOWS
 *   - the canonical target from the curriculum («Баланс Pocket от $50»);
 *   - what passing it opens (rank / community channel — L4 opens no tool);
 *   - that verification is unavailable, and that progress is kept.
 *
 * WHAT IT NEVER SHOWS OR OFFERS (DD-020…DD-024, STATE_MATRIX §2)
 *   the learner's balance · «осталось $X» · a progress bar toward money ·
 *   a Pocket link or CTA · deposit-encouraging copy · a countdown ·
 *   a balance input · an upload · a mentor-review request · an active verify
 *   button · a spinner that never resolves.
 *
 * COPY NOTE — a deliberate, documented deviation. The canonical «Data
 * unavailable» line is «Данные обновляются. Подожди немного — проверка
 * продолжится автоматически». That sentence promises a retry that is
 * happening; here no check is running and none is scheduled, because no
 * provider exists. Shipping it would be precisely the never-resolving loading
 * state this phase exists to remove, so the state is described truthfully
 * instead. The canonical line returns unchanged with the verification engine.
 */

const REASON_NOTE: Record<AcademyCheckpointState["reason"], string> = {
  // Every branch says the same thing to the learner — the difference is
  // operational and belongs in the audit, not on their screen.
  checkpoint_disabled: "Автоматическая проверка контрольной точки пока не подключена.",
  provider_unconfigured: "Автоматическая проверка контрольной точки пока не подключена.",
  integration_unknown: "Автоматическая проверка контрольной точки пока не подключена.",
  unsupported: "Автоматическая проверка контрольной точки пока не подключена.",
};

export function LevelCheckpoint({
  levelNumber,
  checkpoint,
}: {
  levelNumber: number;
  checkpoint: AcademyCheckpointState;
}) {
  // Canonical target and rewards, read from the same curriculum fixture the
  // library reads. Null when the level number carries no checkpoint — rendered
  // as absence rather than as a placeholder amount.
  const info = buildCheckpointInfo(levelNumber);

  return (
    <section className="cp-gate" aria-labelledby="cp-gate-title" data-verification={checkpoint.verificationState}>
      <h2 id="cp-gate-title" className="cp-gate__title">
        Контрольная точка
      </h2>

      <div className="cp-gate__body">
        <div className="cp-gate__near">
          {info ? (
            <>
              <p className="cp-gate__condition">
                Условие: <b>{info.requirement}</b>
              </p>
              <p className="cp-gate__note">
                Учитывается только подтверждённый реальный баланс. Demo не учитывается.
              </p>
            </>
          ) : (
            <p className="cp-gate__note">Условие этой контрольной точки не задано в программе.</p>
          )}

          {/* The honest state. Announced politely because it is the answer to
              the action the learner came here to take. */}
          <p className="cp-gate__status" role="status">
            Проверка условия сейчас недоступна.
          </p>
          <p className="cp-gate__explain">
            {REASON_NOTE[checkpoint.reason]} Пока она недоступна, следующий модуль не открывается.
          </p>
          <p className="cp-gate__saved">
            Прогресс сохранён: пройденные уровни и материалы остаются доступными.
          </p>
        </div>

        <CheckpointGate />

        {info && info.rewards.length > 0 ? (
          <div className="cp-gate__far">
            <p className="cp-gate__far-label">За границей · что откроется</p>
            <ul className="cp-gate__rewards">
              {info.rewards.map((reward) => (
                <li key={reward}>{reward}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
