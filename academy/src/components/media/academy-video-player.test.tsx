import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcademyVideoPlayer } from "./academy-video-player";

function setMedia(
  video: HTMLVideoElement,
  values: {
    duration?: number;
    currentTime?: number;
    videoWidth?: number;
    videoHeight?: number;
    error?: { code: number };
  },
) {
  if (values.duration !== undefined) {
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: values.duration,
    });
  }
  if (values.currentTime !== undefined) {
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      writable: true,
      value: values.currentTime,
    });
  }
  if (values.videoWidth !== undefined) {
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: values.videoWidth,
    });
  }
  if (values.videoHeight !== undefined) {
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: values.videoHeight,
    });
  }
  if (values.error !== undefined) {
    Object.defineProperty(video, "error", {
      configurable: true,
      value: values.error,
    });
  }
}

const getVideo = () =>
  screen.getByTestId("academy-video-element") as HTMLVideoElement;
const getRegion = (title = "Урок") =>
  screen.getByRole("region", { name: `Видеоплеер: ${title}` });
const getTimeline = () => screen.getByRole("slider", { name: "Позиция видео" });

function mockTimelineRect(el: HTMLElement, left = 0, width = 200) {
  el.getBoundingClientRect = () =>
    ({ left, top: 0, width, height: 8, right: left + width, bottom: 8, x: left, y: 0, toJSON() {} }) as DOMRect;
}

