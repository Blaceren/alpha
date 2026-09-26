"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminActionBar, AdminInput, AdminPageHeader, AdminSection, AdminShell, StatusBadge } from "@/components/admin-ui";
import { csrfFetch } from "@/lib/api";

type ModerationData = {
  rules: Array<{ id: number; value: string; isActive: boolean }>;
  mutes: Array<{ id: number; userId: number; reason: string; expiresAt: string | null; user: { name: string; email: string } }>;
  messages: Array<{ id: number; userId: number | null; userName: string; message: string; channelId: number | null }>;
  logs: Array<{ id: number; action: string; reason: string | null; createdAt: string }>;
};

const emptyData: ModerationData = { rules: [], mutes: [], messages: [], logs: [] };

export function ChatModerationPanel() {
  const [data, setData] = useState(emptyData);
  const [rule, setRule] = useState("");
  const [muteUserId, setMuteUserId] = useState("");
  const [muteReason, setMuteReason] = useState("");
  const [duration, setDuration] = useState("60");
  const [assignmentUserId, setAssignmentUserId] = useState("");
  const [assignmentChannelId, setAssignmentChannelId] = useState("");
  const [assignmentRole, setAssignmentRole] = useState<"mentor" | "moderator">("moderator");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/chat-moderation", { cache: "no-store" });
    if (response.ok) setData((await response.json()) as ModerationData);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function mutate(body: unknown) {
    setStatus("Saving...");
    const response = await csrfFetch("/api/admin/chat-moderation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setStatus(response.ok ? "Saved" : "Action failed");
    if (response.ok) await load();
  }

  async function remove(type: "rule" | "mute", id: number) {
    const response = await csrfFetch(`/api/admin/chat-moderation?type=${type}&id=${id}`, { method: "DELETE" });
    setStatus(response.ok ? "Removed" : "Action failed");
    if (response.ok) await load();
  }

  return (
    <AdminShell>
      <AdminPageHeader title="Chat moderation" description="Stop words, temporary or permanent mutes, and message visibility." breadcrumbs={[{ href: "/admin", label: "Admin" }, { label: "Chat moderation" }]} />
      {status ? <p className="text-sm text-[var(--text-secondary)]">{status}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <AdminSection>
          <h2 className="section-title">Stop words</h2>
          <AdminActionBar className="mt-3"><AdminInput value={rule} onChange={(event) => setRule(event.target.value)} placeholder="New stop word" /><button className="btn btn-primary" type="button" disabled={!rule.trim()} onClick={() => { mutate({ action: "rule.create", value: rule }); setRule(""); }}>Add</button></AdminActionBar>
          <ul className="mt-4 space-y-2">{data.rules.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] p-3"><span>{item.value}</span><AdminActionBar><StatusBadge value={item.isActive ? "active" : "disabled"} /><button type="button" className="btn btn-secondary" onClick={() => mutate({ action: "rule.toggle", id: item.id, isActive: !item.isActive })}>{item.isActive ? "Disable" : "Enable"}</button><button type="button" className="btn btn-ghost" onClick={() => remove("rule", item.id)}>Delete</button></AdminActionBar></li>)}</ul>
        </AdminSection>
        <AdminSection>
          <h2 className="section-title">Mute user</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3"><AdminInput value={muteUserId} onChange={(event) => setMuteUserId(event.target.value)} inputMode="numeric" placeholder="User ID" /><AdminInput value={duration} onChange={(event) => setDuration(event.target.value)} inputMode="numeric" placeholder="Minutes, blank = permanent" /><AdminInput value={muteReason} onChange={(event) => setMuteReason(event.target.value)} placeholder="Reason" /></div>
          <button type="button" className="btn btn-primary mt-3" disabled={!muteUserId || !muteReason} onClick={() => mutate({ action: "mute.create", userId: Number(muteUserId), reason: muteReason, durationMinutes: duration ? Number(duration) : null })}>Mute</button>
          <ul className="mt-4 space-y-2">{data.mutes.map((mute) => <li key={mute.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-3 text-sm"><span><strong>{mute.user.name}</strong> #{mute.userId}<br />{mute.reason} / {mute.expiresAt ? new Date(mute.expiresAt).toLocaleString("ru-RU") : "permanent"}</span><button type="button" className="btn btn-secondary" onClick={() => remove("mute", mute.id)}>Unmute</button></li>)}</ul>
        </AdminSection>
      </div>
      <AdminSection>
        <h2 className="section-title">Channel assignment</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <AdminInput value={assignmentUserId} onChange={(event) => setAssignmentUserId(event.target.value)} inputMode="numeric" placeholder="User ID" />
          <AdminInput value={assignmentChannelId} onChange={(event) => setAssignmentChannelId(event.target.value)} inputMode="numeric" placeholder="Channel ID" />
          <select className="form-input" value={assignmentRole} onChange={(event) => setAssignmentRole(event.target.value as "mentor" | "moderator")}><option value="moderator">moderator</option><option value="mentor">mentor</option></select>
          <button type="button" className="btn btn-primary" disabled={!assignmentUserId || !assignmentChannelId} onClick={() => mutate({ action: "assignment.create", userId: Number(assignmentUserId), channelId: Number(assignmentChannelId), role: assignmentRole })}>Assign</button>
        </div>
      </AdminSection>
      <AdminSection>
        <h2 className="section-title">Recent visible messages</h2>
        <div className="mt-3 space-y-2">{data.messages.map((message) => <div key={message.id} className="flex flex-col justify-between gap-3 rounded-lg border border-[var(--border)] p-3 sm:flex-row sm:items-center"><div className="min-w-0"><strong>{message.userName}</strong> <span className="text-xs text-[var(--text-muted)]">#{message.userId ?? "-"}</span><p className="break-words text-sm text-[var(--text-secondary)]">{message.message}</p></div><button type="button" className="btn btn-secondary" onClick={() => mutate({ action: "message.hide", messageId: message.id, reason: "Hidden from moderation panel" })}>Hide</button></div>)}</div>
      </AdminSection>
    </AdminShell>
  );
}
