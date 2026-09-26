/**
 * L2START-PLAYER-1 — the production lesson media surface.
 *
 * Two things are proven here. First, that a lesson with a published video
 * renders the real player and a lesson without one renders nothing and stays
 * usable. Second — the part that matters for progression — that this surface is
 * a dead end: no request, no progress, no completion, whatever the player does.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { LessonMedia } from "@/features/lesson-media/lesson-media";
import type { AcademyLessonMedia } from "@/lib/curriculum/academy-view";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function media(partial: Partial<AcademyLessonMedia> = {}): AcademyLessonMedia {
  return {
    src: "https://media.example.com/lesson-2.mp4",
    mimeType: "video/mp4",
    poster: null,
    durationSeconds: 480,
    captions: [],
    ...partial,
  };
}

describe("LessonMedia", () => {
  it("renders the player when the curriculum published a video", () => {
    const { container } = render(<LessonMedia media={media()} title="Как устроен ATA" />);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe("https://media.example.com/lesson-2.mp4");
    expect(container.querySelector('[data-media="ready"]')).not.toBeNull();
  });

  it("renders the published poster, and nothing invented when there is none", () => {
    const withPoster = render(
      <LessonMedia media={media({ poster: "https://media.example.com/p.jpg" })} title="Урок" />,
    );
    expect(withPoster.container.querySelector("video")?.getAttribute("poster")).toBe(
      "https://media.example.com/p.jpg",
    );
    withPoster.unmount();

    const without = render(<LessonMedia media={media()} title="Урок" />);
    const poster = without.container.querySelector("video")?.getAttribute("poster");
    // A missing poster stays missing. A synthetic branded frame is a showcase
    // affordance and would be a fabricated lesson asset here.
    expect(poster === null || poster === "").toBe(true);
  });

  it("renders published captions as real tracks", () => {
    const { container } = render(
      <LessonMedia
        media={media({ captions: [{ src: "https://media.example.com/ru.vtt", srcLang: "ru", label: "ru" }] })}
        title="Урок"
      />,
    );
    const track = container.querySelector("track");
    expect(track?.getAttribute("src")).toBe("https://media.example.com/ru.vtt");
    expect(track?.getAttribute("srclang")).toBe("ru");
  });

  it("renders nothing at all for a text-only lesson", () => {
    const { container } = render(<LessonMedia media={null} title="Урок" />);
    expect(container.querySelector("video")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("offers no file selection of any kind to a learner", () => {
    const { container } = render(<LessonMedia media={media()} title="Урок" />);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(screen.queryByText(/файл|Выбрать видео|загрузить/i)).toBeNull();
    // The player's own volume slider is the ONLY input a lesson may contain.
    const inputs = [...container.querySelectorAll("input")];
    expect(inputs.every((input) => input.type === "range")).toBe(true);
  });

  it("imports nothing from the showcase", () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "src/features/lesson-media/lesson-media.tsx"),
      "utf8",
    );
    // Comments are stripped: the file deliberately EXPLAINS that it imports no
    // showcase code, so scanning raw source would always match its own prose.
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(executable).not.toMatch(/showcase/i);
    expect(executable).not.toMatch(/createObjectURL|blob:/);
    // Exactly one player import, the production component.
    expect(source).toMatch(/from "@\/components\/media\/academy-video-player"/);
  });

  it("wires no playback callback, so the player cannot own progress", () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "src/features/lesson-media/lesson-media.tsx"),
      "utf8",
    );
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    for (const handler of ["onEnded", "onPlay", "onPause", "onTimeUpdate", "onError"]) {
      expect(executable, `lesson media wires ${handler}`).not.toMatch(new RegExp(`${handler}\\s*=`));
    }
  });
});

describe("the production lesson never reaches showcase code", () => {
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "showcase") continue;
        out.push(...walk(full));
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  it("no production source imports the showcase or a local-file affordance", () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(REPO_ROOT, "src"))) {
      const source = fs.readFileSync(file, "utf8");
      if (/from\s+["'][^"']*showcase[^"']*["']/.test(source)) offenders.push(file);
      // `createObjectURL` is how the showcase turns a chosen file into a src.
      // A blob URL is meaningful only inside one browser tab, so it can never be
      // a lesson's media and must not appear outside the showcase.
      if (/createObjectURL/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("the lesson route knows nothing about a showcase", () => {
    const lesson = fs.readFileSync(
      path.join(REPO_ROOT, "src/app/(app)/lessons/[levelCode]/page.tsx"),
      "utf8",
    );
    expect(lesson).not.toMatch(/showcase/i);
  });

  it("the showcase route does not exist at all", () => {
    /* It used to exist and 404 in api mode, which was enough to keep a learner
       away from the file chooser but not enough to keep the board out of the
       artifact: its component, its stylesheet and its retired palette were
       compiled into every release, and its media shipped in public/.

       H-STALE-2 closed that by removing the route rather than restyling a board
       nobody ships. Git history is the retained copy; nothing hidden is left
       behind, which is why this asserts absence rather than a guard. */
    expect(fs.existsSync(path.join(REPO_ROOT, "src/app/showcase"))).toBe(false);
    expect(fs.existsSync(path.join(REPO_ROOT, "public/showcase"))).toBe(false);
  });

  it("no source file imports the showcase or names its path any more", () => {
    /* Comments are stripped first, deliberately. Prose that explains WHY a rule
       exists — the blob: refusal, the media contract, the matcher note — still
       mentions the board, and that is history rather than a dependency. What
       must not survive is an import or a path in the code itself. */
    const offenders: string[] = [];
    for (const file of walk(path.join(REPO_ROOT, "src"))) {
      if (file.endsWith("lesson-media.test.tsx")) continue;
      const code = fs
        .readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      if (/from\s+["'][^"']*showcase[^"']*["']/.test(code)) offenders.push(`${file} (import)`);
      if (/["'`][^"'`]*\/showcase\/[^"'`]*["'`]/.test(code)) offenders.push(`${file} (path)`);
    }
    expect(offenders).toEqual([]);
  });
});
