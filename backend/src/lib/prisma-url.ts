/**
 * G4-M7 — SQLite has ONE writer, and the connection pool must agree with it.
 *
 * WHAT WAS MEASURED. Twelve concurrent identical emissions against the PREPROD
 * SQLite configuration produced `created=3, duplicate=2, threw=7`. The unique
 * index did its job — exactly the right canonical rows survived — but seven
 * callers received an EXCEPTION instead of the `duplicate` answer the emitter
 * documents. Registration uses the strict emitter inside its own transaction,
 * so a write burst could turn a registration that would previously have
 * succeeded into a 500.
 *
 * WHY IT HAPPENS. Prisma's default pool opens several connections. SQLite
 * permits one writer, and PREPROD runs `busy_timeout=0`, so a second connection
 * that meets a held write lock fails INSTANTLY rather than waiting. The pool
 * was contending with itself.
 *
 * WHAT FIXES IT, MEASURED RATHER THAN ASSUMED:
 *
 *   (none)                                created=3 duplicate=2 threw=7
 *   ?socket_timeout=15                    created=2 duplicate=3 threw=7
 *   ?connection_limit=1                   created=3 duplicate=9 threw=0
 *   ?connection_limit=1&socket_timeout=15 created=3 duplicate=9 threw=0
 *
 * `socket_timeout` does nothing for lock contention. `connection_limit=1` fixes
 * it completely: the same three canonical rows are created and the other nine
 * callers get the honest `duplicate` answer instead of an exception.
 *
 * WHY THIS IS SOURCE AND NOT AN ENV FILE. A deployment that forgets the
 * parameter is a deployment that 500s under load, and "remember to add a query
 * string" is not a safety mechanism. An operator who genuinely wants a
 * different pool still wins: an explicit `connection_limit` in the URL is never
 * overridden.
 *
 * SQLITE ONLY. Postgres and MySQL benefit from a real pool, and nothing here
 * touches them.
 */

/** Does this URL name a SQLite file database? */
function isSqliteUrl(url: string): boolean {
  return url.startsWith("file:") || url.startsWith("sqlite:");
}

/**
 * The datasource URL the application should actually connect with.
 *
 * Returns the input unchanged for every non-SQLite URL, for a SQLite URL that
 * already states a `connection_limit`, and for an absent or unparseable value —
 * this function exists to add one safe default, never to reinterpret an
 * operator's configuration.
 */
export function resolveDatasourceUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  if (!isSqliteUrl(raw)) return raw;

  const [base, query = ""] = raw.split("?", 2);
  const params = new URLSearchParams(query);

  if (params.has("connection_limit")) return raw;

  params.set("connection_limit", "1");
  return `${base}?${params.toString()}`;
}
