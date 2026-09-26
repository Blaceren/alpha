import { describe, expect, it } from "vitest";
import { getCrmDataProvider, getCrmMutations } from "./provider";

/**
 * The composition root has to hand out ONE object.
 *
 * The provider builds its mutation-overlay adapter in its constructor
 * (docs/MUTATION_OVERLAY.md §3), so a second instance would be a second adapter
 * over the same storage: a note written through one could be missing from a read
 * through the other, intermittently, only in a browser. Identity is therefore a
 * behavioural contract, not a micro-optimisation — hence a test.
 */
describe("application provider composition", () => {
  it("gives the read accessor and the mutation accessor the same instance", () => {
    expect(getCrmMutations()).toBe(getCrmDataProvider());
  });

  it("caches: repeated calls never rebuild the provider", () => {
    expect(getCrmDataProvider()).toBe(getCrmDataProvider());
    expect(getCrmMutations()).toBe(getCrmMutations());
  });

  it("does not let the implicit and the explicit default state diverge", () => {
    expect(getCrmDataProvider("default")).toBe(getCrmDataProvider());
    expect(getCrmMutations("default")).toBe(getCrmDataProvider());
  });

  it("narrows rather than casts: both halves are real methods on that instance", () => {
    const provider = getCrmDataProvider();
    const mutations = getCrmMutations();
    expect(typeof provider.getUserNotes).toBe("function");
    expect(typeof mutations.addNote).toBe("function");
    expect(mutations).toBe(provider);
  });

  it("shares one mutation-overlay adapter, because it is one object", () => {
    // A functional write/read round-trip through these accessors would prove the
    // same thing, but only where a real localStorage exists: this environment's
    // `window.localStorage` is a broken Node shim without getItem, so the app
    // provider's storage degrades (correctly) to failing writes. Identity is the
    // property that matters and it holds regardless of the host storage.
    const provider = getCrmDataProvider() as unknown as { overlay: unknown };
    const mutations = getCrmMutations() as unknown as { overlay: unknown };
    expect(mutations.overlay).toBe(provider.overlay);
  });
});
