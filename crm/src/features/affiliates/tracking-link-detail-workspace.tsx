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
  fetchAffiliateTrackingLink,
  updateAffiliateTrackingLink,
} from "@/application/api/affiliates-client";
import type { AffiliateCampaign, AffiliateTrackingLink } from "@/data/contracts/api/affiliates";
import { useAffiliateAccess } from "./use-affiliate-access";
import {
  AVAILABILITY_LABEL,
  LINK_STATUS_LABEL,
  activationStateLabel,
  describeAffiliateFailure,
  failureRequestId,
  formatDateTime,
  pluralDays,
  publicRouteStateLabel,
  statusTone,
} from "./affiliate-labels";
import { CanonicalLinkBlock, TrackerTemplateBlock } from "./copy-link";
import { TrackingLinkFormDialog } from "./tracking-link-form";
import { StatusAction, type StatusActionResult } from "./status-actions";

/**
 * AFD-5A — tracking-link detail: configuration, effective availability, the
 * canonical URL and the status actions.
 *
 * ACTIVATION IS NEVER OPTIMISTIC. The activate button awaits the backend and
 * the row is then re-read, so a refusal — attribution switched off, a paused
 * parent, an invalid mapping — is shown as the backend's own stable reason
 * rather than as a status that flickers and reverts.
 */

type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string; requestId?: string }
  | { kind: "forbidden"; message: string }
  | { kind: "not_found" };

