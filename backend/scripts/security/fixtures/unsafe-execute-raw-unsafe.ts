// UNSAFE: $executeRawUnsafe.
import type { RawDb } from "./raw-db";
export async function wipe(prisma: RawDb, table: string) {
  return prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
}
