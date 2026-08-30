/**
 * LESSONS — the content library, not a second progression map.
 *
 * THE PROBLEM THIS FIXES. Path and Lessons both rendered all 100 levels in the
 * same flat shape, so the product had two routes doing one job and neither did
 * it well. Two navigations that mean the same thing is worse than one, because
 * the learner has to work out which is authoritative.
 *
 * THE SPLIT. Path answers «где я в программе?» — structure, position, what is
 * next. Lessons answers «что я уже могу перечитать?» — the material the learner
 * has actually reached, newest first, so returning to something half-remembered
 * takes one step instead of a hunt through twenty modules.
 *
 * So this page deliberately shows LESS than Path: only levels whose content the
 * learner may open. Locked future material is not listed here at all — it lives
 * on Path, where being locked is the point.
 */
import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { getServerViewer } from "@/server/auth/server-session";
import { getCurriculumView } from "@/lib/curriculum/provider";
import type { AcademyCurriculumView } from "@/lib/curriculum/academy-view";
import { EmptyState, MilestoneMark, StateMark } from "@/features/academy-experience/primitives";
import { CurriculumErrorState, CurriculumInfoState } from "@/features/curriculum-api/curriculum-states";
import "@/features/academy-experience/experience.css";

type Enrolled = Extract<AcademyCurriculumView, { state: "enrolled" | "completed" }>;

export async function ExperienceLessons() {
  const [viewer, result] = await Promise.all([getServerViewer(), getCurriculumView()]);
  const name = viewer?.name ?? "Ученик";
  const shell = (children: React.ReactNode) => (
    <AppShell userName={name} activeId="lessons">
      <div className="ax">{children}</div>
    </AppShell>
  );

  if (!result.ok) return shell(<CurriculumErrorState error={result.error} />);
  if (result.view.state === "unavailable") {
    return shell(<CurriculumInfoState title="Программа готовится" message="Активная учебная программа пока не опубликована." />);
  }
  if (result.view.state === "candidate") {
    return shell(
      <CurriculumInfoState
        title={result.view.curriculum.title}
        message="Материалы откроются после зачисления на программу."
      />,
    );
  }

  const view = result.view as Enrolled;
  const moduleTitle = new Map<string, { order: number; title: string }>();
  for (const m of view.modules) for (const l of m.levels) moduleTitle.set(l.levelCode, { order: m.order, title: m.title });

  // Reached material only, most recent first — the order a learner revisits in.
  const reached = view.modules
    .flatMap((m) => m.levels)
    .filter((l) => l.routeAccessible && l.state !== "locked")
    .sort((a, b) => b.order - a.order);

  return shell(
    <>
      <p className="ax-coord">
        Материалы, которые вам доступны · <b>{reached.length}</b> из {view.progress.totalLevels}
      </p>
      <h1 className="ax-mod__title">Уроки</h1>
      <p className="ax-mod__obj">
        Здесь собраны материалы уровней, до которых вы уже дошли — чтобы вернуться к пройденному.
        Структура программы и следующий шаг живут на странице «Путь».
      </p>

      {reached.length === 0 ? (
        <EmptyState
          title="Материалы пока не открыты"
          message="Как только вы начнёте первый уровень, его материалы появятся здесь."
        />
      ) : (
        <ul className="ax-levels">
          {reached.map((l) => {
            const mod = moduleTitle.get(l.levelCode);
            return (
              <li className="ax-lvl" key={l.levelCode} data-state={l.state} data-level={l.levelCode}>
                <span className="ax-lvl__n">{l.order}</span>
                <span>
                  <Link className="ax-lvl__t" href={l.href}>{l.title}</Link> <MilestoneMark level={l} />
                  {mod ? <p className="ax-lvl__why">Модуль {mod.order} — {mod.title}</p> : null}
                </span>
                <StateMark level={l} />
              </li>
            );
          })}
        </ul>
      )}
    </>,
  );
}
