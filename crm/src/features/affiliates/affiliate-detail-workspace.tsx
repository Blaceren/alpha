"use client";

import * as React from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/states/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchAffiliateCampaigns,
  fetchAffiliatePartner,
  fetchAffiliateTrackingLinks,
  updateAffiliateCampaign,
  updateAffiliatePartner,
} from "@/application/api/affiliates-client";
import type {
  AffiliateCampaign,
  AffiliatePartner,
  AffiliateTrackingLink,
} from "@/data/contracts/api/affiliates";
import { useAffiliateAccess } from "./use-affiliate-access";
import {
  AVAILABILITY_LABEL,
  ENTITY_STATUS_LABEL,
  LINK_STATUS_LABEL,
  describeAffiliateFailure,
  failureRequestId,
  formatDateTime,
  pluralDays,
  publicRouteStateLabel,
  statusTone,
} from "./affiliate-labels";
import { PartnerFormDialog } from "./partner-form";
import { CampaignFormDialog } from "./campaign-form";
import { TrackingLinkFormDialog } from "./tracking-link-form";
import { StatusAction, type StatusActionResult } from "./status-actions";
import { PartnerCommercialPanel } from "@/features/affiliate-commercial/partner-commercial-panel";

/**
 * AFD-5A — affiliate partner detail: the partner's own configuration, its
 * campaigns and its tracking links on one page.
 *
 * Campaigns are managed INLINE rather than on their own route: a campaign is a
 * grouping label with a status, and splitting three fields across a second page
 * would cost a navigation for every edit. Tracking links do get their own route,
 * because a link carries the parameter contract and the canonical URL.
 *
 * Archived children stay listed. History is what an operator reconciling a
 * payout needs, and hiding an archived campaign would make last month's links
 * look orphaned.
 */

type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string; requestId?: string }
  | { kind: "forbidden"; message: string }
  | { kind: "not_found" };

