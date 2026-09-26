"use client";

import { useMemo, useState } from "react";
import {
  AdminFilters,
  AdminInput,
  AdminPageHeader,
  AdminSection,
  AdminSelect,
  AdminShell,
  AdminTable,
  JsonPreview,
  MetadataPanel,
  StatusBadge,
} from "@/components/admin-ui";
import type { MockCohort } from "@/data/mockCohorts";
import type { MockCrmUser } from "@/data/mockCrmUsers";

type CrmDashboardProps = {
  cohorts: MockCohort[];
  users: MockCrmUser[];
};

export function CrmDashboard({ cohorts, users }: CrmDashboardProps) {
  const [selectedCohort, setSelectedCohort] = useState("all");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [checkpointFilter, setCheckpointFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("");
  const [browserFilter, setBrowserFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return users.filter((user) => {
      if (selectedCohort !== "all" && user.cohort !== selectedCohort) return false;
      if (statusFilter !== "all" && user.status !== statusFilter) return false;
      if (checkpointFilter !== "all" && user.checkpointStatus !== checkpointFilter) return false;
      if (eventFilter !== "all" && !user.postbackEvents?.some((event) => event.eventType === eventFilter)) return false;
      if (levelFilter && user.level !== Number(levelFilter)) return false;
      if (countryFilter && String(user.attribution?.country ?? "").toLowerCase() !== countryFilter.toLowerCase()) return false;
      if (deviceFilter && String(user.attribution?.device_type ?? "").toLowerCase() !== deviceFilter.toLowerCase()) return false;
      if (browserFilter && String(user.attribution?.browser ?? "").toLowerCase() !== browserFilter.toLowerCase()) return false;
      if (sourceFilter && ![user.attribution?.site_id, user.attribution?.cid, user.attribution?.ac, user.attribution?.sub_id1, user.attribution?.promo].some((value) => String(value ?? "").toLowerCase().includes(sourceFilter.toLowerCase()))) return false;
      if (!normalizedQuery) return true;
      return [user.name, user.email, user.traderId, user.clickId]
        .some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
    });
  }, [browserFilter, checkpointFilter, countryFilter, deviceFilter, eventFilter, levelFilter, query, selectedCohort, sourceFilter, statusFilter, users]);

  const cohortIds = useMemo(() => Array.from(new Set([...cohorts.map((cohort) => cohort.id), ...users.map((user) => user.cohort)])), [cohorts, users]);

  function getCohortTitle(cohortId: string) {
    return cohorts.find((cohort) => cohort.id === cohortId)?.title ?? cohortId;
  }

  return (
    <AdminShell>
      <AdminPageHeader
        title="CRM / cohorts"
        description="Existing internal cohort and attribution surface."
        breadcrumbs={[{ href: "/admin", label: "Admin" }, { label: "CRM" }]}
      />

      <div className="grid gap-4 md:grid-cols-2">
        {cohorts.map((cohort) => (
          <AdminSection key={cohort.id}>
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-bold text-[var(--text-primary)]">{cohort.title}</h2>
              <StatusBadge value={`${cohort.usersCount} users`} />
            </div>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{cohort.description}</p>
            <div className="mt-3 grid gap-2 text-sm text-[var(--text-secondary)]">
              <p><span className="font-bold text-[var(--text-primary)]">Conditions:</span> {cohort.conditions}</p>
              <p><span className="font-bold text-[var(--text-primary)]">Action:</span> {cohort.action}</p>
            </div>
          </AdminSection>
        ))}
      </div>

      <AdminFilters>
        <label className="min-w-56 flex-[2] text-sm font-semibold text-[var(--text-secondary)]">
          Search
          <AdminInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Email, name, trader_id, click_id" />
        </label>
        <label className="min-w-56 flex-1 text-sm font-semibold text-[var(--text-secondary)]">
          Cohort
          <AdminSelect
            value={selectedCohort}
            onChange={(event) => setSelectedCohort(event.target.value)}
          >
            <option value="all">All cohorts</option>
            {cohortIds.map((cohortId) => (
              <option key={cohortId} value={cohortId}>
                {getCohortTitle(cohortId)}
              </option>
            ))}
          </AdminSelect>
        </label>
        <label className="min-w-32 text-sm font-semibold text-[var(--text-secondary)]">Level<AdminInput value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)} inputMode="numeric" placeholder="Any" /></label>
        <label className="min-w-36 text-sm font-semibold text-[var(--text-secondary)]">Source / campaign<AdminInput value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} placeholder="site/cid/sub/promo" /></label>
        <label className="min-w-28 text-sm font-semibold text-[var(--text-secondary)]">Country<AdminInput value={countryFilter} onChange={(event) => setCountryFilter(event.target.value)} placeholder="RU" /></label>
        <label className="min-w-28 text-sm font-semibold text-[var(--text-secondary)]">Device<AdminInput value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)} placeholder="desktop" /></label>
        <label className="min-w-28 text-sm font-semibold text-[var(--text-secondary)]">Browser<AdminInput value={browserFilter} onChange={(event) => setBrowserFilter(event.target.value)} placeholder="Chrome" /></label>
        <label className="min-w-40 text-sm font-semibold text-[var(--text-secondary)]">
          Status
          <AdminSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="blocked">Blocked</option>
          </AdminSelect>
        </label>
        <label className="min-w-44 text-sm font-semibold text-[var(--text-secondary)]">
          Checkpoint
          <AdminSelect value={checkpointFilter} onChange={(event) => setCheckpointFilter(event.target.value)}>
            <option value="all">All checkpoints</option>
            <option value="completed">Completed</option>
            <option value="frozen">Frozen</option>
            <option value="pending">Pending</option>
            <option value="none">None</option>
          </AdminSelect>
        </label>
        <label className="min-w-44 text-sm font-semibold text-[var(--text-secondary)]">
          Postback event
          <AdminSelect value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}>
            <option value="all">All events</option>
            <option value="registration">Registration</option>
            <option value="first_deposit">First Deposit</option>
            <option value="redeposit">Re-deposit</option>
            <option value="withdrawal">Withdrawal</option>
            <option value="commission">Commission</option>
          </AdminSelect>
        </label>
        <StatusBadge value={`${filteredUsers.length} users`} />
      </AdminFilters>

      <AdminTable>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Level</th>
            <th>Step</th>
            <th>Deposit</th>
            <th>Balance</th>
            <th>Last active</th>
            <th>Cohort</th>
          </tr>
        </thead>
        <tbody>
          {filteredUsers.map((user) => (
            <tr key={user.id}>
              <td className="font-bold text-[var(--text-primary)]"><button type="button" className="text-left hover:text-[var(--primary)]" onClick={() => setSelectedUserId((current) => current === user.id ? null : user.id)}>{user.name}</button></td>
              <td>{user.email}</td>
              <td>{user.level}</td>
              <td>{user.currentStep}</td>
              <td><StatusBadge value={user.depositStatus} /></td>
              <td>${user.balance}</td>
              <td>{user.lastActiveAt}</td>
              <td>{getCohortTitle(user.cohort)}</td>
            </tr>
          ))}
        </tbody>
      </AdminTable>

      {selectedUserId ? (() => {
        const selected = users.find((user) => user.id === selectedUserId);
        if (!selected) return null;
        return (
          <AdminSection>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="section-title">Lead detail: {selected.name}</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">{selected.email}</p></div>
              <StatusBadge value={selected.cohort} />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <MetadataPanel>Level {selected.level} / {selected.xp ?? 0} XP<br />Step: {selected.currentStep}</MetadataPanel>
              <MetadataPanel>Registration: {String(selected.registrationStatus)}<br />Email: {String(selected.emailConfirmed)}<br />First deposit: {String(selected.firstDepositConfirmed)}</MetadataPanel>
              <MetadataPanel>Deposits: ${selected.totalDeposits ?? 0}<br />Withdrawals: ${selected.totalWithdrawals ?? 0}<br />Commission: ${selected.totalCommission ?? 0}</MetadataPanel>
              <MetadataPanel>trader_id: {selected.traderId ?? "-"}<br />click_id: {selected.clickId ?? "-"}<br />Checkpoint: {selected.checkpointStatus ?? "-"}</MetadataPanel>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div><h3 className="mb-2 font-bold text-[var(--text-primary)]">Attribution</h3><JsonPreview value={selected.attribution ?? {}} /></div>
              <div><h3 className="mb-2 font-bold text-[var(--text-primary)]">Postback history</h3><JsonPreview value={selected.postbackEvents ?? []} /></div>
            </div>
          </AdminSection>
        );
      })() : null}

    </AdminShell>
  );
}
