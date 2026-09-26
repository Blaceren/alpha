// UNSAFE: Prisma.raw() injects unescaped SQL text; it is not parameter-bound.
import { Prisma } from "@prisma/client";
import type { RawDb } from "./raw-db";
export async function orderBy(prisma: RawDb, column: string) {
  return prisma.$queryRaw(Prisma.raw(`SELECT * FROM "User" ORDER BY ${column}`));
}
