/**
 * G4-R7 — prove the two repositories carry the SAME session permission contract.
 *
 * WHY A SCRIPT AND NOT A TEST. The invariant is cross-repository, and neither
 * repository's test runner can see the other one. The backend's
 * `session-permission-contract.test.ts` catches the moment a permission is
 * ADDED; this catches the moment the two copies DIVERGE, which is a different
 * event and the one that actually bit — the backend was internally consistent
 * the entire time the CRM was broken.
 *
 * Run it wherever both checkouts exist: a release pipeline, a cutover
 * pre-flight, or by hand before publishing a CRM release.
 *
 *   npx tsx scripts/ops/verifyCrmSessionPermissionContract.ts <path-to-crm-repo>
 *
 * Exits 0 only when the two files are byte-identical AND the declared digest
 * matches the list they both declare. Any other outcome exits 1 and says which
 * of those two things failed.
 *
 * It reads two files and writes nothing. It creates no directory, deletes
 * nothing and takes no lock.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const BACKEND_CONTRACT = "src/lib/crm/session-permission-contract.ts";
const CRM_CONTRACT = "src/domain/identity/crm-session-permission-contract.ts";

function fail(message: string): never {
  process.stderr.write(`verifyCrmSessionPermissionContract: FAILED: ${message}\n`);
  process.exit(1);
}

function read(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return fail(`cannot read ${file}`);
  }
}

/** The declared vocabulary, parsed out of the contract source. */
function parseContract(source: string, file: string): { names: string[]; digest: string } {
  const listStart = source.indexOf("export const CRM_SESSION_PERMISSION_CONTRACT = [");
  if (listStart === -1) fail(`${file} declares no CRM_SESSION_PERMISSION_CONTRACT`);
  const listEnd = source.indexOf("] as const;", listStart);
  if (listEnd === -1) fail(`${file} has an unterminated CRM_SESSION_PERMISSION_CONTRACT`);
  const body = source.slice(listStart, listEnd);
  const names = [...body.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
  if (names.length === 0) fail(`${file} declares an empty vocabulary`);

  const digestMatch = source.match(
    /CRM_SESSION_PERMISSION_CONTRACT_DIGEST\s*=\s*\n?\s*"([0-9a-f]{64})"/,
  );
  if (!digestMatch) fail(`${file} declares no CRM_SESSION_PERMISSION_CONTRACT_DIGEST`);
  return { names, digest: digestMatch[1]! };
}

const crmRepo = process.argv[2];
if (!crmRepo) {
  fail("usage: verifyCrmSessionPermissionContract.ts <path-to-crm-repo>");
}

const backendFile = path.resolve(process.cwd(), BACKEND_CONTRACT);
const crmFile = path.resolve(crmRepo, CRM_CONTRACT);

const backendSource = read(backendFile);
const crmSource = read(crmFile);

const backendSha = createHash("sha256").update(backendSource).digest("hex");
const crmSha = createHash("sha256").update(crmSource).digest("hex");

process.stdout.write(`backend contract : ${backendFile}\n  sha256 ${backendSha}\n`);
process.stdout.write(`crm     contract : ${crmFile}\n  sha256 ${crmSha}\n`);

if (backendSha !== crmSha) {
  fail(
    "the two contract files are NOT byte-identical.\n" +
      "  The repositories are running different session permission vocabularies,\n" +
      "  which is the G4-R7 condition. Copy the backend file verbatim to the CRM\n" +
      "  path above and re-run both test suites.",
  );
}

const backend = parseContract(backendSource, backendFile);
const recomputed = createHash("sha256").update(backend.names.join("\n")).digest("hex");

process.stdout.write(`vocabulary       : ${backend.names.length} permissions\n`);
process.stdout.write(`declared digest  : ${backend.digest}\n`);
process.stdout.write(`recomputed digest: ${recomputed}\n`);

if (recomputed !== backend.digest) {
  fail(
    "the declared digest does not match the declared vocabulary.\n" +
      `  Set CRM_SESSION_PERMISSION_CONTRACT_DIGEST to ${recomputed} in BOTH copies.`,
  );
}

process.stdout.write("OK — both repositories carry the same verified contract.\n");
