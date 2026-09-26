// UNSAFE: an untagged template string with interpolated user input, passed as a
// value rather than as a Prisma tagged template — no parameter binding occurs.
import type { RawDb } from "./raw-db";
export async function byName(prisma: RawDb, name: string) {
  return prisma.$queryRaw(`SELECT * FROM "User" WHERE "name" = '${name}'`);
}
