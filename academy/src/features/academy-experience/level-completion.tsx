/**
 * THE COMPLETION MOMENT (§13, §14, §15).
 *
 * WHAT IT IS. When a level is finished, the learner should get one clear,
 * restrained acknowledgement in one place: the level is done, this is what it
 * was worth, this is where that puts them, this is what is next. Before this,
 * a completed level said "завершён" in four places — the state mark, the state
 * sentence, the task component and the parameters table — and answered "what
 * now?" nowhere.
 *
 * WHERE EVERY NUMBER COMES FROM (§14). All four facts are canonical reads:
 *   - completion .......... the Backend's level state, already mapped
 *   - XP .................. the curriculum's published `xpReward` for this level
 *   - position ............ the progress summary the Backend computed
 *   - what is next ........ `deriveNextAction`, the SAME function Home uses
 *
 * Nothing here is inferred from an action the learner just took. A submission
 * that succeeded, a CTA that was clicked, a task component that says "готово"
 * locally — none of those reaches this component. It is rendered only when the
 * canonical state IS `completed`, so a page that renders it is a page the server
 * already agreed was finished.
 *
 * XP IS MOTIVATIONAL ONLY. It is displayed as a plain figure with a plain label.
 * It never gates anything here, it is never presented as a balance, a currency,
 * a prize or a total the learner is working towards, and it never appears on a
 * level whose canonical reward is zero — the checkpoints and the external
 * registration show no XP line at all rather than "+0 XP".
 *
 * THE VISUAL RULE (§15). A state transition in MATERIAL, and nothing else. No
 * confetti, no spinning counter, no burst, no "поздравляем", no coins, no
 * winnings language. The surface goes quiet and settled, which is what finishing
 * something actually feels like — and which is the only register that can be
 * used 100 times without becoming noise.
 */
import Link from "next/link";
import type { AcademyLevelSummary, AcademyProgressSummary } from "@/lib/curriculum/academy-view";
import type { AcademyNextAction } from "@/lib/curriculum/next-action";

export function LevelCompletion({
  level,
  progress,
  nextAction,
  moduleTitle,
}: {
  level: AcademyLevelSummary;
  progress: AcademyProgressSummary;
  /**
   * The programme's next action, derived once by the shared owner.
   *
   * Note what is NOT done here: this component does not look for "the next
   * level" itself. If it did, it would be a second progression reading, and the
   * whole point of the shared derivation is that Home, Path, the level page and
   * this panel cannot disagree.
   */
  nextAction: AcademyNextAction;
  moduleTitle: string | null;
}) {
  // Rendered only for a canonically completed level. Defensive, because this is
  // the component whose whole meaning is "the server said this is finished".
  if (level.state !== "completed") return null;

  // A level whose canonical reward is zero shows no XP line. The 20 financial
  // checkpoints and the Pocket registration are worth 0 XP by design, and
  // "+0 XP" would read as a failure rather than as a level that was never
  // scored.
  const earned = level.xpReward > 0 ? level.xpReward : null;

  // The next action is only worth repeating here when it is somewhere ELSE.
  // On a completed level the derived action usually points at the next level;
  // if it still points at this one, the honest thing is to say nothing.
  const forward = nextAction.level === null || nextAction.level.levelCode !== level.levelCode;

  return (
    <section className="ax-done" aria-labelledby="ax-done-title" data-posture="done">
      <p className="ax-done__kicker">Уровень {level.order} завершён</p>
      <h2 className="ax-done__title" id="ax-done-title">
        {level.title}
      </h2>

      <dl className="ax-done__facts">
        {earned !== null ? (
          <div>
            <dt>Начислено</dt>
            {/* Plain figure, plain label. Not a balance and not a total. */}
            <dd className="ax-done__xp">+{earned} XP</dd>
          </div>
        ) : null}
        <div>
          <dt>Пройдено</dt>
          <dd>
            {progress.completedLevels} из {progress.totalLevels} уровней
          </dd>
        </div>
        {moduleTitle ? (
          <div>
            <dt>Модуль</dt>
            <dd>{moduleTitle}</dd>
          </div>
        ) : null}
      </dl>

      {/* THE CONTROL FOLLOWS THE DERIVED POSTURE, not the fact that a level was
          finished. Finishing level 14 does not make level 15 actionable: here it
          is a checkpoint the platform cannot currently verify, so the learner is
          WAITING, and Home renders that same action with a quiet control. Lighting
          it only on this page would make one screen promise something the next
          screen withholds — the exact inconsistency this phase exists to remove. */}
      {forward ? (
        <div className="ax-done__next">
          <p className="ax-done__nextTitle">{nextAction.title}</p>
          <p className="ax-done__nextWhy">{nextAction.explanation}</p>
          {nextAction.ctaLabel && nextAction.href ? (
            <Link
              className={`ax-done__cta${nextAction.posture === "act" ? "" : " ax-done__cta--quiet"}`}
              href={nextAction.href}
              data-posture={nextAction.posture}
            >
              {nextAction.ctaLabel}
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
