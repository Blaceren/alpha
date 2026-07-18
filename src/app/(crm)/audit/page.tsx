import { AuditWorkspace } from "@/features/audit/audit-workspace";

/**
 * Global Audit Workspace (Phase 1B5-B). A read-only ledger of the browser-local
 * mutation-overlay audit records, gated by `canViewAudit`. Data comes only via the
 * CrmDataProvider — never the overlay or fixtures directly.
 */
export default function AuditPage() {
  return <AuditWorkspace />;
}
