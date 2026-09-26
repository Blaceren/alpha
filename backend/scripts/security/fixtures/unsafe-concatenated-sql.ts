// UNSAFE: SQL built by string concatenation and handed to a raw API as a value.
import type { RawDb } from "./raw-db";
export async function search(prisma: RawDb, term: string) {
  const sql = 'SELECT * FROM "User" WHERE "name" LIKE ' + "'%" + term + "%'";
  return prisma.$queryRaw(sql);
}
