"use client";

import * as React from "react";
import type { AuditRecordView, CrmDataProvider, GetAuditRecordsInput } from "@/data/contracts/CrmDataProvider";
import type { Paginated, Result } from "@/data/contracts/result";
import { getCrmDataProvider } from "@/application/provider";
import { contextFromSession } from "@/application/context";
import { readDemoState, type DemoDataState } from "@/config/demo-state";
import { useSession } from "@/components/crm-shell/session-context";

/** Page size for the Audit Workspace (contract §6). */
export const AUDIT_PAGE_SIZE = 20;

export interface UseAuditQuery {
  result: Result<Paginated<AuditRecordView>> | null;
  loading: boolean;
  pageIndex: number;
  setPageIndex: (i: number) => void;
  retry: () => void;
}

/**
 * Owns the Audit Workspace query and calls the CrmDataProvider — never the
 * overlay or fixtures directly. Permission (`canViewAudit`), projection and
 * ordering are the provider's; this only carries the page and the read state.
 *
 * `providerOverride` exists for tests; production uses getCrmDataProvider(). The
 * dev-only data-state switch is read after mount (never during render), exactly as
 * Today does, so the server's HTML and the first client render agree.
 */
export function useAuditQuery(providerOverride?: CrmDataProvider): UseAuditQuery {
  const { session } = useSession();

  const [demoState, setDemoState] = React.useState<DemoDataState>("default");
  React.useEffect(() => setDemoState(readDemoState()), []);

  const provider = React.useMemo(
    () => providerOverride ?? getCrmDataProvider(demoState),
    [providerOverride, demoState],
  );

  const [pageIndex, setPageIndexState] = React.useState(0);
  const [result, setResult] = React.useState<Result<Paginated<AuditRecordView>> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);

  // A role switch returns to the first page: the record set the new role may see
  // is different, and a stale page cursor could point past its end.
  const roleRef = React.useRef(session.role);
  React.useEffect(() => {
    if (roleRef.current !== session.role) {
      roleRef.current = session.role;
      setPageIndexState(0);
    }
  }, [session.role]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const input: GetAuditRecordsInput = {
      page: {
        cursor: pageIndex > 0 ? String(pageIndex * AUDIT_PAGE_SIZE) : null,
        pageSize: AUDIT_PAGE_SIZE,
      },
    };
    provider.getAuditRecords(contextFromSession(session), input).then((res) => {
      if (cancelled) return;
      setResult(res);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [provider, session, pageIndex, nonce]);

  const setPageIndex = React.useCallback((i: number) => {
    setPageIndexState(Math.max(0, i));
  }, []);

  return {
    result,
    loading,
    pageIndex,
    setPageIndex,
    retry: () => setNonce((n) => n + 1),
  };
}
