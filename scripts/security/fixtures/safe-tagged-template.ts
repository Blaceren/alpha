// SAFE: Prisma tagged template. `${}` becomes a bound parameter.
import type { RawDb } from "./raw-db";
export async function readOne(prisma: RawDb, id: number) {
  return prisma.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id}`;
}
export async function ping(prisma: RawDb) {
  return prisma.$queryRaw`SELECT 1`;
}
