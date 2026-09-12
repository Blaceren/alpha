// SYNTHETIC MOCK DATA — NOT PRODUCTION. Fixtures entry point.
// UI/components must not import this; access data via the CrmDataProvider.
import type { MockUser } from "@/domain/users/mock-user";
import { FixedMockClock, type Clock } from "@/lib/clock";
import { buildDataset } from "./build";

export { buildDataset, buildUser } from "./build";
export { RAW_PERSONAS } from "./personas";
export {
  validateDataset,
  assertValidDataset,
  REQUIRED_SCENARIOS,
  type ValidationIssue,
} from "./validate";

let cached: MockUser[] | null = null;

/** Memoized default dataset built with the FixedMockClock. */
export function defaultDataset(clock: Clock = new FixedMockClock()): MockUser[] {
  if (clock instanceof FixedMockClock && cached) return cached;
  const built = buildDataset(clock);
  if (clock instanceof FixedMockClock) cached = built;
  return built;
}
