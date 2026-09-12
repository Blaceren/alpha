import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { UnreadPresence } from "@/components/shell/unread-presence";
import { getServerViewer } from "@/server/auth/server-session";
import { getLevelDetail } from "@/lib/curriculum/provider";
import { explainLevelState } from "@/lib/curriculum/next-action";
import { CurriculumErrorState } from "@/features/curriculum-api/curriculum-states";
import { LevelReport } from "@/features/report/level-report";
import { LevelMentorReview } from "@/features/mentor-review/level-mentor-review";
import { MentorFeedbackPanel } from "@/features/mentor-review/mentor-feedback";
import { readLevelMentorFeedback } from "@/server/learner-ops/server-read";
import { WS_COPY, decisionOf, ownerOf, whereLineOf } from "@/features/workspace-fidelity/workspace-state";
import "@/features/workspace-fidelity/workspace-fidelity.css";
import "@/features/workspace-fidelity/workspace-form-fidelity.css";

const REPORT_LOCALE = "ru";

/**
 * WORKSPACE — the level-scoped execution surface, in the frozen composition.
 *
 * VISUAL AUTHORITY: WorkspaceATA @ 14e37895f83791e7a53a61e62b588c9969715e59.
 * The page frame is the frozen one and its order is the argument the design
 * makes: WHO AND WHAT this level is, WHAT IS REQUIRED, WHERE THE WORK STANDS
 * and WHOSE MOVE IT IS, then THE TASK ITSELF, then the material and the exits.
 * A learner arriving cold reads those five answers in that order and never has
 * to hunt for the one they came for.
 *
 * DATA AUTHORITY: the product. Every value comes from the canonical level
 * detail, and the task components mounted inside `.ws-host` are the product's
 * own — unchanged.
 *
 * WHAT THIS SURFACE STILL DOES NOT DO, unchanged from the accepted product:
 *   * It is scoped to ONE level named in the path. No cross-level cabinet, no
 *     aggregate of every draft, no "my work" dashboard.
 *   * It is not a new Backend domain. No Workspace table, no Workspace model,
 *     no Workspace endpoint — it is a composition over report, mentor-review
 *     and progression contracts that already existed.
 *   * IT WRITES NOTHING ITSELF. The submit/resubmit state machine, the
 *     duplicate-submit protection, the durable draft authority and the
 *     post-mutation refetch all live inside `LevelReport` / `LevelMentorReview`.
 *     This surface mounts them; it does not wrap their mutations, which is why
 *     it cannot weaken them.
 *
 * WHERE THE RESTORATION DELIBERATELY STOPS, AND WHY.
 * The frozen source also carries a complete visual vocabulary for the report
 * FORM itself — `.rpt-group`, `.rpt-f`, `.rpt-bar` — and for its assessment and
 * submission engines (`.eng-*`, `.sub-*`). Those are not applied here. The
 * product's report form is the protected mutation surface: it owns the
 * submit/resubmit machine, the duplicate-submit guard, the auth-loss recovery
 * that must never resubmit automatically, and the live-region adapter, and its
 * own tests assert on its markup. Re-marking it for appearance would put every
 * one of those behaviours in the blast radius of a class rename. The frame is
 * restored; the form keeps the markup its guarantees are written against, and
 * the remaining vocabulary is carried in the stylesheet unused, ready for a
 * pass that is authorised to touch the mutation surface.
 */
