import { describe, expect, it } from "vitest";
import {
  buildOwnerSearch,
  CRM_USERS_OWNER_FILTERS,
  isCanonicalOwnerSearch,
  isOwnerFilter,
  OWNER_FILTER_PARAM,
  readOwnerFilter,
} from "./users-owner-filter";

const params = (search: string) => new URLSearchParams(search);

describe("the owner filter set", () => {
  it("is exactly all / mine / unassigned", () => {
    expect([...CRM_USERS_OWNER_FILTERS]).toEqual(["all", "mine", "unassigned"]);
  });

  it("recognizes only those three as valid filters", () => {
    for (const v of ["all", "mine", "unassigned"]) expect(isOwnerFilter(v)).toBe(true);
    for (const v of ["assigned", "ALL", "Mine", "", "emp_1", "mine,all", null, 1, true]) {
      expect(isOwnerFilter(v)).toBe(false);
    }
  });
});

describe("readOwnerFilter — URL derivation, fail-safe to all", () => {
  it("treats an absent parameter as all", () => {
    expect(readOwnerFilter(params(""))).toBe("all");
  });

  it("reads mine and unassigned exactly", () => {
    expect(readOwnerFilter(params("owner=mine"))).toBe("mine");
    expect(readOwnerFilter(params("owner=unassigned"))).toBe("unassigned");
  });

  it("accepts an explicit all", () => {
    expect(readOwnerFilter(params("owner=all"))).toBe("all");
  });

  it("canonicalizes any invalid value to all", () => {
    for (const raw of ["owner=", "owner=All", "owner=MINE", "owner=assigned", "owner=emp_1", "owner=true"]) {
      expect(readOwnerFilter(params(raw))).toBe("all");
    }
  });

  it("treats a repeated owner key as all", () => {
    expect(readOwnerFilter(params("owner=mine&owner=all"))).toBe("all");
    expect(readOwnerFilter(params("owner=mine&owner=unassigned"))).toBe("all");
    expect(readOwnerFilter(params("owner=mine&owner=mine"))).toBe("all");
  });

  it("ignores unrelated params", () => {
    expect(readOwnerFilter(params("search=Лена&owner=mine"))).toBe("mine");
  });
});

describe("buildOwnerSearch — canonical URL writing", () => {
  it("omits the parameter for all", () => {
    expect(buildOwnerSearch(params(""), "all")).toBe("");
    // An explicit incoming all collapses away.
    expect(buildOwnerSearch(params("owner=all"), "all")).toBe("");
  });

  it("writes owner=mine and owner=unassigned", () => {
    expect(buildOwnerSearch(params(""), "mine")).toBe(`?${OWNER_FILTER_PARAM}=mine`);
    expect(buildOwnerSearch(params(""), "unassigned")).toBe(`?${OWNER_FILTER_PARAM}=unassigned`);
  });

  it("removes any pre-existing owner values, including repeats", () => {
    expect(buildOwnerSearch(params("owner=mine&owner=all"), "all")).toBe("");
    expect(buildOwnerSearch(params("owner=unassigned"), "mine")).toBe("?owner=mine");
  });

  it("never emits owner=all", () => {
    expect(buildOwnerSearch(params("owner=all"), "all")).not.toContain("owner");
  });
});

describe("isCanonicalOwnerSearch", () => {
  it("treats the empty query and a clean single value as canonical", () => {
    expect(isCanonicalOwnerSearch("")).toBe(true);
    expect(isCanonicalOwnerSearch("?owner=mine")).toBe(true);
    expect(isCanonicalOwnerSearch("?owner=unassigned")).toBe(true);
  });

  it("flags an explicit all, a repeat or a garbage value as non-canonical", () => {
    expect(isCanonicalOwnerSearch("?owner=all")).toBe(false);
    expect(isCanonicalOwnerSearch("?owner=mine&owner=all")).toBe(false);
    expect(isCanonicalOwnerSearch("?owner=ALL")).toBe(false);
  });
});
