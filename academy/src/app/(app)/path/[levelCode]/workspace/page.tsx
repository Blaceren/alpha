import type { Metadata } from "next";
import { WorkspaceFidelityScreen } from "@/features/workspace-fidelity/workspace-fidelity-screen";

export const metadata: Metadata = {
  title: "Рабочая область — Alfa Trade Academy",
  description: "Выполнение задания уровня: отправка работы, разбор и исправления.",
};

/**
 * `/path/[levelCode]/workspace` — the level-scoped Workspace surface.
 *
 * It lives INSIDE the `(app)` route group, so it inherits the authenticated
 * guard, the SessionProvider and the shell's skip link exactly like every other
 * authenticated surface. Nothing about auth is re-implemented here.
 *
 * `force-dynamic` because the surface's whole job is to reflect canonical
 * progression and report state at request time. A cached workspace could offer
 * a submit control for a level that has since been approved, or hide one that
 * has since been returned for corrections.
 */
export const dynamic = "force-dynamic";

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ levelCode: string }>;
}) {
  const { levelCode } = await params;
  return <WorkspaceFidelityScreen levelCode={levelCode} />;
}
