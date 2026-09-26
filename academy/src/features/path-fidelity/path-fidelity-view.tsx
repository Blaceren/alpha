import { AppShell } from "@/components/shell/app-shell";
import Link from "next/link";
import { UnreadPresence } from "@/components/shell/unread-presence";
import { deriveNextAction, explainLevelState } from "@/lib/curriculum/next-action";
import type {
  AcademyCurriculumView,
  AcademyLevelSummary,
  AcademyModuleSummary,
} from "@/lib/curriculum/academy-view";
import { CurriculumInfoState } from "@/features/curriculum-api/curriculum-states";
import { PathRail } from "@/features/path-fidelity/path-rail";
import {
  focusKind,
  waitingLine,
  nodeState,
  nodeStateText,
  moduleSegState,
  MODULE_SEG_WORD,
  NODE_STATE_WORD,
  levelCodeLabel,
  moduleKicker,
} from "@/features/path-fidelity/path-state";
import "@/features/path-fidelity/path-fidelity.css";

/**
 * PATH — the frozen PuthATA composition, rendered from real progression.
 *
 * VISUAL AUTHORITY: PuthATA @ 3c740ccf8eb9182e858706a7423f07d29019858e. The
 * module ribbon, the horizontal level rail and the focus panel that joins the
 * current node to its detail as one object (the Decision Frame). Element order,
 * class names, the `data-*` hooks the geometry needs and the text shapes all
 * follow `index.html` and the `render*` functions of `script.js`.
 *
 * DATA AUTHORITY: the product. Every level, module, order, state, label, href
 * and accessibility flag arrives in `view`, which is what
 * `/api/backend/curriculum/current` returned. The frozen renderer's
 * MODULE_01..03 constants and its `?scenario=` fixtures are marked
 * "DESIGN QA — SYNTHETIC FIXTURE · не является функцией продукта" in the
 * prototype's own markup; not one of those values is here.
 *
 * THIS COMPONENT IS SYNCHRONOUS AND PURE. Everything that can fail — the
 * session read, the BFF call, the error and not-enrolled screens — lives in
 * `path-fidelity-screen.tsx`. Splitting them is what makes every state of this
 * surface reachable in a test from a real-shaped curriculum view rather than
 * only through a live Backend.
 *
 * WHAT IS DELIBERATELY NOT CARRIED ACROSS, AND WHY:
 *
 *   * The prototype's `<header class="topbar">`. Its own comment calls it a
 *     "deliberately neutral low-fi shell" and points at the provenance note
 *     recording that the real implementation carries a wider one. The product
 *     keeps the accepted AppShell, which also supplies the skip link and the
 *     `#main` landmark — so this surface adds neither and cannot duplicate them.
 *
 *   * The `.qa-harness` panel, the `?scenario=` switch and the transition
 *     engine. The engine animates fixture-to-fixture swaps; in the product a
 *     state change is a navigation and the server renders the result.
 *     Reproducing it would mean simulating progression on the client, which
 *     inverts the authority the BFF contract exists to protect.
 *
 *   * The `[data-announce]` live region. The frozen page announces exactly one
 *     thing — a harness transition — and nothing else ever writes to it. With
 *     the engine gone it could only ever be an empty `role="status"`, which
 *     tells assistive technology nothing.
 *
 *   * The richer module ENTRY line. The frozen fixture writes "Модуль 02
 *     завершён · контрольная точка $100 подтверждена — Trading Journal открыт".
 *     The curriculum view carries module completion, so the first clause is
 *     real; it does not carry unlock consequences, so the rest would have to be
 *     invented. The line is rendered at the length the data actually supports.
 *
 * THE ACTIONABLE LEVEL IS THE SAME ONE HOME USES. `deriveNextAction` is the
 * shared decision, so the level Path puts in focus and the statement Home makes
 * are one computation rendered twice, never two.
 */
export type PathEnrolledView = Extract<
  AcademyCurriculumView,
  { state: "enrolled" | "completed" }
>;

