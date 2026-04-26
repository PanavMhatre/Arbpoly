import type { BudgetKey, EndpointBudget } from "@config/rateLimits";
import { rateLimitBudgets } from "@config/rateLimits";

export interface SchedulerClock {
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
}

export interface ScheduleOptions {
  budgetKey: BudgetKey;
  requestKey: string;
  priority: 0 | 1 | 2 | 3 | 4;
  ttlMs?: number;
  maxRetries?: number;
}

export interface BudgetState {
  tokens: number;
  backoffUntilMs: number;
  consecutiveFailures: number;
  circuitOpen: boolean;
}

class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(private readonly budget: EndpointBudget, nowMs: number) {
    this.tokens = budget.capacity;
    this.lastRefillMs = nowMs;
  }

  take(nowMs: number): boolean {
    this.refill(nowMs);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  waitMs(nowMs: number): number {
    this.refill(nowMs);
    if (this.tokens >= 1) {
      return 0;
    }
    if (this.budget.refillAmount <= 0) {
      return this.budget.timeoutMs;
    }
    return Math.max(1, this.budget.refillIntervalMs / this.budget.refillAmount);
  }

  snapshot(nowMs: number): number {
    this.refill(nowMs);
    return this.tokens;
  }

  reduceTemporarily(): void {
    this.tokens = Math.min(this.tokens, 0);
  }

  private refill(nowMs: number): void {
    if (this.budget.capacity <= 0 || this.budget.refillAmount <= 0) {
      this.tokens = 0;
      this.lastRefillMs = nowMs;
      return;
    }
    const elapsed = nowMs - this.lastRefillMs;
    if (elapsed <= 0) {
      return;
    }
    const refillUnits = elapsed / this.budget.refillIntervalMs;
    const refillTokens = refillUnits * this.budget.refillAmount;
    this.tokens = Math.min(this.budget.capacity, this.tokens + refillTokens);
    this.lastRefillMs = nowMs;
  }
}

interface CachedValue<T> {
  expiresAtMs: number;
  value: T;
}

interface FailureState {
  backoffUntilMs: number;
  consecutiveFailures: number;
  circuitOpenUntilMs: number;
}

export class RateLimitScheduler {
  private readonly buckets = new Map<BudgetKey, TokenBucket>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly cache = new Map<string, CachedValue<unknown>>();
  private readonly failures = new Map<BudgetKey, FailureState>();

  constructor(
    private readonly budgets: Record<BudgetKey, EndpointBudget> = rateLimitBudgets,
    private readonly clock: SchedulerClock = realClock
  ) {
    for (const key of Object.keys(budgets) as BudgetKey[]) {
      this.buckets.set(key, new TokenBucket(budgets[key], this.clock.now()));
    }
  }

  async schedule<T>(options: ScheduleOptions, task: () => Promise<T>): Promise<T> {
    const cached = this.readCache<T>(options.requestKey);
    if (cached.found) {
      return cached.value;
    }

    const existing = this.inFlight.get(options.requestKey);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = this.runWithControls(options, task).finally(() => {
      this.inFlight.delete(options.requestKey);
    });
    this.inFlight.set(options.requestKey, promise);
    return promise;
  }

  getBudgetState(key: BudgetKey): BudgetState {
    const failure = this.failures.get(key);
    return {
      tokens: Number((this.bucketFor(key).snapshot(this.clock.now())).toFixed(4)),
      backoffUntilMs: failure?.backoffUntilMs ?? 0,
      consecutiveFailures: failure?.consecutiveFailures ?? 0,
      circuitOpen: (failure?.circuitOpenUntilMs ?? 0) > this.clock.now()
    };
  }

  private async runWithControls<T>(options: ScheduleOptions, task: () => Promise<T>): Promise<T> {
    const maxRetries = options.maxRetries ?? 2;
    let attempt = 0;
    for (;;) {
      await this.awaitBudget(options);
      try {
        const result = await task();
        this.recordSuccess(options.budgetKey);
        if (options.ttlMs && options.ttlMs > 0) {
          this.cache.set(options.requestKey, {
            expiresAtMs: this.clock.now() + options.ttlMs,
            value: result
          });
        }
        return result;
      } catch (error) {
        const status = statusCode(error);
        if (status === 429) {
          this.recordFailure(options.budgetKey, attempt, true);
          throw error;
        }
        if (status >= 500 && status <= 599 && attempt < maxRetries) {
          this.recordFailure(options.budgetKey, attempt, false);
          attempt += 1;
          await this.clock.sleep(this.backoffMs(attempt));
          continue;
        }
        this.recordFailure(options.budgetKey, attempt, false);
        throw error;
      }
    }
  }

  private async awaitBudget(options: ScheduleOptions): Promise<void> {
    const failure = this.failures.get(options.budgetKey);
    const nowMs = this.clock.now();
    const blockedUntil = Math.max(failure?.backoffUntilMs ?? 0, failure?.circuitOpenUntilMs ?? 0);
    if (blockedUntil > nowMs) {
      await this.clock.sleep(blockedUntil - nowMs);
    }

    const bucket = this.bucketFor(options.budgetKey);
    while (!bucket.take(this.clock.now())) {
      await this.clock.sleep(bucket.waitMs(this.clock.now()));
    }
  }

  private recordSuccess(key: BudgetKey): void {
    this.failures.delete(key);
  }

  private recordFailure(key: BudgetKey, attempt: number, rateLimited: boolean): void {
    const current = this.failures.get(key);
    const consecutiveFailures = (current?.consecutiveFailures ?? 0) + 1;
    const backoffUntilMs = this.clock.now() + this.backoffMs(attempt + 1);
    const circuitOpenUntilMs = consecutiveFailures >= 4 ? this.clock.now() + 30_000 : current?.circuitOpenUntilMs ?? 0;
    this.failures.set(key, { backoffUntilMs, consecutiveFailures, circuitOpenUntilMs });
    if (rateLimited) {
      this.bucketFor(key).reduceTemporarily();
    }
    console.warn(
      JSON.stringify({
        level: "warn",
        event: rateLimited ? "rate_limited" : "provider_failure",
        providerBudget: key,
        backoffUntilMs,
        consecutiveFailures
      })
    );
  }

  private backoffMs(attempt: number): number {
    const base = 250 * 2 ** Math.max(0, attempt - 1);
    const jitter = this.clock.random() * 125;
    return Math.min(10_000, Math.round(base + jitter));
  }

  private bucketFor(key: BudgetKey): TokenBucket {
    const bucket = this.buckets.get(key);
    if (!bucket) {
      throw new Error(`Missing budget ${key}`);
    }
    return bucket;
  }

  private readCache<T>(key: string): { found: true; value: T } | { found: false } {
    const cached = this.cache.get(key);
    if (!cached) {
      return { found: false };
    }
    if (cached.expiresAtMs <= this.clock.now()) {
      this.cache.delete(key);
      return { found: false };
    }
    return { found: true, value: cached.value as T };
  }
}

export class HttpStatusError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function statusCode(error: unknown): number {
  if (error instanceof HttpStatusError) {
    return error.status;
  }
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : 0;
  }
  return 0;
}

const realClock: SchedulerClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random()
};