export async function WorkspaceFidelityScreen({ levelCode }: { levelCode: string }) {
  const viewer = await getServerViewer();
  const name = viewer?.name ?? "Ученик";
  const result = await getLevelDetail(levelCode);

  /* activeId stays "lessons": the accepted route map nests the workspace under
     Уроки, so the shell must not lose its active item on any state. */
  if (!result.ok) {
    if (result.error.category === "LEVEL_NOT_FOUND") {
      return (
        <AppShell userName={name} activeId="lessons" frozenSurface notificationPresence={<UnreadPresence />}>
          <PageMessage title={WS_COPY.notFoundTitle} body={WS_COPY.notFoundBody} />
        </AppShell>
      );
    }
    return (
      <AppShell userName={name} activeId="lessons" notificationPresence={<UnreadPresence />}>
        <div className="ax">
          <CurriculumErrorState error={result.error} />
        </div>
      </AppShell>
    );
  }

  const { summary, navigation } = result.detail;
  const levelHref = `/lessons/${encodeURIComponent(summary.levelCode)}`;

  /**
   * The gate, re-asked server-side on every request. A workspace is deep-linkable
   * by construction — someone will paste the URL, or return to a bookmark after
   * the level has been re-locked — so it never assumes the caller arrived through
   * a legitimate link. Failing it renders the level's OWN canonical explanation,
   * the same sentence Path and Level Detail would use, not a generic denial.
   */
  if (!summary.routeAccessible) {
    return (
      <AppShell userName={name} activeId="lessons" frozenSurface notificationPresence={<UnreadPresence />}>
        <PageMessage
          title={WS_COPY.gateTitle}
          body={explainLevelState(summary)}
          levelHref={levelHref}
        />
      </AppShell>
    );
  }

  /**
   * Which execution task this level actually has. Only the two families with a
   * learner-executable task in this product get one: an assessment is taken in
   * its own runtime, a checkpoint is a financial boundary the Academy does not
   * execute, and an external event is completed by a provider postback.
   */
  const isReport = summary.typeInfo.type === "report";
  const isMentorReview =
    summary.typeInfo.type === "mentor-review" && summary.completionMethod === "mentor-review";

  /* The reviewer's own words. A failure answers null and the task still renders:
     feedback is context beside a canonical task and must never be able to take
     the task's page down with it. It is NOT approval — approval lives behind a
     mentor-initiated Backend route with no Academy handler at all. */
  const feedback =
    isReport || isMentorReview ? await readLevelMentorFeedback(summary.levelCode) : null;

  const decision = decisionOf(summary);
  const hasTask = isReport || isMentorReview;
  /* Null exactly when the level hosts no work here — see `whereLineOf`. */
  const whereLine = whereLineOf(summary);

  return (
    <AppShell userName={name} activeId="lessons" frozenSurface notificationPresence={<UnreadPresence />}>
      <div className="wsp">
        <div className="ws" data-decision={decision}>
          <header className="ws-id">
            <p className="ws-id__coord">
              Уровень <b>{summary.order}</b> · {summary.typeInfo.label}
            </p>
            <h1 className="ws-id__title">{summary.title}</h1>
          </header>

          <section className="ws-req" aria-labelledby="req-h">
            <h2 className="ws-req__label" id="req-h">
              {WS_COPY.labelRequirement}
            </h2>
            {summary.shortDescription ? (
              <p className="ws-req__title">{summary.shortDescription}</p>
            ) : null}
            {summary.learningObjective ? (
              <p className="ws-req__lead">{summary.learningObjective}</p>
            ) : (
              <p className="ws-req__unstated">{WS_COPY.requirementUnstated}</p>
            )}
            {whereLine !== null ? (
              <p className="ws-req__where">{whereLine}</p>
            ) : null}
          </section>

          {/* Execution state and whose move it is — ONE block, because they are
              one question. `wait` and `none` carry no control at all. */}
          <section className="ws-state" data-decision={decision} aria-labelledby="st-h">
            <h2 className="ws-state__label" id="st-h">
              {WS_COPY.labelState}
            </h2>
            <p className="ws-state__line">{explainLevelState(summary)}</p>
            <p className="ws-state__owner">{ownerOf(summary)}</p>
            {decision === "action" && hasTask ? (
              <p className="ws-quiet">{WS_COPY.actionBelow}</p>
            ) : null}
          </section>

          {feedback ? <MentorFeedbackPanel feedback={feedback} levelState={summary.state} /> : null}

          {hasTask ? (
            <section className="ws-host" id="task" aria-labelledby="host-h">
              <h2 className="ws-host__label" id="host-h">
                {WS_COPY.labelHost}
              </h2>
              {isReport ? (
                <LevelReport
                  stableCode={summary.levelCode}
                  locale={REPORT_LOCALE}
                  nextLevelCode={navigation.nextLevelCode}
                />
              ) : (
                <LevelMentorReview
                  stableCode={summary.levelCode}
                  xpReward={summary.xpReward}
                  levelState={summary.state}
                />
              )}
            </section>
          ) : (
            <section className="ws-req" aria-label={WS_COPY.noWorkspaceTitle}>
              <p className="ws-req__title">{WS_COPY.noWorkspaceTitle}</p>
              <p className="ws-req__lead">{WS_COPY.noWorkspaceBody}</p>
              {/* The one action this state has. The exit row below still holds
                  both routes; this is the same destination raised to the weight
                  the state deserves, and it is a <Link>, so a modified click
                  stays native. */}
              <Link className="ws-req__cta" href={levelHref}>
                {WS_COPY.exitLevel}
              </Link>
            </section>
          )}

          <section className="ws-mat" aria-labelledby="mat-h">
            <h2 className="ws-mat__label" id="mat-h">
              {WS_COPY.labelMaterial}
            </h2>
            <p className="ws-mat__title">{summary.title}</p>
            <Link className="ws-mat__link" href={`${levelHref}/material`}>
              {WS_COPY.openMaterial} →
            </Link>
          </section>

          <nav className="ws-exit" aria-label="Выход">
            <Link href={levelHref}>{WS_COPY.exitLevel}</Link>
            <Link href="/path">{WS_COPY.exitPath}</Link>
          </nav>
        </div>
      </div>
    </AppShell>
  );
}

/**
 * A page-level message, for the two states where there is no workspace to draw:
 * an address that names no level, and a level the learner may not open. Both
 * keep the exits, because a message with no way onward is a dead end.
 */
function PageMessage({
  title,
  body,
  levelHref,
}: {
  title: string;
  body: string;
  levelHref?: string;
}) {
  return (
    <div className="wsp">
      <div className="ws" data-decision="none">
        <div className="ws-page-msg">
          <p className="ws-page-msg__title">{title}</p>
          <p className="ws-page-msg__body">{body}</p>
          <nav className="ws-exit" aria-label="Выход">
            {levelHref ? <Link href={levelHref}>{WS_COPY.exitLevel}</Link> : null}
            <Link href="/path">{WS_COPY.exitPath}</Link>
          </nav>
        </div>
      </div>
    </div>
  );
}
