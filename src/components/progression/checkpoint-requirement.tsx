import type { HomeState } from "@/domain/home";
import { PrimaryRouteAction } from "@/components/progression/primary-route-action";
import { MentorContext } from "@/components/mentor/mentor-context";

/**
 * The near side of the gate: the checkpoint condition, in a calm hierarchy.
 * The amount is never the largest text and carries no glow / deposit styling /
 * urgency. No user balance, no "remaining $X", no Pocket CTA.
 */
export function CheckpointRequirement({ state }: { state: HomeState }) {
  const { checkpoint, primaryAction, mentor } = state;
  return (
    <div className="near">
      <p className="action-ctx cold">
        Текущая контрольная точка · Уровень {checkpoint.levelIndex}
      </p>
      <h1 className="lesson-title" id="checkpoint-title">
        Подтверди условие,
        <br />
        чтобы пройти дальше
      </h1>
      <p className="cp-cond">
        Для продолжения подтверди условие:{" "}
        <b>баланс Pocket от ${checkpoint.requirementUsd}</b>.
      </p>
      <p className="cp-note">
        Учитывается только подтверждённый реальный баланс. Demo не учитывается.
      </p>
      <div style={{ marginTop: 22 }}>
        <PrimaryRouteAction label={primaryAction.label} />
      </div>
      <div style={{ marginTop: 26 }}>
        <MentorContext message={mentor} frameSize={54} />
      </div>
    </div>
  );
}
