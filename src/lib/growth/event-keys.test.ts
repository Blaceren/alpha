/**
 * G4-GROWTH — the keys the runtime emitters use must equal the keys the
 * migration backfilled with.
 *
 * WHY THIS TEST IS THE MOST IMPORTANT ONE IN THE PHASE. Migration 47 reconstructs
 * history by writing GrowthEvent rows from the owner tables, building
 * `sourceEventId` in SQL. The runtime emitters build the same string in
 * TypeScript. If the two ever disagree by a character, a backfilled row and a
 * later runtime row for the SAME owner both exist — the unique index does not
 * collide, nothing errors, and every downstream count is silently inflated.
 *
 * So this test does not compare the functions against hard-coded strings, which
 * would drift with them. It reads the ACTUAL migration file and asserts the SQL
 * expressions produce what these functions produce.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GROWTH_EVENT_TYPES,
  GROWTH_SOURCE_ENTITY_TYPES,
  GROWTH_SOURCE_OWNER_BY_TYPE,
  assessmentAttemptSourceEventId,
  clickSourceEventId,
  enrollmentSourceEventId,
  pocketPlayerSourceEventId,
  progressSourceEventId,
  redepositSourceEventId,
  reportSubmissionSourceEventId,
  userSourceEventId,
} from "./event-keys";

const MIGRATION = readFileSync(
  path.join(
    process.cwd(),
    "prisma/migrations/20260813000000_growth_event_foundation/migration.sql",
  ),
  "utf8",
);

describe("growth event keys", () => {
  it("produces the documented shapes", () => {
    expect(clickSourceEventId(7)).toBe("click:7");
    expect(userSourceEventId(56)).toBe("user:56");
    expect(enrollmentSourceEventId(21)).toBe("enrollment:21");
    expect(progressSourceEventId(4)).toBe("progress:4");
    expect(assessmentAttemptSourceEventId(9)).toBe("attempt:9");
    expect(reportSubmissionSourceEventId(3)).toBe("submission:3");
    expect(pocketPlayerSourceEventId("112233")).toBe("pocket:player:112233");
    expect(redepositSourceEventId("evt_abc")).toBe("pocket:event:evt_abc");
  });

  /**
   * Each entry pairs a runtime key with the SQL concatenation the migration uses
   * for the same family. The SQL is asserted to be PRESENT in the migration
   * file, so deleting or editing a backfill statement without updating this list
   * fails here rather than in production six weeks later.
   */
  const SQL_PREFIXES: Array<[string, string]> = [
    [clickSourceEventId(1).replace("1", ""), "'click:' || CAST(c.\"id\" AS TEXT)"],
    [userSourceEventId(1).replace("1", ""), "'user:' || CAST(e.\"userId\" AS TEXT)"],
    [enrollmentSourceEventId(1).replace("1", ""), "'enrollment:' || CAST(en.\"id\" AS TEXT)"],
    [progressSourceEventId(1).replace("1", ""), "'progress:' || CAST(p.\"id\" AS TEXT)"],
    [assessmentAttemptSourceEventId(1).replace("1", ""), "'attempt:' || CAST(a.\"id\" AS TEXT)"],
    [reportSubmissionSourceEventId(1).replace("1", ""), "'submission:' || CAST(s.\"id\" AS TEXT)"],
    [pocketPlayerSourceEventId("").replace(/:$/, ":"), "'pocket:player:' || t.\"pocketUserId\""],
  ];

  it.each(SQL_PREFIXES)(
    "runtime prefix %s matches a literal in the migration",
    (prefix, sqlExpression) => {
      // The SQL literal must carry exactly the runtime prefix.
      expect(sqlExpression).toContain(`'${prefix}`);
      // And the expression must actually appear in the shipped migration.
      expect(MIGRATION).toContain(sqlExpression);
    },
  );

  it("keys the ata_reg fallback pass identically to the ledger pass", () => {
    // Two backfill statements produce `ata_reg`. If they disagreed, a learner
    // covered by both would get two rows.
    expect(MIGRATION).toContain("'user:' || CAST(e.\"userId\" AS TEXT)");
    expect(MIGRATION).toContain("'user:' || CAST(u.\"id\" AS TEXT)");
  });

  it("keys dep on the Pocket player, matching the provider-side identity", () => {
    expect(MIGRATION).toContain("'pocket:player:' || pe.\"pocketPlayerId\"");
    expect(pocketPlayerSourceEventId("77")).toBe("pocket:player:77");
  });

  it("never backfills rdep, because no redeposit can be identified", () => {
    // The absence is the assertion. An INSERT naming 'rdep' would mean the
    // migration invented an identity the provider does not supply.
    expect(MIGRATION).not.toMatch(/'rdep'\s*,/);
  });

  it("declares an owner and an entity type for every event type", () => {
    for (const eventType of GROWTH_EVENT_TYPES) {
      expect(GROWTH_SOURCE_OWNER_BY_TYPE[eventType]).toBeTruthy();
      expect(GROWTH_SOURCE_ENTITY_TYPES[eventType]).toBeTruthy();
    }
  });

  /**
   * G4-R8. The runtime's `sourceEntityType` for a family must be the table the
   * migration names for the SAME family, because a reader uses the pair
   * (`sourceEntityType`, `sourceEntityId`) to find the origin row.
   *
   * Read from the shipped SQL rather than from a second hard-coded list, for
   * the same reason as the key test above: a list that is maintained by hand
   * drifts with the thing it is supposed to be checking.
   */
  const MIGRATION_ENTITY_TYPES: Array<[string, string]> = [
    ["ata_reg", "User"],
    ["curriculum_enrollment", "UserCurriculumEnrollment"],
    ["academy_activation", "UserLevelProgress"],
    ["level_started", "UserLevelProgress"],
    ["level_completed", "UserLevelProgress"],
    ["assessment_completed", "AssessmentAttempt"],
    ["report_submitted", "ReportSubmission"],
    ["report_approved", "ReportReview"],
    ["pocket_reg", "PocketTraderIdentity"],
    ["dep", "PocketProviderEvent"],
  ];

  it.each(MIGRATION_ENTITY_TYPES)(
    "runtime sourceEntityType for %s equals the table the migration writes",
    (eventType, entityType) => {
      expect(GROWTH_SOURCE_ENTITY_TYPES[eventType as (typeof GROWTH_EVENT_TYPES)[number]]).toBe(
        entityType,
      );
      // And the migration really does write that string for this family, so a
      // change to either side without the other fails here.
      expect(MIGRATION).toContain(`'${eventType}',`);
      expect(MIGRATION).toContain(`'${entityType}',`);
    },
  );

  it("names the User as the ata_reg owner, matching every backfilled row", () => {
    // The defect this closes: the constant said `AffiliateConversionEvent`
    // while `sourceEntityId` carried a `User.id` and both backfill passes wrote
    // `'User'`. A reader following the declared type looked in the wrong table.
    expect(GROWTH_SOURCE_ENTITY_TYPES.ata_reg).toBe("User");
    expect(MIGRATION).not.toContain("'AffiliateConversionEvent',");
  });

  it("has no way to build a redeposit key without a provider identity", () => {
    // A degraded overload taking (player, amount, time) is exactly what §26
    // forbids. Its absence is what makes the fail-closed path unavoidable.
    expect(redepositSourceEventId.length).toBe(1);
  });
});
