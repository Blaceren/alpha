/**
 * Permission-aware identity projection (Phase 1B1 §11). Prepares contracts +
 * projection only — the real PII reveal flow is NOT implemented here.
 * Users list always uses masked email regardless of role.
 */
import type { CrmRole } from "@/domain/identity/roles";
import { canViewIdentity } from "@/domain/identity/access";

export type IdentityProjectionMode = "full" | "masked" | "pseudonymous" | "hidden";

export interface IdentityProjection {
  mode: IdentityProjectionMode;
  displayName: string | null;
  email: string | null;
  /** Opaque pseudonymous id for analyst-style views. */
  pseudonymId: string | null;
}

export interface ProjectIdentityInput {
  role: CrmRole;
  userId: string;
  displayName: string;
  maskedEmail: string;
  fullEmail: string;
  /** In lists we force masked even for privileged roles (reveal is per-record). */
  context: "list" | "detail";
}

export function projectIdentity(input: ProjectIdentityInput): IdentityProjection {
  const { role, userId, displayName, maskedEmail, fullEmail, context } = input;

  if (role === "analyst") {
    return { mode: "pseudonymous", displayName: null, email: null, pseudonymId: pseudonym(userId) };
  }
  if (role === "content_manager") {
    return { mode: "hidden", displayName: null, email: null, pseudonymId: null };
  }
  if (role === "moderator") {
    // Display name + platform id, no email.
    return { mode: "masked", displayName, email: null, pseudonymId: userId };
  }

  // Full email is only ever shown in the detail context, and only for permitted
  // roles. Lists are always masked. Support requires a separate grant (not modeled).
  if (context === "detail" && canViewIdentity(role)) {
    return { mode: "full", displayName, email: fullEmail, pseudonymId: null };
  }

  return { mode: "masked", displayName, email: maskedEmail, pseudonymId: null };
}

function pseudonym(userId: string): string {
  // Deterministic opaque id derived from the synthetic user id.
  return `anon_${userId.slice(-3)}`;
}
