/**
 * Whether a unique index on `model.field` refused a write — however this Prisma
 * version reports it (2026-10-07 audit: two registrations of one address at
 * once answered 500 instead of «Email уже занят»).
 *
 * Prisma says `P2002` with `meta: { modelName, target: [field] }`; the raw
 * SQLite message names `Model.field`. Matching the model as well as the field
 * keeps another table's unique `email` from being mistaken for this one.
 */
export function isUniqueViolationOn(error: unknown, model: string, field: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, meta, message } = error as {
    code?: unknown;
    meta?: { modelName?: unknown; target?: unknown };
    message?: unknown;
  };
  if (code === "P2002" && meta?.modelName === model) {
    const target = meta.target;
    const fields = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
    if (fields.some((name) => name === field || name === `${model}_${field}_key`)) return true;
  }
  const escaped = `${model}.${field}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return typeof message === "string" && new RegExp(`UNIQUE constraint failed: ${escaped}\\b`).test(message);
}
