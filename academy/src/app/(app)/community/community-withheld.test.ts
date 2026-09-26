/**
 * THE WITHHELD ROUTE ANSWERS "THERE IS NOTHING HERE", AND ASKS NOBODY.
 *
 * Two properties, and the second is the one that is easy to lose: the address
 * must 404, and it must do so BEFORE any Community request goes out. A section
 * hidden from the navigation that still fetches its own data on a direct URL is
 * hidden in appearance only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* `vi.mock` factories are hoisted above the file, so anything they close over
   has to be hoisted with them. */
const h = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    const e = new Error("NEXT_NOT_FOUND");
    (e as unknown as { digest: string }).digest = "NEXT_NOT_FOUND";
    throw e;
  }),
  getServerViewer: vi.fn(async () => ({ name: "Мария Ковалёва" })),
  communityFetch: vi.fn(),
}));
const { notFound, getServerViewer, communityFetch } = h;

vi.mock("next/navigation", () => ({ notFound: h.notFound }));
vi.mock("@/server/auth/server-session", () => ({ getServerViewer: h.getServerViewer }));
/* If the guard ever moved below the data layer, these would be reached. */
vi.mock("@/lib/community/community-client", () => ({
  fetchCommunityOverview: h.communityFetch,
  fetchCommunitySpace: h.communityFetch,
  fetchCommunityThread: h.communityFetch,
}));

import CommunityPage from "@/app/(app)/community/page";
import CommunitySpacePage from "@/app/(app)/community/[spaceCode]/page";
import CommunityThreadPage from "@/app/(app)/community/d/[discussionId]/page";
import { COMMUNITY_ENABLED } from "@/config/feature-visibility";

beforeEach(() => {
  notFound.mockClear();
  getServerViewer.mockClear();
  communityFetch.mockClear();
});

describe("the withheld Community routes", () => {
  it("is the state under test", () => {
    expect(COMMUNITY_ENABLED).toBe(false);
  });

  const cases: Array<[string, () => Promise<unknown>]> = [
    ["/community", () => CommunityPage()],
    ["/community/[spaceCode]", () => CommunitySpacePage({ params: Promise.resolve({ spaceCode: "s1" }) })],
    ["/community/d/[discussionId]", () => CommunityThreadPage({ params: Promise.resolve({ discussionId: "abcd1234efgh" }) })],
  ];

  for (const [name, call] of cases) {
    it(`${name} answers notFound`, async () => {
      await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(notFound).toHaveBeenCalledTimes(1);
    });

    it(`${name} reads nothing before it does`, async () => {
      await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(getServerViewer, "the session must not be read").not.toHaveBeenCalled();
      expect(communityFetch, "no Community request may be made").not.toHaveBeenCalled();
    });
  }

  it("never redirects — a withheld address is not a working link", async () => {
    // `redirect()` would surface as a different digest; nothing here may call it.
    await expect(CommunityPage()).rejects.toMatchObject({ digest: "NEXT_NOT_FOUND" });
  });
});
