import * as React from "react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import {
  ENGAGEMENT_LABEL,
  FUNDING_LABEL,
  LIFECYCLE_LABEL,
  REGISTRATION_STATUS_LABEL,
  type RegistrationStatus,
} from "@/config/labels";
import type { EngagementStatus, FundingStatus, LifecycleStage } from "@/domain/lifecycle/state";

type Tone = NonNullable<BadgeProps["tone"]>;

const FUNDING_TONE: Record<FundingStatus, Tone> = {
  not_available: "neutral",
  unfunded: "neutral",
  funded: "success",
  checkpoint_grace: "warning",
  financial_access_suspended: "danger",
  balance_unknown: "warning",
};

const ENGAGEMENT_TONE: Record<EngagementStatus, Tone> = {
  not_started: "neutral",
  active: "success",
  progression_stalled: "warning",
  inactive_3d: "warning",
  inactive_7d: "warning",
  dormant_14d: "danger",
  dormant_30d: "danger",
  returned: "info",
};

/** Lifecycle = primary relationship stage. Neutral, no color-only meaning. */
export function LifecycleBadge({ value }: { value: LifecycleStage }) {
  return <Badge tone="neutral">{LIFECYCLE_LABEL[value]}</Badge>;
}

export function FundingBadge({ value }: { value: FundingStatus }) {
  return <Badge tone={FUNDING_TONE[value]}>{FUNDING_LABEL[value]}</Badge>;
}

export function EngagementBadge({ value }: { value: EngagementStatus }) {
  return <Badge tone={ENGAGEMENT_TONE[value]}>{ENGAGEMENT_LABEL[value]}</Badge>;
}

export function RegistrationBadge({ value }: { value: RegistrationStatus }) {
  const tone: Tone = value === "registered" ? "success" : value === "registration_pending" ? "warning" : "neutral";
  return <Badge tone={tone}>{REGISTRATION_STATUS_LABEL[value]}</Badge>;
}
