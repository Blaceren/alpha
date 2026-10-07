type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitEntry>();

/* THE MAP IS BOUNDED (2026-10-07 audit). A key is kept per address and email,
   and nothing used to delete one: every distinct key ever seen stayed in memory
   for the life of the process. Expired buckets are now swept once the map
   passes SWEEP_AT (at most once a minute), and past MAX_BUCKETS the oldest are
   dropped — a dropped bucket only forgets a count, it never blocks anyone. */
const SWEEP_AT = 5_000;
const MAX_BUCKETS = 50_000;
const SWEEP_EVERY_MS = 60_000;
let lastSweepAt = 0;

function keepBounded(now: number) {
  if (buckets.size < SWEEP_AT) return;
  if (now - lastSweepAt >= SWEEP_EVERY_MS || buckets.size >= MAX_BUCKETS) {
    lastSweepAt = now;
    for (const [key, entry] of buckets) {
      if (entry.resetAt <= now) buckets.delete(key);
    }
  }
  // A Map iterates in insertion order, so the first keys are the oldest.
  for (const key of buckets.keys()) {
    if (buckets.size < MAX_BUCKETS) break;
    buckets.delete(key);
  }
}

// MVP/dev in-memory limiter. For production use Redis/Upstash/Cloudflare
// so limits are shared between instances and survive server restarts.
export function rateLimit(
  key: string,
  options: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + options.windowMs;
    keepBounded(now);
    buckets.set(key, { count: 1, resetAt });

    return {
      allowed: true,
      remaining: Math.max(options.limit - 1, 0),
      resetAt,
    };
  }

  if (existing.count >= options.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
    };
  }

  existing.count += 1;
  buckets.set(key, existing);

  return {
    allowed: true,
    remaining: Math.max(options.limit - existing.count, 0),
    resetAt: existing.resetAt,
  };
}

/**
 * Whether `key` is still under its limit — WITHOUT counting this call.
 *
 * For limits that count only some outcomes (sign-in counts wrong passwords, not
 * attempts): ask first, and `rateLimit` only when the outcome should count.
 */
export function peekRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    return { allowed: true, remaining: options.limit, resetAt: now + options.windowMs };
  }
  return {
    allowed: existing.count < options.limit,
    remaining: Math.max(options.limit - existing.count, 0),
    resetAt: existing.resetAt,
  };
}

/** Forget `key`'s count — a correct password clears the wrong ones before it. */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/** Test-only: how many keys are held, and a way to start from none. */
export function rateLimitBucketCountForTests(): number {
  return buckets.size;
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
  lastSweepAt = 0;
}

export function getRequestIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  }

  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}
