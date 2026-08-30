/**
 * THE BLOCK RENDERER — canonical lesson material, in the Academy's own language.
 *
 * ONE COMPONENT PER CANONICAL BLOCK TYPE, and nothing else. There is no
 * "unknown block" fallback that prints JSON, no markdown parser, and no
 * `dangerouslySetInnerHTML` anywhere: the reader upstream has already dropped
 * anything this file cannot render, so every branch here handles a shape it has
 * been guaranteed.
 *
 * VISUAL INHERITANCE (§10). These render inside `.ax`, so they inherit the
 * approved tokens — deep navy field, high-contrast ink, the one functional cyan
 * signal — and cannot drift into a second palette. The fixture era's lesson
 * styling is not carried over: no card wall, no LMS chrome, no progress
 * furniture around every paragraph. A lesson is a document, and it is set like
 * one.
 *
 * IT COMPLETES NOTHING (§11). The only interactive elements a block can produce
 * are LINKS — to a tool the product already routes to, or back to the level page
 * where the canonical task control lives. There is no button here that reports
 * anything to a server, and an `exercise` block deliberately carries no "done"
 * control: a practical level is finished by the canonical manual-completion,
 * mentor-review or report owner, never by ticking a box next to the text.
 */
import Link from "next/link";
import type { LessonBlock, LessonCtaAction } from "@/lib/curriculum/lesson-body";

/**
 * Where a canonical CTA action goes.
 *
 * Every destination is a route the Academy already owns. `levelHref` is the
 * level's own page, which is where every canonical task control lives —
 * assessment, report, manual completion, mentor review and the Pocket
 * registration CTA are all rendered there and all still refuse anything the
 * Backend refuses. So a lesson CTA is navigation to the authority, never a
 * substitute for it.
 *
 * `next_level` is the one action that can legitimately have nowhere to go: the
 * next level may be locked, or this may be the last one. It resolves to the
 * level page too rather than to a dead link, because the level page is where the
 * learner finds out what actually comes next.
 */
export function ctaHref(
  action: LessonCtaAction,
  toolCode: string | null,
  levelHref: string,
  nextLevelHref: string | null,
): string {
  switch (action) {
    case "open_tool":
      return toolCode ? `/tools/${encodeURIComponent(toolCode)}` : levelHref;
    case "next_level":
      return nextLevelHref ?? levelHref;
    case "start_assessment":
    case "open_report":
    case "request_mentor_review":
    case "pocket_registration":
      // The canonical control for all four lives in the task section of the
      // level page. The anchor lands the learner on it directly.
      return `${levelHref}#task`;
  }
}

const CALLOUT_LABEL: Record<string, string> = {
  info: "Важно знать",
  key_idea: "Ключевая мысль",
  tip: "Подсказка",
  warning: "Осторожно",
  risk: "Риск",
};

