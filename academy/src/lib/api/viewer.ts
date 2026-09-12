/**
 * Academy viewer DTO — the narrow, display-safe identity the learner UI sees.
 *
 * The Backend session returns more than the learner UI needs (email, level,
 * xp, internal status). We map only what an authenticated shell requires:
 *   - a stable id (stringified, opaque to the UI);
 *   - a display-safe name;
 *   - the account role;
 *   - the account status when present.
 *
 * Null semantics:
 *   - A session response of `{ user: null }` yields NO viewer (unauthenticated);
 *     `toAcademyViewer` is only called with a present user.
 *   - `status` is `null` when the Backend omits it.
 *   - `level`/`xp` are deliberately absent: progression is Backend authority
 *     (CI-1 does not read or expose it), and nothing here may be treated as an
 *     authoritative progression fact.
 */
import type { BackendPublicUser } from "@/lib/api/types";

export type AcademyViewer = {
  id: string;
  name: string;
  role: string;
  status: string | null;
  /** Marks a synthetic fixture-mode viewer so it can never be mistaken for a real session. */
  synthetic: boolean;
};

export function toAcademyViewer(user: BackendPublicUser): AcademyViewer {
  return {
    id: String(user.id),
    name: user.name,
    role: user.role,
    status: user.status ?? null,
    synthetic: false,
  };
}

/** The clearly-synthetic viewer used only in explicit fixture mode. */
export const FIXTURE_VIEWER: AcademyViewer = {
  id: "fixture-user",
  name: "Артём",
  role: "user",
  status: "active",
  synthetic: true,
};
