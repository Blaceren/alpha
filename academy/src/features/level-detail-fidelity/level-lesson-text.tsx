import type { LessonBlock, LessonBody } from "@/lib/curriculum/lesson-body";
import { toParagraphs } from "@/lib/curriculum/lesson-body";

/**
 * THE LESSON'S OWN TEXT, ON THE LEVEL PAGE.
 *
 * Rendered only for a body `isInlineLessonBody` accepted, so every block here
 * is one of five plain types: prose, a sub-heading, a list, a callout, a rule.
 * Anything richer keeps the reading surface, which has the vocabulary for it.
 *
 * NO PROGRESS, NO CONTROLS. This is text. There is no «отметить прочитанным»
 * under it and nothing here reports to the Backend: the level's own task, below
 * on the same page, is what completes it.
 *
 * No markdown is interpreted and no HTML is injected — a paragraph is a string
 * printed as a string, exactly as the reading surface prints it.
 */
const CALLOUT_LABEL: Record<string, string> = {
  info: "Важно знать",
  key_idea: "Ключевая мысль",
  tip: "Подсказка",
  warning: "Осторожно",
  risk: "Риск",
};

function Block({ block }: { block: LessonBlock }) {
  switch (block.type) {
    case "rich_text":
      return (
        <>
          {block.paragraphs.flatMap((text, i) =>
            toParagraphs(text).map((paragraph, j) => (
              <p className="ld-text__p" key={`${i}-${j}`}>
                {paragraph}
              </p>
            )),
          )}
        </>
      );
    case "heading":
      return <h4 className="ld-text__sub">{block.text}</h4>;
    case "list":
      return block.ordered ? (
        <ol className="ld-text__list">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul className="ld-text__list">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case "callout":
      return (
        <aside className="ld-text__callout" data-variant={block.variant}>
          <p className="ld-text__callout-label">{block.title || CALLOUT_LABEL[block.variant] || "Важно"}</p>
          <p className="ld-text__callout-body">{block.body}</p>
        </aside>
      );
    case "divider":
      return <hr className="ld-text__rule" />;
    default:
      /* Unreachable for an accepted body; fail-closed all the same. */
      return null;
  }
}

export function LevelLessonText({ body }: { body: LessonBody }) {
  return (
    <div className="ld-text">
      {body.sections.map((section) => (
        <section className="ld-text__section" key={section.code} data-section={section.code}>
          <h3 className="ld-text__title">{section.title}</h3>
          {section.blocks.map((block, i) => (
            <Block block={block} key={i} />
          ))}
        </section>
      ))}
    </div>
  );
}
