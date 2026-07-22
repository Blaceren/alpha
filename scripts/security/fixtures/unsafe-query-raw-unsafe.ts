// UNSAFE: $queryRawUnsafe with interpolated input.
import type { RawDb } from "./raw-db";
export async function lookup(prisma: RawDb, email: string) {
  return prisma.$queryRawUnsafe(`SELECT * FROM "User" WHERE "email" = '${email}'`);
}
