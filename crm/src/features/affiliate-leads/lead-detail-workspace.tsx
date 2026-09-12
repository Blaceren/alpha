"use client";

/**
 * AFD-5C2 — one lead, redacted by default.
 *
 * REDACTED FOR EVERY ROLE, INCLUDING A CRM ADMINISTRATOR. Opening this route
 * renders `maskedEmail` and never an address: `fetchLeadDetail` returns a
 * `LeadDetail` whose contract has no identity field, so there is nothing here a
 * permission could unlock. Full identity has exactly one owner and it is an
 * explicit POST behind a confirmation — see `lead-reveal.tsx`.
 *
 * NOTHING PREFETCHES THE REVEAL. This component fetches the detail on mount and
 * that is all; the reveal client is not imported here, and the reveal component
 * calls it only from a confirm handler. Opening a lead, hovering a row, focusing
 * a control or restoring a history entry therefore mint no audit row.
 *
 * ACQUISITION IS DISPLAYED FROM THE FROZEN RECORD. First, last and selected
 * touch, the model, the selection reason and the freeze instant are read
 * verbatim from `acquisition`. Nothing is recomputed, nothing is editable, and a
 * direct lead is shown as direct rather than assigned to a synthetic affiliate.
 */
import * as React from "react";
import Link from "next/link";
import { fetchLeadDetail } from "@/application/api/affiliate-leads-client";
import type {
  LeadDataAvailability,
  LeadDetailResponse,
} from "@/data/contracts/api/affiliate-leads";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/states/empty-state";
import { isWellFormedLeadId } from "@/data/contracts/api/affiliate-leads";
import { useAffiliateAccess } from "@/features/affiliates/use-affiliate-access";
import { AffiliateSectionTabs } from "@/features/affiliates/affiliate-section-tabs";
import { LeadPiiReveal } from "./lead-reveal";
import { LeadTimelineView } from "./lead-timeline";
import {
  AttributionChip,
  AvailabilityList,
  DepositChip,
  ErrorBlock,
  FactList,
  FactRow,
  InfoNote,
  IntegrityFlags,
  JourneyChip,
  LoadingBlock,
  RefreshingBadge,
  SectionHeading,
} from "./lead-primitives";
import {
  ACQUISITION_FROZEN_AT_LABEL,
  ACQUISITION_FROZEN_NOTE,
  ACQUISITION_MODEL_LABEL,
  ACQUISITION_REASON_LABEL,
  ACQUISITION_TITLE,
  acquisitionModelText,
  AFFILIATE_LABEL,
  AMOUNT_LABEL,
  AVAILABILITY_TITLE,
  BACK_TO_LIST_LABEL,
  CAMPAIGN_LABEL,
  CONFLICT_CATEGORY_LABEL,
  DEPOSIT_LABEL,
  DEPOSIT_STATE_HINT,
  describeLeadFailure,
  DETAIL_LOADING,
  DIRECT_ACQUISITION_NOTE,
  failureRequestId,
  FIRST_TOUCH_LABEL,
  formatDepositAmount,
  formatInstant,
  FORBIDDEN_MESSAGE,
  JOURNEY_LABEL,
  LAST_TOUCH_LABEL,
  LINK_LABEL,
  MASKED_EMAIL_LABEL,
  NOT_APPLICABLE,
  NOT_FOUND_MESSAGE,
  POCKET_AT_LABEL,
  REGISTERED_AT_LABEL,
  REPLAY_OBSERVED_LABEL,
  SELECTED_TOUCH_LABEL,
  selectionReasonText,
  SUBPARAMETERS_NOTE,
  availabilityReasonLabel,
  DEPOSIT_AT_LABEL,
} from "./leads-labels";
import { useLeadResource } from "./use-lead-resource";

/** The availability table, in a fixed reading order. */
function availabilityEntries(availability: LeadDataAvailability) {
  const flat = (key: string, state: { available: boolean; reason?: string }) => ({
    key,
    available: state.available,
    ...(state.available ? {} : { reason: state.reason }),
  });

  return [
    flat("acquisition", availability.acquisition),
    flat("academyRegistration", availability.academyRegistration),
    flat("pocketRegistration", availability.pocketRegistration),
    // The first deposit has FOUR outcomes rather than two. `available` maps to
    // the one that is genuinely present; the other three carry their reason and
    // are never drawn as a zero.
    {
      key: "firstDeposit",
      available: availability.firstDeposit.state === "available",
      ...(availability.firstDeposit.state === "available"
        ? {}
        : { reason: availability.firstDeposit.reason }),
    },
    flat("redeposit", availability.redeposit),
    flat("currentBalance", availability.currentBalance),
    flat("educationTimeline", availability.educationTimeline),
    flat("trafficSubParameters", availability.trafficSubParameters),
  ];
}

function dimensionText(value: { displayName: string; code: string } | null): string {
  return value === null ? NOT_APPLICABLE : `${value.displayName} (${value.code})`;
}

