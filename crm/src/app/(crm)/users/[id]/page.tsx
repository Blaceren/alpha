import { User360Workspace } from "@/features/user-360/user-360-workspace";

type User360PageProps = {
  params: Promise<{ id: string }>;
};

/**
 * User 360 (Phase 1C) — read-only. Data comes only via the CrmDataProvider,
 * already permission-projected for the caller's role.
 *
 * `params` is a Promise since Next 15 (async request APIs).
 */
export default async function User360Page({ params }: User360PageProps) {
  const { id } = await params;

  return <User360Workspace userId={id} />;
}