export function AffiliateDetailWorkspace({ partnerId }: { partnerId: string }) {
  const { canManage, readOnly } = useAffiliateAccess();

  const [state, setState] = React.useState<LoadState>({ kind: "loading" });
  const [partner, setPartner] = React.useState<AffiliatePartner | null>(null);
  const [campaigns, setCampaigns] = React.useState<AffiliateCampaign[]>([]);
  const [links, setLinks] = React.useState<AffiliateTrackingLink[]>([]);
  const [reloadToken, setReloadToken] = React.useState(0);

  const [editOpen, setEditOpen] = React.useState(false);
  const [campaignCreateOpen, setCampaignCreateOpen] = React.useState(false);
  const [campaignEdit, setCampaignEdit] = React.useState<AffiliateCampaign | null>(null);
  const [linkCreateOpen, setLinkCreateOpen] = React.useState(false);

  const reload = React.useCallback(() => setReloadToken((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });

    void (async () => {
      const partnerOutcome = await fetchAffiliatePartner(partnerId);
      if (cancelled) return;

      if (partnerOutcome.status === "forbidden") {
        setState({ kind: "forbidden", message: describeAffiliateFailure(partnerOutcome) });
        return;
      }
      if (partnerOutcome.status === "not_found") {
        setState({ kind: "not_found" });
        return;
      }
      if (partnerOutcome.status !== "success") {
        setState({
          kind: "error",
          message: describeAffiliateFailure(partnerOutcome),
          requestId: failureRequestId(partnerOutcome),
        });
        return;
      }

      // Children are fetched after the parent so a 403/404 is reported once,
      // about the thing the operator actually asked for.
      const [campaignOutcome, linkOutcome] = await Promise.all([
        fetchAffiliateCampaigns({ affiliatePartnerId: partnerId, limit: 100 }),
        fetchAffiliateTrackingLinks({ affiliatePartnerId: partnerId, limit: 100 }),
      ]);
      if (cancelled) return;

      setPartner(partnerOutcome.data);
      setCampaigns(campaignOutcome.status === "success" ? campaignOutcome.data.items : []);
      setLinks(linkOutcome.status === "success" ? linkOutcome.data.items : []);
      setState({ kind: "ready" });
    })();

    return () => {
      cancelled = true;
    };
  }, [partnerId, reloadToken]);

  if (state.kind === "loading") {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">Загрузка данных аффилейта</span>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (state.kind === "forbidden") {
    return <EmptyState titleAs="h1" title="Нет доступа" description={state.message} />;
  }

  if (state.kind === "not_found") {
    return (
      <EmptyState
        titleAs="h1"
        title="Аффилейт не найден"
        description="Запись не существует или была удалена."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/affiliates">К списку аффилейтов</Link>
          </Button>
        }
      />
    );
  }

  if (state.kind === "error") {
    return (
      <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-3 text-sm">
        <p>{state.message}</p>
        {state.requestId ? (
          <p className="mt-1 text-2xs text-text-secondary">
            Код обращения: <code className="font-mono">{state.requestId}</code>
          </p>
        ) : null}
        <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={reload}>
          Повторить
        </Button>
      </div>
    );
  }

  if (!partner) return null;

  const archived = partner.status === "archived";

  async function runPartnerStatus(status: "active" | "paused" | "archived"): Promise<StatusActionResult> {
    const outcome = await updateAffiliatePartner(partner!.id, { status });
    if (outcome.status === "success") {
      reload();
      return { ok: true };
    }
    return {
      ok: false,
      message: describeAffiliateFailure(outcome),
      requestId: failureRequestId(outcome),
    };
  }

  return (
    <div className="space-y-5">
      <nav aria-label="Хлебные крошки" className="text-xs text-text-secondary">
        <Link href="/affiliates" className="underline-offset-2 hover:underline">
          Аффилейты
        </Link>
        <span aria-hidden> / </span>
        <span className="text-text-primary">{partner.displayName}</span>
      </nav>

      <PageHeader
        title={partner.displayName}
        description={`Код: ${partner.code}`}
        actions={
          canManage && !archived ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditOpen(true)}>
              Редактировать
            </Button>
          ) : null
        }
      />

      {readOnly ? (
        <p role="status" className="rounded-sm border border-border bg-surface px-2 py-1.5 text-xs text-text-secondary">
          Режим только для чтения.
        </p>
      ) : null}

      {/* ---------------------------------------------------------- summary */}
      <section aria-labelledby="partner-summary-heading" className="rounded-lg border border-border p-3">
        <h2 id="partner-summary-heading" className="text-sm font-semibold text-text-primary">
          Конфигурация
        </h2>
        <dl className="mt-2 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-text-secondary">Статус</dt>
            <dd className="mt-0.5">
              <StatusBadge tone={statusTone(partner.status)} label={ENTITY_STATUS_LABEL[partner.status]} />
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Эффективная доступность</dt>
            <dd className="mt-0.5 text-text-primary">{AVAILABILITY_LABEL[partner.availability]}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Окно атрибуции по умолчанию</dt>
            <dd className="mt-0.5 text-text-primary">
              {pluralDays(partner.defaultAttributionWindowDays)}
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Кампаний</dt>
            <dd className="mt-0.5 text-text-primary">{partner.inventory.campaigns}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Ссылок</dt>
            <dd className="mt-0.5 text-text-primary">
              {partner.inventory.trackingLinks} (активных: {partner.inventory.activeTrackingLinks})
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Создан</dt>
            <dd className="mt-0.5 text-text-primary">
              {formatDateTime(partner.createdAt)}
              {partner.createdBy ? ` · ${partner.createdBy.displayName}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Обновлён</dt>
            <dd className="mt-0.5 text-text-primary">{formatDateTime(partner.updatedAt)}</dd>
          </div>
          {partner.archivedAt ? (
            <div>
              <dt className="text-text-secondary">Архивирован</dt>
              <dd className="mt-0.5 text-text-primary">{formatDateTime(partner.archivedAt)}</dd>
            </div>
          ) : null}
        </dl>

        {partner.description ? (
          <div className="mt-3">
            <h3 className="text-xs font-medium text-text-secondary">Описание</h3>
            <p className="mt-0.5 whitespace-pre-wrap text-xs text-text-primary">
              {partner.description}
            </p>
          </div>
        ) : null}

        {canManage ? (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
            {partner.status === "active" ? (
              <StatusAction
                label="Поставить на паузу"
                pendingLabel="Сохранение…"
                onRun={() => runPartnerStatus("paused")}
              />
            ) : null}
            {partner.status === "paused" ? (
              <StatusAction
                label="Возобновить"
                pendingLabel="Сохранение…"
                onRun={() => runPartnerStatus("active")}
              />
            ) : null}
            {!archived ? (
              <StatusAction
                label="Архивировать"
                pendingLabel="Архивирование…"
                variant="danger"
                onRun={() => runPartnerStatus("archived")}
                confirm={{
                  title: "Архивировать аффилейта?",
                  description:
                    "Архив необратим. Аффилейт, его кампании и ссылки перестанут принимать трафик, но останутся видны в истории.",
                  confirmLabel: "Архивировать",
                }}
              />
            ) : (
              <p className="text-xs text-text-secondary">
                Аффилейт в архиве. Это состояние необратимо.
              </p>
            )}
          </div>
        ) : null}
      </section>

      {/* -------------------------------------------------------- campaigns */}
      <CampaignsSection
        campaigns={campaigns}
        canManage={canManage}
        parentArchived={archived}
        onCreate={() => setCampaignCreateOpen(true)}
        onEdit={setCampaignEdit}
        onReload={reload}
      />

      {/* ------------------------- AFFILIATE-PLATFORM-V1: commercial control
        *
        * PARTNER ACCESS and CPA TERMS live on the partner they belong to,
        * between the campaigns they are priced on and the links that carry the
        * traffic. Both are staff-owned; neither is editable in place, because
        * a price is superseded and a login is disabled — nothing here rewrites
        * a value a past commission was computed from.
        */}
      <PartnerCommercialPanel
        affiliatePartnerId={partner.id}
        campaigns={campaigns}
        canManage={canManage}
      />

      {/* ------------------------------------------------------------ links */}
      <LinksSection
        links={links}
        canManage={canManage}
        parentArchived={archived}
        onCreate={() => setLinkCreateOpen(true)}
      />

      {canManage ? (
        <>
          <PartnerFormDialog
            mode="edit"
            partner={partner}
            open={editOpen}
            onOpenChange={setEditOpen}
            onSaved={reload}
          />
          <CampaignFormDialog
            mode="create"
            affiliatePartnerId={partner.id}
            open={campaignCreateOpen}
            onOpenChange={setCampaignCreateOpen}
            onSaved={reload}
          />
          {campaignEdit ? (
            <CampaignFormDialog
              mode="edit"
              affiliatePartnerId={partner.id}
              campaign={campaignEdit}
              open
              onOpenChange={(next) => (next ? undefined : setCampaignEdit(null))}
              onSaved={reload}
            />
          ) : null}
          <TrackingLinkFormDialog
            mode="create"
            affiliatePartnerId={partner.id}
            campaigns={campaigns}
            open={linkCreateOpen}
            onOpenChange={setLinkCreateOpen}
            onSaved={reload}
          />
        </>
      ) : null}
    </div>
  );
}

function CampaignsSection({
  campaigns,
  canManage,
  parentArchived,
  onCreate,
  onEdit,
  onReload,
}: {
  campaigns: AffiliateCampaign[];
  canManage: boolean;
  parentArchived: boolean;
  onCreate: () => void;
  onEdit: (campaign: AffiliateCampaign) => void;
  onReload: () => void;
}) {
  async function runStatus(
    campaign: AffiliateCampaign,
    status: "active" | "paused" | "archived",
  ): Promise<StatusActionResult> {
    const outcome = await updateAffiliateCampaign(campaign.id, { status });
    if (outcome.status === "success") {
      onReload();
      return { ok: true };
    }
    return {
      ok: false,
      message: describeAffiliateFailure(outcome),
      requestId: failureRequestId(outcome),
    };
  }

  return (
    <section aria-labelledby="campaigns-heading" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="campaigns-heading" className="text-sm font-semibold text-text-primary">
          Кампании
        </h2>
        {canManage && !parentArchived ? (
          <Button type="button" size="sm" variant="secondary" onClick={onCreate}>
            Новая кампания
          </Button>
        ) : null}
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          title="Кампаний нет"
          description="Кампания — необязательная группировка ссылок внутри аффилейта."
        />
      ) : (
        <ul className="space-y-2">
          {campaigns.map((campaign) => (
            <li key={campaign.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary">{campaign.displayName}</p>
                  <p className="font-mono text-2xs text-text-secondary">{campaign.code}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    tone={statusTone(campaign.status)}
                    label={ENTITY_STATUS_LABEL[campaign.status]}
                  />
                  <span className="text-2xs text-text-secondary">
                    {AVAILABILITY_LABEL[campaign.availability]}
                  </span>
                </div>
              </div>

              <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-text-secondary">
                <div className="flex gap-1">
                  <dt>Ссылок:</dt>
                  <dd className="text-text-primary">{campaign.inventory.trackingLinks}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>Активных:</dt>
                  <dd className="text-text-primary">{campaign.inventory.activeTrackingLinks}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>Создана:</dt>
                  <dd className="text-text-primary">{formatDateTime(campaign.createdAt)}</dd>
                </div>
              </dl>

              {campaign.notes ? (
                <p className="mt-2 whitespace-pre-wrap text-xs text-text-primary">{campaign.notes}</p>
              ) : null}

              {campaign.availability !== "available" && campaign.status === "active" ? (
                <p className="mt-2 text-2xs text-text-secondary">
                  Кампания активна, но недоступна: родительский аффилейт не активен.
                </p>
              ) : null}

              {canManage && campaign.status !== "archived" ? (
                <div className="mt-2 flex flex-wrap gap-2 border-t border-border pt-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => onEdit(campaign)}>
                    Редактировать
                  </Button>
                  {campaign.status === "active" ? (
                    <StatusAction
                      label="Пауза"
                      pendingLabel="Сохранение…"
                      onRun={() => runStatus(campaign, "paused")}
                    />
                  ) : (
                    <StatusAction
                      label="Возобновить"
                      pendingLabel="Сохранение…"
                      onRun={() => runStatus(campaign, "active")}
                    />
                  )}
                  <StatusAction
                    label="Архивировать"
                    pendingLabel="Архивирование…"
                    variant="danger"
                    onRun={() => runStatus(campaign, "archived")}
                    confirm={{
                      title: "Архивировать кампанию?",
                      description:
                        "Архив необратим. Ссылки кампании перестанут принимать трафик, но останутся видны в истории.",
                      confirmLabel: "Архивировать",
                    }}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LinksSection({
  links,
  canManage,
  parentArchived,
  onCreate,
}: {
  links: AffiliateTrackingLink[];
  canManage: boolean;
  parentArchived: boolean;
  onCreate: () => void;
}) {
  return (
    <section aria-labelledby="links-heading" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="links-heading" className="text-sm font-semibold text-text-primary">
          Трекинговые ссылки
        </h2>
        {canManage && !parentArchived ? (
          <Button type="button" size="sm" variant="secondary" onClick={onCreate}>
            Новая ссылка
          </Button>
        ) : null}
      </div>

      {links.length === 0 ? (
        <EmptyState
          title="Ссылок нет"
          description="Трекинговая ссылка описывается тем, какие параметры она принимает, а не тем, куда она ведёт."
        />
      ) : (
        <ul className="space-y-2">
          {links.map((link) => (
            <li key={link.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/affiliates/links/${link.id}`}
                    className="text-sm font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {link.displayName}
                  </Link>
                  <p className="break-all font-mono text-2xs text-text-secondary">
                    {link.publicPath}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    tone={statusTone(link.status)}
                    label={LINK_STATUS_LABEL[link.status]}
                  />
                </div>
              </div>
              <p className="mt-1 text-2xs text-text-secondary">
                {publicRouteStateLabel(link.publicRouteState)}
                {link.affiliateCampaignCode ? ` · кампания: ${link.affiliateCampaignCode}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
