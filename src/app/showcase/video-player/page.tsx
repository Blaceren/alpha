import type { Metadata } from "next";
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

export default async function VideoPlayerShowcasePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const initialState = SHOWCASE_STATES.has(state as ShowcaseState)
    ? (state as ShowcaseState)
    : "initial";

  return <VideoPlayerShowcase initialState={initialState} />;
}
