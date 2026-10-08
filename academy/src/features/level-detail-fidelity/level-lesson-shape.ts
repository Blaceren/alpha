/**
 * DOES THE LESSON'S TEXT BELONG ON THE LEVEL PAGE, OR ON ITS OWN?
 *
 * Two kinds of lesson text exist in published programs:
 *
 *   - the 100-level program's lessons are READING: several sections of prose,
 *     tables and worked examples, with a reading position the Backend keeps.
 *     They live on the reading surface (`/lessons/<code>/material`) and the
 *     level page links to it;
 *
 *   - the 30-level program's lessons are VIDEO, and their text is what stands
 *     beside a video: one paragraph saying what the lesson is about, or the
 *     assignment of a practical level. Sending a learner to a second page to
 *     read three sentences — and to press «отметить прочитанным» under them —
 *     would be the reading surface's ceremony without its reason.
 *
 * So a SHORT body is printed on the level page itself and a long one keeps its
 * own surface. "Short" is measured, not declared: a handful of sections and a
 * couple of screens of text at most. The measure is deliberately generous to
 * an assignment (a list of eight points, a list of seven, three checks) and
 * deliberately far below a reading lesson.
 *
 * PRESENTATION ONLY. The reading surface stays reachable for every lesson.
 */
import type { LessonBlock, LessonBody } from "@/lib/curriculum/lesson-body";

export const INLINE_LESSON_MAX_SECTIONS = 6;
export const INLINE_LESSON_MAX_CHARACTERS = 4_000;

/** Block types that are text beside a video; anything else is reading material. */
const INLINE_BLOCK_TYPES: ReadonlySet<LessonBlock["type"]> = new Set([
  "rich_text",
  "heading",
  "list",
  "callout",
  "divider",
]);

function blockLength(block: LessonBlock): number {
  switch (block.type) {
    case "rich_text":
      return block.paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
    case "heading":
      return block.text.length;
    case "list":
      return block.items.reduce((sum, item) => sum + item.length, 0);
    case "callout":
      return block.body.length + (block.title?.length ?? 0);
    default:
      return 0;
  }
}

export function isInlineLessonBody(body: LessonBody | null): body is LessonBody {
  if (!body || body.sections.length === 0 || body.sections.length > INLINE_LESSON_MAX_SECTIONS) return false;
  if (body.appendix.length > 0) return false;
  let characters = 0;
  for (const section of body.sections) {
    for (const block of section.blocks) {
      if (!INLINE_BLOCK_TYPES.has(block.type)) return false;
      characters += blockLength(block);
      if (characters > INLINE_LESSON_MAX_CHARACTERS) return false;
    }
  }
  return true;
}
