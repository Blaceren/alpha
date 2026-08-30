/**
 * A WITHHELD ROUTE MUST NOT NAME ITSELF.
 *
 * The component guard was never the whole story: Next resolves a segment's
 * metadata separately, so `/community` kept answering with «Сообщество — Alfa
 * Trade Academy» in the document title while rendering a 404 body. Hidden
 * everywhere except the tab.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getServerViewer: vi.fn(async () => ({ name: "Мария Ковалёва" })),
  communityFetch: vi.fn(),
  notFound: vi.fn(() => {
    const e = new Error("NEXT_NOT_FOUND");
    (e as unknown as { digest: string }).digest = "NEXT_NOT_FOUND";
    throw e;
  }),
}));
vi.mock("next/navigation", () => ({ notFound: h.notFound }));
vi.mock("@/server/auth/server-session", () => ({ getServerViewer: h.getServerViewer }));
vi.mock("@/lib/community/community-client", () => ({
  fetchCommunityOverview: h.communityFetch,
  fetchCommunitySpace: h.communityFetch,
  fetchCommunityThread: h.communityFetch,
}));

import { generateMetadata as communityMeta } from "@/app/(app)/community/page";
import { generateMetadata as spaceMeta } from "@/app/(app)/community/[spaceCode]/page";
import { generateMetadata as threadMeta } from "@/app/(app)/community/d/[discussionId]/page";
import { NOT_FOUND_METADATA } from "@/config/not-found-metadata";
import { COMMUNITY_ENABLED } from "@/config/feature-visibility";

const ROUTES: Array<[string, () => Promise<unknown>]> = [
  ["/community", () => communityMeta()],
  ["/community/[spaceCode]", () => spaceMeta()],
  ["/community/d/[discussionId]", () => threadMeta()],
];

/** Anything that would tell a reader the section exists. */
const FORBIDDEN = ["Сообщество", "Обсуждение", "Community", "/community", "community"];

beforeEach(() => {
  h.getServerViewer.mockClear();
  h.communityFetch.mockClear();
  h.notFound.mockClear();
});

describe("withheld Community route metadata", () => {
  it("is the state under test", () => {
    expect(COMMUNITY_ENABLED).toBe(false);
  });

  for (const [name, call] of ROUTES) {
    it(`${name} returns the generic not-found metadata`, async () => {
      const meta = await call();
      expect(meta).toEqual(NOT_FOUND_METADATA);
      expect((meta as { title: string }).title).toBe("Страница не найдена — Alfa Trade Academy");
    });

    it(`${name} names nothing about the section`, async () => {
      const serialised = JSON.stringify(await call());
      for (const word of FORBIDDEN) {
        expect(serialised, `${name} leaks "${word}"`).not.toContain(word);
      }
    });

    it(`${name} declares no canonical, Open Graph, Twitter or structured data`, async () => {
      const meta = (await call()) as Record<string, unknown>;
      for (const key of ["openGraph", "twitter", "alternates", "other", "verification"]) {
        expect(meta[key], key).toBeUndefined();
      }
    });

    it(`${name} reads nothing to decide it`, async () => {
      await call();
      expect(h.getServerViewer, "the session must not be read in metadata").not.toHaveBeenCalled();
      expect(h.communityFetch, "no Community request may be made in metadata").not.toHaveBeenCalled();
    });
  }

  it("the shared 404 metadata carries no Community vocabulary", () => {
    const s = JSON.stringify(NOT_FOUND_METADATA);
    for (const word of FORBIDDEN) expect(s).not.toContain(word);
  });
});
