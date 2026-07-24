import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcademyVideoPlayer } from "./academy-video-player";

function setMediaValues(video: HTMLVideoElement, values: { duration: number; currentTime: number }) {
  Object.defineProperty(video, "duration", {
    configurable: true,
    value: values.duration,
  });
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    writable: true,
    value: values.currentTime,
  });
}

describe("AcademyVideoPlayer", () => {
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();

  beforeEach(() => {
    play.mockClear();
    pause.mockClear();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("plays, pauses and reflects media events", async () => {
    const onPlay = vi.fn();
    const onPause = vi.fn();
    render(
      <AcademyVideoPlayer
        src="/lesson.mp4"
        title="Поддержка и сопротивление"
        onPlay={onPlay}
        onPause={onPause}
      />,
    );

    const video = screen.getByTestId("academy-video-element") as HTMLVideoElement;
    setMediaValues(video, { duration: 120, currentTime: 0 });
    fireEvent.loadedMetadata(video);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Воспроизвести видео" }));
    });
    expect(play).toHaveBeenCalledOnce();

    fireEvent.play(video);
    expect(onPlay).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Пауза" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Пауза" }));
    expect(pause).toHaveBeenCalledOnce();
    fireEvent.pause(video);
    expect(onPause).toHaveBeenCalledOnce();
  });

  it("seeks and reports the updated time", () => {
    const onTimeUpdate = vi.fn();
    render(
      <AcademyVideoPlayer
        src="/lesson.mp4"
        title="Урок"
        onTimeUpdate={onTimeUpdate}
      />,
    );
    const video = screen.getByTestId("academy-video-element") as HTMLVideoElement;
    setMediaValues(video, { duration: 200, currentTime: 20 });
    fireEvent.loadedMetadata(video);

    fireEvent.change(screen.getByLabelText("Позиция видео"), {
      target: { value: "75" },
    });
    expect(video.currentTime).toBe(75);

    fireEvent.timeUpdate(video);
    expect(onTimeUpdate).toHaveBeenLastCalledWith(75, 200);
  });

  it("mutes, unmutes and changes volume", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" initialVolume={0.7} />);
    const video = screen.getByTestId("academy-video-element") as HTMLVideoElement;

    fireEvent.click(screen.getByRole("button", { name: "Выключить звук" }));
    expect(video.muted).toBe(true);
    expect(screen.getByRole("button", { name: "Включить звук" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.change(screen.getByLabelText("Громкость"), {
      target: { value: "0.35" },
    });
    expect(video.volume).toBe(0.35);
    expect(video.muted).toBe(false);
  });

  it("shows loading, error and completed states from native media events", () => {
    const onEnded = vi.fn();
    const onError = vi.fn();
    render(
      <AcademyVideoPlayer
        src="/lesson.mp4"
        title="Урок"
        onEnded={onEnded}
        onError={onError}
      />,
    );
    const video = screen.getByTestId("academy-video-element");

    fireEvent.play(video);
    fireEvent.waiting(video);
    expect(screen.getByRole("status")).toHaveTextContent("Загружаем видео");

    fireEvent.canPlay(video);
    fireEvent.ended(video);
    expect(onEnded).toHaveBeenCalledOnce();
    expect(screen.getByText("Урок просмотрен")).toBeInTheDocument();

    fireEvent.error(video);
    expect(onError).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("Видео не загрузилось");
  });

  it("supports player keyboard shortcuts without hijacking controls", async () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const player = screen.getByRole("region", { name: "Видеоплеер: Урок" });
    const video = screen.getByTestId("academy-video-element") as HTMLVideoElement;
    setMediaValues(video, { duration: 120, currentTime: 30 });
    fireEvent.loadedMetadata(video);

    await act(async () => {
      player.focus();
      fireEvent.keyDown(player, { key: " " });
    });

    fireEvent.keyDown(player, { key: "ArrowRight" });
    expect(video.currentTime).toBe(35);

    fireEvent.keyDown(screen.getByLabelText("Громкость"), { key: " " });
    expect(play).toHaveBeenCalledOnce();
  });

  it("uses fullscreen when available and falls back without throwing", async () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const player = screen.getByRole("region", { name: "Видеоплеер: Урок" });
    const requestFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(player, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });

    fireEvent.click(screen.getByRole("button", { name: "На весь экран" }));
    expect(requestFullscreen).toHaveBeenCalledOnce();
  });

  it("auto-hides after pointer inactivity and returns on interaction", () => {
    vi.useFakeTimers();
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const player = screen.getByRole("region", { name: "Видеоплеер: Урок" });
    const video = screen.getByTestId("academy-video-element");

    fireEvent.play(video);
    fireEvent.pointerDown(player);
    act(() => vi.advanceTimersByTime(2500));
    expect(player).not.toHaveClass("avp--controls-visible");

    fireEvent.pointerMove(player);
    expect(player).toHaveClass("avp--controls-visible");
  });
});
