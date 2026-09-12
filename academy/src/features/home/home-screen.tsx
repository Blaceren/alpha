import type { HomeScenario } from "@/domain/home";
import { getHomeState } from "@/data/mock/home-scenarios";
import { RouteField } from "@/components/progression/route-field";
import { RouteNode } from "@/components/progression/route-node";
import { LessonPlane } from "@/components/progression/lesson-plane";
import { ProgressInstrumentation } from "@/components/progression/progress-instrumentation";
import { MentorContext } from "@/components/mentor/mentor-context";
import { FutureCheckpointPreview } from "@/components/progression/future-checkpoint-preview";
import { CheckpointGate } from "@/components/progression/checkpoint-gate";
import { CheckpointRequirement } from "@/components/progression/checkpoint-requirement";
import { CheckpointOutcome } from "@/components/progression/checkpoint-outcome";

/**
 * The Route Field Home content for one deterministic scenario (active / checkpoint).
 * Rendered inside the app shell's <main>. Server component — static markup + CSS
 * motion, no client JS (deterministic, stable screenshots).
 */
export function HomeScreen({ scenario }: { scenario: HomeScenario }) {
  const state = getHomeState(scenario);

  return (
    <>
      <RouteField
        scenario={scenario}
        route={state.route}
        currentLevel={state.lesson.levelIndex}
        nextLevel={state.upcomingLevelIndex}
        checkpointLevel={state.checkpoint.levelIndex}
      />

      {scenario === "active" ? (
        <div className="content content--active">
          <div className="lesson-anchor">
            <div className="node-narrow">
              <RouteNode />
            </div>
            <LessonPlane state={state} />
            <ProgressInstrumentation data={state.instrumentation} />
            <MentorContext message={state.mentor} frameSize={64} />
          </div>
          <FutureCheckpointPreview checkpoint={state.checkpoint} />
        </div>
      ) : (
        <div className="content content--checkpoint">
          <CheckpointGate />
          <CheckpointRequirement state={state} />
          <CheckpointOutcome checkpoint={state.checkpoint} />
        </div>
      )}
    </>
  );
}
