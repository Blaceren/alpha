/**
 * G4-M2 — append-only, enforced by a gate instead of by hope.
 *
 * WHAT THE FINDING SAID. The ledger is append-only because no code updates or
 * deletes a `GrowthEvent`, not because anything prevents it. The database
 * refuses the worst mutations — the amount/eventType CHECK, the outbox FK
 * RESTRICT — but `prisma.growthEvent.update({data:{occurredAt}})` succeeds, and
 * "there is no update path in the application" stops being true the first time
 * somebody writes one, with nothing objecting.
 *
 * WHY THIS TEST RATHER THAN A TRIGGER. `BEFORE UPDATE`/`BEFORE DELETE` triggers
 * would be genuine database-level enforcement, and they would require a new
 * migration against the live, accepted G4 table. That is a schema change to
 * settled data in exchange for closing a hazard with zero current reachability
 * — no shipped path mutates, and this test is what keeps that true. The
 * enforcement moved from a claim in a comment to a mechanical gate that fails a
 * build; the trigger option is recorded as a deliberate design choice, not as
 * an oversight, in the closure register.
 *
 * WHAT IT GUARANTEES. A future writer who adds `growthEvent.update`,
 * `.delete`, `.upsert`, `.updateMany`, `.deleteMany`, or a second `.create`
 * outside the one auditable emitter fails HERE, in their own change, with the
 * reason attached — rather than six weeks later in a reconciliation nobody
 * scheduled.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");

/** The single module allowed to write the ledger. */
const EMITTER = path.join("lib", "growth", "emit.ts");

const FORBIDDEN = [
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
  "create",
  "createMany",
] as const;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // lstat semantics: a symlink is not followed into.
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("GrowthEvent ledger is append-only", () => {
  const files = sourceFiles(SRC);

  it("finds source to check, so a broken walk cannot pass vacuously", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("has exactly one module that writes GrowthEvent, and it is the emitter", () => {
    const writers = files.filter((file) =>
      /(?:tx|prisma|db|client)\.growthEvent\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\b/.test(
        fs.readFileSync(file, "utf8"),
      ),
    );

    expect(writers.map((file) => path.relative(SRC, file))).toEqual([EMITTER]);
  });

  it("never updates, deletes or upserts a GrowthEvent anywhere, including the emitter", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      for (const method of FORBIDDEN) {
        if (method === "create") continue; // the emitter's one legitimate write
        if (new RegExp(`growthEvent\\.${method}\\b`).test(source)) {
          offenders.push(`${path.relative(SRC, file)}: growthEvent.${method}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("creates a GrowthEvent in exactly one place", () => {
    const creates = files.flatMap((file) => {
      const matches = fs.readFileSync(file, "utf8").match(/growthEvent\.create\b/g) ?? [];
      return matches.map(() => path.relative(SRC, file));
    });

    expect(creates).toEqual([EMITTER]);
  });

  it("never deletes an outbox row either — a consumed row is marked, not removed", () => {
    const offenders = files.filter((file) =>
      /growthEventOutbox\.(?:delete|deleteMany)\b/.test(fs.readFileSync(file, "utf8")),
    );

    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
  });
});