export function PathFidelityView({
  view,
  userName,
}: {
  view: PathEnrolledView;
  userName: string;
}) {
  const modules: AcademyModuleSummary[] = view.modules;
  const nextAction = deriveNextAction(view);

  /* The module in focus: the one holding the actionable level, else the first
     module that is not finished, else the last. Not a new authority — every
     fallback reads the same canonical progress the Backend supplied. */
  const currentLevelCode = nextAction.level?.levelCode ?? view.progress.currentLevelCode ?? null;
  const focusModule =
    modules.find((m) => m.levels.some((l) => l.levelCode === currentLevelCode)) ??
    modules.find((m) => m.progress.completed < m.progress.total) ??
    modules[modules.length - 1];

  if (!focusModule) {
    return (
      <AppShell userName={userName} activeId="path" notificationPresence={<UnreadPresence />}>
        <div className="ax">
          <CurriculumInfoState
            title="Программа пуста"
            message="В текущей программе пока нет модулей."
          />
        </div>
      </AppShell>
    );
  }

  const focusLevel: AcademyLevelSummary | null =
    focusModule.levels.find((l) => l.levelCode === currentLevelCode) ??
    focusModule.levels.find((l) => l.state !== "completed") ??
    focusModule.levels[focusModule.levels.length - 1] ??
    null;

  const currentOrder = focusLevel?.order ?? null;
  const kind = focusLevel ? focusKind(focusLevel) : "current";
  const waiting = focusLevel ? waitingLine(focusLevel) : null;

  const moduleIndex = modules.findIndex((m) => m.moduleCode === focusModule.moduleCode);
  const previousModule = moduleIndex > 0 ? modules[moduleIndex - 1] : null;
  const nextModule = moduleIndex >= 0 ? modules[moduleIndex + 1] ?? null : null;

  const firstOrder = focusModule.levels[0]?.order;
  const lastOrder = focusModule.levels[focusModule.levels.length - 1]?.order;

  /* "Why the path does not continue yet" — taken from the level that actually
     follows, ACROSS the module boundary, because the frozen line does the same
     ("Уровень 5 (модуль 02) станет доступен после подтверждения условия"). It is
     that level's own canonical explanation, never a sentence invented here. */
  const followingLevel =
    currentOrder === null
      ? null
      : modules.flatMap((m) => m.levels).find((l) => l.order === currentOrder + 1) ?? null;
  const nextReason = followingLevel ? explainLevelState(followingLevel) : null;

  /* The primary action is whatever `deriveNextAction` decided; it returns label
     and href together or not at all, so one test covers both.

     Reading the two out as a pair is what lets the CTA be a Link. The href is
     known to be a route here by the same contract that decides whether the CTA
     renders at all — not by inspecting the string, and not by a fallback. The
     old `href={nextAction.href ?? "#"}` could never reach its "#": the guard
     above it already required a non-null href, so the fragment was unreachable
     and this was an internal route sitting on a bare <a>.

     The secondary is the frozen "открыть описание" navigation, shown only when
     it would lead somewhere else than the primary already does. */
  const primaryAction =
    nextAction.ctaLabel !== null && nextAction.href !== null
      ? { label: nextAction.ctaLabel, href: nextAction.href }
      : null;
  const showSecondary =
    focusLevel !== null && focusLevel.routeAccessible && focusLevel.href !== nextAction.href;

  return (
    <AppShell userName={userName} activeId="path" frozenSurface notificationPresence={<UnreadPresence />}>
      <div className="pth" data-pth-root>
        <PathRail />

        <section className="path-header" aria-labelledby="path-title">
          <div className="path-header__row">
            <h1 id="path-title">Путь</h1>
            <p className="path-header__done">
              Пройдено {view.progress.completedLevels} из {view.progress.totalLevels} уровней
            </p>
          </div>
          {focusLevel ? (
            <p className="path-header__now">
              Сейчас: <b>Уровень {focusLevel.order}</b> · {focusLevel.title}
              <span className="path-header__module">
                модуль {focusModule.order} из {modules.length}
              </span>
            </p>
          ) : null}
        </section>

        <nav className="mod-nav" aria-label="Модули программы">
          <ol className="mod-nav__ribbon">
            {modules.map((m) => {
              const seg = moduleSegState(m, focusModule.order);
              return (
                <li
                  key={m.moduleCode}
                  className={[
                    "mod-seg",
                    `mod-seg--${seg}`,
                    m.order % 5 === 0 ? "mod-seg--chapter" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="visually-hidden">
                    Модуль {m.order} — {MODULE_SEG_WORD[seg]}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mod-nav__scale">
            <span>
              Модуль {focusModule.order} из {modules.length} — текущий
            </span>
            <span>
              Завершено модулей: {focusModule.order - 1} · Впереди:{" "}
              {modules.length - focusModule.order}
            </span>
          </p>
        </nav>

        <section className="workspace" aria-label="Текущий модуль">
          <header className="workspace__head">
            <span className="workspace__kicker">
              {moduleKicker(focusModule.order, modules.length)}
            </span>
            <span className="workspace__name">{focusModule.title}</span>
            {firstOrder !== undefined && lastOrder !== undefined ? (
              <span className="workspace__range">
                уровни {firstOrder}–{lastOrder}
              </span>
            ) : null}
          </header>

          {previousModule &&
          previousModule.progress.total > 0 &&
          previousModule.progress.completed === previousModule.progress.total ? (
            <p className="workspace__edge workspace__edge--entry">
              Модуль {String(previousModule.order).padStart(2, "0")} «{previousModule.title}»
              завершён
            </p>
          ) : null}

          <div className="rail">
            <div className="rail__scroller" data-scroller>
              <ol className="level-strip">
                {focusModule.levels.map((level) => {
                  const st = nodeState(level, currentOrder);
                  /* The frozen strip drops the type line and dims the node once
                     a level is three or more steps beyond the current one — the
                     rail stops describing what the learner cannot yet act on. */
                  const beyond = currentOrder !== null && level.order - currentOrder >= 3;
                  const cls = [
                    "level-node",
                    `level-node--${st}`,
                    level.typeInfo.isCheckpoint ? "level-node--cp" : "",
                    st === "current" ? `level-node--wf-${kind}` : "",
                    st === "locked" && beyond ? "level-node--far" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <li
                      key={level.levelCode}
                      className={cls}
                      data-level={level.levelCode}
                      {...(st === "current" ? { "aria-current": "step" as const } : {})}
                    >
                      <span className="level-node__mark" aria-hidden="true" />
                      <span className="level-node__code">{levelCodeLabel(level.order)}</span>
                      <span className="level-node__name">{level.title}</span>
                      {beyond ? null : (
                        <span className="level-node__type">
                          {level.typeInfo.label}
                          {level.completionMethod === "mentor-review" &&
                          (st === "current" || st === "next")
                            ? " · mentor review"
                            : ""}
                        </span>
                      )}
                      {st === "locked" ? (
                        <span className="visually-hidden">{NODE_STATE_WORD.locked}</span>
                      ) : (
                        <span className="level-node__state">
                          {nodeStateText(st, kind, level.stateLabel)}
                        </span>
                      )}
                      {st === "next" ? (
                        <span className="level-node__reason">{explainLevelState(level)}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
            {/* Return-to-current: the approved rail utility. Hidden until the
                current node's centre leaves the window; the controller sets the
                direction arrow and hands focus back to the detail heading. */}
            <button type="button" className="rail__return" data-return hidden>
              К текущему уровню
            </button>
          </div>

          {/* current progression focus: node + detail as one object (Decision Frame) */}
          {focusLevel ? (
            <section className="focus" aria-labelledby="detail-title" data-focus>
              <span className="focus__leader" data-leader aria-hidden="true" />
              <span className="frame-corner frame-corner--tl" aria-hidden="true" />
              <span className="frame-corner frame-corner--br" aria-hidden="true" />
              <h2 id="detail-title" data-detail-title tabIndex={-1}>
                Уровень {focusLevel.order} · {focusLevel.title}
              </h2>
              <p className="focus__meta">
                Модуль {String(focusModule.order).padStart(2, "0")} «{focusModule.title}» ·{" "}
                {focusLevel.typeInfo.label}
                {focusLevel.completionMethod === "mentor-review" ? " · mentor review" : ""}
              </p>
              <p className={`focus__state focus__state--${kind}`}>
                <i className="fstate-glyph" aria-hidden="true" />
                {focusLevel.stateLabel}
              </p>
              <div className="focus__body">
                {focusLevel.shortDescription ? <p>{focusLevel.shortDescription}</p> : null}
                {waiting ? <p>{waiting}</p> : null}
                {!focusLevel.shortDescription && !waiting ? (
                  <p>{explainLevelState(focusLevel)}</p>
                ) : null}
              </div>
              {nextReason ? <p className="focus__next">{nextReason}</p> : null}
              <div className="focus__actions">
                {primaryAction ? (
                  <Link className="button button--primary" href={primaryAction.href}>
                    {primaryAction.label}
                  </Link>
                ) : null}
                {showSecondary ? (
                  <Link className="button button--secondary" href={focusLevel.href}>
                    Открыть описание уровня
                  </Link>
                ) : null}
              </div>
            </section>
          ) : null}

          {nextModule ? (
            <p className="workspace__edge workspace__edge--exit">
              Дальше: модуль {String(nextModule.order).padStart(2, "0")} «{nextModule.title}»
              {nextModule.levels.length > 0
                ? ` · уровни ${nextModule.levels[0]!.order}–${nextModule.levels[nextModule.levels.length - 1]!.order}`
                : ""}
            </p>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
