type RateLimitRecord = {
  count: number;
  resetAt: number;
};

const cache = new Map<string, RateLimitRecord>();

/**
 * Simple in-memory rate limiter.
 * In a real-world multi-node production environment, this should use Redis.
 */
export function rateLimit(key: string, limit: number = 100, windowMs: number = 60000) {
  const now = Date.now();
  const record = cache.get(key);

  if (!record || now > record.resetAt) {
    cache.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return {
      success: true,
      remaining: limit - 1,
      reset: now + windowMs,
    };
  }

  if (record.count >= limit) {
    return {
      success: false,
      remaining: 0,
      reset: record.resetAt,
    };
  }

  record.count += 1;
  return {
    success: true,
    remaining: limit - record.count,
    reset: record.resetAt,
  };
}

export function getClientIp(request: Request): string {
  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    return xForwardedFor.split(",")[0].trim();
  }
  return "127.0.0.1";
}
