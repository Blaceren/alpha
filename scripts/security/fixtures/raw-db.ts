/**
 * Minimal client shape for the audit fixtures. Deliberately not Prisma's real
 * type: these files are classified as text and never executed, and typing them
 * properly keeps `tsc` and `eslint` clean without pulling the client in.
 */
export interface RawDb {
  $queryRaw<T = unknown>(...args: unknown[]): Promise<T>;
  $executeRaw(...args: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(...args: unknown[]): Promise<T>;
  $executeRawUnsafe(...args: unknown[]): Promise<number>;
}
