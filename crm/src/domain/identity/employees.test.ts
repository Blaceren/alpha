/**
 * Canonical employee directory (Phase 1B4-C).
 *
 * The point of the directory is that there is only one of it. These tests pin it to
 * the two things that used to disagree with it: the fixtures' actual owners, and the
 * lists the UI renders.
 */
import { describe, expect, it } from "vitest";
import {
  EMPLOYEE_DIRECTORY,
  PRIMARY_OWNER_CANDIDATES,
  findEmployee,
  isPrimaryOwnerCandidate,
} from "./employees";
import { OWNER_LABEL, UNKNOWN_OWNER_LABEL, ownerLabel } from "@/config/labels";
import { ALL_FILTERS } from "@/features/users/filter-options";
import { defaultDataset } from "@/data/mock/fixtures/index";
import { FixedMockClock } from "@/lib/clock";

const clock = new FixedMockClock();

/** Every distinct owner the baseline fixtures actually name. */
function fixtureOwnerIds(): string[] {
  const ids = new Set<string>();
  for (const u of defaultDataset(clock)) {
    if (u.operations.primaryOwnerId !== null) ids.add(u.operations.primaryOwnerId);
  }
  return [...ids].sort();
}

describe("employee directory — internal shape", () => {
  it("has no duplicate ids", () => {
    const ids = EMPLOYEE_DIRECTORY.map((e) => e.employeeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every employee a non-empty display name that is not the id", () => {
    for (const e of EMPLOYEE_DIRECTORY) {
      expect(e.displayName.trim().length).toBeGreaterThan(0);
      expect(e.displayName).not.toContain(e.employeeId);
      expect(e.displayName).not.toMatch(/^emp[_ ]/i);
    }
  });

  it("carries no PII and no HR model — id, name and one flag, nothing else", () => {
    for (const e of EMPLOYEE_DIRECTORY) {
      expect(Object.keys(e).sort()).toEqual(["displayName", "employeeId", "primaryOwnerCandidate"]);
    }
    const serialized = JSON.stringify(EMPLOYEE_DIRECTORY);
    expect(serialized).not.toMatch(/@/);
    expect(serialized).not.toMatch(/\+\d{6,}/);
  });

  it("findEmployee tolerates null/unknown without inventing an employee", () => {
    expect(findEmployee(null)).toBeNull();
    expect(findEmployee(undefined)).toBeNull();
    expect(findEmployee("emp_nobody")).toBeNull();
    expect(findEmployee("emp_ret1")?.displayName).toBe("Retention 1");
  });
});

describe("employee directory — candidates match the fixtures", () => {
  /**
   * The load-bearing test. A candidate nobody owns is an option that cannot be
   * demonstrated; a fixture owner missing from the candidates is an owner the picker
   * could never restore after someone reassigned away from them.
   */
  it("the candidate set IS the set of baseline fixture owners", () => {
    const candidates = PRIMARY_OWNER_CANDIDATES.map((e) => e.employeeId).sort();
    expect(candidates).toEqual(fixtureOwnerIds());
  });

  it("names the five documented owners", () => {
    expect(PRIMARY_OWNER_CANDIDATES.map((e) => e.employeeId).sort()).toEqual([
      "emp_men1",
      "emp_mgr",
      "emp_ret1",
      "emp_ret2",
      "emp_sup1",
    ]);
  });

  it("isPrimaryOwnerCandidate admits candidates and refuses everyone else", () => {
    expect(isPrimaryOwnerCandidate("emp_ret1")).toBe(true);
    // In the directory (so it has a caption) but never an owner.
    expect(isPrimaryOwnerCandidate("emp_mod1")).toBe(false);
    expect(isPrimaryOwnerCandidate("emp_mock_admin")).toBe(false);
    expect(isPrimaryOwnerCandidate("emp_nobody")).toBe(false);
  });
});

describe("employee directory — the UI lists are derived from it", () => {
  it("OWNER_LABEL covers the directory exactly", () => {
    expect(Object.keys(OWNER_LABEL).sort()).toEqual(
      EMPLOYEE_DIRECTORY.map((e) => e.employeeId).sort(),
    );
    for (const e of EMPLOYEE_DIRECTORY) {
      expect(OWNER_LABEL[e.employeeId]).toBe(e.displayName);
    }
  });

  it("the Users owner filter offers exactly the candidates", () => {
    const def = ALL_FILTERS.find((f) => f.key === "ownerId")!;
    expect(def.options.map((o) => o.value).sort()).toEqual(
      PRIMARY_OWNER_CANDIDATES.map((e) => e.employeeId).sort(),
    );
    // It used to offer emp_mod1, who owns nobody — a filter that always came back
    // empty. Deriving the options is what removed it.
    expect(def.options.map((o) => o.value)).not.toContain("emp_mod1");
  });

  it("the Users owner filter shows names, never codes", () => {
    const def = ALL_FILTERS.find((f) => f.key === "ownerId")!;
    for (const o of def.options) {
      expect(o.label).not.toMatch(/^emp[_ ]/i);
      expect(o.label).toBe(OWNER_LABEL[o.value]);
    }
  });
});

describe("ownerLabel — an unknown id is never printed", () => {
  it("labels every known employee by name", () => {
    for (const e of EMPLOYEE_DIRECTORY) {
      expect(ownerLabel(e.employeeId)).toBe(e.displayName);
    }
  });

  it("says «не назначен» for no owner", () => {
    expect(ownerLabel(null)).toBe("Не назначен");
    expect(ownerLabel(undefined)).toBe("Не назначен");
    expect(ownerLabel("")).toBe("Не назначен");
  });

  /**
   * The old fallback was `humanizeCode`, which turned `emp_xyz` into "Emp xyz" —
   * the raw id with a capital letter, printed to the screen as if it were a name.
   */
  it("falls back to a neutral caption rather than humanizing the code", () => {
    expect(ownerLabel("emp_unknown_person")).toBe(UNKNOWN_OWNER_LABEL);
    expect(ownerLabel("emp_unknown_person")).not.toMatch(/emp/i);
    expect(ownerLabel("emp_unknown_person")).not.toMatch(/unknown_person/);
  });
});
