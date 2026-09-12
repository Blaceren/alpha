/**
 * Dev-only data-state switch for the mock provider.
 *
 * The mock derives everything from a fixed clock, so states like "stale" or
 * "the queue is empty" cannot occur on their own — yet they are real product
 * states that have to be reviewable in a real browser, not only in unit tests.
 * This selects which MockCrmDataProvider mode the app reads through.
 *
 * Same mechanism as the dev role switch (`ata-crm.mock-role.v1`): a localStorage
 * key, seeded before navigation. It is NOT a product feature — it changes which
 * synthetic source is read, never what a role is allowed to see, and it is
 * ignored outside development.
 */
export type DemoDataState = "default" | "stale" | "empty" | "error";

export const DEMO_STATE_STORAGE_KEY = "ata-crm.mock-state.v1";

const VALID: readonly DemoDataState[] = ["default", "stale", "empty", "error"];

/** Read the requested state on the client. Returns "default" for anything odd. */
export function readDemoState(): DemoDataState {
  try {
    const raw = window.localStorage.getItem(DEMO_STATE_STORAGE_KEY);
    return VALID.includes(raw as DemoDataState) ? (raw as DemoDataState) : "default";
  } catch {
    // Storage can be unavailable (privacy mode); the default is always safe.
    return "default";
  }
}
