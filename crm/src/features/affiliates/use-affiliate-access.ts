"use client";

import { useSession } from "@/components/crm-shell/session-context";
import { sessionGrants } from "@/domain/identity/access";

/**
 * AFD-5A — the CRM's view of what this operator may do with affiliates.
 *
 * Both answers come from `session.effectivePermissions`, which is the BACKEND's
 * answer, never a recomputation from the role. A backend that says
 * `role=crm_admin, effectivePermissions=[]` therefore grants nothing here.
 *
 * THIS IS NOT THE SECURITY BOUNDARY. `canManage` decides whether a button is
 * rendered; the backend decides whether a mutation succeeds, and answers 403
 * regardless of what this hook returned. Hiding controls is how the UI stays
 * honest about what an operator can do — not how access is enforced.
 */
export interface AffiliateAccess {
  /** May open the section and read the inventory. */
  canRead: boolean;
  /** May create, edit and change status. Requires `manage_settings`. */
  canManage: boolean;
  /** Read access without management — the analyst contract. */
  readOnly: boolean;
}

export function useAffiliateAccess(): AffiliateAccess {
  const { session } = useSession();
  const canManage = sessionGrants(session, "manage_settings");
  const canRead = canManage || sessionGrants(session, "view_affiliate_analytics");
  return { canRead, canManage, readOnly: canRead && !canManage };
}