describe("AcademyVideoPlayer", () => {
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();
  const load = vi.fn();

  beforeEach(() => {
    play.mockClear();
    pause.mockClear();
    load.mockClear();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(load);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("plays and pauses from the center control", async () => {
    const onPlay = vi.fn();
    const onPause = vi.fn();
    render(
      <AcademyVideoPlayer src="/lesson.mp4" title="Урок" onPlay={onPlay} onPause={onPause} />,
    );
    const video = getVideo();
    setMedia(video, { duration: 120, currentTime: 0 });
    fireEvent.loadedMetadata(video);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Воспроизвести видео" }));
    });
    expect(play).toHaveBeenCalledOnce();

    fireEvent.play(video);
    expect(onPlay).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Пауза" }));
    expect(pause).toHaveBeenCalledOnce();
    fireEvent.pause(video);
    expect(onPause).toHaveBeenCalledOnce();
  });

  it("shows the real duration only after loadedmetadata", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const video = getVideo();
    // Before metadata: unknown state.
    expect(getTimeline()).toHaveAttribute("aria-valuemax", "0");
    expect(getTimeline()).toHaveAttribute("aria-disabled", "true");

    setMedia(video, { duration: 120, currentTime: 0 });
    fireEvent.loadedMetadata(video);
    expect(screen.getByText("2:00")).toBeInTheDocument();
    expect(getTimeline()).toHaveAttribute("aria-valuemax", "120");
  });

  it("never treats NaN or Infinity as a valid duration", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const video = getVideo();

    setMedia(video, { duration: Infinity });
    fireEvent.durationChange(video);
    expect(getTimeline()).toHaveAttribute("aria-valuemax", "0");

    setMedia(video, { duration: NaN });
    fireEvent.durationChange(video);
    expect(getTimeline()).toHaveAttribute("aria-valuemax", "0");
    expect(getTimeline()).toHaveAttribute("aria-disabled", "true");
  });

  it("resets duration, time and error when the source is replaced", () => {
    render(<AcademyVideoPlayer src="/a.mp4" title="Урок" />);
    const video = getVideo();
    setMedia(video, { duration: 100, currentTime: 40 });
    fireEvent.loadedMetadata(video);
    expect(getTimeline()).toHaveAttribute("aria-valuemax", "100");
    setMedia(video, { error: { code: 3 } });
    fireEvent.error(video);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // A new src makes the browser fire emptied + loadstart.
    fireEvent.emptied(video);
    fireEvent.loadStart(video);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getTimeline()).toHaveAttribute("aria-valuemax", "0");

    setMedia(video, { duration: 45, currentTime: 0 });
    fireEvent.loadedMetadata(video);
    expect(screen.getByText("0:45")).toBeInTheDocument();
  });

  it("seeks to the clicked position on the timeline", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const video = getVideo();
    setMedia(video, { duration: 100, currentTime: 0 });
    fireEvent.loadedMetadata(video);
    const timeline = getTimeline();
    mockTimelineRect(timeline, 0, 200);

    fireEvent.pointerDown(timeline, { clientX: 100, pointerId: 1 });
    expect(video.currentTime).toBe(50);
    fireEvent.pointerUp(timeline, { pointerId: 1 });
  });

  it("scrubs with pointer drag and clamps to the media range", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const video = getVideo();
    setMedia(video, { duration: 100, currentTime: 0 });
    fireEvent.loadedMetadata(video);
    const timeline = getTimeline();
    mockTimelineRect(timeline, 0, 200);

    fireEvent.pointerDown(timeline, { clientX: 40, pointerId: 1 });
    expect(video.currentTime).toBe(20);
    fireEvent.pointerMove(timeline, { clientX: 150, pointerId: 1 });
    expect(video.currentTime).toBe(75);
    // Past the ends clamps to 0..duration.
    fireEvent.pointerMove(timeline, { clientX: 999, pointerId: 1 });
    expect(video.currentTime).toBe(100);
    fireEvent.pointerMove(timeline, { clientX: -50, pointerId: 1 });
    expect(video.currentTime).toBe(0);
    fireEvent.pointerUp(timeline, { pointerId: 1 });
  });

  it("skips backward and forward by 10 seconds with clamping", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const video = getVideo();
    setMedia(video, { duration: 100, currentTime: 50 });
    fireEvent.loadedMetadata(video);

    const backBtn = () =>
      screen.getAllByRole("button", { name: "Назад на 10 секунд" })[0]!;
    const forwardBtn = () =>
      screen.getAllByRole("button", { name: "Вперёд на 10 секунд" })[0]!;

    fireEvent.click(backBtn());
    expect(video.currentTime).toBe(40);
    fireEvent.click(forwardBtn());
    expect(video.currentTime).toBe(50);

    setMedia(video, { currentTime: 5 });
    fireEvent.click(backBtn());
    expect(video.currentTime).toBe(0);

    setMedia(video, { currentTime: 95 });
    fireEvent.click(forwardBtn());
    expect(video.currentTime).toBe(100);
  });

  it("disables skip controls until a valid duration is known", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    expect(screen.getAllByRole("button", { name: "Назад на 10 секунд" })[0]).toBeDisabled();
    const video = getVideo();
    setMedia(video, { duration: 60, currentTime: 0 });
    fireEvent.loadedMetadata(video);
    expect(screen.getAllByRole("button", { name: "Назад на 10 секунд" })[0]).toBeEnabled();
  });

  it("uses ArrowLeft/ArrowRight for ±10s only when the region is focused", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const region = getRegion();
    const video = getVideo();
    setMedia(video, { duration: 100, currentTime: 30 });
    fireEvent.loadedMetadata(video);

    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(video.currentTime).toBe(40);
    fireEvent.keyDown(region, { key: "ArrowLeft" });
    expect(video.currentTime).toBe(30);

    // Arrows inside the range control must not trigger the ±10s shortcut.
    fireEvent.keyDown(screen.getByLabelText("Громкость"), { key: "ArrowRight" });
    expect(video.currentTime).toBe(30);
  });

  it("single click toggles play/pause on the video surface", () => {
    vi.useFakeTimers();
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const region = getRegion();

    fireEvent.click(region);
    act(() => vi.advanceTimersByTime(260));
    expect(play).toHaveBeenCalledOnce();
  });

  it("double click toggles fullscreen and cancels the single-click play", () => {
    vi.useFakeTimers();
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const region = getRegion();
    const requestFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(region, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });

    fireEvent.click(region);
    fireEvent.dblClick(region);
    act(() => vi.advanceTimersByTime(300));

    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(play).not.toHaveBeenCalled();
  });

  it("exits fullscreen on a second double click", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const region = getRegion();
    const exitFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: region,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });

    fireEvent.dblClick(region);
    expect(exitFullscreen).toHaveBeenCalledOnce();

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
  });

  it("does not toggle play when a control is clicked", () => {
    vi.useFakeTimers();
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);

    fireEvent.click(screen.getByRole("button", { name: "Выключить звук" }));
    act(() => vi.advanceTimersByTime(300));
    expect(play).not.toHaveBeenCalled();
  });

  it("adapts the frame to the source aspect ratio", () => {
    render(<AcademyVideoPlayer src="/portrait.mp4" title="Урок" />);
    const region = getRegion();
    const video = getVideo();

    setMedia(video, { duration: 30, videoWidth: 1080, videoHeight: 1920 });
    fireEvent.loadedMetadata(video);
    expect(region).toHaveClass("avp--tall");
    expect(region.style.getPropertyValue("--avp-aspect-ratio")).toBe("0.5625");
  });

  it("keeps landscape video from being treated as portrait", () => {
    render(<AcademyVideoPlayer src="/wide.mp4" title="Урок" />);
    const region = getRegion();
    const video = getVideo();

    setMedia(video, { duration: 30, videoWidth: 1920, videoHeight: 1080 });
    fireEvent.loadedMetadata(video);
    expect(region).not.toHaveClass("avp--tall");
    expect(region.style.getPropertyValue("--avp-aspect-ratio")).toMatch(/^1\.77/);
  });

  it("clears a stale media error once the video can play again", () => {
    const onError = vi.fn();
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" onError={onError} />);
    const video = getVideo();

    setMedia(video, { error: { code: 2 } });
    fireEvent.error(video);
    expect(screen.getByRole("alert")).toHaveTextContent("Видео не загрузилось");
    expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ code: 2 }));

    fireEvent.canPlay(video);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onError).toHaveBeenLastCalledWith(null);
  });

  it("explains the failure differently for network vs codec errors", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const video = getVideo();

    setMedia(video, { error: { code: 2 } });
    fireEvent.error(video);
    expect(screen.getByRole("alert")).toHaveTextContent("Проблема с сетью");

    setMedia(video, { error: { code: 4 } });
    fireEvent.error(video);
    expect(screen.getByRole("alert")).toHaveTextContent("кодек");
  });

  it("mutes, unmutes and changes volume", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" initialVolume={0.7} />);
    const video = getVideo();

    fireEvent.click(screen.getByRole("button", { name: "Выключить звук" }));
    expect(video.muted).toBe(true);

    fireEvent.change(screen.getByLabelText("Громкость"), { target: { value: "0.35" } });
    expect(video.volume).toBe(0.35);
    expect(video.muted).toBe(false);
  });

  it("shows loading, ended and error states from native media events", () => {
    const onEnded = vi.fn();
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" onEnded={onEnded} />);
    const video = getVideo();

    fireEvent.play(video);
    fireEvent.waiting(video);
    expect(screen.getByRole("status")).toHaveTextContent("Загружаем видео");

    fireEvent.canPlay(video);
    fireEvent.ended(video);
    expect(onEnded).toHaveBeenCalledOnce();
    expect(screen.getByText("Урок просмотрен")).toBeInTheDocument();
  });

  it("auto-hides controls after inactivity and returns on interaction", () => {
    vi.useFakeTimers();
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const region = getRegion();
    const video = getVideo();

    fireEvent.play(video);
    fireEvent.pointerDown(region);
    act(() => vi.advanceTimersByTime(2500));
    expect(region).not.toHaveClass("avp--controls-visible");

    fireEvent.pointerMove(region);
    expect(region).toHaveClass("avp--controls-visible");
  });
});
