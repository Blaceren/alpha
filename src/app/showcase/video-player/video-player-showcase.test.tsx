import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoPlayerShowcase } from "./video-player-showcase";

describe("VideoPlayerShowcase local video loader", () => {
  const createObjectURL = vi.fn();
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    createObjectURL.mockReset();
    revokeObjectURL.mockReset();
    createObjectURL
      .mockReturnValueOnce("blob:academy-video-1")
      .mockReturnValueOnce("blob:academy-video-2");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("accepts a video file and creates an in-memory object URL", () => {
    render(<VideoPlayerShowcase initialState="initial" />);
    const file = new File(["video"], "market-lesson.mp4", {
      type: "video/mp4",
    });

    fireEvent.change(screen.getByLabelText("Выбрать локальное видео"), {
      target: { files: [file] },
    });

    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(screen.getAllByText("market-lesson.mp4")).toHaveLength(2);
    expect(screen.getByTestId("academy-video-element")).toHaveAttribute(
      "src",
      "blob:academy-video-1",
    );
    expect(
      screen.queryByRole("button", { name: "Включить субтитры" }),
    ).not.toBeInTheDocument();
  });

  it("releases the previous object URL when another video is selected", () => {
    render(<VideoPlayerShowcase initialState="initial" />);
    const input = screen.getByLabelText("Выбрать локальное видео");

    fireEvent.change(input, {
      target: {
        files: [new File(["one"], "first.webm", { type: "video/webm" })],
      },
    });
    fireEvent.change(input, {
      target: {
        files: [new File(["two"], "second.mp4", { type: "video/mp4" })],
      },
    });

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:academy-video-1");
    expect(screen.getAllByText("second.mp4")).toHaveLength(2);
    expect(screen.getByTestId("academy-video-element")).toHaveAttribute(
      "src",
      "blob:academy-video-2",
    );
  });

  it("resets to the bundled demo source and releases the local URL", () => {
    render(<VideoPlayerShowcase initialState="initial" />);
    fireEvent.change(screen.getByLabelText("Выбрать локальное видео"), {
      target: {
        files: [new File(["video"], "lesson.webm", { type: "video/webm" })],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:academy-video-1");
    expect(screen.getByTestId("academy-video-element")).toHaveAttribute(
      "src",
      "/showcase/video-player/academy-lesson-demo.webm",
    );
    expect(
      screen.getByRole("button", { name: "Включить субтитры" }),
    ).toBeInTheDocument();
  });

  it("rejects unsupported files without replacing the current source", () => {
    render(<VideoPlayerShowcase initialState="initial" />);
    fireEvent.change(screen.getByLabelText("Выбрать локальное видео"), {
      target: {
        files: [new File(["notes"], "lesson.txt", { type: "text/plain" })],
      },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Выберите видео в формате MP4 или WebM.",
    );
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByTestId("academy-video-element")).toHaveAttribute(
      "src",
      "/showcase/video-player/academy-lesson-demo.webm",
    );
  });
});
