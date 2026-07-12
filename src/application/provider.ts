/**
 * Application-layer access point to the data provider.
 * UI/components import from here (or hooks) — never from data/mock directly.
 * Phase 1A always resolves to the mock provider (env.CRM_MODE === "mock").
 */
import type { CrmDataProvider } from "@/data/contracts/CrmDataProvider";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import { env, isDevelopment } from "@/config/env";

let singleton: CrmDataProvider | null = null;

export function getCrmDataProvider(): CrmDataProvider {
  if (singleton) return singleton;

  switch (env.CRM_MODE) {
    case "mock":
    default:
      singleton = new MockCrmDataProvider({ delayMs: isDevelopment ? 150 : 0 });
      break;
  }
  return singleton;
}
