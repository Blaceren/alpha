/**
 * PREPROD ACTIVATION AUTHORIZATION — the capability, and why it cannot be forged.
 *
 * WHAT THE INDEPENDENT AUDIT FOUND. The first implementation described a grant
 * as a TYPE and let the protected-database guard authenticate it from its own
 * public fields: a `kind` string, a path, a device and an inode — all of which
 * any caller can read with `stat(2)` — and then called a method the caller had
 * supplied, named `assertStillValid`, as the final proof. An object literal of
 * eight lines therefore carried full authority, and the audit demonstrated the
 * real structural importer writing a protected database with one.
 *
 * The mistake was treating a SHAPE as an IDENTITY. Anything a caller can
 * describe, a caller can construct.
 *
 * WHAT THIS MODULE DOES INSTEAD. Authority lives in a module-private `WeakMap`
 * that nothing outside this file can reach. A grant handle is an opaque, frozen
 * object whose public fields are labels for humans and carry no power at all;
 * the claims that decide anything are stored in the registry, keyed by that
 * object's IDENTITY. Verification looks the handle up. A copy, a clone, a
 * serialisation round-trip, a class instance or a hand-built literal is a
 * different object, so it is not in the map, so it is refused — not because its
 * fields are wrong but because it was never issued.
 *
 * WHY ISSUANCE IS NOT EXPORTED. `issueActivationGrant` is deliberately absent
 * from this module's public surface. The only way to add an entry to the
 * registry is `runWithGrantIssuer`, which takes a callback and hands it an
 * issuer that is discarded the moment the callback returns. `authorize.ts` is
 * the single caller, and it calls it only after every precondition has held. An
 * in-repo caller that imports this module gets the verifier and the types; there
 * is no exported function that mints authority without doing the work.
 *
 * WHY THE REVALIDATION CLOSURE IS STORED, NOT PASSED. The guard must re-read the
 * live target immediately before the connection is opened — that is the whole
 * TOCTOU narrowing. It now calls a closure held INSIDE the registry entry, built
 * by the authorization code from its own measurements. The caller cannot supply
 * it, cannot replace it, and cannot observe it.
 *
 * THREAT MODEL, UNCHANGED AND STATED PLAINLY. This defends against operator
 * error and against ordinary in-repo code reaching a protected database by
 * accident or by shortcut. It does not defend against a hostile operator with
 * root, who can open the SQLite file directly, nor against code that edits this
 * file. Those were never in scope and pretending otherwise would buy complexity
 * with no security.
 */
import { PreprodActivationError } from "./errors";
import type { AuthorizedOperation, ActivationStage } from "./stages";

/**
 * The public handle.
 *
 * Everything on it is descriptive. `activationId` and `stage` are here so an
 * activation record and a log line can say what happened; NONE of these fields
 * is consulted when authority is checked. Reading them proves nothing and
 * setting them grants nothing.
 */
export type PreprodActivationGrant = {
  readonly kind: "preprod-activation";
  readonly activationId: string;
  readonly manifestSha256: string;
  readonly operation: AuthorizedOperation;
  readonly stage: ActivationStage;
  readonly target: {
    readonly absolutePath: string;
    readonly device: number;
    readonly inode: number;
  };
};

/**
 * The claims that actually decide, held where no caller can reach them.
 *
 * `revalidate` is built by the authorization module from state it measured
 * itself. It re-reads the live target and throws if anything it pinned has moved.
 */
type GrantClaims = {
  activationId: string;
  manifestSha256: string;
  operation: AuthorizedOperation;
  stage: ActivationStage;
  targetPath: string;
  targetDevice: number;
  targetInode: number;
  revalidate: () => void;
};

/**
 * THE REGISTRY.
 *
 * Module-private and never exported, not even indirectly. A `WeakMap` keyed by
 * the handle means a grant that goes out of scope is collected with it, and — the
 * point — that membership is a fact about object identity rather than about
 * anything observable on the object.
 */
const ISSUED = new WeakMap<PreprodActivationGrant, GrantClaims>();

export type GrantIssuer = (claims: GrantClaims) => PreprodActivationGrant;

