/**
 * Application-layer access point to the data boundary.
 * UI/components import from here (or hooks) — never from data/mock directly.
 * Phase 1A always resolves to the mock provider (env.CRM_MODE === "mock").
 */
import type { CrmDataProvider } from "@/data/contracts/CrmDataProvider";
import type { CrmMutations } from "@/data/contracts/CrmMutations";
import { MockCrmDataProvider, type MockProviderOptions } from "@/data/mock/MockCrmDataProvider";
import type { DemoDataState } from "@/config/demo-state";
import { isDevelopment } from "@/config/env";
import { getClientRuntimeMode } from "@/config/client-runtime-mode";

/**
 * One object implements both halves of the boundary: the read contract and the
 * mutation contract (`MockCrmDataProvider implements CrmDataProvider, CrmMutations`,
 * and `ApiCrmDataProvider` will do the same). The cache therefore holds the whole
 * object and the exported accessors only narrow it — they never build anything.
 *
 * This matters beyond tidiness: the provider owns a single mutation-overlay
 * adapter, created in its constructor (docs/MUTATION_OVERLAY.md §3). A second
 * instance would be a second adapter over the same storage, so a note written
 * through one could be missing from a read through the other.
 */
type CrmProvider = CrmDataProvider & CrmMutations;

const cache = new Map<DemoDataState, CrmProvider>();

/** Which mock mode each dev-only demo state reads through. */
const DEMO_OPTIONS: Record<DemoDataState, MockProviderOptions> = {
  default: {},
  stale: { staleMode: true },
  empty: { emptyMode: true },
  error: { errorMode: true },
};

/**
 * The single construction point. `state` is a DEV-ONLY affordance for reviewing
 * the stale/empty/error surfaces in a real browser (see config/demo-state.ts).
 * It is forced back to "default" outside development, it never affects what a
 * role may see, and the default call is exactly the singleton it always was.
 * Providers are cached per state so a re-render never rebuilds the dataset.
 */
function resolveProvider(state: DemoDataState): CrmProvider {
  // Fail closed before touching the cache: api mode has no data provider yet,
  // and the mock one must never stand in for it.
  if (getClientRuntimeMode() === "api") throw new MockProviderUnavailableError();

  const key: DemoDataState = isDevelopment ? state : "default";
  const cached = cache.get(key);
  if (cached) return cached;

  const provider = new MockCrmDataProvider({
    delayMs: isDevelopment ? 150 : 0,
    ...DEMO_OPTIONS[key],
  });
  cache.set(key, provider);
  return provider;
}

/**
 * Thrown when something reaches for CRM data in api mode. `ApiCrmDataProvider`
 * does not exist yet, and the one thing that must never happen is api mode
 * quietly falling back to the synthetic dataset: a confirmed production session
 * would then be looking at mock users, balances and notes believing them real.
 *
 * The shell already prevents this structurally — in api mode it never mounts the
 * feature routes — so this is the second line of defence, not the first.
 */
export class MockProviderUnavailableError extends Error {
  constructor() {
    super(
      "MockCrmDataProvider is not available in api mode. " +
        "CRM data APIs arrive with ApiCrmDataProvider in a later phase.",
    );
    this.name = "MockProviderUnavailableError";
  }
}

/** The read half of the boundary. */
export function getCrmDataProvider(state: DemoDataState = "default"): CrmDataProvider {
  return resolveProvider(state);
}

/**
 * The mutation half of the boundary — the same cached object as
 * `getCrmDataProvider(state)`, narrowed to what a caller may mutate. Narrowing
 * rather than casting is the point: a `as unknown as CrmMutations` over the read
 * accessor would compile even after the two drifted apart.
 */
export function getCrmMutations(state: DemoDataState = "default"): CrmMutations {
  return resolveProvider(state);
}
