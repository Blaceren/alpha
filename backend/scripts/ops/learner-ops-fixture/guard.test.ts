/**
 * The acceptance-fixture provisioner's REFUSALS.
 *
 * Every assertion here is about something the tool must NOT do. A provisioner
 * that mints staff principals is only as safe as its refusals, and a refusal
 * that nothing tests is a refusal that quietly stops working.
 */
import { describe, expect, it } from "vitest";
import {
  ALLOWLISTED_EMAILS,
  LEARNER_FIXTURES,
  STAFF_FIXTURES,
  isAllowlisted,
  learnerFixture,
  staffFixture,
} from "./identities";
import { validateAgainstProductPolicy } from "./tty-password";
import {
  FIXTURE_CONFIRM_KEY,
  FIXTURE_CONFIRM_VALUE,
  checkAcknowledgement,
  checkFixtureAllowed,
} from "../learnerOpsAcceptanceFixture";

/** A PREPROD-shaped environment: everything the real deployment sets. */
function preprodEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    ATA_ENVIRONMENT: "staging",
    STAGING_ATTESTATION_ENABLED: "true",
    NODE_ENV: "production",
    DATABASE_URL: "file:/srv/ata-data/data/ata-preprod.sqlite",
    APP_URL: "https://preprod.alfatrade.media",
    PUBLIC_APP_URL: "https://preprod.alfatrade.media",
    SESSION_SECRET: "x".repeat(48),
    [FIXTURE_CONFIRM_KEY]: FIXTURE_CONFIRM_VALUE,
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe("environment gate", () => {
  it("refuses when the environment is not staging", () => {
    const result = checkFixtureAllowed(preprodEnv({ ATA_ENVIRONMENT: "production" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("environment");
  });

  it("refuses when the environment is absent entirely", () => {
    const result = checkFixtureAllowed(preprodEnv({ ATA_ENVIRONMENT: undefined }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("environment");
  });

  it("refuses when the PREPROD capability marker is not set", () => {
    const result = checkFixtureAllowed(preprodEnv({ STAGING_ATTESTATION_ENABLED: "false" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("environment");
  });

  it("checks the environment BEFORE the acknowledgement", () => {
    // On a production host the answer must be "wrong environment" no matter
    // what anyone typed, so the sentinel is never a thing a production host can
    // be walked toward one variable at a time.
    const result = checkFixtureAllowed(
      preprodEnv({ ATA_ENVIRONMENT: "production", [FIXTURE_CONFIRM_KEY]: FIXTURE_CONFIRM_VALUE }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("environment");
  });
});

describe("acknowledgement gate", () => {
  it("refuses with no acknowledgement", () => {
    const result = checkAcknowledgement({} as unknown as NodeJS.ProcessEnv);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_confirmation");
  });

  it("refuses a near-miss acknowledgement", () => {
    for (const wrong of ["provision", "yes", FIXTURE_CONFIRM_VALUE.toLowerCase(), ` ${FIXTURE_CONFIRM_VALUE}`]) {
      const result = checkAcknowledgement({ [FIXTURE_CONFIRM_KEY]: wrong } as unknown as NodeJS.ProcessEnv);
      expect(result.ok, `must refuse ${JSON.stringify(wrong)}`).toBe(false);
    }
  });

  it("does NOT accept the QA operator's sentinel", () => {
    // An acknowledgement left in a shell after provisioning that principal must
    // not silently authorize provisioning these.
    const result = checkAcknowledgement({
      [FIXTURE_CONFIRM_KEY]: "PROVISION_PREPROD_QA_OPERATOR",
    } as unknown as NodeJS.ProcessEnv);
    expect(result.ok).toBe(false);
  });

  it("accepts only the exact sentinel", () => {
    const result = checkAcknowledgement({
      [FIXTURE_CONFIRM_KEY]: FIXTURE_CONFIRM_VALUE,
    } as unknown as NodeJS.ProcessEnv);
    expect(result.ok).toBe(true);
  });
});

describe("the closed identity allowlist", () => {
  it("admits exactly the nine reviewed fixtures", () => {
    expect(ALLOWLISTED_EMAILS).toHaveLength(9);
    expect(STAFF_FIXTURES).toHaveLength(3);
    expect(LEARNER_FIXTURES).toHaveLength(6);
    for (const email of ALLOWLISTED_EMAILS) expect(isAllowlisted(email)).toBe(true);
  });

  it("REFUSES the negative RBAC control", () => {
    // This is the assertion that keeps `preprod-qa-operator` able to prove
    // denial. If it ever fails, the phase has lost its only negative control.
    expect(isAllowlisted("preprod-qa-operator@ata.invalid")).toBe(false);
    expect(ALLOWLISTED_EMAILS).not.toContain("preprod-qa-operator@ata.invalid");
  });

  it("REFUSES the commercial fixtures and every real address", () => {
    for (const email of [
      "testregfin@tst.fin", // user 66
      "echetest@twstes.co", // user 67
      "preprod-crm-admin@ata.invalid",
      "dev.crm.mentor@ata.test",
      "smokel3d1r.learner@ata.invalid",
      "someone@alfatrade.media",
      "admin@example.com",
    ]) {
      expect(isAllowlisted(email), `must refuse ${email}`).toBe(false);
    }
  });

  it("cannot be widened by appending the synthetic suffix to an arbitrary name", () => {
    // Membership is by EXACT string, not by domain suffix — otherwise anybody
    // could mint `whatever@learner-ops.invalid` and be admitted.
    expect(isAllowlisted("attacker@learner-ops.invalid")).toBe(false);
    expect(isAllowlisted("lo-operator@learner-ops.invalid.evil.com")).toBe(false);
  });

  it("refuses an allowlisted local-part on the wrong domain", () => {
    expect(isAllowlisted("lo-admin@ata.invalid")).toBe(false);
    expect(isAllowlisted("lo-reviewer@alfatrade.media")).toBe(false);
  });

  it("resolves fixtures only by reviewed key", () => {
    expect(staffFixture("admin")?.staffRole).toBe("crm_admin");
    expect(staffFixture("nonexistent")).toBeNull();
    expect(learnerFixture("report")?.key).toBe("report");
    expect(learnerFixture("../../etc/passwd")).toBeNull();
  });
});

describe("the capability separation the fixtures exist to prove", () => {
  it("gives the frontline operator NEITHER review permission", () => {
    const operator = STAFF_FIXTURES.find((f) => f.key === "operator")!;
    // `support` grants view + handle + escalate and no review permission.
    expect(operator.staffRole).toBe("support");
    // And it is NOT on the canonical Academy reviewer axis either.
    expect(operator.userRole).toBe("user");
  });

  it("gives the reviewer BOTH axes, which is what LO-AUTH-AXIS-1 requires", () => {
    const reviewer = STAFF_FIXTURES.find((f) => f.key === "reviewer")!;
    expect(reviewer.staffRole).toBe("mentor");
    expect(reviewer.userRole).toBe("mentor");
  });

  it("gives the admin the CRM review permission but NOT the platform axis", () => {
    // The point of this principal: it proves the CRM permission alone is not
    // sufficient for review, which is exactly what "additional, never
    // alternative" claims.
    const admin = STAFF_FIXTURES.find((f) => f.key === "admin")!;
    expect(admin.staffRole).toBe("crm_admin");
    expect(admin.userRole).toBe("user");
  });

  it("provisions one learner per journey, never one learner walked through contradictory states", () => {
    expect(LEARNER_FIXTURES.map((f) => f.key).sort()).toEqual([
      "complaint",
      "escalation",
      "external",
      "mentor",
      "report",
      "support",
    ]);
    expect(new Set(LEARNER_FIXTURES.map((f) => f.email)).size).toBe(6);
  });
});

describe("password policy delegation", () => {
  it("defers to the platform's own registration policy", () => {
    expect(validateAgainstProductPolicy("short").length).toBeGreaterThan(0);
    expect(validateAgainstProductPolicy("")).not.toHaveLength(0);
  });
});

describe("the enrolment actor — LO-FIXTURE-ENROL-1", () => {
  it("does NOT use any staff fixture as the enrolment actor", () => {
    // The canonical enrolment owner requires an active `admin` on the platform
    // axis. None of the three fixtures is one, and that is the point: the
    // `admin` fixture is `userRole: "user"` precisely so it can prove the CRM
    // review permission is not sufficient for canonical authority. If a future
    // edit made it a platform admin to satisfy the enrolment command, this test
    // is what should stop it.
    for (const fixture of STAFF_FIXTURES) {
      expect(fixture.userRole, `${fixture.key} must not be a platform admin`).not.toBe("admin");
    }
  });

  it("keeps the reviewer on `mentor`, not `admin`", () => {
    // `mentor` satisfies requireTaskReportReviewer without granting the broad
    // platform-admin authority that would make the fixture a progression bypass.
    const reviewer = STAFF_FIXTURES.find((f) => f.key === "reviewer")!;
    expect(reviewer.userRole).toBe("mentor");
  });
});
