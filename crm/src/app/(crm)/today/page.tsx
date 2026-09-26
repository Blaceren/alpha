import { TodayWorkspace } from "@/features/today/today-workspace";

/**
 * Today workspace (Phase 1B3) — read-only. Data comes only via the
 * CrmDataProvider, already projected for the caller's role.
 */
export default function TodayPage() {
  return <TodayWorkspace />;
}
