/**
 * Application-layer access point to the data provider.
 * UI/components import from here (or hooks) — never from data/mock directly.
 * Phase 1A always resolves to the mock provider (env.CRM_MODE === "mock").
 */
import type { CrmDataProvider } from "@/data/contracts/CrmDataProvider";
import { MockCrmDataProvider, type MockProviderOptions } from "@/data/mock/MockCrmDataProvider";
import type { DemoDataState } from "@/config/demo-state";
import { env, isDevelopment } from "@/config/env";

const cache = new Map<DemoDataState, CrmDataProvider>();

/** Which mock mode each dev-only demo state reads through. */
const DEMO_OPTIONS: Record<DemoDataState, MockProviderOptions> = {
  default: {},
  stale: { staleMode: true },
  empty: { emptyMode: true },
  error: { errorMode: true },
};

/**
 * The provider for the current data state.
 *
 * `state` is a DEV-ONLY affordance for reviewing the stale/empty/error surfaces
 * in a real browser (see config/demo-state.ts). It is forced back to "default"
 * outside development, it never affects what a role may see, and the default
 * call is exactly the singleton it always was. Providers are cached per state so
 * a re-render never rebuilds the dataset.
 */
export function getCrmDataProvider(state: DemoDataState = "default"): CrmDataProvider {
  const key: DemoDataState = isDevelopment ? state : "default";
  const cached = cache.get(key);
  if (cached) return cached;

  switch (env.CRM_MODE) {
    case "mock":
    default: {
      const provider = new MockCrmDataProvider({
        delayMs: isDevelopment ? 150 : 0,
        ...DEMO_OPTIONS[key],
      });
      cache.set(key, provider);
      return provider;
    }
  }
}
