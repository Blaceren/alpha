"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSessionProgress } from "@/features/lessons-library/hooks/use-session-progress";
import {
  buildLessonsLibraryModel,
  type LessonsLibraryModel,
} from "@/features/lessons-library/model/lessons-library-model";
import { LibraryModuleIndex } from "@/features/lessons-library/components/library-module-index";
import { LibraryModuleContent } from "@/features/lessons-library/components/library-module-content";
import { LibraryModuleSwitcher } from "@/features/lessons-library/components/library-module-switcher";
import { getPathProgress, type PathScenario } from "@/features/path/model/path-state";
import { useReportWorkspace } from "@/features/report-level/hooks/use-report-workspace";
import { sessionWithApprovedReports } from "@/features/report-level/model/report-progression";

/**
 * Уроки (/lessons) — the lessons library (Phase D2C-B), built on the selected
 * art direction: Concept B «Curriculum Index» (DD-261).
 *
 * This is a client component for exactly one reason: session progress lives in
 * `sessionStorage`, which the server cannot read. Everything else — module
 * selection, the model, the copy — is derived from props and the URL, so the
 * server renders the full page and the client only re-resolves what the session
 * changes. Module selection stays in the URL (`?module=module.NN`), which makes
 * it shareable and gives Back/Forward for free.
 *
 * The component receives a MODEL and renders it. It computes no progression
 * rule of its own (DD-262).
 */
function ContinueBand({ model }: { model: LessonsLibraryModel }) {
  const step = model.continueStep;

  // Honest: no open lesson (the next step is a checkpoint gate, or everything is
  // done). We explain instead of showing a dead CTA — and a money condition never
  // becomes a call to action.
  if (!step) {
    return (
      <section className="lib-cont is-quiet" aria-label="Следующий шаг">
        <div className="lib-cont-txt">
          <p className="lib-cont-k">Следующий шаг</p>
          <p className="lib-cont-note">{model.continueNote}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="lib-cont" aria-label="Продолжить обучение">
      <div className="lib-cont-txt">
        <p className="lib-cont-k">{step.eyebrow}</p>
        <p className="lib-cont-t">
          <span className="lib-cont-n mono" aria-hidden="true">
            {step.levelNumber}
          </span>
          <span>{step.title}</span>
        </p>
        <p className="lib-cont-m">
          <span className="mono">Модуль {String(step.moduleIndex).padStart(2, "0")}</span>
          <i className="sep" aria-hidden="true" />
          <span>{step.moduleTitle}</span>
          <i className="sep" aria-hidden="true" />
          <span>{step.kindLabel}</span>
          {step.reportStatusLabel && (
            <>
              <i className="sep" aria-hidden="true" />
              <span>{step.reportStatusLabel}</span>
            </>
          )}
          {step.durationLabel && (
            <>
              <i className="sep" aria-hidden="true" />
              <span className="mono">{step.durationLabel}</span>
            </>
          )}
        </p>
      </div>
      <Link className="cta" href={step.href}>
        {step.actionLabel}
        <span className="go" aria-hidden="true">
          <svg className="ic" viewBox="0 0 24 24">
            <path d="M5 12h14" />
            <path d="M13 6l6 6-6 6" />
          </svg>
        </span>
      </Link>
    </section>
  );
}

export function LessonsLibraryWorkspace({
  moduleParam,
  scenario = "active",
}: {
  moduleParam?: string;
  /**
   * Which shared progress marker to read. Follows the PathWorkspace precedent:
   * the KEY crosses the server/client boundary, not the marker object, so the
   * marker stays resolved from one shared module — and instrumentation the
   * library never renders (rankLabel, xpLabel, streak) is not serialised into
   * the page payload.
   *
   * This is not the URL's to set: /lessons never reads ?scenario (DD-263).
   */
  scenario?: PathScenario;
}) {
  const marker = getPathProgress(scenario);
  const session = useSessionProgress();
  // Browser-local report drafts (D3-B): the library only DISPLAYS their status,
  // it never writes one — the workspace at /lessons/level.003 owns that.
  const reports = useReportWorkspace();
  // An APPROVED report projects a completion onto the session (D3-D), through the
  // shared augmentation helper — so the existing resolver advances the current
  // step from L3 to the L4 checkpoint and shows L3 «Завершён» (never «Одобрено»,
  // which lives only on the report screen). Under the canonical profile this is a
  // no-op: L3 is already behind the marker.
  const augmentedSession = useMemo(
    () => sessionWithApprovedReports(session, reports),
    [session, reports],
  );
  const model = useMemo(
    () =>
      buildLessonsLibraryModel({ moduleParam, marker, session: augmentedSession, reports }),
    [moduleParam, marker, augmentedSession, reports],
  );

  return (
    <div className="lib-page">
      <header className="lib-head">
        <h1 className="lib-h1">Уроки</h1>
        <p className="lib-scale">
          Модуль <b className="mono">{String(model.selected.index).padStart(2, "0")}</b> из{" "}
          <span className="mono">{model.totalModules}</span>
          <span className="lib-scale-sep"> · </span>
          <span className="lib-scale-t">{model.selected.title}</span>
        </p>
      </header>

      {/* Mobile only (CSS): the stepper + the full-contents sheet. */}
      <LibraryModuleSwitcher
        modules={model.modules}
        selectedIndex={model.selected.index}
        totalModules={model.totalModules}
      />

      <ContinueBand model={model} />

      {/* DOM order = reading order = mobile order: the opened module first, the
          full contents second. Desktop puts the contents in the left column via
          grid areas, so no order/DOM mismatch is ever introduced. */}
      <div className="lib-grid">
        <LibraryModuleContent module={model.selected} />

        <section className="lib-toc" aria-labelledby="lib-toc-h">
          <h2 className="lib-toc-h" id="lib-toc-h">
            Содержание программы
          </h2>
          <LibraryModuleIndex modules={model.modules} idPrefix="toc" />
        </section>
      </div>
    </div>
  );
}
