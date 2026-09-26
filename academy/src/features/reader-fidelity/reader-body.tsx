"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LessonBody } from "@/lib/curriculum/lesson-body";
import { ReaderBlock } from "@/features/reader-fidelity/reader-blocks";
import {
  saveLessonReadingProgress,
  newLessonProgressRequestId,
} from "@/lib/curriculum/lesson-progress-client";

import {
  BOUNDARY_LABEL,
  BOUNDARY_TEXT,
  HANDOFF_ACTION,
  OBJECTIVE_LABEL,
  QUIET_RETURN,
  SAVE_FAILED_NOTE,
  STRIP_BUTTON,
  TOC_LABEL,
  type BoundaryClass,
  type ReadingState,
} from "@/features/reader-fidelity/reader-state";

/**
 * THE READER — the frozen reading surface, on the published lesson.
 *
 * VISUAL AUTHORITY: LessonsATA @ e311a849bcd12b086de68d6cb41f908e8b99f910,
 * `Reader/hifi/desktop/prototype`. The opening with its address kicker and
 * objective, the structure list, the numbered sections, the context strip that
 * appears once the opening leaves view, and the closing boundary.
 *
 * DATA AUTHORITY: the product. The body, the sections, their canonical codes,
 * the reading position and the level's state all come from
 * `/api/backend/curriculum/levels/[stableCode]/content`. Every block is rendered
 * through the product's existing sanitising block view — a lesson body is
 * authored content arriving over the wire, and this surface does not get to
 * decide it is safe.
 *
 * WHAT DID NOT CROSS OVER:
 *
 *   * `[WORKING COPY]` tags. They are QA markers in the prototype, printed
 *     beside copy that had not been ratified. Shipping them would put an
 *     internal review state in front of a learner.
 *
 *   * The 23 `?lf=` scenarios and the `&qa=1` panel. Fixtures and
 *     instrumentation.
 *
 *   * The prototype's own topbar. The product keeps the accepted AppShell,
 *     which supplies the one `<main>` landmark and the one skip link.
 *
 *   * The `alt=margin` exploration variant, which the prototype itself marks as
 *     an exploration rather than the accepted composition.
 */
