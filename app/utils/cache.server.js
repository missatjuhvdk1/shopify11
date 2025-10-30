// Simple in-memory cache with TTL for server runtime
// Note: For serverless deployments, consider persisting via Prisma instead.

const DEFAULT_TTL_MS = Number(process.env.METRICS_CACHE_TTL_MS || 5 * 60 * 1000);

const store = new Map();

function now() {
  return Date.now();
}

export function getCache(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCache(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, { value, expiresAt: now() + Number(ttlMs) });
}

export async function withCache(key, fetcher, ttlMs = DEFAULT_TTL_MS) {
  const hit = getCache(key);
  if (hit !== undefined) {
    return { value: hit, cache: "HIT" };
  }
  const value = await fetcher();
  setCache(key, value, ttlMs);
  return { value, cache: "MISS" };
}