export function LessonBlockView({
  block,
  levelHref,
  nextLevelHref,
  /**
   * The canonical posture of the level this lesson belongs to.
   *
   * WHY A BLOCK NEEDS IT. A lesson body is STATIC content: the author wrote
   * "Отправить план на проверку" once, and it is still in the text after the
   * mentor has approved the level. Rendered as the page's one lit control it
   * would invite an action that no longer exists — on a finished level, on a
   * level whose review is pending, and on a locked one alike.
   *
   * The link itself is kept in all cases, because it is navigation to the
   * canonical task surface and that surface is the honest place to find out
   * what the level's state actually is. What changes is EMPHASIS: lit only when
   * the learner can genuinely act, exactly as Home and Path already do.
   */
  posture,
}: {
  block: LessonBlock;
  levelHref: string;
  nextLevelHref: string | null;
  posture: "act" | "waiting" | "blocked" | "done";
}) {
  switch (block.type) {
    case "heading":
      // h3/h4 only: h1 is the lesson title and h2 is the section title, so the
      // document outline stays correct for a screen reader.
      return block.level === 3 ? (
        <h3 className="lr-h3">{block.text}</h3>
      ) : (
        <h4 className="lr-h4">{block.text}</h4>
      );

    case "rich_text":
      return (
        <>
          {block.paragraphs.map((paragraph, index) => (
            <p className="lr-p" key={index}>
              {paragraph}
            </p>
          ))}
        </>
      );

    case "callout":
      return (
        <aside className="lr-callout" data-variant={block.variant}>
          {/* The variant is named in TEXT, never carried by colour alone. */}
          <p className="lr-callout__label">{block.title ?? CALLOUT_LABEL[block.variant] ?? "Важно"}</p>
          <p className="lr-callout__body">{block.body}</p>
        </aside>
      );

    case "list":
      return block.ordered ? (
        <ol className="lr-list" data-ordered="true">
          {block.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul className="lr-list">
          {block.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      );

    case "table":
      return (
        // Wrapped so a wide table scrolls INSIDE its own box. The page body must
        // never scroll horizontally, least of all at 390px.
        <div className="lr-tablewrap">
          <table className="lr-table">
            {block.caption ? <caption className="lr-table__caption">{block.caption}</caption> : null}
            <thead>
              <tr>
                {block.headers.map((header, index) => (
                  <th scope="col" key={index}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "example":
      return (
        <figure className="lr-example">
          <figcaption className="lr-example__title">{block.title}</figcaption>
          {block.body.split(/\n{2,}/).map((paragraph, index) => (
            <p className="lr-p" key={index}>
              {paragraph.trim()}
            </p>
          ))}
        </figure>
      );

    case "common_mistake":
      return (
        <div className="lr-mistake">
          <p className="lr-mistake__row" data-role="mistake">
            <span className="lr-mistake__label">Частая ошибка</span>
            {block.mistake}
          </p>
          <p className="lr-mistake__row" data-role="correction">
            <span className="lr-mistake__label">Как правильно</span>
            {block.correction}
          </p>
        </div>
      );

    case "glossary":
      return (
        <dl className="lr-glossary">
          {block.entries.map((entry) => (
            <div className="lr-glossary__item" key={entry.term}>
              <dt>{entry.term}</dt>
              <dd>{entry.definition}</dd>
            </div>
          ))}
        </dl>
      );

    case "exercise":
      return (
        <section className="lr-exercise" aria-label={`Задание: ${block.title}`}>
          <p className="lr-exercise__kicker">
            Задание
            {/* Author-written, per exercise. Absent when the author wrote none —
                never estimated, never averaged (§7). */}
            {block.estimatedMinutes !== null ? <> · ≈{block.estimatedMinutes} мин</> : null}
          </p>
          <h3 className="lr-exercise__title">{block.title}</h3>
          {block.instructions.split(/\n{2,}/).map((paragraph, index) => (
            <p className="lr-p" key={index}>
              {paragraph.trim()}
            </p>
          ))}
          <p className="lr-exercise__expected">
            <span className="lr-exercise__expectedLabel">Что сделать</span>
            {block.expectedAction}
          </p>
        </section>
      );

    case "tool_link":
      return (
        <Link className="lr-toollink" href={`/tools/${encodeURIComponent(block.toolCode)}`}>
          <span className="lr-toollink__label">{block.label}</span>
          {block.context ? <span className="lr-toollink__ctx">{block.context}</span> : null}
        </Link>
      );

    case "cta":
      return (
        <div className="lr-cta" data-posture={posture}>
          {block.body ? <p className="lr-cta__body">{block.body}</p> : null}
          <Link
            className={`lr-cta__link${posture === "act" ? "" : " lr-cta__link--quiet"}`}
            href={ctaHref(block.action, block.toolCode, levelHref, nextLevelHref)}
          >
            {block.label}
          </Link>
        </div>
      );

    case "divider":
      return <hr className="lr-divider" />;

    case "image":
      return (
        <figure className="lr-figure">
          {/* eslint-disable-next-line @next/next/no-img-element -- the source is
              a published https asset of unknown intrinsic size, not a bundled
              file the optimizer can reason about. */}
          <img className="lr-figure__img" src={block.asset.url} alt={block.alt} loading="lazy" />
          {block.caption ? <figcaption className="lr-figure__cap">{block.caption}</figcaption> : null}
        </figure>
      );

    case "video":
      return (
        <figure className="lr-figure">
          <video className="lr-figure__video" controls preload="metadata" playsInline>
            <source src={block.asset.url} type={block.asset.mimeType} />
            {block.captions ? (
              <track kind="captions" src={block.captions.url} label="Субтитры" default />
            ) : null}
          </video>
          <figcaption className="lr-figure__cap">{block.caption ?? block.title}</figcaption>
        </figure>
      );

    case "download":
      return (
        <a className="lr-download" href={block.asset.url} rel="noopener">
          <span className="lr-download__label">{block.label}</span>
          {block.description ? <span className="lr-download__desc">{block.description}</span> : null}
        </a>
      );
  }
}
