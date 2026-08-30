/**
 * COMMUNITY IS OUT OF THE LEARNER PRODUCT, AND EVERY SURFACE AGREES.
 *
 * These tests hold the contract at the authority itself and at each consumer,
 * because the failure this guards against is not "the flag is wrong" — it is
 * "one consumer forgot to read it", which is how a hidden section shows up in
 * exactly one place.
 */
import { describe, it, expect } from "vitest";
import {
  COMMUNITY_ENABLED,
  isVisibleSection,
  isVisibleNotificationType,
} from "@/config/feature-visibility";
import { PRIMARY_NAV, MORE_MENU } from "@/config/navigation";
import { isBuiltRoute } from "@/config/built-routes";
import { deriveNotificationHref } from "@/features/academy-experience/notifications-screen";
import { toRecord } from "@/features/notifications-fidelity/notifications-state";

describe("the visibility authority", () => {
  it("withholds Community and nothing else", () => {
    expect(COMMUNITY_ENABLED).toBe(false);
    expect(isVisibleSection("community")).toBe(false);
    for (const id of ["home", "path", "lessons", "tools", "support", "notifications", "profile"]) {
      expect(isVisibleSection(id)).toBe(true);
    }
  });

  it("does not pretend Community is unbuilt", () => {
    // The route exists and answers. Hiding is a product decision, not a claim
    // about the codebase - and writing it out of the built list would take the
    // surface's own tests down with it.
    expect(isBuiltRoute("community")).toBe(true);
  });

  it("keeps Community in the canonical navigation model", () => {
    // Order and labels are untouched; only what is SHOWN is filtered. Turning
    // the section back on must not need the nav model edited.
    expect(PRIMARY_NAV.some((i) => i.id === "community")).toBe(true);
    expect(MORE_MENU.some((i) => i.id === "community")).toBe(true);
  });

  it("withholds exactly the two Community notification types", () => {
    expect(isVisibleNotificationType("community_reply")).toBe(false);
    expect(isVisibleNotificationType("community_moderation")).toBe(false);
    for (const t of ["level_up", "mentor_reply", "support_reply", "system", "reward_granted"]) {
      expect(isVisibleNotificationType(t)).toBe(true);
    }
  });
});

describe("no link may lead into the withheld section", () => {
  const now = new Date("2026-08-30T12:00:00Z");

  it("refuses a derived Community thread link", () => {
    expect(
      deriveNotificationHref({
        type: "community_reply",
        metadata: { discussionId: "abcdefgh1234" },
        link: null,
        url: null,
      }),
    ).toBeNull();
  });

  it("refuses a Backend-authored link into Community, whatever the type", () => {
    for (const raw of ["/community", "/community/space-1", "/community/d/xyz", "/community?tab=1"]) {
      expect(
        deriveNotificationHref({ type: "system", metadata: null, link: raw, url: null }),
      ).toBeNull();
    }
  });

  it("still passes an ordinary internal link through", () => {
    expect(
      deriveNotificationHref({ type: "system", metadata: null, link: "/support", url: null }),
    ).toBe("/support");
  });

  it("drops a Community row from the register without touching it", () => {
    const row = {
      id: 1,
      type: "community_reply",
      title: "Ответ в обсуждении",
      createdAt: now.toISOString(),
      readAt: null,
      metadata: { discussionId: "abcdefgh1234" },
    };
    expect(toRecord(row, now)).toBeNull();
    // the row object itself is untouched - nothing is marked read here
    expect(row.readAt).toBeNull();
  });

  it("keeps a non-Community row", () => {
    const rec = toRecord(
      { id: 2, type: "level_up", title: "Уровень пройден", createdAt: now.toISOString(), readAt: null },
      now,
    );
    expect(rec).not.toBeNull();
    expect(rec?.consumption).toBe("UNREAD");
  });
});
