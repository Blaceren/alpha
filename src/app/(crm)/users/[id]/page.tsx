import { User360Workspace } from "@/features/user-360/user-360-workspace";

/**
 * User 360 (Phase 1C) — read-only. Data comes only via the CrmDataProvider,
 * already permission-projected for the caller's role.
 */
export default function User360Page({ params }: { params: { id: string } }) {
  return <User360Workspace userId={params.id} />;
}