/**
 * Run `body` with the ability to issue exactly the grants it needs, then take it
 * away.
 *
 * The issuer is a closure created per call and revoked when the call returns, so
 * a reference captured out of the callback is inert afterwards. This is what
 * replaces an exported `issueGrant()`: there is no name an unrelated module can
 * import to obtain authority, and the only import site is `authorize.ts`.
 */
export function runWithGrantIssuer<T>(body: (issue: GrantIssuer) => T): T {
  let live = true;
  const issue: GrantIssuer = (claims) => {
    if (!live) {
      throw new PreprodActivationError(
        "GRANT_NOT_AUTHENTIC",
        "the grant issuer was used after the authorization that created it returned. A capability may only be minted inside the authorization that justifies it.",
      );
    }
    const handle: PreprodActivationGrant = Object.freeze({
      kind: "preprod-activation" as const,
      activationId: claims.activationId,
      manifestSha256: claims.manifestSha256,
      operation: claims.operation,
      stage: claims.stage,
      target: Object.freeze({
        absolutePath: claims.targetPath,
        device: claims.targetDevice,
        inode: claims.targetInode,
      }),
    });
    ISSUED.set(handle, { ...claims });
    return handle;
  };
  try {
    return body(issue);
  } finally {
    live = false;
  }
}

export type ExpectedGrantTarget = {
  absolutePath: string;
  device: number;
  inode: number;
};

/**
 * Verify a capability and return what it actually authorizes.
 *
 * Called by the protected-database guard. Every comparison below is against the
 * REGISTRY entry, never against the handle's own fields, so a caller that
 * rewrites the handle changes nothing that matters. The registry lookup comes
 * first: a value that was not issued here is refused before anything about it is
 * examined.
 *
 * The final `revalidate()` is the issuer's own closure. It re-reads the live
 * database at the last possible moment, which is what turns "all of this was
 * true when the manifest was checked" into "all of this is true now".
 */
export function assertAuthenticActivationGrant(
  candidate: unknown,
  expectedTarget: ExpectedGrantTarget,
  expectedOperation: AuthorizedOperation,
): GrantClaims {
  const claims =
    candidate !== null && typeof candidate === "object"
      ? ISSUED.get(candidate as PreprodActivationGrant)
      : undefined;

  if (!claims) {
    throw new PreprodActivationError(
      "GRANT_NOT_AUTHENTIC",
      "the value offered as an activation grant was not issued by this process's authorization module. A grant is a runtime capability, not a shape: copies, clones, serialisations and hand-built objects carry no authority.",
      { expected: "a capability issued by assertPreprodActivationAuthorization", actual: "an unissued value" },
    );
  }

  if (claims.operation !== expectedOperation) {
    throw new PreprodActivationError(
      "GRANT_OPERATION_MISMATCH",
      `this activation grant authorizes ${claims.operation}, not ${expectedOperation}. A grant is issued for exactly one operation and does not generalise to the other.`,
      { expected: expectedOperation, actual: claims.operation },
    );
  }

  if (claims.targetPath !== expectedTarget.absolutePath) {
    throw new PreprodActivationError(
      "GRANT_TARGET_MISMATCH",
      `this activation grant authorizes ${claims.targetPath}, not ${expectedTarget.absolutePath}`,
      { expected: claims.targetPath, actual: expectedTarget.absolutePath },
    );
  }

  if (claims.targetDevice !== expectedTarget.device || claims.targetInode !== expectedTarget.inode) {
    throw new PreprodActivationError(
      "GRANT_TARGET_MISMATCH",
      `this activation grant was issued against device ${claims.targetDevice}, inode ${claims.targetInode}; the file at that path is now device ${expectedTarget.device}, inode ${expectedTarget.inode}`,
      {
        expected: `${claims.targetDevice}:${claims.targetInode}`,
        actual: `${expectedTarget.device}:${expectedTarget.inode}`,
      },
    );
  }

  claims.revalidate();
  return claims;
}

/** Is this value a capability this process issued? Diagnostics and tests only. */
export function isAuthenticActivationGrant(candidate: unknown): boolean {
  if (candidate === null || typeof candidate !== "object") return false;
  return ISSUED.has(candidate as PreprodActivationGrant);
}
