"use client";

import { useEffect, useState } from "react";
import { AdminPageHeader, AdminShell, AdminTable, JsonPreview, StatusBadge } from "@/components/admin-ui";
import { ProtectedPage } from "@/components/ProtectedPage";

type AuditLogUser = {
  id: number;
  name: string;
  email: string;
  role: string;
} | null;

type AuditLogItem = {
  id: number;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  user: AuditLogUser;
};

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [status, setStatus] = useState("Loading...");
  const [filters, setFilters] = useState({ action: "", userId: "", role: "", entityType: "", entityId: "", dateFrom: "", dateTo: "", limit: "100" });
  const [reload, setReload] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function loadLogs() {
      const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
      const response = await fetch(`/api/admin/audit-logs?${query.toString()}`);

      if (!response.ok) {
        if (isMounted) {
          setStatus("Could not load audit logs");
        }
        return;
      }

      const result = (await response.json()) as { logs: AuditLogItem[]; total: number };

      if (isMounted) {
        setLogs(result.logs);
        setTotal(result.total);
        setStatus("");
      }
    }

    loadLogs();

    return () => {
      isMounted = false;
    };
  }, [filters, reload]);

  return (
    <ProtectedPage allowedRoles={["admin"]}>
      <AdminShell>
        <AdminPageHeader
          title="Audit logs"
          description={`Системные и staff-события: показано ${logs.length} из ${total}.`}
          breadcrumbs={[{ href: "/admin", label: "Admin" }, { label: "Audit logs" }]}
        />

        {status ? <p className="text-sm text-[var(--text-secondary)]">{status}</p> : null}

        <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-4">
          <input className="form-input" placeholder="Event type" value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })} />
          <input className="form-input" placeholder="User ID" inputMode="numeric" value={filters.userId} onChange={(event) => setFilters({ ...filters, userId: event.target.value })} />
          <select className="form-input" value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value })}><option value="">Все роли</option>{["user","admin","support","mentor","moderator","news_editor"].map((value) => <option key={value}>{value}</option>)}</select>
          <input className="form-input" placeholder="Entity type" value={filters.entityType} onChange={(event) => setFilters({ ...filters, entityType: event.target.value })} />
          <input className="form-input" placeholder="Entity ID" value={filters.entityId} onChange={(event) => setFilters({ ...filters, entityId: event.target.value })} />
          <input className="form-input" type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} />
          <input className="form-input" type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} />
          <select className="form-input" value={filters.limit} onChange={(event) => setFilters({ ...filters, limit: event.target.value })}>{["100","500","1000","all"].map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <button type="button" className="btn btn-primary" onClick={() => setReload((value) => value + 1)}>Применить</button>
        </div>

        <AdminTable>
          <thead>
            <tr>
              <th>Date</th>
              <th>User</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Metadata</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.createdAt).toLocaleString("ru-RU")}</td>
                <td>
                  <div className="font-bold text-[var(--text-primary)]">
                    {log.user ? log.user.name : "System"}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">{log.user?.email ?? "-"}</div>
                </td>
                <td><StatusBadge value={log.action} /></td>
                <td>{[log.entityType, log.entityId].filter(Boolean).join(" #") || "-"}</td>
                <td><JsonPreview value={log.metadata} /></td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      </AdminShell>
    </ProtectedPage>
  );
}
