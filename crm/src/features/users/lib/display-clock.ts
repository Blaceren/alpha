import { FixedMockClock } from "@/lib/clock";

/**
 * Display "now" for relative timestamps in the Users workspace.
 * Matches the provider's default FixedMockClock so relative times are stable
 * (deterministic screenshots + tests). When the app moves to real data this
 * will be swapped for the live clock alongside the provider's clock.
 */
export const displayNowMs = (): number => new FixedMockClock().nowMs();
