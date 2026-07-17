import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

/**
 * A working `window.localStorage` for the test environment.
 *
 * Why this exists: in this jsdom/Node combination `window.sessionStorage` is a
 * real jsdom `Storage`, but `window.localStorage` is a bare `{}` — it answers the
 * property and implements none of the methods. Anything relying on it (the D3-B
 * report store) would therefore never exercise its real path in tests, and would
 * silently fall back to the in-memory store.
 *
 * This is a TEST-ENVIRONMENT fix only. Production code does not assume storage
 * works: `createReportStore()` checks the shape and degrades to a non-durable
 * in-memory store, and the UI then tells the user local saving is unavailable.
 */
class TestStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

if (typeof window !== "undefined" && typeof window.localStorage?.setItem !== "function") {
  Object.defineProperty(window, "localStorage", {
    value: new TestStorage(),
    configurable: true,
    writable: true,
  });
}

// Storage must not leak between tests: a draft written by one case would
// otherwise become another case's starting state.
beforeEach(() => {
  window.localStorage?.clear?.();
  window.sessionStorage?.clear?.();
});

afterEach(() => {
  cleanup();
});
