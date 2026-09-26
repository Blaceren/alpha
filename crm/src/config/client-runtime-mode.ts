/**
 * Client-side record of the resolved runtime mode.
 *
 * The mode is decided on the server and handed to `AppShell` as a prop. Some
 * client code that needs it — notably the data-provider accessors — sits below
 * React and cannot take a prop, so the shell publishes the value here once and
 * those modules read it.
 *
 * This is NOT a second source of truth and it is NOT authorization. It carries
 * the same non-secret "mock" | "api" string the prop already carries; its only
 * job is to let `getCrmDataProvider` refuse to build the mock provider in api
 * mode.
 *
 * The default is "mock" so that unit tests and Storybook-style renders that
 * mount a hook without the shell behave exactly as they did before this module
 * existed.
 */
import type { CrmRuntimeMode } from "@/config/runtime-mode";

let current: CrmRuntimeMode = "mock";

export function setClientRuntimeMode(mode: CrmRuntimeMode): void {
  current = mode;
}

export function getClientRuntimeMode(): CrmRuntimeMode {
  return current;
}

/** Test helper — restores the default so cases cannot leak into each other. */
export function resetClientRuntimeMode(): void {
  current = "mock";
}
