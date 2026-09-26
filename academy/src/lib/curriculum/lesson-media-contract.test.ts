/**
 * L2START-PLAYER-1 — the lesson media contract.
 *
 * The Backend has always returned `content.assets`; the Academy never typed
 * them, so no lesson page could know a video existed. These cases pin the
 * mapping that closes that gap, and — more importantly — pin what is refused:
 * a `blob:` source (which is what the showcase's local file picker produces and
 * would be a broken lesson for everyone but the person who chose the file), a
 * plaintext or `javascript:` source, and any attempt to invent media that the
 * curriculum did not publish.
 */
import { describe, it, expect } from "vitest";
import { readBackendContentAssets, type BackendLevelContent } from "@/lib/curriculum/backend-dto";
import { mapLevelContent } from "@/lib/curriculum/view-model";

function asset(partial: Record<string, unknown> = {}) {
  return {
    kind: "video",
    assetCode: "lesson-video",
    locale: null,
    url: "https://media.example.com/lesson.mp4",
    mimeType: "video/mp4",
    sizeBytes: 1024,
    durationSeconds: 300,
    sortOrder: 0,
    ...partial,
  };
}

function content(assets: unknown[], locale = "ru"): BackendLevelContent {
  return {
    kind: "available",
    level: {
      levelNumber: 2,
      stableCode: "v2.l002.kak-ustroen-alfa-trade-academy",
      type: "lesson",
      title: "Как устроен ATA",
      shortDescription: "",
      learningObjective: "",
    },
    content: {
      versionNumber: 1,
      videoDurationSeconds: null,
      publishedAt: "2026-07-01T00:00:00.000Z",
      localization: {
        locale,
        title: "Как устроен ATA",
        subtitle: "",
        learningObjectiveExtension: "",
        summary: "",
        transcript: null,
        body: {},
      },
      assets: readBackendContentAssets(assets),
    },
    progress: null,
  };
}

describe("readBackendContentAssets", () => {
  it("keeps a well-formed https asset", () => {
    expect(readBackendContentAssets([asset()])).toHaveLength(1);
  });

  it("refuses a blob: source — the showcase's local file can never be lesson media", () => {
    expect(readBackendContentAssets([asset({ url: "blob:http://localhost/abc" })])).toEqual([]);
  });

  it("refuses javascript:, data: and plain http sources", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:video/mp4;base64,AAAA",
      "http://media.example.com/lesson.mp4",
      "file:///home/ubuntu/lesson.mp4",
      "not a url",
    ]) {
      expect(readBackendContentAssets([asset({ url })]), url).toEqual([]);
    }
  });

  it("refuses a URL carrying credentials", () => {
    expect(readBackendContentAssets([asset({ url: "https://u:p@media.example.com/x.mp4" })])).toEqual([]);
  });

  it("drops one malformed asset without losing the good ones", () => {
    const assets = readBackendContentAssets([asset({ url: "nope" }), asset({ assetCode: "b" })]);
    expect(assets.map((a) => a.assetCode)).toEqual(["b"]);
  });

  it("tolerates a non-array payload", () => {
    expect(readBackendContentAssets(undefined)).toEqual([]);
    expect(readBackendContentAssets({})).toEqual([]);
  });
});

describe("mapLevelContent media", () => {
  it("is null when the curriculum published no assets — the honest text-only case", () => {
    expect(mapLevelContent(content([]), null).media).toBeNull();
  });

  it("is null when assets exist but none is a video", () => {
    expect(mapLevelContent(content([asset({ kind: "attachment" })]), null).media).toBeNull();
  });

  it("maps the first video by sort order", () => {
    const mapped = mapLevelContent(
      content([
        asset({ assetCode: "second", url: "https://media.example.com/2.mp4", sortOrder: 2 }),
        asset({ assetCode: "first", url: "https://media.example.com/1.mp4", sortOrder: 1 }),
      ]),
      null,
    );
    expect(mapped.media?.src).toBe("https://media.example.com/1.mp4");
  });

  it("maps a published poster and published captions", () => {
    const mapped = mapLevelContent(
      content([
        asset({ sortOrder: 0 }),
        asset({ kind: "image", assetCode: "poster", url: "https://media.example.com/p.jpg", sortOrder: 1 }),
        asset({ kind: "subtitles", assetCode: "ru-vtt", url: "https://media.example.com/ru.vtt", locale: "ru", sortOrder: 2 }),
      ]),
      null,
    );
    expect(mapped.media?.poster).toBe("https://media.example.com/p.jpg");
    expect(mapped.media?.captions).toEqual([
      { src: "https://media.example.com/ru.vtt", srcLang: "ru", label: "ru" },
    ]);
  });

  it("keeps a locale-neutral asset and skips one for another language", () => {
    const neutral = mapLevelContent(content([asset({ locale: null })], "ru"), null);
    expect(neutral.media).not.toBeNull();

    const foreign = mapLevelContent(content([asset({ locale: "en" })], "ru"), null);
    expect(foreign.media).toBeNull();
  });

  it("falls back to the content version's duration when the asset has none", () => {
    const payload = content([asset({ durationSeconds: null })]);
    payload.content.videoDurationSeconds = 600;
    expect(mapLevelContent(payload, null).media?.durationSeconds).toBe(600);
  });

  it("unavailable content carries no media", () => {
    expect(mapLevelContent(null, "locked").media).toBeNull();
  });
});