export function ReaderBody({
  body,
  stableCode,
  levelHref,
  levelOrder,
  nextLevelHref,
  moduleOrder,
  moduleTitle,
  title,
  subtitle,
  objective,
  objectiveExt,
  initialReading,
  canTrackReading,
  playbackPositionSeconds,
  posture,
  boundary,
  completionMethod,
  hasAuthoredCta,
}: {
  body: LessonBody;
  stableCode: string;
  levelHref: string;
  levelOrder: number;
  nextLevelHref: string | null;
  moduleOrder: number;
  moduleTitle: string;
  title: string;
  subtitle: string | null;
  objective: string;
  objectiveExt: string | null;
  initialReading: ReadingState | null;
  canTrackReading: boolean;
  playbackPositionSeconds: number;
  posture: "act" | "waiting" | "blocked" | "done";
  boundary: BoundaryClass;
  completionMethod: string;
  hasAuthoredCta: boolean;
}) {
  const [reading, setReading] = useState<ReadingState>(
    initialReading ?? { revision: 0, completedSections: [], activeSectionCode: null },
  );
  const [note, setNote] = useState<string | null>(null);
  const [stripVisible, setStripVisible] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const inFlight = useRef(false);
  const openingRef = useRef<HTMLElement>(null);

  const done = useMemo(() => new Set(reading.completedSections), [reading.completedSections]);
  const sections = body.sections;

  /**
   * The section to resume from: the server's own active marker when it still
   * names a section of this lesson, otherwise the first unread one. Not a
   * second resume engine — it reads the canonical position and picks the
   * earliest thing the learner has not finished.
   */
  const resumeIndex = useMemo(() => {
    const active = reading.activeSectionCode;
    if (active && sections.some((s) => s.code === active) && !done.has(active)) {
      return sections.findIndex((s) => s.code === active);
    }
    /* A frozen position — one belonging to a level that is no longer being
       read — is not offered. The prototype derives the same rule from trace
       temperature: only live traces reach the learner. */
    if (!canTrackReading) return -1;
    return sections.findIndex((s) => !done.has(s.code));
  }, [reading.activeSectionCode, sections, done, canTrackReading]);

  /* The context strip appears only after the opening leaves view: while the
     opening is on screen it already carries the identity, and two copies of it
     at once is the duplication the strip exists to avoid. */
  useEffect(() => {
    const opening = openingRef.current;
    if (!opening || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      ([entry]) => setStripVisible(!(entry?.isIntersecting ?? true)),
      { threshold: 0 },
    );
    observer.observe(opening);
    return () => observer.disconnect();
  }, []);

  const toggle = useCallback(
    async (code: string) => {
      if (!canTrackReading || inFlight.current) return;
      inFlight.current = true;
      setNote(null);

      const previous = reading;
      const nextCompleted = done.has(code)
        ? reading.completedSections.filter((entry) => entry !== code)
        : [...reading.completedSections, code];
      const nextActive = sections.find((s) => !nextCompleted.includes(s.code))?.code ?? null;

      setReading({ ...reading, completedSections: nextCompleted, activeSectionCode: nextActive });

      const result = await saveLessonReadingProgress(
        stableCode,
        {
          expectedRevision: reading.revision,
          completedSections: nextCompleted,
          activeSectionCode: nextActive,
          playbackPositionSeconds,
        },
        newLessonProgressRequestId(),
      );
      inFlight.current = false;

      if (!result.ok) {
        /* Reverted: the page must never show a position the server rejected. */
        setReading(previous);
        setNote(SAVE_FAILED_NOTE);
        return;
      }
      setReading({
        revision: result.data.acceptedRevision,
        completedSections: result.data.completedSections,
        activeSectionCode: result.data.activeSectionCode,
      });
    },
    [canTrackReading, reading, done, sections, stableCode, playbackPositionSeconds],
  );

  const address = `МОДУЛЬ ${String(moduleOrder).padStart(2, "0")} · ${moduleTitle.toUpperCase()}`;

  return (
    <div className="rdr">
      {/* Local context strip: identity + location + structure access. */}
      <div className="strip" hidden={!stripVisible}>
        <div className="strip__inner">
          <button
            type="button"
            className="strip__btn"
            aria-expanded={panelOpen}
            aria-controls="strip-panel"
            onClick={() => setPanelOpen((open) => !open)}
          >
            {STRIP_BUTTON}
          </button>
          <span className="strip__addr">УРОВЕНЬ {levelOrder}</span>
          <span className="strip__title">{title}</span>
        </div>
      </div>
      <nav className="panel" id="strip-panel" aria-label={TOC_LABEL} hidden={!panelOpen}>
        <div className="panel__inner">
          <ol className="panel__list">
            {sections.map((section, index) => (
              <li key={section.code}>
                <a href={`#${section.code}`} onClick={() => setPanelOpen(false)}>
                  <span className="panel__num">{String(index + 1).padStart(2, "0")}</span>
                  <span>{section.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      </nav>

      <p className="savenote" role="status">
        {note ?? ""}
      </p>

      <article className="reader" data-level={stableCode}>
        <p className="return">
          <Link href={levelHref}>← Уровень {levelOrder}</Link>
        </p>

        <header className="opening" ref={openingRef}>
          <p className="kicker">
            <span className="kicker__ctx">{address}</span>
            <span className="kicker__lvl">УРОВЕНЬ {levelOrder}</span>
          </p>
          <h1>{title}</h1>
          {subtitle ? <p className="subtitle">{subtitle}</p> : null}

          <section className="objective" aria-label={OBJECTIVE_LABEL}>
            <p className="objective__label">{OBJECTIVE_LABEL}</p>
            <p className="objective__text">{objective}</p>
            {objectiveExt ? <p className="objective__ext">{objectiveExt}</p> : null}
          </section>

          <nav className="toc" aria-label={TOC_LABEL}>
            <p className="toc__label">{TOC_LABEL}</p>
            <ol>
              {sections.map((section, index) => (
                <li key={section.code}>
                  <a href={`#${section.code}`}>
                    <span className="toc__num">{String(index + 1).padStart(2, "0")}</span>
                    <span>{section.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {resumeIndex >= 0 ? (
            <p className="resume">
              Вы остановились на разделе {resumeIndex + 1} — «{sections[resumeIndex]!.title}».{" "}
              <a href={`#${sections[resumeIndex]!.code}`}>Вернуться к разделу</a>
            </p>
          ) : null}
        </header>

        {sections.map((section, index) => (
          <section
            className="section"
            id={section.code}
            key={section.code}
            aria-labelledby={`h-${section.code}`}
            data-read={done.has(section.code) ? "true" : "false"}
          >
            <p className="section__kicker">
              <span>РАЗДЕЛ</span>
              <b className="section__ord">{String(index + 1).padStart(2, "0")}</b>
            </p>
            <h2 id={`h-${section.code}`} tabIndex={-1}>
              {section.title}
            </h2>
            {section.blocks.map((block, blockIndex) => (
              <ReaderBlock
                block={block}
                key={blockIndex}
                levelHref={levelHref}
                nextLevelHref={nextLevelHref}
                actionable={posture === "act"}
              />
            ))}
            {canTrackReading ? (
              <button
                type="button"
                className="acta__link"
                onClick={() => void toggle(section.code)}
                aria-pressed={done.has(section.code)}
              >
                {done.has(section.code) ? "Прочитано" : "Отметить прочитанным"}
              </button>
            ) : null}
          </section>
        ))}

        {body.appendix.length > 0 ? (
          <section className="section" aria-label="Дополнительно">
            {body.appendix.map((block, index) => (
              <ReaderBlock
                block={block}
                key={index}
                levelHref={levelHref}
                nextLevelHref={nextLevelHref}
                actionable={posture === "act"}
              />
            ))}
          </section>
        ) : null}

        {/* The closing boundary, plus the system handoff. An authored CTA at the
            end of the material already carries the action, so the boundary then
            carries state and exits without saying it twice. */}
        <footer className="boundary" aria-label="Граница материала">
          <p className="boundary__label">{BOUNDARY_LABEL}</p>
          <p className="boundary__text">{BOUNDARY_TEXT[boundary]}</p>
          {boundary === "act" && !hasAuthoredCta ? (
            <Link className="boundary__act" href={levelHref}>
              {HANDOFF_ACTION[completionMethod] ?? "Открыть страницу уровня"}
            </Link>
          ) : boundary !== "act" ? (
            <Link className="boundary__quiet" href={levelHref}>
              {QUIET_RETURN}
            </Link>
          ) : null}
          <nav className="exits" aria-label="Навигация">
            <Link href={levelHref}>← Уровень {levelOrder}</Link>
            <Link href="/path">Открыть путь</Link>
          </nav>
        </footer>
      </article>
    </div>
  );
}
