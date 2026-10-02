import { describe, expect, it } from "vitest";
import { lessonQuestionMarkers } from "./content-read-progress";

const scope = { level: { id: 7 }, curriculumVersionId: 5 };
const published = (questions: Array<{ questionNumber: number; rewatchFromSeconds: number | null }>) => ({
  id: 11,
  levelDefinitionId: 7,
  curriculumVersionId: 5,
  status: "published",
  publishedAt: new Date("2026-10-02T12:00:00Z"),
  questions,
});

describe("lessonQuestionMarkers", () => {
  it("gives each question's number and the second its answer is taught, in order", () => {
    const markers = lessonQuestionMarkers(
      scope,
      published([
        { questionNumber: 1, rewatchFromSeconds: 115 },
        { questionNumber: 2, rewatchFromSeconds: 190 },
        { questionNumber: 3, rewatchFromSeconds: null },
        { questionNumber: 4, rewatchFromSeconds: 470 },
      ]),
      true,
    );
    expect(markers).toEqual([
      { questionNumber: 1, rewatchFromSeconds: 115 },
      { questionNumber: 2, rewatchFromSeconds: 190 },
      { questionNumber: 4, rewatchFromSeconds: 470 },
    ]);
  });

  it("says nothing when assessments are off or the level has no test", () => {
    const test = published([{ questionNumber: 1, rewatchFromSeconds: 10 }]);
    expect(lessonQuestionMarkers(scope, test, false)).toEqual([]);
    expect(lessonQuestionMarkers(scope, null, true)).toEqual([]);
    expect(lessonQuestionMarkers(scope, undefined, true)).toEqual([]);
  });

  it("says nothing for a test the assessment runtime would not serve", () => {
    const questions = [{ questionNumber: 1, rewatchFromSeconds: 10 }];
    expect(lessonQuestionMarkers(scope, { ...published(questions), status: "draft" }, true)).toEqual([]);
    expect(lessonQuestionMarkers(scope, { ...published(questions), publishedAt: null }, true)).toEqual([]);
    expect(lessonQuestionMarkers(scope, { ...published(questions), levelDefinitionId: 8 }, true)).toEqual([]);
    expect(lessonQuestionMarkers(scope, { ...published(questions), curriculumVersionId: 4 }, true)).toEqual([]);
  });

  it("drops a second or a number it cannot place, and never repeats a question", () => {
    const markers = lessonQuestionMarkers(
      scope,
      published([
        { questionNumber: 1, rewatchFromSeconds: -1 },
        { questionNumber: 2, rewatchFromSeconds: 86_401 },
        { questionNumber: 0, rewatchFromSeconds: 5 },
        { questionNumber: 3, rewatchFromSeconds: 1.5 },
        { questionNumber: 4, rewatchFromSeconds: 30 },
        { questionNumber: 4, rewatchFromSeconds: 40 },
      ]),
      true,
    );
    expect(markers).toEqual([{ questionNumber: 4, rewatchFromSeconds: 30 }]);
  });
});
