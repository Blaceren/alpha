/**
 * COMMUNITY-V1 — the moderation section is reachable in the mode PREPROD runs.
 *
 * WHAT WENT WRONG, AND WHY IT IS THE FOURTH TIME.
 *
 * This CRM has TWO navigation models. `SECTION_VISIBILITY` + `config/navigation`
 * drive the MOCK shell. `API_NAV_ITEMS` drives the API shell, and api mode is
 * the only mode PREPROD runs. Worse, in api mode `AppShell` never renders
 * `children` at all — `ApiModeLanding` decides what to show from the pathname
 * alone, so an App Router page under `(crm)/community-moderation/` is not
 * enough on its own.
 *
 * COMMUNITY-V1 updated only the mock model. The workspace was routed in the
 * Next sense, authorised by the backend, fully working — and in api mode the
 * section answered the deferred placeholder and appeared in no menu. A `curl`
 * against the path returned **200**, which is exactly why that check did not
 * catch it: the 200 was the deferred state, not the surface.
 *
 * `growth-route-composition.test.tsx` exists for the same defect in G4, and
 * `review-queue-navigation.test.tsx` for the same defect in the review queues.
 * This is the Community one.
 *
 * WHAT IT HOLDS: the path is one constant, the nav entry exists, its permission
 * is the one the backend actually enforces, and the entry is shown to exactly
 * the roles that hold it.
 */
import { describe, expect, it } from "vitest";
import { API_NAV_ITEMS, COMMUNITY_MODERATION_PATH } from "./api-shell";
import { grants } from "@/domain/identity/access";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { ROLE_PERMISSIONS } from "@/domain/identity/permissions";

const entry = API_NAV_ITEMS.find((item) => item.href === COMMUNITY_MODERATION_PATH);

describe("Community moderation route composition (api mode)", () => {
  it("has a navigation entry at the canonical path", () => {
    expect(entry, "the api shell must offer Сообщество — it is the only nav PREPROD renders").toBeDefined();
    expect(entry!.label).toBe("Сообщество");
  });

  it("gates the entry on the permission the backend enforces, not on a role name", () => {
    // `requireCommunityModerator` asserts exactly this. If the two ever
    // disagree the menu starts advertising a section that answers 403.
    expect(entry!.permissions).toEqual(["community_moderate"]);
  });

  it("shows the entry to exactly the roles that hold the permission", () => {
    const visible = (role: CrmRole) =>
      entry!.permissions.some((permission) =>
        grants(ROLE_PERMISSIONS[role] ?? [], permission),
      );

    for (const role of CRM_ROLES) {
      const holds = (ROLE_PERMISSIONS[role] ?? []).includes("community_moderate");
      expect(visible(role), `${role}: nav visibility must follow the permission`).toBe(holds);
    }

    // The two that matter, stated explicitly so a grant change is loud.
    expect(visible("moderator")).toBe(true);
    expect(visible("crm_admin")).toBe(true);
    expect(visible("support")).toBe(false);
    expect(visible("mentor")).toBe(false);
    expect(visible("read_only")).toBe(false);
  });

  it("keeps the path as ONE constant, not a hand-copied string", () => {
    // Two copies of a pathname is precisely the shape of the original defect.
    expect(COMMUNITY_MODERATION_PATH).toBe("/community-moderation");
    expect(entry!.href).toBe(COMMUNITY_MODERATION_PATH);
  });
});