export function TrackingLinkDetailWorkspace({ linkId }: { linkId: string }) {
  const { canManage, readOnly } = useAffiliateAccess();

  const [state, setState] = React.useState<LoadState>({ kind: "loading" });
  const [link, setLink] = React.useState<AffiliateTrackingLink | null>(null);
  const [campaigns, setCampaigns] = React.useState<AffiliateCampaign[]>([]);
  const [editOpen, setEditOpen] = React.useState(false);
  const [reloadToken, setReloadToken] = React.useState(0);

  const reload = React.useCallback(() => setReloadToken((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });

    void (async () => {
      const outcome = await fetchAffiliateTrackingLink(linkId);
      if (cancelled) return;

      if (outcome.status === "forbidden") {
        setState({ kind: "forbidden", message: describeAffiliateFailure(outcome) });
        return;
      }
      if (outcome.status === "not_found") {
        setState({ kind: "not_found" });
        return;
      }
      if (outcome.status !== "success") {
        setState({
          kind: "error",
          message: describeAffiliateFailure(outcome),
          requestId: failureRequestId(outcome),
        });
        return;
      }

      setLink(outcome.data);
      const campaignOutcome = await fetchAffiliateCampaigns({
        affiliatePartnerId: outcome.data.affiliatePartnerId,
        limit: 100,
      });
      if (cancelled) return;
      setCampaigns(campaignOutcome.status === "success" ? campaignOutcome.data.items : []);
      setState({ kind: "ready" });
    })();

    return () => {
      cancelled = true;
    };
  }, [linkId, reloadToken]);

  if (state.kind === "loading") {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">Загрузка трекинговой ссылки</span>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
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
        title="Ссылка не найдена"
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

  if (!link) return null;

  async function runStatus(
    status: "draft" | "active" | "paused" | "archived",
  ): Promise<StatusActionResult> {
    const outcome = await updateAffiliateTrackingLink(link!.id, { status });
    if (outcome.status === "success") {
      // Re-read from the authoritative result rather than assuming success
      // produced the status we asked for.
      setLink(outcome.data);
      reload();
      return { ok: true };
    }
    return {
      ok: false,
      message: describeAffiliateFailure(outcome),
      requestId: failureRequestId(outcome),
    };
  }

  const archived = link.status === "archived";
  const canActivate = link.activationState === "available";

  return (
    <div className="space-y-5">
      <nav aria-label="Хлебные крошки" className="text-xs text-text-secondary">
        <Link href="/affiliates" className="underline-offset-2 hover:underline">
          Аффилейты
        </Link>
        <span aria-hidden> / </span>
        <Link
          href={`/affiliates/${link.affiliatePartnerId}`}
          className="underline-offset-2 hover:underline"
        >
          {link.affiliatePartnerCode}
        </Link>
        <span aria-hidden> / </span>
        <span className="text-text-primary">{link.displayName}</span>
      </nav>

      <PageHeader
        title={link.displayName}
        description={`Аффилейт: ${link.affiliatePartnerCode}${
          link.affiliateCampaignCode ? ` · Кампания: ${link.affiliateCampaignCode}` : ""
        }`}
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

      {/* ------------------------------------------------------ availability */}
      <section aria-labelledby="link-status-heading" className="rounded-lg border border-border p-3">
        <h2 id="link-status-heading" className="text-sm font-semibold text-text-primary">
          Состояние
        </h2>
        <dl className="mt-2 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-text-secondary">Статус</dt>
            <dd className="mt-0.5">
              <StatusBadge tone={statusTone(link.status)} label={LINK_STATUS_LABEL[link.status]} />
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Эффективная доступность</dt>
            <dd className="mt-0.5 text-text-primary">{AVAILABILITY_LABEL[link.availability]}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Приём трафика</dt>
            <dd className="mt-0.5 text-text-primary">
              {publicRouteStateLabel(link.publicRouteState)}
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Возможность активации</dt>
            <dd className="mt-0.5 text-text-primary">
              {activationStateLabel(link.activationState)}
            </dd>
          </div>
        </dl>

        {canManage ? (
          <div className="mt-3 space-y-2 border-t border-border pt-3">
            {!archived ? (
              <ActivationPrerequisites link={link} />
            ) : null}
            <div className="flex flex-wrap gap-2">
              {!archived && link.status !== "active" ? (
                <StatusAction
                  label="Активировать"
                  pendingLabel="Активация…"
                  variant="primary"
                  disabled={!canActivate}
                  onRun={() => runStatus("active")}
                />
              ) : null}
              {link.status === "active" ? (
                <StatusAction
                  label="Поставить на паузу"
                  pendingLabel="Сохранение…"
                  onRun={() => runStatus("paused")}
                />
              ) : null}
              {link.status === "paused" ? (
                <StatusAction
                  label="Вернуть в черновик"
                  pendingLabel="Сохранение…"
                  variant="ghost"
                  onRun={() => runStatus("draft")}
                />
              ) : null}
              {!archived ? (
                <StatusAction
                  label="Архивировать"
                  pendingLabel="Архивирование…"
                  variant="danger"
                  onRun={() => runStatus("archived")}
                  confirm={{
                    title: "Архивировать ссылку?",
                    description:
                      "Архив необратим: активировать ссылку снова будет нельзя. Ссылка останется видна в истории.",
                    confirmLabel: "Архивировать",
                  }}
                />
              ) : (
                <p className="text-xs text-text-secondary">
                  Ссылка в архиве. Повторная активация невозможна.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </section>

      {/* -------------------------------------------------------------- link */}
      <section aria-labelledby="link-url-heading" className="rounded-lg border border-border p-3">
        <h2 id="link-url-heading" className="text-sm font-semibold text-text-primary">
          Ссылка
        </h2>
        <div className="mt-2 space-y-4">
          <CanonicalLinkBlock link={link} />
          <div className="border-t border-border pt-3">
            <TrackerTemplateBlock link={link} />
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- configuration */}
      <section aria-labelledby="link-config-heading" className="rounded-lg border border-border p-3">
        <h2 id="link-config-heading" className="text-sm font-semibold text-text-primary">
          Конфигурация
        </h2>
        <dl className="mt-2 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-text-secondary">Публичный код</dt>
            <dd className="mt-0.5 break-all font-mono text-text-primary">{link.publicCode}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Посадочная страница</dt>
            <dd className="mt-0.5 font-mono text-text-primary">{link.landingKey}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Окно атрибуции</dt>
            <dd className="mt-0.5 text-text-primary">
              {pluralDays(link.effectiveAttributionWindowDays)}
              {link.attributionWindowDays === null ? " (наследуется)" : " (собственное)"}
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Создана</dt>
            <dd className="mt-0.5 text-text-primary">
              {formatDateTime(link.createdAt)}
              {link.createdBy ? ` · ${link.createdBy.displayName}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Обновлена</dt>
            <dd className="mt-0.5 text-text-primary">{formatDateTime(link.updatedAt)}</dd>
          </div>
          {link.archivedAt ? (
            <div>
              <dt className="text-text-secondary">Архивирована</dt>
              <dd className="mt-0.5 text-text-primary">{formatDateTime(link.archivedAt)}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {canManage ? (
        <TrackingLinkFormDialog
          mode="edit"
          affiliatePartnerId={link.affiliatePartnerId}
          campaigns={campaigns}
          link={link}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={(saved) => {
            setLink(saved);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The activation checklist.
 *
 * It states the prerequisites in the operator's own terms so a blocked
 * activation is explainable BEFORE the button is pressed. The backend remains
 * the authority: pressing activate on a link this checklist believes is ready
 * can still be refused, and that refusal is displayed verbatim from its stable
 * reason.
 */
function ActivationPrerequisites({ link }: { link: AffiliateTrackingLink }) {
  if (link.activationState === "available") {
    return (
      <p className="text-2xs text-text-secondary">
        Все условия активации выполнены.
      </p>
    );
  }

  const reason =
    link.activationState === "feature_disabled"
      ? "Атрибуция отключена в этой среде (AFFILIATE_ATTRIBUTION_DISABLED)."
      : link.publicRouteState === "parent_archived"
        ? "Родительский аффилейт или кампания находятся в архиве."
        : link.publicRouteState === "parent_paused"
          ? "Родительский аффилейт или кампания на паузе."
          : "Не выполнены условия активации: проверьте статус аффилейта и кампании, имена параметров и окно атрибуции.";

  return (
    <div
      role="status"
      className="rounded-sm border border-warning/40 bg-warning/10 px-2 py-1.5 text-2xs text-text-primary"
    >
      <p className="font-medium">Активация сейчас недоступна</p>
      <p className="mt-0.5">{reason}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-text-secondary">
        <li>атрибуция включена в среде;</li>
        <li>родительский аффилейт активен;</li>
        <li>кампания активна (если указана);</li>
        <li>имена параметров корректны и не повторяются;</li>
        <li>окно атрибуции — от 1 до 365 дней;</li>
        <li>поддерживаемая посадочная страница.</li>
      </ul>
    </div>
  );
}
