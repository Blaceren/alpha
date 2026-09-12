import { describe, it, expect, vi, beforeEach } from "vitest";

const auditLogCreate = vi.fn();
const requireAffiliateReaderMock = vi.fn();
const requireAffiliateCsrfMock = vi.fn();
const resolveAffiliateActorUserIdMock = vi.fn();
const canRevealLeadPiiMock = vi.fn();
const loadLeadByEventIdMock = vi.fn();

// Only prisma, the session/permission gates, and the lead lookup are
// replaced. `@/lib/audit`, `@/lib/crm/affiliates` (the error classes) and
// `@/lib/leads/lead-routes` (the real `leadErrorResponse` safety net) are
// deliberately left real, because the fail-closed guarantee this suite
// verifies lives in how those pieces compose, not in a mock of them.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: {
      create: (...args: unknown[]) => auditLogCreate(...args),
    },
  },
}));

vi.mock("@/lib/crm/affiliate-routes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crm/affiliate-routes")>();
  return {
    ...actual,
    requireAffiliateReader: (...args: unknown[]) => requireAffiliateReaderMock(...args),
    requireAffiliateCsrf: (...args: unknown[]) => requireAffiliateCsrfMock(...args),
    resolveAffiliateActorUserId: (...args: unknown[]) => resolveAffiliateActorUserIdMock(...args),
  };
});

vi.mock("@/lib/crm/roles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crm/roles")>();
  return {
    ...actual,
    canRevealLeadPii: (...args: unknown[]) => canRevealLeadPiiMock(...args),
  };
});

vi.mock("@/lib/leads/lead-queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/leads/lead-queries")>();
  return {
    ...actual,
    loadLeadByEventId: (...args: unknown[]) => loadLeadByEventIdMock(...args),
  };
});

import { AffiliateForbiddenError } from "@/lib/crm/affiliates";
import { POST } from "./route";

const VALID_LEAD_ID = "v1_abcdefghijklmnopqrstuvwxyz234567";
const FIXTURE_EMAIL = "reveal-fixture@example.invalid";
const FIXTURE_DISPLAY_NAME = "Fixture Learner";

function makeRequest(body = "{}") {
  return new Request(
    "https://preprod.example.invalid/api/crm/v1/affiliates/leads/x/reveal",
    { method: "POST", body, headers: { "content-type": "application/json" } },
  );
}

function makeContext(leadId = VALID_LEAD_ID) {
  return { params: Promise.resolve({ leadId }) };
}

const SESSION = { effectivePermissions: ["reveal_pii"], employeeId: "employee-1" };

describe("POST /api/crm/v1/affiliates/leads/[leadId]/reveal", () => {
  beforeEach(() => {
    auditLogCreate.mockReset();
    requireAffiliateReaderMock.mockReset().mockResolvedValue(SESSION);
    requireAffiliateCsrfMock.mockReset().mockResolvedValue(undefined);
    resolveAffiliateActorUserIdMock.mockReset().mockResolvedValue(42);
    canRevealLeadPiiMock.mockReset().mockReturnValue(true);
    loadLeadByEventIdMock.mockReset().mockResolvedValue({
      eventId: VALID_LEAD_ID.slice(3),
      email: FIXTURE_EMAIL,
      displayName: FIXTURE_DISPLAY_NAME,
    });
  });

  it("returns the identity when audit persistence succeeds", async () => {
    auditLogCreate.mockResolvedValueOnce({ id: "row-1" });

    const response = await POST(makeRequest(), makeContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.identity).toEqual({
      leadId: VALID_LEAD_ID,
      email: FIXTURE_EMAIL,
      displayName: FIXTURE_DISPLAY_NAME,
      piiState: "revealed",
    });
    expect(auditLogCreate).toHaveBeenCalledTimes(1);
  });

  it("fails closed: blocks the reveal when audit persistence fails, with no PII in the response", async () => {
    auditLogCreate.mockRejectedValueOnce(new Error("db unavailable"));

    const response = await POST(makeRequest(), makeContext());
    const bodyText = await response.text();

    // Non-2xx: the reveal must not be treated as having succeeded.
    expect(response.status).toBeGreaterThanOrEqual(400);

    // No PII anywhere in the failure body: no `identity` key, and the
    // fixture email/display name must not appear as a raw string either.
    const body = JSON.parse(bodyText);
    expect(body.identity).toBeUndefined();
    expect(bodyText).not.toContain(FIXTURE_EMAIL);
    expect(bodyText).not.toContain(FIXTURE_DISPLAY_NAME);
    expect(body).toMatchObject({ code: "internal" });
  });

  it("does not mask the audit failure as success (status is never 2xx)", async () => {
    auditLogCreate.mockRejectedValueOnce(new Error("db unavailable"));

    const response = await POST(makeRequest(), makeContext());

    expect(response.status >= 200 && response.status < 300).toBe(false);
    expect(response.ok).toBe(false);
  });

  it("still refuses a caller without the PII permission (no regression)", async () => {
    canRevealLeadPiiMock.mockReturnValue(false);

    const response = await POST(makeRequest(), makeContext());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.identity).toBeUndefined();
    // Permission is checked before CSRF and before any lookup, so neither
    // the audit write nor the lead lookup should ever run.
    expect(auditLogCreate).not.toHaveBeenCalled();
    expect(loadLeadByEventIdMock).not.toHaveBeenCalled();
  });

  it("still refuses a caller who fails CSRF (no regression)", async () => {
    requireAffiliateCsrfMock.mockRejectedValueOnce(
      new AffiliateForbiddenError("crm.affiliates.csrf_invalid"),
    );

    const response = await POST(makeRequest(), makeContext());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.identity).toBeUndefined();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it("still returns not-found for an unknown lead (no regression)", async () => {
    loadLeadByEventIdMock.mockResolvedValueOnce(null);

    const response = await POST(makeRequest(), makeContext());
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.identity).toBeUndefined();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });
});