export function AffiliateLeadDetailWorkspace({ leadId }: { leadId: string }) {
  const { canRead } = useAffiliateAccess();

  // A malformed reference is rejected LOCALLY, with no request. This is not an
  // authorization decision — it only avoids a round trip that would 400 anyway,
  // and the backend still owns the real parse.
  const wellFormed = isWellFormedLeadId(leadId);

  const detail = useLeadResource<LeadDetailResponse>(
    `lead:${leadId}`,
    canRead && wellFormed,
    (signal) => fetchLeadDetail(leadId, { signal }),
  );

  if (!canRead) {
    return (
      <div className="space-y-4">
        <PageHeader title="Лид" />
        <EmptyState title="Раздел недоступен" description={FORBIDDEN_MESSAGE} />
      </div>
    );
  }

  if (!wellFormed) {
    return (
      <div className="space-y-4">
        <PageHeader title="Лид" />
        <AffiliateSectionTabs active="leads" />
        <EmptyState title={NOT_FOUND_MESSAGE} description="Ссылка на лида некорректна." />
        <Link
          href="/affiliates/leads"
          className="inline-flex min-h-[2.25rem] items-center rounded-md border border-border bg-surface px-3 text-sm text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {BACK_TO_LIST_LABEL}
        </Link>
      </div>
    );
  }

  const data = detail.data;
  const lead = data?.lead;

  return (
    <div className="space-y-4">
      <PageHeader
        // The MASKED address is the page title. A lead has no other public name,
        // and a raw reference would be an opaque string nobody can act on.
        title={lead ? lead.maskedEmail : "Лид"}
        description="Карточка лида показывает данные в замаскированном виде."
        actions={detail.refreshing ? <RefreshingBadge /> : null}
      />
      <AffiliateSectionTabs active="leads" />

      <Link
        href="/affiliates/leads"
        className="inline-flex min-h-[2.25rem] items-center rounded-md border border-border bg-surface px-3 text-sm text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        ← {BACK_TO_LIST_LABEL}
      </Link>

      {detail.loading ? <LoadingBlock label={DETAIL_LOADING} /> : null}

      {detail.failure ? (
        <ErrorBlock
          message={describeLeadFailure(detail.failure)}
          requestId={failureRequestId(detail.failure)}
          onRetry={detail.failure.status === "not_found" ? undefined : detail.reload}
        />
      ) : null}

      {data && lead ? (
        <>
          <IntegrityFlags flags={lead.integrityFlags} />

          {/* ---------------------------------------------------- identity */}
          <section aria-labelledby="lead-identity-heading" className="space-y-2">
            <SectionHeading
              id="lead-identity-heading"
              title="Учащийся"
              description="Полный адрес и имя не отображаются по умолчанию ни для одной роли, включая администратора CRM."
            />
            <FactList>
              <FactRow label={MASKED_EMAIL_LABEL}>
                <span className="break-all">{lead.maskedEmail}</span>
              </FactRow>
              <FactRow label={JOURNEY_LABEL}>
                <JourneyChip stage={lead.journey.journeyStage} withHint />
              </FactRow>
            </FactList>

            {/* The one place full identity can be requested. Rendered only when
                the backend says this caller may, and even then only as a button
                that opens a confirmation. */}
            <LeadPiiReveal leadId={lead.leadId} canRevealPii={lead.canRevealPii} />
          </section>

          {/* ------------------------------------------------- acquisition */}
          <section aria-labelledby="lead-acquisition-heading" className="space-y-2">
            <SectionHeading
              id="lead-acquisition-heading"
              title={ACQUISITION_TITLE}
              description={
                lead.acquisition.attributionState === "attributed"
                  ? ACQUISITION_FROZEN_NOTE
                  : undefined
              }
              actions={<AttributionChip state={lead.acquisition.attributionState} withHint />}
            />

            {lead.acquisition.attributionState === "unattributed" ? (
              // A DIRECT LEAD IS SHOWN AS DIRECT. No affiliate row, no zeroed
              // touch timestamps, no "(прямой)" partner invented to fill a
              // column — that would put organic signups in somebody's payout.
              <InfoNote>{DIRECT_ACQUISITION_NOTE}</InfoNote>
            ) : (
              <FactList>
                <FactRow label={AFFILIATE_LABEL}>
                  {dimensionText(lead.acquisition.affiliate)}
                </FactRow>
                <FactRow label={CAMPAIGN_LABEL}>
                  {dimensionText(lead.acquisition.campaign)}
                </FactRow>
                <FactRow label={LINK_LABEL}>
                  {dimensionText(lead.acquisition.trackingLink)}
                </FactRow>
                <FactRow label={FIRST_TOUCH_LABEL}>
                  <span className="tabular-nums">
                    {formatInstant(lead.acquisition.firstTouchAt)}
                  </span>
                </FactRow>
                <FactRow label={LAST_TOUCH_LABEL}>
                  <span className="tabular-nums">
                    {formatInstant(lead.acquisition.lastTouchAt)}
                  </span>
                </FactRow>
                <FactRow label={SELECTED_TOUCH_LABEL}>
                  <span className="tabular-nums">
                    {formatInstant(lead.acquisition.selectedTouchAt)}
                  </span>
                </FactRow>
                <FactRow
                  label={ACQUISITION_MODEL_LABEL}
                  // The exact stored value stays visible beside the wording: it
                  // is what a support conversation or a payout dispute will
                  // quote, and the readable form is a convenience, not a
                  // replacement.
                  hint={lead.acquisition.acquisitionModel ?? undefined}
                >
                  {lead.acquisition.acquisitionModel === null
                    ? NOT_APPLICABLE
                    : acquisitionModelText(lead.acquisition.acquisitionModel)}
                </FactRow>
                <FactRow
                  label={ACQUISITION_REASON_LABEL}
                  hint={lead.acquisition.selectionReason ?? undefined}
                >
                  {lead.acquisition.selectionReason === null
                    ? NOT_APPLICABLE
                    : selectionReasonText(lead.acquisition.selectionReason)}
                </FactRow>
                <FactRow label={ACQUISITION_FROZEN_AT_LABEL}>
                  <span className="tabular-nums">{formatInstant(lead.acquisition.frozenAt)}</span>
                </FactRow>
              </FactList>
            )}
          </section>

          {/* ----------------------------------------- journey and deposit */}
          <section aria-labelledby="lead-journey-heading" className="space-y-2">
            <SectionHeading
              id="lead-journey-heading"
              title="Этап пути и депозит"
              description="Этап пути и состояние депозита — независимые факты. Конфликт не отменяет учтённый депозит, а учтённый депозит не снимает конфликт."
            />
            <FactList>
              <FactRow label={REGISTERED_AT_LABEL}>
                <span className="tabular-nums">
                  {formatInstant(lead.journey.academyRegisteredAt)}
                </span>
              </FactRow>
              <FactRow label={POCKET_AT_LABEL}>
                <span className="tabular-nums">
                  {formatInstant(lead.journey.pocketRegisteredAt)}
                </span>
              </FactRow>
              <FactRow label={DEPOSIT_AT_LABEL}>
                <span className="tabular-nums">
                  {formatInstant(lead.journey.firstDepositConfirmedAt)}
                </span>
              </FactRow>
              <FactRow
                label={DEPOSIT_LABEL}
                hint={DEPOSIT_STATE_HINT[lead.deposit.depositState]}
              >
                <DepositChip state={lead.deposit.depositState} />
              </FactRow>
              <FactRow label="Депозит получен провайдером">
                <span className="tabular-nums">
                  {formatInstant(lead.deposit.firstReceivedAt)}
                </span>
              </FactRow>
              <FactRow label="Конфликт обнаружен">
                <span className="tabular-nums">
                  {formatInstant(lead.deposit.conflictDetectedAt)}
                </span>
              </FactRow>
              <FactRow label={AMOUNT_LABEL}>
                {/* NO USD FALLBACK. An amount whose currency the backend did not
                    state is withheld and the reason is named instead. */}
                {formatDepositAmount(
                  lead.deposit.providerAmount,
                  lead.deposit.currencyCode,
                  lead.deposit.amountAvailability,
                ) ?? (
                  <span className="text-text-muted">
                    {lead.deposit.amountAvailability.available
                      ? NOT_APPLICABLE
                      : availabilityReasonLabel(lead.deposit.amountAvailability.reason)}
                  </span>
                )}
              </FactRow>
              {lead.deposit.conflictCategory !== null ? (
                <FactRow label="Категория конфликта">
                  {CONFLICT_CATEGORY_LABEL[lead.deposit.conflictCategory]}
                </FactRow>
              ) : null}
              <FactRow
                label={REPLAY_OBSERVED_LABEL}
                // Explicitly NOT a count. The number of redeliveries is
                // transport metadata and publishing it would invite it to be
                // read as a number of deposits.
                hint="Признак повторной доставки события провайдером. Это не количество депозитов."
              >
                {lead.deposit.replayObserved ? "Да" : "Нет"}
              </FactRow>
            </FactList>
          </section>

          {/* ------------------------------------------------- the timeline */}
          <LeadTimelineView timeline={lead.timeline} />

          {/* ----------------------------------------------- availability */}
          <section aria-labelledby="lead-availability-heading" className="space-y-2">
            <SectionHeading
              id="lead-availability-heading"
              title={AVAILABILITY_TITLE}
              description={SUBPARAMETERS_NOTE}
            />
            <AvailabilityList entries={availabilityEntries(data.dataAvailability)} />
          </section>
        </>
      ) : null}
    </div>
  );
}
