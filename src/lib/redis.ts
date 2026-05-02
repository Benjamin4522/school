import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function createRedisClient(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn("[Redis] REDIS_URL not set, using in-memory fallback");
    // Return a mock that won't crash the app
    return null as unknown as Redis;
  }

  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
    lazyConnect: true,
    connectTimeout: 10000,
  });

  client.on("error", (err) => {
    console.error("[Redis] Connection error:", err.message);
  });

  client.on("connect", () => {
    console.log("[Redis] Connected successfully");
  });

  return client;
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;

// ── OTP Operations ──
const OTP_PREFIX = "otp:";
const OTP_TTL = 300; // 5 minutes

export async function redisStoreOtp(email: string, codeHash: string): Promise<void> {
  if (!redis) return;
  const key = `${OTP_PREFIX}${email}`;
  await redis.setex(key, OTP_TTL, JSON.stringify({ codeHash, attempts: 0, createdAt: Date.now() }));
}

export async function redisGetOtp(email: string): Promise<{ codeHash: string; attempts: number } | null> {
  if (!redis) return null;
  const key = `${OTP_PREFIX}${email}`;
  const data = await redis.get(key);
  if (!data) return null;
  return JSON.parse(data);
}

export async function redisIncrementOtpAttempts(email: string): Promise<number> {
  if (!redis) return 0;
  const key = `${OTP_PREFIX}${email}`;
  const data = await redis.get(key);
  if (!data) return 0;
  const parsed = JSON.parse(data);
  parsed.attempts += 1;
  if (parsed.attempts >= 5) {
    await redis.del(key);
    return parsed.attempts;
  }
  const ttl = await redis.ttl(key);
  if (ttl > 0) {
    await redis.setex(key, ttl, JSON.stringify(parsed));
  }
  return parsed.attempts;
}

export async function redisDeleteOtp(email: string): Promise<void> {
  if (!redis) return;
  await redis.del(`${OTP_PREFIX}${email}`);
}

// ── Rate Limiting ──
const RATE_PREFIX = "rate_limit:";

export async function redisCheckRateLimit(
  identifier: string,
  type: "ip" | "email"
): Promise<{ allowed: boolean; remaining: number }> {
  if (!redis) return { allowed: true, remaining: 10 };
  const key = `${RATE_PREFIX}${type}:${identifier}`;
  const windowMs = 600; // 10 minutes in seconds
  const maxRequests = type === "ip" ? 10 : 5;

  const now = Date.now();
  const windowStart = now - 600000; // 10 minutes ago

  // Use Redis sorted set for sliding window rate limiting
  const multi = redis.multi();
  multi.zremrangebyscore(key, 0, windowStart);
  multi.zadd(key, now, `${now}:${Math.random()}`);
  multi.zcard(key);
  multi.expire(key, windowMs);
  const results = await multi.exec();

  const count = results?.[2]?.[1] as number;
  if (count > maxRequests) {
    // Remove the entry we just added since it's over limit
    await redis.zrem(key, `${now}:${Math.random()}`);
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: maxRequests - count };
}

// ── Resend Cooldown ──
const COOLDOWN_PREFIX = "cooldown:";

export async function redisSetResendCooldown(email: string, cooldownMs: number = 60000): Promise<void> {
  if (!redis) return;
  await redis.setex(`${COOLDOWN_PREFIX}${email}`, Math.ceil(cooldownMs / 1000), "1");
}

export async function redisIsResendCooldown(email: string): Promise<boolean> {
  if (!redis) return false;
  const exists = await redis.exists(`${COOLDOWN_PREFIX}${email}`);
  return exists === 1;
}

export async function redisGetResendCooldownRemaining(email: string): Promise<number> {
  if (!redis) return 0;
  const ttl = await redis.ttl(`${COOLDOWN_PREFIX}${email}`);
  return Math.max(0, ttl);
}

// ── Execution State ──
const EXEC_PREFIX = "exec:";

export async function redisSetExecution(jobId: string, data: Record<string, unknown>, ttl: number = 3600): Promise<void> {
  if (!redis) return;
  await redis.setex(`${EXEC_PREFIX}${jobId}`, ttl, JSON.stringify(data));
}

export async function redisGetExecution(jobId: string): Promise<Record<string, unknown> | null> {
  if (!redis) return null;
  const data = await redis.get(`${EXEC_PREFIX}${jobId}`);
  if (!data) return null;
  return JSON.parse(data);
}

export async function redisUpdateExecution(jobId: string, updates: Record<string, unknown>): Promise<void> {
  if (!redis) return;
  const existing = await redisGetExecution(jobId);
  if (existing) {
    const updated = { ...existing, ...updates };
    const ttl = await redis.ttl(`${EXEC_PREFIX}${jobId}`);
    await redis.setex(`${EXEC_PREFIX}${jobId}`, Math.max(ttl, 300), JSON.stringify(updated));
  }
}

// ── Live Stats ──
const STATS_KEY = "system:stats";

export async function redisGetStats(): Promise<Record<string, string>> {
  if (!redis) return {};
  return await redis.hgetall(STATS_KEY);
}

export async function redisSetStatsField(field: string, value: string): Promise<void> {
  if (!redis) return;
  await redis.hset(STATS_KEY, field, value);
}

export async function redisIncrementStats(field: string, amount: number = 1): Promise<void> {
  if (!redis) return;
  await redis.hincrby(STATS_KEY, field, amount);
}

// ── Circuit Breaker State ──
const CIRCUIT_PREFIX = "circuit:";

export async function redisGetCircuitState(serverId: string): Promise<"closed" | "open" | "half-open"> {
  if (!redis) return "closed";
  const state = await redis.get(`${CIRCUIT_PREFIX}${serverId}`);
  return (state as "closed" | "open" | "half-open") || "closed";
}

export async function redisSetCircuitState(serverId: string, state: "closed" | "open" | "half-open", ttl: number = 60): Promise<void> {
  if (!redis) return;
  await redis.setex(`${CIRCUIT_PREFIX}${serverId}`, ttl, state);
}

export async function redisIncrementFailures(serverId: string): Promise<number> {
  if (!redis) return 0;
  const key = `${CIRCUIT_PREFIX}failures:${serverId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 300); // 5 min window
  return count;
}

export async function redisResetFailures(serverId: string): Promise<void> {
  if (!redis) return;
  await redis.del(`${CIRCUIT_PREFIX}failures:${serverId}`);
}
