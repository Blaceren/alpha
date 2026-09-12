import { PrismaClient } from "@prisma/client";

import { resolveDatasourceUrl } from "@/lib/prisma-url";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

// G4-M7. SQLite has one writer; the pool must not contend with itself. See
// `prisma-url.ts` for the measurement. Non-SQLite URLs pass through untouched,
// and an explicit `connection_limit` in the URL always wins.
const datasourceUrl = resolveDatasourceUrl(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : undefined);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
