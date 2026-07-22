// SAFE: Prisma.sql value passed to $queryRaw, including a generic type argument
// and a composed fragment — the shape used by Curriculum V2.
import { Prisma } from "@prisma/client";
import type { RawDb } from "./raw-db";
export async function readStatuses(tx: RawDb, enrollmentId: number, asOf?: Date) {
  const asOfClause = asOf ? Prisma.sql`AND x."createdAt" <= ${asOf}` : Prisma.empty;
  return tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT "status" FROM "UserLevelProgress"
    WHERE "enrollmentId" = ${enrollmentId} ${asOfClause}
  `);
}
export async function writeOne(tx: RawDb, id: number) {
  return tx.$executeRaw(Prisma.sql`UPDATE "User" SET "name" = 'x' WHERE "id" = ${id}`);
}
