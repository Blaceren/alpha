import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAcademyConfig } from "@/config/academy-config";
import { VideoPlayerShowcase } from "./video-player-showcase";
import "./video-player-showcase.css";

export const metadata: Metadata = {
  title: "Video Player Showcase — Alfa Trade Academy",
  description: "Изолированный showcase видеоплеера Alfa Trade Academy.",
};

type ShowcaseState =
  | "initial"
  | "playing"
  | "paused"
  | "loading"
  | "error"
  | "completed";

const SHOWCASE_STATES = new Set<ShowcaseState>([
  "initial",
  "playing",
  "paused",
  "loading",
  "error",
  "completed",
]);

/**
 * The showcase exists so a human can judge the player against a file on their own
 * machine. That produces a `blob:` URL which lives only in one browser tab, and a
 * file chooser is something a learner must never be offered — so in `api` mode,
 * where the Academy is the real product talking to the real Backend, this route
 * does not exist at all.
 *
 * It stays available in `fixture` mode, which is what the design/QA surface runs
 * in. Gating rather than deleting keeps the player's own review tooling intact
 * without shipping a file picker into the product.
 */
export default async function VideoPlayerShowcasePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (getAcademyConfig().mode === "api") notFound();

  const { state } = await searchParams;
  const initialState = SHOWCASE_STATES.has(state as ShowcaseState)
    ? (state as ShowcaseState)
    : "initial";

  return <VideoPlayerShowcase initialState={initialState} />;
}
