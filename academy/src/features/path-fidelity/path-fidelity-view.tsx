import type { CSSProperties } from "react";
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
  chapterKicker,
  endsChapter,
  focusKind,
  followingLevelLine,
  waitingLine,
  nodeState,
  nodeStateText,
  moduleSegState,
  moduleFill,
  levelsWord,
  MODULE_SEG_WORD,
  NODE_STATE_WORD,
  levelCodeLabel,
} from "@/features/path-fidelity/path-state";
import "@/features/path-fidelity/path-fidelity.css";
import "@/features/path-fidelity/path-hifi.css";

/**
 * PATH — the frozen PuthATA composition, rendered from real progression.
 *
 * VISUAL AUTHORITY: PuthATA @ 3c740ccf8eb9182e858706a7423f07d29019858e. The
 * module ribbon (the module's own small scale since DD-352), the horizontal
 * level rail and the focus panel that joined the
 * current node to its detail as one object (the Decision Frame — since DD-353
 * each level's branch ends in its own block instead). Element order,
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
  const nextReason = focusLevel ? followingLevelLine(focusLevel, followingLevel, explainLevelState) : null;
  /* The level in focus is defined and not open yet: every open level is behind
     the learner, and the page says what comes next rather than what is "now". */
  const focusInProduction = focusLevel?.inProduction === true;
  const chapterLine = chapterKicker(focusModule);

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
  /* …and never a control that leads to this very page. When every open level is
     finished the shared decision offers «Открыть путь», which is the right
     thing for Home and for a level page to say and nothing at all here. */
  const primaryAction =
    nextAction.ctaLabel !== null && nextAction.href !== null && nextAction.href !== "/path"
      ? { label: nextAction.ctaLabel, href: nextAction.href }
      : null;
  const showSecondary =
    focusLevel !== null && focusLevel.routeAccessible && focusLevel.href !== nextAction.href;

  return (
    <AppShell userName={userName} activeId="path" frozenSurface notificationPresence={<UnreadPresence />}>
      {/* `pth--hifi`: the product hi-fi layer (DD-338) over the frozen surface. */}
      <div className="pth pth--hifi" data-pth-root>
        <PathRail />

        <section className="path-header" aria-labelledby="path-title">
          <div className="path-header__row">
            <h1 id="path-title">Путь</h1>
            <p className="path-header__done">
              Пройдено {view.progress.completedLevels} из {view.progress.totalLevels} уровней
              {/* Said only while part of the program is still being produced:
                  how many of those levels can be taken at all. */}
              {view.progress.openLevels < view.progress.totalLevels
                ? ` · открыто ${view.progress.openLevels}`
                : ""}
            </p>
          </div>
          {focusLevel ? (
            <p className="path-header__now">
              {focusInProduction ? "Дальше" : "Сейчас"}: <b>Уровень {focusLevel.order}</b> ·{" "}
              {focusLevel.title}
              <span className="path-header__module">
                модуль {focusModule.order} из {modules.length}
                {focusInProduction ? " · готовится" : ""}
              </span>
            </p>
          ) : null}
        </section>

        <section className="workspace" aria-label="Текущий модуль">
          <header className="workspace__head">
            <span className="workspace__kicker">
              {chapterLine ? <>{chapterLine} · </> : null}
              {firstOrder !== undefined && lastOrder !== undefined ? (
                <span className="workspace__range">
                  уровни {firstOrder}–{lastOrder}
                </span>
              ) : null}
            </span>
            {/* THE SCALE OF MODULES (DD-352, owner 2026-10-06: «общее кол-во
                модулей видно тоже небольшое»). It used to run the page's full
                width above the module; it is the module's own small scale now,
                beside its name: walked modules full, the module in focus
                filled by its walked levels, the rest ahead. */}
            <nav className="mod-nav" aria-label="Модули программы">
              <p className="mod-nav__scale">
                Модуль {focusModule.order} из {modules.length}
              </p>
              <ol className="mod-nav__ribbon">
                {modules.map((m, index) => {
                  const seg = moduleSegState(m, focusModule.order);
                  return (
                    <li
                      key={m.moduleCode}
                      className={[
                        "mod-seg",
                        `mod-seg--${seg}`,
                        endsChapter(modules, index) ? "mod-seg--chapter" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={
                        seg === "current"
                          ? ({ "--seg-fill": `${moduleFill(m)}%` } as CSSProperties)
                          : undefined
                      }
                    >
                      <span className="visually-hidden">
                        Модуль {m.order} — {MODULE_SEG_WORD[seg]}
                        {seg === "current"
                          ? `, пройдено ${m.progress.completed} из ${m.progress.total} ${levelsWord(m.progress.total)}`
                          : ""}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </nav>
            <span className="workspace__name">{focusModule.title}</span>
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
              {/* THE STRIP IS THE MODULE (DD-352, owner 2026-10-06: «каждое
                  заполнение один модуль расписанный в этих блоках»). Every level
                  of the module in focus and nothing beyond it; its line fills
                  through the walked levels to the current one, so a module is
                  one filling, and the next module starts a new strip. (DD-346's
                  window across module edges, its edge mark and its «· модуль NN»
                  are gone with it.)

                  EACH OPENED LEVEL HAS ITS BRANCH AND ITS BLOCK (DD-353, owner
                  2026-10-07: «она не должна входить в следующую область … она
                  должна в момент того как водишь и приближаешься к блоку
                  становиться ярче и начинать свечение обводки постепенно, блоки
                  пройденные»). A walked level and the one in focus each carry a
                  short branch from their mark into the top of their own block;
                  the nearer the pointer comes, the brighter the branch and the
                  further the light runs along the block's outline, both ways
                  (the rail controller measures the nearness). The branch no
                  longer reaches the panel below. Under the pointer a level shows
                  what it is to the learner — «Завершён», or «Начать» with the way
                  in. A level that is not open yet is drawn dim and has neither. */}
              <ol className="level-strip">
                {focusModule.levels.map((level) => {
                  const st = nodeState(level, currentOrder);
                  const open = st === "done" || st === "current";
                  const rest = level.levelCode === focusLevel?.levelCode;
                  /* The frozen strip drops the type line and dims the node once
                     a level is three or more steps beyond the current one — the
                     rail stops describing what the learner cannot yet act on. */
                  const beyond = currentOrder !== null && level.order - currentOrder >= 3;
                  const cls = [
                    "level-node",
                    `level-node--${st}`,
                    open ? "level-node--open" : "level-node--closed",
                    rest ? "level-node--rest" : "",
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
                      {...(open ? { "data-open": "" } : {})}
                      {...(rest ? { "data-rest": "" } : {})}
                      {...(st === "current" ? { "aria-current": "step" as const } : {})}
                    >
                      <span className="level-node__mark" aria-hidden="true" />
                      {open ? (
                        <>
                          <span className="level-node__stem" aria-hidden="true" />
                          <span className="level-node__block" aria-hidden="true" />
                        </>
                      ) : null}
                      <span className="level-node__code">{levelCodeLabel(level.order)}</span>
                      <span className="level-node__name">{level.title}</span>
                      {beyond ? null : (
                        <span className="level-node__type">
                          {level.kindLabel}
                          {level.completionMethod === "mentor-review" &&
                          (st === "current" || st === "next")
                            ? " · mentor review"
                            : ""}
                        </span>
                      )}
                      {st === "done" ? (
                        <span className="level-node__state level-node__state--done">Завершён</span>
                      ) : st === "current" ? (
                        <>
                          {/* What the level is to the learner stays for a screen
                              reader; the eye gets the way in, under the pointer.
                              «Начать» on every current level, the one still
                              being prepared included — the owner's decision of
                              2026-10-06; that level's page says it is prepared
                              and has the two ways out. */}
                          <span className="level-node__status visually-hidden">
                            {nodeStateText(st, kind, level.stateLabel, level.inProduction)}
                          </span>
                          <Link className="level-node__state level-node__go" href={level.href}>
                            Начать<span className="visually-hidden"> уровень {level.order}</span>
                          </Link>
                        </>
                      ) : st === "locked" ? (
                        <span className="visually-hidden">{NODE_STATE_WORD.locked}</span>
                      ) : (
                        <span className="level-node__state">
                          {nodeStateText(st, kind, level.stateLabel, level.inProduction)}
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

          {/* current progression focus: the detail of the level in focus. The
              frozen composition joined it to its node with a stem (the
              Decision Frame); since DD-353 (owner 2026-10-07: «она не должна
              входить в следующую область») nothing on the strip reaches into
              it — each level's branch ends in that level's own block. */}
          {focusLevel ? (
            <section className="focus" aria-labelledby="detail-title" data-focus>
              <span className="frame-corner frame-corner--tl" aria-hidden="true" />
              <span className="frame-corner frame-corner--br" aria-hidden="true" />
              <h2 id="detail-title" data-detail-title tabIndex={-1}>
                Уровень {focusLevel.order} · {focusLevel.title}
              </h2>
              <p className="focus__meta">
                Модуль {String(focusModule.order).padStart(2, "0")} «{focusModule.title}» ·{" "}
                {focusLevel.kindLabel}
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
