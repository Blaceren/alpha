import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoPlayerShowcase } from "./video-player-showcase";

const DEMO_SRC = "/showcase/video-player/academy-lesson-demo.webm";
const REJECT_MESSAGE =
  "Не похоже на видео. Поддерживаются MP4, WebM, MOV, M4V и MKV.";

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

  function selectFile(name: string, type: string, body = "video") {
    fireEvent.change(screen.getByLabelText("Выбрать локальное видео"), {
      target: { files: [new File([body], name, { type })] },
    });
  }

  const videoEl = () => screen.getByTestId("academy-video-element");

  it("accepts a clean video/mp4 file and assigns an object URL", () => {
    render(<VideoPlayerShowcase initialState="initial" />);
    selectFile("market-lesson.mp4", "video/mp4");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(videoEl()).toHaveAttribute("src", "blob:academy-video-1");
    // Captions are meaningless for a user's own file, so the control is hidden.
    expect(
      screen.queryByRole("button", { name: "Включить субтитры" }),
    ).not.toBeInTheDocument();
  });

  // Regression for the reported failure: a picked .mp4 that the OS reports as
  // "application/octet-stream" (common on Windows) must still load.
  it("accepts an .mp4 reported as application/octet-stream", () => {
    render(<VideoPlayerShowcase initialState="initial" />);
    selectFile("lesson.mp4", "application/octet-stream");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(videoEl()).toHaveAttribute("src", "blob:academy-video-1");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("accepts a .mov reported as video/quicktime", () => {
    render(<VideoPlayerShowcase initialState="initial" />);
    selectFile("clip.mov", "video/quicktime");

    expect(videoEl()).toHaveAttribute("src", "blob:academy-video-1");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("accepts an .m4v with an empty MIME type", () => {
    render(<VideoPlayerShowcase initialState="initial" />);
    selectFile("clip.m4v", "");

    expect(videoEl()).toHaveAttribute("src", "blob:academy-video-1");
  });

  it("surfaces the picked file's MIME type and extension in diagnostics", () => {
    render(<VideoPlayerShowcase initialState="initial" />);
    selectFile("lesson.mp4", "application/octet-stream");

    const diagnostics = screen.getByLabelText("Диагностика файла");
    expect(
      within(diagnostics).getByText("application/octet-stream"),
    ).toBeInTheDocument();
    expect(within(diagnostics).getByText(".mp4")).toBeInTheDocument();
  });

  it("releases the previous object URL when another video is selected", () => {
    render(<VideoPlayerShowcase initialState="initial" />);
    selectFile("first.webm", "video/webm");
    selectFile("second.mp4", "video/mp4");

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:academy-video-1");
    expect(videoEl()).toHaveAttribute("src", "blob:academy-video-2");
  });

  it("resets to the bundled demo source and releases the local URL", () => {
    render(<VideoPlayerShowcase initialState="initial" />);
    selectFile("lesson.webm", "video/webm");

    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:academy-video-1");
    expect(videoEl()).toHaveAttribute("src", DEMO_SRC);
    expect(
      screen.getByRole("button", { name: "Включить субтитры" }),
    ).toBeInTheDocument();
  });

  it("keeps the object URL until unmount, then revokes it once", () => {
    const { unmount } = render(<VideoPlayerShowcase initialState="initial" />);
    selectFile("lesson.mp4", "video/mp4");

    expect(revokeObjectURL).not.toHaveBeenCalled();

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:academy-video-1");
  });

  // An accepted container can still carry a codec the browser cannot decode.
  // The showcase must explain that instead of the demo's generic error, and it
  // must not discard the selected source.
  it("explains a codec failure without dropping the local source", () => {
    render(<VideoPlayerShowcase initialState="initial" />);
    selectFile("lesson.mp4", "video/mp4");

    fireEvent.error(videoEl());

    expect(
      screen.getByText(/браузер не поддерживает его видеокодек/i),
    ).toBeInTheDocument();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(videoEl()).toHaveAttribute("src", "blob:academy-video-1");
  });

  it("rejects a non-video file without replacing the current source", () => {
    render(<VideoPlayerShowcase initialState="initial" />);
    selectFile("lesson.txt", "text/plain", "notes");

    expect(screen.getByRole("alert")).toHaveTextContent(REJECT_MESSAGE);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(videoEl()).toHaveAttribute("src", DEMO_SRC);
  });
});
