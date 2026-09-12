import type { LessonBlock } from "@/lib/curriculum/lesson-body";
import Link from "next/link";
import { ctaHref } from "@/features/lesson-reader/lesson-blocks";
import { LessonMedia } from "@/features/reader-fidelity/reader-media";

/**
 * THE BLOCK RENDERER, in the frozen Reader's vocabulary.
 *
 * ONE COMPONENT PER CANONICAL BLOCK TYPE, and nothing else. No "unknown block"
 * fallback that prints JSON, no markdown parser, and no `dangerouslySetInnerHTML`
 * anywhere: the parser upstream has already dropped anything this file cannot
 * render, so every branch here handles a shape it has been guaranteed. An
 * unknown type renders NOTHING — fail-closed, exactly as the frozen renderer
 * does.
 *
 * IT COMPLETES NOTHING. The only interactive elements a block can produce are
 * LINKS — to a tool the product already routes to, or back to the level page
 * where the canonical task control lives. There is no button here that reports
 * anything to a server, and an `exercise` block deliberately carries no "done"
 * control: a practical level is finished by the canonical manual-completion,
 * mentor-review or report owner, never by ticking a box beside the text.
 *
 * WHERE A CTA GOES IS NOT DECIDED HERE. `ctaHref` is the product's own routing
 * rule and is imported rather than reimplemented, so a lesson CTA and the level
 * page can never disagree about where the canonical control lives.
 */
const CALLOUT_LABEL: Record<string, string> = {
  info: "Важно знать",
  key_idea: "Ключевая мысль",
  tip: "Подсказка",
  warning: "Осторожно",
  risk: "Риск",
};

/** Blank-line separated prose, as the frozen renderer splits it. */
function paragraphs(text: string): string[] {
  return String(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function ReaderBlock({
  block,
  levelHref,
  nextLevelHref,
  actionable,
}: {
  block: LessonBlock;
  levelHref: string;
  nextLevelHref: string | null;
  actionable: boolean;
}) {
  switch (block.type) {
    case "rich_text":
      return (
        <>
          {block.paragraphs.flatMap((text, i) =>
            paragraphs(text).map((p, j) => (
              <p className="p" key={`${i}-${j}`}>
                {p}
              </p>
            )),
          )}
        </>
      );

    case "heading":
      return block.level === 4 ? <h4>{block.text}</h4> : <h3>{block.text}</h3>;

    case "callout":
      return (
        <aside className={`callout callout--${block.variant}`}>
          <p className="callout__label">
            {block.title || CALLOUT_LABEL[block.variant] || "Важно"}
          </p>
          <p className="callout__body">{block.body}</p>
        </aside>
      );

    case "list":
      return block.ordered ? (
        <ol className="list">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul className="list">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );

    case "table":
      /* Focusable and labelled, so a wide table can be reached and scrolled by
         keyboard instead of being a region only a mouse can enter. */
      return (
        <div className="tablewrap" tabIndex={0} role="group" aria-label={block.caption ?? "Таблица"}>
          <table>
            {block.caption ? <caption>{block.caption}</caption> : null}
            <thead>
              <tr>
                {block.headers.map((header, i) => (
                  <th scope="col" key={i}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell || ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "example":
      return (
        <figure className="example">
          <figcaption className="example__label">{block.title || "Пример"}</figcaption>
          {paragraphs(block.body).map((p, i) => (
            <p className="p" key={i}>
              {p}
            </p>
          ))}
        </figure>
      );

    case "common_mistake":
      return (
        <div className="mistake">
          <p>
            <b>Частая ошибка</b>
            {block.mistake}
          </p>
          <p>
            <b>Как правильно</b>
            {block.correction}
          </p>
        </div>
      );

    case "glossary":
      return (
        <dl className="glossary">
          {block.entries.map((entry, i) => (
            <div key={i}>
              <dt>{entry.term}</dt>
              <dd>{entry.definition}</dd>
            </div>
          ))}
        </dl>
      );

    case "exercise":
      return (
        <section className="exercise" aria-label={`Задание: ${block.title}`}>
          <p className="exercise__kicker">
            Задание
            {block.estimatedMinutes ? ` · ≈${block.estimatedMinutes} мин` : ""}
          </p>
          <h3>{block.title}</h3>
          {paragraphs(block.instructions).map((p, i) => (
            <p className="p" key={i}>
              {p}
            </p>
          ))}
          <p className="exercise__expected">
            <b>Что сделать</b>
            {block.expectedAction}
          </p>
        </section>
      );

    case "tool_link":
      return (
        <Link className="toollink" href={`/tools/${encodeURIComponent(block.toolCode)}`}>
          <span className="toollink__label">{block.label}</span>
          {block.context ? <span className="toollink__ctx">{block.context}</span> : null}
        </Link>
      );

    case "cta":
      return (
        <div className="acta">
          {block.body ? <p className="acta__body">{block.body}</p> : null}
          {/* `data-lit` carries whether the level is actually actionable, so a
              CTA on a finished or waiting level reads as quiet rather than as a
              demand. It is presentation of a canonical state, never a second
              decision about one. */}
          <Link
            className="acta__link"
            href={ctaHref(block.action, block.toolCode, levelHref, nextLevelHref)}
            data-lit={String(actionable)}
          >
            {block.label}
          </Link>
        </div>
      );

    case "divider":
      return <hr />;

    case "image":
    case "video":
    case "download":
      return (
        <LessonMedia block={block} />
      );

    default:
      /* Fail-closed: a type this build does not know renders nothing at all,
         rather than a placeholder that implies something is missing. */
      return null;
  }
}
