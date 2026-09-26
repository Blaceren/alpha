/**
 * Derive explainable recommended actions from computed signals (Phase 1B1 §7).
 * Applies communication-fatigue suppression and always yields a no_action fallback.
 */
import type { MockUser } from "@/domain/users/mock-user";
import type { ComputedSignal } from "@/domain/signals/engine";
import {
  RECOMMENDATION_CATALOG,
  type RecommendedActionCode,
  type RecommendedActionDef,
} from "./catalog";

export interface DerivedRecommendation {
  code: RecommendedActionCode;
  title: string;
  reason: string;
  sourceSignalCodes: ComputedSignal["code"][];
  priority: RecommendedActionDef["priority"];
  suggestedChannel: RecommendedActionDef["suggestedChannel"];
  humanApprovalRequired: boolean;
  cooldownHours: number;
}

/** Channels considered "outbound" and therefore suppressed under fatigue. */
const OUTBOUND_CHANNELS = new Set(["in_app", "email"]);

export function deriveRecommendations(user: MockUser, signals: ComputedSignal[]): DerivedRecommendation[] {
  const activeCodes = new Set(signals.map((s) => s.code));
  const fatigue =
    signals.some((s) => s.code === "communication_fatigue") ||
    user.state.blockers.includes("communication_fatigue");

  const byCode = new Map<RecommendedActionCode, DerivedRecommendation>();

  for (const signal of signals) {
    for (const code of signal.recommendedActionCodes) {
      const def = RECOMMENDATION_CATALOG[code];
      // Suppress outbound nudges when the user is fatigued (except the action that fixes it).
      if (fatigue && OUTBOUND_CHANNELS.has(def.suggestedChannel) && code !== "reduce_communication_frequency") {
        continue;
      }
      const existing = byCode.get(code);
      const sources = new Set(existing?.sourceSignalCodes ?? []);
      sources.add(signal.code);
      byCode.set(code, {
        code,
        title: def.title,
        reason: def.reason,
        sourceSignalCodes: [...sources].filter((c) => activeCodes.has(c)),
        priority: def.priority,
        suggestedChannel: def.suggestedChannel,
        humanApprovalRequired: def.humanApprovalRequired,
        cooldownHours: def.cooldownHours,
      });
    }
  }

  const results = [...byCode.values()];
  if (results.length === 0) {
    const def = RECOMMENDATION_CATALOG.no_action_required;
    return [
      {
        code: def.code,
        title: def.title,
        reason: def.reason,
        sourceSignalCodes: [],
        priority: def.priority,
        suggestedChannel: def.suggestedChannel,
        humanApprovalRequired: def.humanApprovalRequired,
        cooldownHours: def.cooldownHours,
      },
    ];
  }

  const order = { critical: 0, high: 1, normal: 2, low: 3 } as const;
  return results.sort(
    (a, b) => order[a.priority] - order[b.priority] || a.code.localeCompare(b.code),
  );
}
