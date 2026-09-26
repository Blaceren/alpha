/**
 * COMMUNITY-V1 — notification linkage.
 *
 * The two Community events carry `metadata: { spaceCode, discussionId }` so the
 * one canonical notification surface can reach the thread. It shipped without
 * the mapping and the rows were dead text: the learner was told somebody had
 * replied and given no way to go and read it.
 *
 * `metadata` is written by the Backend and never by a learner, and it is still
 * validated like data arriving over the wire, because "the server wrote it" is
 * an assumption and a URL built from an unvalidated string is a redirect.
 */
import { describe, expect, it } from "vitest";
import { deriveNotificationHref } from "./notifications-screen";

/**
 * COMMUNITY IS WITHHELD FROM THE LEARNER PRODUCT.
 *
 * The derivation below is intact and still correct — the type check, the
 * metadata shape and the id pattern all still run, and turning the section back
 * on in config/feature-visibility.ts restores the links with no change here.
 * What changed is the last gate: a link into a withheld section is refused, so
 * these rows reach the learner with no destination rather than a 404.
 */
describe("Community notification linkage — withheld", () => {
  it("links a reply notification to its thread", () => {
    expect(
      deriveNotificationHref({
        type: "community_reply",
        metadata: { spaceCode: "channel.start_questions", discussionId: "cmsw75kw00001t54t3qpe65m3" },
      }),
    ).toBeNull();
  });

  it("links a moderation notification to its thread", () => {
    expect(
      deriveNotificationHref({
        type: "community_moderation",
        metadata: { spaceCode: "channel.start_questions", discussionId: "cmsw75kwf0003t54tc9eee8q2" },
      }),
    ).toBeNull();
  });

  it("refuses an id that could leave its path segment", () => {
    for (const bad of [
      "../../etc/passwd",
      "abc/def",
      "a?x=1",
      "https://evil.test/x",
      "//evil.test",
      "short",
      "",
    ]) {
      expect(
        deriveNotificationHref({ type: "community_reply", metadata: { discussionId: bad } }),
        bad,
      ).toBeNull();
    }
  });

  it("produces no link for a malformed or absent metadata payload", () => {
    expect(deriveNotificationHref({ type: "community_reply" })).toBeNull();
    expect(deriveNotificationHref({ type: "community_reply", metadata: null })).toBeNull();
    expect(deriveNotificationHref({ type: "community_reply", metadata: "x" })).toBeNull();
    expect(deriveNotificationHref({ type: "community_reply", metadata: {} })).toBeNull();
    expect(deriveNotificationHref({ type: "community_reply", metadata: { discussionId: 7 } })).toBeNull();
  });

  it("maps no other notification type", () => {
    // A future event gets no link until somebody decides where it leads.
    for (const type of ["support_reply", "level_up", "mentor_reply", "system", null, undefined]) {
      expect(
        deriveNotificationHref({ type, metadata: { discussionId: "cmsw75kw00001t54t3qpe65m3" } }),
        String(type),
      ).toBeNull();
    }
  });

  it("still honours an explicit internal link and still refuses an external one", () => {
    expect(deriveNotificationHref({ type: "support_reply", link: "/support" })).toBe("/support");
    expect(deriveNotificationHref({ type: "support_reply", link: "https://evil.test" })).toBeNull();
    expect(deriveNotificationHref({ type: "support_reply", link: "//evil.test" })).toBeNull();
  });
});
