// SYNTHETIC MOCK DATA — NOT PRODUCTION. No real emails, player IDs, or amounts.
// Phase 1A only needs a couple of records for shell smoke; the full 30-persona
// set (docs/MOCK_DATA_PLAN.md) arrives in a later phase.
//
// IMPORTANT: UI/components must not import this file. Access data via the
// CrmDataProvider only (enforced by ESLint no-restricted-imports).
import type { UserSummary } from "@/domain/users/user";

export const MOCK_USERS: UserSummary[] = [
  {
    id: "usr_mock_001",
    displayName: "Nadia N.",
    maskedEmail: "n***@e***.com",
    lifecycleStage: "registered",
    fundingStatus: "not_connected",
    engagementStatus: "not_started",
    currentLevel: 1,
    lastMeaningfulActionAt: null,
  },
  {
    id: "usr_mock_012",
    displayName: "Denis F.",
    maskedEmail: "d***@e***.com",
    lifecycleStage: "at_risk",
    fundingStatus: "checkpoint_grace",
    engagementStatus: "active",
    currentLevel: 10,
    lastMeaningfulActionAt: "2026-07-12T09:00:00.000Z",
  },
  {
    id: "usr_mock_017",
    displayName: "Yulia S.",
    maskedEmail: "y***@e***.com",
    lifecycleStage: "active",
    fundingStatus: "funded",
    engagementStatus: "active",
    currentLevel: 20,
    lastMeaningfulActionAt: "2026-07-12T11:30:00.000Z",
  },
];
