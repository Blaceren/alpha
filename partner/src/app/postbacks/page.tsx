"use client";

/**
 * §26/§27/§30 — outbound postback configuration and the delivery ledger.
 *
 * THE SIGNING SECRET IS SHOWN ONCE AND SAID SO. When the API returns it, this
 * page displays it in a panel that states plainly it will not be shown again.
 * It is never written to local storage, never re-fetched, and disappears on the
 * next render — because the server has no route that would return it.
 *
 * THE DELIVERY LEDGER RENDERS THE PARTNER'S OWN SERVER'S RESPONSE AS TEXT.
 * React escapes it, and there is no `dangerouslySetInnerHTML` anywhere in this
 * application, so a receiver that answers with markup sees its own markup
 * quoted back rather than executed.
 */
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api, messageFor } from "@/lib/api";

type Endpoint = {
  endpointId: string;
  eventType: string;
  urlTemplate: string;
  version: number;
  status: string;
  secretVersion: number;
};

type Attempt = {
  attemptNumber: number;
  startedAt: string;
  outcome: string;
  httpStatus: number | null;
  durationMs: number;
  responseSnippet: string | null;
};

type Delivery = {
  deliveryId: string;
  conversionId: string;
  eventType: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  lastOutcome: string | null;
  lastHttpStatus: number | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  requestUrl: string;
  endpointVersion: number;
  attempts: Attempt[];
};

const EVENT_LABEL: Record<string, string> = {
  academy_registration: "REG",
  first_deposit: "DEP",
  redeposit: "RDEP",
};

const MACROS = [
  "{event}", "{click_id}", "{external_click_id}", "{sub1}", "{sub2}", "{sub3}",
  "{sub4}", "{sub5}", "{amount}", "{currency}", "{event_time}", "{conversion_id}",
  "{campaign}", "{link}",
];

export default function PostbacksPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[] | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [eventType, setEventType] = useState("first_deposit");
  const [urlTemplate, setUrlTemplate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ value: string; version: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const e = await api<{ rows: Endpoint[] }>("/api/partner/v1/postbacks");
    if (e.ok) setEndpoints(e.data.rows);
    const d = await api<{ rows: Delivery[] }>("/api/partner/v1/postbacks/deliveries");
    if (d.ok) setDeliveries(d.data.rows);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Shell>
      <h1>Postbacks</h1>
      <p className="sub">
        ATA sends a GET request to your URL for each conversion. Every delivery carries an
        <span className="mono"> x-ata-signature </span> header — an HMAC-SHA256 over the secret version,
        timestamp, delivery id and full URL.
      </p>

      <h2>Configure a destination</h2>
      <form
        className="card"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          setSecret(null);
          const result = await api<{ signingSecret?: string; secretVersion: number }>(
            "/api/partner/v1/postbacks",
            { method: "PUT", body: { eventType, urlTemplate } },
          );
          setBusy(false);
          if (result.ok) {
            if (result.data.signingSecret !== undefined) {
              setSecret({ value: result.data.signingSecret, version: result.data.secretVersion });
            }
            setUrlTemplate("");
            await load();
          } else setError(messageFor(result.messageKey));
        }}
      >
        <label htmlFor="event">Event</label>
        <select id="event" value={eventType} onChange={(e) => setEventType(e.target.value)}>
          <option value="academy_registration">REG — Academy registration</option>
          <option value="first_deposit">DEP — first Pocket deposit</option>
          <option value="redeposit">RDEP — later deposits (no commission)</option>
        </select>
        <label htmlFor="template">URL template (https only)</label>
        <input
          id="template"
          value={urlTemplate}
          onChange={(e) => setUrlTemplate(e.target.value)}
          placeholder="https://your-tracker.example.com/postback?cid={click_id}&amp;e={event}&amp;amt={amount}"
          required
        />
        <p className="sub" style={{ marginTop: 8 }}>
          Supported macros: <span className="mono">{MACROS.join(" ")}</span>. Anything else is
          rejected. The template must include <span className="mono">{"{click_id}"}</span> or{" "}
          <span className="mono">{"{external_click_id}"}</span>.
        </p>
        <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save destination"}</button>
        {error !== null ? <p className="err">{error}</p> : null}
        {secret !== null ? (
          <div className="reveal">
            <strong>Signing secret (version {secret.version})</strong>
            <p className="mono" style={{ wordBreak: "break-all", margin: "8px 0" }}>{secret.value}</p>
            <p className="sub" style={{ margin: 0 }}>
              Copy it now. It is shown once and cannot be retrieved again — you can only rotate it.
            </p>
          </div>
        ) : null}
      </form>

      <h2>Your destinations</h2>
      {endpoints === null ? (
        <p className="empty">Loading…</p>
      ) : endpoints.length === 0 ? (
        <p className="empty">No destinations configured.</p>
      ) : (
        <table>
          <thead><tr><th>Event</th><th>URL</th><th>Status</th><th>Version</th><th>Secret</th><th /></tr></thead>
          <tbody>
            {endpoints.map((endpoint) => (
              <tr key={endpoint.endpointId}>
                <td><span className="pill">{EVENT_LABEL[endpoint.eventType]}</span></td>
                <td className="mono" style={{ wordBreak: "break-all" }}>{endpoint.urlTemplate}</td>
                <td>{endpoint.status}</td>
                <td className="num">v{endpoint.version}</td>
                <td className="num">v{endpoint.secretVersion}</td>
                <td>
                  <button
                    className="ghost"
                    style={{ marginTop: 0 }}
                    onClick={async () => {
                      const result = await api<{ signingSecret: string; secretVersion: number }>(
                        "/api/partner/v1/postbacks/rotate-secret",
                        { method: "POST", body: { endpointId: endpoint.endpointId } },
                      );
                      if (result.ok) {
                        setSecret({ value: result.data.signingSecret, version: result.data.secretVersion });
                        await load();
                      }
                    }}
                  >
                    Rotate secret
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Delivery log</h2>
      {deliveries.length === 0 ? (
        <p className="empty">No deliveries yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Event</th><th>Status</th><th>Attempts</th><th>Last result</th>
              <th>Next retry</th><th>URL sent</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((delivery) => (
              <tr key={delivery.deliveryId}>
                <td><span className="pill">{EVENT_LABEL[delivery.eventType]}</span></td>
                <td>{delivery.status}</td>
                <td className="num">{delivery.attemptCount} / {delivery.maxAttempts}</td>
                <td>
                  {delivery.lastOutcome ?? "—"}
                  {delivery.lastHttpStatus !== null ? ` (${delivery.lastHttpStatus})` : ""}
                  {delivery.attempts.length > 0 && delivery.attempts[delivery.attempts.length - 1].responseSnippet !== null ? (
                    <div className="mono" style={{ color: "var(--muted)" }}>
                      {delivery.attempts[delivery.attempts.length - 1].responseSnippet}
                    </div>
                  ) : null}
                </td>
                <td className="mono">{delivery.nextAttemptAt?.replace("T", " ").replace(".000Z", "Z") ?? "—"}</td>
                <td className="mono" style={{ wordBreak: "break-all", maxWidth: 320 }}>{delivery.requestUrl}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
