"use client";

/**
 * AFFILIATE-PLATFORM-V1 §19 — the two STAFF-OWNED commercial controls, on the
 * partner they belong to.
 *
 *   1. PARTNER ACCESS — create a login, disable it, re-enable it, reset its
 *      password. Staff GRANT partner access; they never HOLD it. There is no
 *      impersonation control here or anywhere else: a partner session is a
 *      different cookie, signed with a different secret, over a different
 *      table.
 *
 *   2. COMMERCIAL TERMS — set a campaign's CPA, and read every version that has
 *      ever applied to it.
 *
 * THERE IS NO EDIT AND NO DELETE, on either. Setting a price APPENDS a version
 * and supersedes the previous one, and the history below shows both. §11's "no
 * retroactive money rewrite" is expressed here as an ABSENCE OF CONTROLS, which
 * is the only form of it a UI cannot get wrong: an operator cannot reach the
 * amount a past commission was computed from, because no control does that.
 *
 * A GENERATED CREDENTIAL IS SHOWN ONCE AND SAID SO. It is held in component
 * state, never written to storage, and disappears on the next reload — because
 * no read path on the server would return it again.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createPartnerUser,
  fetchCampaignTerms,
  fetchPartnerUsers,
  setCampaignTerms,
  updatePartnerUser,
} from "@/application/api/affiliate-commercial-client";
import type {
  AffiliateCampaignTerms,
  AffiliatePartnerUser,
} from "@/data/contracts/api/affiliate-commercial";
import { PRINCIPAL_STATUS_LABEL, TERMS_STATUS_LABEL, formatInstant, formatMoney, labelFor } from "./commercial-labels";

/** The currencies the backend's allowlist accepts. Kept in step deliberately. */
const CPA_CURRENCIES = ["USD", "EUR"] as const;

export function PartnerCommercialPanel({
  affiliatePartnerId,
  campaigns,
  canManage,
}: {
  affiliatePartnerId: string;
  campaigns: readonly { id: string; code: string; displayName: string; status: string }[];
  canManage: boolean;
}) {
  return (
    <>
      <PartnerAccessSection affiliatePartnerId={affiliatePartnerId} canManage={canManage} />
      <CommercialTermsSection campaigns={campaigns} canManage={canManage} />
    </>
  );
}

/* ------------------------------------------------------------- principals */

function PartnerAccessSection({
  affiliatePartnerId,
  canManage,
}: {
  affiliatePartnerId: string;
  canManage: boolean;
}) {
  const [rows, setRows] = React.useState<AffiliatePartnerUser[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  /** The one-time reveal. Component state only — never storage, never a log. */
  const [reveal, setReveal] = React.useState<{ email: string; password: string } | null>(null);

  const load = React.useCallback(async () => {
    const outcome = await fetchPartnerUsers(affiliatePartnerId);
    if (outcome.status === "success") {
      setRows(outcome.data.items);
      setError(null);
    } else {
      setRows([]);
      setError("Не удалось загрузить доступы партнёра.");
    }
  }, [affiliatePartnerId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="partner-access-heading" className="space-y-2">
      <h2 id="partner-access-heading" className="text-sm font-semibold">
        Доступ партнёра
      </h2>
      <p className="text-xs text-muted-foreground">
        Сотрудник выдаёт доступ, но не получает его: сессия партнёра — отдельная кука, отдельный
        секрет и отдельная таблица. Входа «от имени партнёра» не существует.
      </p>

      {rows === null ? <Skeleton className="h-20 w-full" /> : null}
      {error !== null ? <p className="text-xs text-destructive">{error}</p> : null}

      {rows !== null && rows.length === 0 ? (
        <EmptyState title="Доступов нет" description="У партнёра пока нет ни одного логина." />
      ) : null}

      {rows !== null && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3 text-left">Email</th>
                <th className="p-3 text-left">Имя</th>
                <th className="p-3 text-left">Статус</th>
                <th className="p-3 text-left">Последний вход</th>
                {canManage ? <th className="p-3 text-right">Действия</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.partnerUserId} className="border-t">
                  <td className="p-3 font-mono text-xs">{row.email}</td>
                  <td className="p-3">{row.displayName}</td>
                  <td className="p-3">
                    <span className="rounded-full border px-2 py-0.5 text-xs">
                      {labelFor(PRINCIPAL_STATUS_LABEL, row.status)}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-xs">{formatInstant(row.lastLoginAt)}</td>
                  {canManage ? (
                    <td className="space-x-2 p-3 text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setReveal(null);
                          const outcome = await updatePartnerUser({
                            partnerUserId: row.partnerUserId,
                            action: row.status === "active" ? "disable" : "enable",
                          });
                          setBusy(false);
                          if (outcome.status === "success") await load();
                          else setError("Действие не выполнено.");
                        }}
                      >
                        {row.status === "active" ? "Отключить" : "Включить"}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setReveal(null);
                          const outcome = await updatePartnerUser({
                            partnerUserId: row.partnerUserId,
                            action: "reset_password",
                          });
                          setBusy(false);
                          if (outcome.status === "success") {
                            if (outcome.data.initialPassword !== undefined) {
                              setReveal({ email: row.email, password: outcome.data.initialPassword });
                            }
                            await load();
                          } else setError("Сброс пароля не выполнен.");
                        }}
                      >
                        Сбросить пароль
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* DISABLE AND RESET BOTH TAKE EFFECT IMMEDIATELY, and the operator is told
          so rather than left to assume it expires with the token. */}
      {canManage ? (
        <p className="text-xs text-muted-foreground">
          Отключение и сброс пароля завершают все действующие сессии партнёра немедленно, а не по
          истечении токена.
        </p>
      ) : null}

      {reveal !== null ? (
        <div className="rounded-lg border border-dashed p-3 text-sm">
          <strong>Пароль для {reveal.email}</strong>
          <p className="mt-1 break-all font-mono text-xs">{reveal.password}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Показывается один раз. Повторно получить его нельзя — только сбросить снова.
          </p>
        </div>
      ) : null}

      {canManage ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border p-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            setReveal(null);
            const outcome = await createPartnerUser({ affiliatePartnerId, email, displayName });
            setBusy(false);
            if (outcome.status === "success") {
              if (outcome.data.initialPassword !== undefined) {
                setReveal({ email, password: outcome.data.initialPassword });
              }
              setEmail("");
              setDisplayName("");
              await load();
            } else if (outcome.status === "invalid_input") {
              setError("Адрес уже используется или данные некорректны.");
            } else setError("Не удалось создать доступ.");
          }}
        >
          <label className="text-xs">
            <span className="block text-muted-foreground">Email</span>
            <input
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 rounded border px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="block text-muted-foreground">Имя</span>
            <input
              required
              maxLength={160}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="mt-1 rounded border px-2 py-1 text-sm"
            />
          </label>
          <Button type="submit" size="sm" disabled={busy}>
            Создать доступ
          </Button>
        </form>
      ) : null}
    </section>
  );
}

