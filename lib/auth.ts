export function isAuthorized(authorization: string | null, apiKey: string | undefined): boolean {
  if (!apiKey) return true;
  if (!authorization) return false;
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : authorization.trim();
  return token.length > 0 && token === apiKey;
}

export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return function allow(key: string, now = Date.now()): boolean {
    const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

export const apiLimiter = createRateLimiter(60, 60_000);
