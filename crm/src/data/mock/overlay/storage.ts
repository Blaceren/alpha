/**
 * Minimal key-value storage seam for the mutation overlay.
 *
 * The overlay must be persistable in a browser, absent during SSR, and fully
 * controllable from unit tests without touching a real localStorage. That is
 * three consumers of one tiny interface, so the interface is the seam rather
 * than `typeof window` checks scattered through the provider.
 */

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory storage — the test double, and the SSR fallback. */
export class MemoryKeyValueStorage implements KeyValueStorage {
  private readonly entries: Map<string, string>;

  constructor(seed: Readonly<Record<string, string>> = {}) {
    this.entries = new Map(Object.entries(seed));
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }
}

/**
 * localStorage in a browser, memory everywhere else.
 *
 * The server must never read localStorage, and it never has to: a provider built
 * during SSR is a different instance from the client one, so the memory fallback
 * is only ever a placeholder that no user observes. Access is wrapped because
 * `window.localStorage` itself throws when storage is disabled (privacy mode).
 */
export function defaultOverlayStorage(): KeyValueStorage {
  if (typeof window === "undefined") return new MemoryKeyValueStorage();
  try {
    const ls = window.localStorage;
    if (!ls) return new MemoryKeyValueStorage();
    return {
      getItem: (key) => ls.getItem(key),
      setItem: (key, value) => ls.setItem(key, value),
      removeItem: (key) => ls.removeItem(key),
    };
  } catch {
    return new MemoryKeyValueStorage();
  }
}
