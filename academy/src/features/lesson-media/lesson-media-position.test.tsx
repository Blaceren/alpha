/**
 * Lesson hi-fi (DD-336) — «Продолжить с …» and the position behind it.
 *
 * The player tells the page where the learner stopped; the page keeps it
 * through the lesson-progress command the reader already uses. What is proven
 * here: the save carries the revision the Backend last accepted and passes the
 * reading state through untouched; a refused save stops the saving instead of
 * guessing; and nothing is saved where the page did not allow it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { AcademyLessonMedia } from "@/lib/curriculum/academy-view";

const save = vi.fn();
vi.mock("@/lib/curriculum/lesson-progress-client", () => ({
  saveLessonReadingProgress: (...args: unknown[]) => save(...args),
}));

const { LessonMedia } = await import("@/features/lesson-media/lesson-media");

const MEDIA: AcademyLessonMedia = {
  src: "/media/lessons/v2.l004.kak-chitat-grafik/4d86121c0c7a1eee.mp4",
  mimeType: "video/mp4",
  poster: null,
  durationSeconds: 500,
  captions: [],
  markers: [],
};
const CODE = "v2.l004.kak-chitat-grafik";

function loaded(container: HTMLElement) {
  const video = container.querySelector("video") as HTMLVideoElement;
  Object.defineProperty(video, "duration", { configurable: true, value: 500 });
  Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 0 });
  fireEvent.loadedMetadata(video);
  return video;
}

describe("the lesson's reading position", () => {
  beforeEach(() => {
    save.mockReset();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("offers the position the Backend kept", () => {
    render(
      <LessonMedia media={MEDIA} title="Урок" levelCode={CODE} reading={{ positionSeconds: 222, save: null }} />,
    );
    expect(screen.getByRole("button", { name: "Продолжить с 3:42" })).toBeInTheDocument();
  });

  it("saves with the revision it was given, then with the one the Backend accepted", async () => {
    save.mockResolvedValueOnce({ ok: true, data: { acceptedRevision: 4, completedSections: ["s1"], activeSectionCode: "s1" } });
    save.mockResolvedValueOnce({ ok: true, data: { acceptedRevision: 5, completedSections: ["s1"], activeSectionCode: "s1" } });
    const { container } = render(
      <LessonMedia
        media={MEDIA}
        title="Урок"
        levelCode={CODE}
        reading={{ positionSeconds: 0, save: { revision: 3, completedSections: ["s1"], activeSectionCode: "s1" } }}
      />,
    );
    const video = loaded(container);
    fireEvent.play(video);
    video.currentTime = 42;
    await act(async () => {
      fireEvent.pause(video);
    });
    expect(save).toHaveBeenCalledTimes(1);
    const [code, input, requestId] = save.mock.calls[0]!;
    expect(code).toBe(CODE);
    expect(input).toEqual({
      expectedRevision: 3,
      completedSections: ["s1"],
      activeSectionCode: "s1",
      playbackPositionSeconds: 42,
    });
    expect(requestId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/);

    fireEvent.play(video);
    video.currentTime = 90;
    await act(async () => {
      fireEvent.pause(video);
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![1]).toMatchObject({ expectedRevision: 4, playbackPositionSeconds: 90 });
  });

  it("stops saving after a refusal, rather than guessing at a merge", async () => {
    save.mockResolvedValueOnce({ ok: false, error: { code: "STALE" } });
    const { container } = render(
      <LessonMedia
        media={MEDIA}
        title="Урок"
        levelCode={CODE}
        reading={{ positionSeconds: 0, save: { revision: 0, completedSections: [], activeSectionCode: null } }}
      />,
    );
    const video = loaded(container);
    fireEvent.play(video);
    video.currentTime = 30;
    await act(async () => {
      fireEvent.pause(video);
    });
    fireEvent.play(video);
    video.currentTime = 60;
    await act(async () => {
      fireEvent.pause(video);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves nothing where the page did not allow it", async () => {
    const { container } = render(
      <LessonMedia media={MEDIA} title="Урок" levelCode={CODE} reading={{ positionSeconds: 120, save: null }} />,
    );
    const video = loaded(container);
    fireEvent.play(video);
    video.currentTime = 150;
    await act(async () => {
      fireEvent.pause(video);
    });
    expect(save).not.toHaveBeenCalled();
  });
});
