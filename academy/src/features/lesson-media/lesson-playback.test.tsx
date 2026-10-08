/**
 * «ПЕРЕСМОТРЕТЬ С 1:55» — the wire between a test's разбор and the lesson's
 * player, and the player's end of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import {
  publishLessonVerdicts,
  requestLessonRewatch,
  subscribeLessonRewatch,
  subscribeLessonVerdicts,
} from "@/features/lesson-media/lesson-playback";
import { LessonMedia } from "@/features/lesson-media/lesson-media";
import type { AcademyLessonMedia } from "@/lib/curriculum/academy-view";

const MEDIA: AcademyLessonMedia = {
  src: "/media/lessons/v2.l004.kak-chitat-grafik/4d86121c0c7a1eee.mp4",
  mimeType: "video/mp4",
  poster: null,
  durationSeconds: 500,
  captions: [],
  markers: [
    { questionNumber: 1, seconds: 115 },
    { questionNumber: 2, seconds: 190 },
  ],
};

describe("the rewatch channel", () => {
  it("delivers a request to a subscriber, as whole seconds", () => {
    const heard: number[] = [];
    const off = subscribeLessonRewatch(({ seconds }) => heard.push(seconds));
    expect(requestLessonRewatch(115)).toBe(true);
    expect(requestLessonRewatch(380.9)).toBe(true);
    off();
    expect(heard).toEqual([115, 380]);
  });

  it("answers false when nobody is listening — the caller can say so", () => {
    expect(requestLessonRewatch(115)).toBe(false);
    const off = subscribeLessonRewatch(() => undefined);
    off();
    expect(requestLessonRewatch(115)).toBe(false);
  });

  it("refuses a second that is not one", () => {
    const heard: number[] = [];
    const off = subscribeLessonRewatch(({ seconds }) => heard.push(seconds));
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(requestLessonRewatch(bad)).toBe(false);
    off();
    expect(heard).toEqual([]);
  });

  it("an unsubscribed listener hears nothing more, and a second listener is unaffected", () => {
    const first: number[] = [];
    const second: number[] = [];
    const offFirst = subscribeLessonRewatch(({ seconds }) => first.push(seconds));
    const offSecond = subscribeLessonRewatch(({ seconds }) => second.push(seconds));
    requestLessonRewatch(10);
    offFirst();
    requestLessonRewatch(20);
    offSecond();
    expect(first).toEqual([10]);
    expect(second).toEqual([10, 20]);
  });
});

describe("the lesson's player answers a rewatch request", () => {
  const play = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    play.mockClear();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  function loaded(container: HTMLElement) {
    const video = container.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { configurable: true, value: 500 });
    Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 0 });
    fireEvent.loadedMetadata(video);
    return video;
  }

  it("plays from the requested second where the learner is: no jump to the top of the page", () => {
    const { container } = render(<LessonMedia media={MEDIA} title="Как читать график" levelCode="v2.l004.kak-chitat-grafik" />);
    const video = loaded(container);
    const region = container.querySelector(".avp") as HTMLElement;
    const scrollIntoView = vi.fn();
    region.scrollIntoView = scrollIntoView;

    let taken = false;
    act(() => {
      taken = requestLessonRewatch(115, { questionNumber: 1 });
    });

    expect(taken).toBe(true);
    expect(video.currentTime).toBe(115);
    expect(play).toHaveBeenCalledOnce();
    // The stage is a docking one: it plays where the learner is instead of
    // taking them away from the question.
    expect(scrollIntoView).not.toHaveBeenCalled();
    // …and the point of that question is the one being watched.
    expect(container.querySelector('.avp__marker[data-active="true"] .avp__marker-point')).toHaveAttribute(
      "aria-label",
      "Вопрос 1 · ответ объясняют с 1:55",
    );
  });

  it("stops listening when it leaves the page", () => {
    const { unmount } = render(<LessonMedia media={MEDIA} title="Урок" />);
    unmount();
    expect(requestLessonRewatch(115)).toBe(false);
  });

  it("a lesson without a video listens to nothing", () => {
    render(<LessonMedia media={null} title="Урок" />);
    expect(requestLessonRewatch(115)).toBe(false);
  });

  it("serves a registry file from the Academy's own origin as it is", () => {
    const { container } = render(<LessonMedia media={MEDIA} title="Урок" />);
    expect(container.querySelector("video")?.getAttribute("src")).toBe(MEDIA.src);
  });

  it("hands the player the level's next step for its ended screen", () => {
    const { container, getByRole } = render(
      <LessonMedia media={MEDIA} title="Урок" endedAction={{ label: "Перейти к тесту", href: "#task" }} />,
    );
    fireEvent.ended(container.querySelector("video") as HTMLVideoElement);
    expect(getByRole("link", { name: "Перейти к тесту" })).toHaveAttribute("href", "#task");
  });
});

describe("the verdicts of the last attempt", () => {
  afterEach(() => {
    publishLessonVerdicts("v2.l004.kak-chitat-grafik", null);
    publishLessonVerdicts("v2.l005.cikl-sdelki", null);
  });

  it("reach the player of the same level, and the points say them", () => {
    const { container } = render(<LessonMedia media={MEDIA} title="Урок" levelCode="v2.l004.kak-chitat-grafik" />);
    const video = container.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { configurable: true, value: 500 });
    fireEvent.loadedMetadata(video);
    act(() => {
      publishLessonVerdicts("v2.l004.kak-chitat-grafik", new Map([[1, "wrong"], [2, "right"]]));
    });
    const states = [...container.querySelectorAll(".avp__marker")].map((item) => item.getAttribute("data-state"));
    expect(states).toEqual(["wrong", "right"]);
    expect(container.querySelector(".avp__marker .avp__marker-point")).toHaveAttribute(
      "aria-label",
      "Вопрос 1 · неверно · ответ объясняют с 1:55",
    );
    act(() => {
      publishLessonVerdicts("v2.l004.kak-chitat-grafik", null);
    });
    expect([...container.querySelectorAll(".avp__marker")].map((item) => item.getAttribute("data-state"))).toEqual([
      "neutral",
      "neutral",
    ]);
  });

  it("never reach the player of another level", () => {
    const heard: Array<unknown> = [];
    const stop = subscribeLessonVerdicts("v2.l005.cikl-sdelki", (verdicts) => heard.push(verdicts));
    publishLessonVerdicts("v2.l004.kak-chitat-grafik", new Map([[1, "right"]]));
    expect(heard).toEqual([null]);
    stop();
    // A player that mounts later hears the last verdicts only if they are its own.
    const late: Array<unknown> = [];
    subscribeLessonVerdicts("v2.l004.kak-chitat-grafik", (verdicts) => late.push(verdicts))();
    expect(late).toEqual([new Map([[1, "right"]])]);
  });
});

describe("the lesson line's points", () => {
  it("are one per second: questions taught at the same second share a point", async () => {
    const { lessonLineMarkers } = await import("@/features/lesson-media/lesson-media");
    const { points, pointOf } = lessonLineMarkers(
      [
        { questionNumber: 1, seconds: 40 },
        { questionNumber: 2, seconds: 130 },
        { questionNumber: 3, seconds: 130 },
        { questionNumber: 4, seconds: 130 },
      ],
      null,
    );
    expect(points.map((p) => [p.id, p.seconds, p.label])).toEqual([
      ["q1", 40, "1"],
      ["q2", 130, "2–4"],
    ]);
    expect(points[1]!.description).toBe("Вопросы 2, 3, 4 · ответы объясняют с 2:10");
    expect(pointOf.get(3)).toBe("q2");
  });

  it("a shared point says «неверно» when any of its questions was wrong, «верно» only when all were right", async () => {
    const { lessonLineMarkers } = await import("@/features/lesson-media/lesson-media");
    const markers = [
      { questionNumber: 2, seconds: 130 },
      { questionNumber: 3, seconds: 130 },
    ];
    expect(lessonLineMarkers(markers, new Map([[2, "right"], [3, "wrong"]])).points[0]!.state).toBe("wrong");
    expect(lessonLineMarkers(markers, new Map([[2, "right"], [3, "right"]])).points[0]!.state).toBe("right");
    expect(lessonLineMarkers(markers, new Map([[2, "right"]])).points[0]!.state).toBe("neutral");
    // Numbers that do not follow each other are listed, not ranged.
    expect(lessonLineMarkers([{ questionNumber: 1, seconds: 9 }, { questionNumber: 3, seconds: 9 }], null).points[0]!.label).toBe("1,3");
  });

  it("a rewatch from a question on a shared point lights that point", () => {
    const shared: AcademyLessonMedia = {
      ...MEDIA,
      markers: [
        { questionNumber: 1, seconds: 40 },
        { questionNumber: 2, seconds: 130 },
        { questionNumber: 3, seconds: 130 },
      ],
    };
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const { container } = render(<LessonMedia media={shared} title="Урок" levelCode="v2.l008.voyti-ili-otkazatsya" />);
    const video = container.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { configurable: true, value: 500 });
    Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 0 });
    fireEvent.loadedMetadata(video);
    act(() => {
      requestLessonRewatch(130, { questionNumber: 3 });
    });
    expect(container.querySelector('.avp__marker[data-active="true"] .avp__marker-point')).toHaveAttribute(
      "aria-label",
      "Вопросы 2, 3 · ответы объясняют с 2:10",
    );
    vi.restoreAllMocks();
  });
});
