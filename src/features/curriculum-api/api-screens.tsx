import { AppShell } from "@/components/shell/app-shell";
import Link from "next/link";
import { getServerViewer } from "@/server/auth/server-session";
import { getCurriculumView } from "@/lib/curriculum/provider";
import type { AcademyCurriculumView, AcademyLevelSummary } from "@/lib/curriculum/academy-view";
import { CurriculumErrorState, CurriculumInfoState } from "@/features/curriculum-api/curriculum-states";
import "@/features/curriculum-api/curriculum-api.css";

async function viewerName(): Promise<string> {
  const viewer = await getServerViewer();
  return viewer?.name ?? "Ученик";
}

/** Text-first level badge (state + type). Never color-only. */
function LevelBadges({ level }: { level: AcademyLevelSummary }) {
  return (
    <span className="lvl-badges">
      <span className={`lvl-badge lvl-badge--${level.state}`} data-state={level.state}>
        {level.stateLabel}
      </span>
      <span className="lvl-badge lvl-badge--type" data-type={level.typeInfo.type}>
        {level.typeInfo.label}
      </span>
      {!level.typeInfo.supported ? <span className="lvl-badge lvl-badge--warn">Не поддерживается</span> : null}
    </span>
  );
}

function LevelRow({ level }: { level: AcademyLevelSummary }) {
  const lockId = level.lockReason ? `lock-${level.levelCode}` : undefined;
  return (
    <li className="lvl-row" data-level={level.levelCode} data-state={level.state}>
      <div className="lvl-row__main">
        <span className="lvl-row__order">{level.order}</span>
        <div className="lvl-row__text">
          {level.routeAccessible ? (
            <Link className="lvl-row__title" href={level.href} aria-describedby={lockId}>
              {level.title}
            </Link>
          ) : (
            <span className="lvl-row__title" aria-describedby={lockId}>
              {level.title}
            </span>
          )}
          <LevelBadges level={level} />
        </div>
      </div>
      {level.lockReason ? (
        <p className="lvl-row__lock" id={lockId}>
          {level.stateLabel}
        </p>
      ) : null}
    </li>
  );
}

function shell(name: string, active: string, children: React.ReactNode) {
  return (
    <AppShell userName={name} activeId={active}>
      <div className="cur-api">{children}</div>
    </AppShell>
  );
}

function renderGuarded(
  view: AcademyCurriculumView,
  onReady: (v: Extract<AcademyCurriculumView, { state: "enrolled" | "completed" }>) => React.ReactNode,
): React.ReactNode {
  if (view.state === "unavailable") {
    return <CurriculumInfoState title="Программа готовится" message="Активная учебная программа пока не опубликована." />;
  }
  if (view.state === "candidate") {
    return (
      <CurriculumInfoState
        title={view.curriculum.title}
        message="Вы ещё не зачислены на программу. Зачисление появится позже."
      />
    );
  }
  return onReady(view);
}

/* --------------------------------- Home --------------------------------- */

export async function ApiHome() {
  const [name, result] = await Promise.all([viewerName(), getCurriculumView()]);
  if (!result.ok) return shell(name, "home", <CurriculumErrorState error={result.error} />);

  return shell(
    name,
    "home",
    renderGuarded(result.view, (view) => {
      const allLevels = view.modules.flatMap((m) => m.levels);
      const current = allLevels.find((l) => l.levelCode === view.progress.currentLevelCode) ?? null;
      const next = allLevels.find((l) => l.levelCode === view.progress.nextAvailableLevelCode) ?? null;
      return (
        <section className="cur-home">
          <h1 className="cur-home__title">Твой путь</h1>
          <p className="cur-home__meta">
            {view.curriculum.title} · версия {view.curriculum.curriculumVersion}
          </p>

          {current ? (
            <div className="cur-home__current">
              <h2>Текущий уровень</h2>
              <p className="cur-home__level">
                <span className="cur-home__order">Уровень {current.order}</span> — {current.title}
              </p>
              <LevelBadges level={current} />
              {current.routeAccessible ? (
                <Link className="cur-cta" href={current.href}>Открыть уровень</Link>
              ) : null}
            </div>
          ) : (
            <p className="cur-home__level">Текущий уровень определяется сервером.</p>
          )}

          {next && next.levelCode !== current?.levelCode ? (
            <p className="cur-home__next">
              Следующий доступный: <Link href={next.href}>{next.title}</Link>
            </p>
          ) : null}

          <p className="cur-home__progress">
            Завершено {view.progress.completedLevels} из {view.progress.totalLevels} уровней
          </p>
        </section>
      );
    }),
  );
}

/* --------------------------------- Path --------------------------------- */

export async function ApiPath() {
  const [name, result] = await Promise.all([viewerName(), getCurriculumView()]);
  if (!result.ok) return shell(name, "path", <CurriculumErrorState error={result.error} />);

  return shell(
    name,
    "path",
    renderGuarded(result.view, (view) => (
      <section className="cur-path">
        <h1 className="cur-path__title">Путь обучения</h1>
        <ol className="cur-modules">
          {view.modules.map((moduleSummary) => (
            <li key={moduleSummary.moduleCode} className="cur-module" data-module={moduleSummary.moduleCode}>
              <h2 className="cur-module__title">
                <span className="cur-module__order">Модуль {moduleSummary.order}</span> {moduleSummary.title}
              </h2>
              <p className="cur-module__progress">
                {moduleSummary.progress.completed} / {moduleSummary.progress.total} завершено
              </p>
              <ul className="lvl-list">
                {moduleSummary.levels.map((level) => (
                  <LevelRow key={level.levelCode} level={level} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>
    )),
  );
}

/* -------------------------------- Lessons ------------------------------- */

export async function ApiLessons() {
  const [name, result] = await Promise.all([viewerName(), getCurriculumView()]);
  if (!result.ok) return shell(name, "lessons", <CurriculumErrorState error={result.error} />);

  return shell(
    name,
    "lessons",
    renderGuarded(result.view, (view) => {
      const levels = view.modules.flatMap((m) => m.levels);
      return (
        <section className="cur-lessons">
          <h1 className="cur-lessons__title">Уроки</h1>
          <p className="cur-lessons__meta">Уровни программы в порядке прохождения.</p>
          <ul className="lvl-list">
            {levels.map((level) => (
              <LevelRow key={level.levelCode} level={level} />
            ))}
          </ul>
        </section>
      );
    }),
  );
}
