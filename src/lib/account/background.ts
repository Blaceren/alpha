/**
 * ACCOUNT RECOVERY — work that must not hold the response.
 *
 * A reset request answers the same for an address with an account and one
 * without. The words being the same is not enough: looking the account up,
 * writing a token and handing a message to a mail provider take time an unknown
 * address does not, and a response that waits for them tells the two apart by
 * the clock. So the route answers first and the work runs detached. This is a
 * long-lived Node server, not a function that is frozen after it responds, so
 * a detached promise runs to completion.
 *
 * Detached work never rejects into the void — every caller here already turns
 * its failures into audit rows — and tests can wait for it with `settle`.
 */
const pending = new Set<Promise<void>>();

export function runDetached(work: () => Promise<unknown>): void {
  const tracked: Promise<void> = (async () => {
    try {
      await work();
    } catch {
      /* The work audits its own failures; nothing here may surface a detail. */
    }
  })().finally(() => {
    pending.delete(tracked);
  });
  pending.add(tracked);
}

/** Wait for every detached task started so far. A test seam, and nothing else. */
export async function settleDetachedWork(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}