/* --------------------------------------------------------------- CPA terms */

function CommercialTermsSection({
  campaigns,
  canManage,
}: {
  campaigns: readonly { id: string; code: string; displayName: string; status: string }[];
  canManage: boolean;
}) {
  return (
    <section aria-labelledby="terms-heading" className="space-y-2">
      <h2 id="terms-heading" className="text-sm font-semibold">
        Коммерческие условия (CPA)
      </h2>
      <p className="text-xs text-muted-foreground">
        Ставка не редактируется. Новая ставка создаёт новую версию и заменяет предыдущую; уже
        начисленные комиссии сохраняют ту версию, по которой были рассчитаны.
      </p>
      {campaigns.length === 0 ? (
        <EmptyState
          title="Кампаний нет"
          description="Ставка CPA задаётся на кампании — коммерческом владельце условий."
        />
      ) : (
        campaigns.map((campaign) => (
          <CampaignTerms key={campaign.id} campaign={campaign} canManage={canManage} />
        ))
      )}
    </section>
  );
}

function CampaignTerms({
  campaign,
  canManage,
}: {
  campaign: { id: string; code: string; displayName: string; status: string };
  canManage: boolean;
}) {
  const [rows, setRows] = React.useState<AffiliateCampaignTerms[] | null>(null);
  const [amount, setAmount] = React.useState("");
  const [currency, setCurrency] = React.useState<string>(CPA_CURRENCIES[0]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const outcome = await fetchCampaignTerms(campaign.id);
    if (outcome.status === "success") setRows(outcome.data.items);
    else setRows([]);
  }, [campaign.id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const active = rows?.find((row) => row.status === "active") ?? null;

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-sm font-medium">{campaign.displayName}</span>{" "}
          <span className="font-mono text-xs text-muted-foreground">{campaign.code}</span>
        </div>
        <div className="text-sm tabular-nums">
          {active === null ? (
            // NULL IS A REAL ANSWER, NOT A MISSING ONE. A campaign with no
            // active price has no agreed price, and a deposit attributed to it
            // qualifies nothing. Showing 0.00 would imply an agreed price of
            // nothing.
            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              ставка не согласована
            </span>
          ) : (
            <>
              {formatMoney(active.cpaAmount, active.cpaCurrency)}{" "}
              <span className="text-xs text-muted-foreground">v{active.version}</span>
            </>
          )}
        </div>
      </div>

      {rows !== null && rows.length > 0 ? (
        <table className="mt-3 w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Версия</th>
              <th className="p-2 text-right">Ставка</th>
              <th className="p-2 text-left">Статус</th>
              <th className="p-2 text-left">Действует с</th>
              <th className="p-2 text-left">Заменена</th>
              <th className="p-2 text-left">Кем задана</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.termsId} className="border-t">
                <td className="p-2">v{row.version}</td>
                <td className="p-2 text-right tabular-nums">
                  {formatMoney(row.cpaAmount, row.cpaCurrency)}
                </td>
                <td className="p-2">{labelFor(TERMS_STATUS_LABEL, row.status)}</td>
                <td className="p-2 font-mono">{formatInstant(row.effectiveFrom)}</td>
                <td className="p-2 font-mono">{formatInstant(row.supersededAt)}</td>
                <td className="p-2">{row.createdByStaffName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {canManage && campaign.status === "active" ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            const outcome = await setCampaignTerms({
              affiliateCampaignId: campaign.id,
              cpaAmount: amount,
              cpaCurrency: currency,
            });
            setBusy(false);
            if (outcome.status === "success") {
              setAmount("");
              await load();
            } else if (outcome.status === "invalid_input") {
              setError("Сумма должна быть положительной, с двумя знаками после точки.");
            } else setError("Не удалось задать ставку.");
          }}
        >
          <label className="text-xs">
            <span className="block text-muted-foreground">Новая ставка CPA</span>
            <input
              required
              inputMode="decimal"
              placeholder="120.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-1 w-28 rounded border px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="block text-muted-foreground">Валюта</span>
            <select
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              className="mt-1 rounded border px-2 py-1 text-sm"
            >
              {CPA_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" disabled={busy}>
            Задать новую версию
          </Button>
          {error !== null ? <span className="text-xs text-destructive">{error}</span> : null}
        </form>
      ) : null}
    </div>
  );
}
