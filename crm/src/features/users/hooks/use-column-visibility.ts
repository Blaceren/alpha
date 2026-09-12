"use client";

import * as React from "react";
import { USERS_COLUMN_LABEL } from "@/config/labels";

/** Optional columns (hidden by default). Visibility lives in React state only. */
export type OptionalColumnKey =
  | "valueSegments"
  | "recommendation"
  | "registrationStatus"
  | "campaign"
  | "balance"
  | "netDeposits";

export const OPTIONAL_COLUMNS: { key: OptionalColumnKey; label: string }[] = [
  { key: "valueSegments", label: USERS_COLUMN_LABEL.valueSegments },
  { key: "recommendation", label: "Рекомендованное действие" },
  { key: "registrationStatus", label: USERS_COLUMN_LABEL.registrationStatus },
  { key: "campaign", label: USERS_COLUMN_LABEL.campaign },
  { key: "balance", label: "Финансовое представление" },
  { key: "netDeposits", label: USERS_COLUMN_LABEL.netDeposits },
];

export function useColumnVisibility() {
  const [visible, setVisible] = React.useState<Record<OptionalColumnKey, boolean>>({
    valueSegments: false,
    recommendation: false,
    registrationStatus: false,
    campaign: false,
    balance: false,
    netDeposits: false,
  });

  const toggle = React.useCallback((key: OptionalColumnKey) => {
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return { visible, toggle };
}
