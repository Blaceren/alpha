import { notFound } from "next/navigation";
import { getAcademyConfig } from "@/config/academy-config";
import { ReaderFidelityScreen } from "@/features/reader-fidelity/reader-fidelity-screen";

export { metadata } from "@/features/reader-fidelity/reader-fidelity-screen";

/**
 * Материал урока (/lessons/[levelCode]/material) — the reading surface.
 *
 * A SUB-ROUTE OF THE LEVEL, not a sibling of it. The address says what the
 * relationship is: this is the material OF that level, so a learner can never
 * arrive at a lesson that belongs to no level, and the level page is always one
 * link away.
 *
 * API MODE ONLY. The rich lesson reads the canonical published body; there is no
 * fixture body to render and inventing one would put fabricated teaching in
 * front of a learner. In fixture mode the route does not exist.
 */
export default async function LessonMaterialPage({
  params,
}: {
  params: Promise<{ levelCode: string }>;
}) {
  if (getAcademyConfig().mode !== "api") notFound();
  const { levelCode } = await params;
  return <ReaderFidelityScreen levelCode={levelCode} />;
}
