import { describe, expect, it } from "vitest";

import { resolveDatasourceUrl } from "./prisma-url";

describe("resolveDatasourceUrl — G4-M7", () => {
  it("serialises a bare SQLite file URL to one connection", () => {
    expect(resolveDatasourceUrl("file:/srv/ata-data/data/ata-preprod.sqlite")).toBe(
      "file:/srv/ata-data/data/ata-preprod.sqlite?connection_limit=1",
    );
  });

  it("preserves any parameters the operator already set", () => {
    const resolved = resolveDatasourceUrl("file:./dev.sqlite?socket_timeout=15");

    expect(resolved).toContain("socket_timeout=15");
    expect(resolved).toContain("connection_limit=1");
  });

  it("NEVER overrides an explicit connection_limit", () => {
    // The default exists to stop a forgotten parameter causing 500s, not to
    // overrule a deliberate choice.
    expect(resolveDatasourceUrl("file:./dev.sqlite?connection_limit=4")).toBe(
      "file:./dev.sqlite?connection_limit=4",
    );
  });

  it("leaves a non-SQLite URL completely alone", () => {
    // Postgres and MySQL want a real pool; this reasoning is SQLite's alone.
    for (const url of [
      "postgresql://user@host:5432/db",
      "mysql://user@host:3306/db",
      "postgres://user@host/db?connection_limit=17",
    ]) {
      expect(resolveDatasourceUrl(url)).toBe(url);
    }
  });

  it("passes an absent value through rather than inventing one", () => {
    expect(resolveDatasourceUrl(undefined)).toBeUndefined();
    expect(resolveDatasourceUrl("")).toBe("");
  });

  it("handles the sqlite: scheme as well as file:", () => {
    expect(resolveDatasourceUrl("sqlite:./x.db")).toContain("connection_limit=1");
  });
});
