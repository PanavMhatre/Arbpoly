import { describe, expect, it, vi } from "vitest";
import { rateLimitBudgets, type BudgetKey, type EndpointBudget } from "@config/rateLimits";
import { HttpStatusError, RateLimitScheduler, type SchedulerClock } from "@/core/rateLimit/scheduler";

function fakeClock(): SchedulerClock & { current: number } {
  return {
    current: 0,
    now() {
      return this.current;
    },
    async sleep(ms: number) {
      this.current += ms;
    },
    random() {
      return 0;
    }
  };
}

function budgetsWithKalshiRead(budget: EndpointBudget): Record<BudgetKey, EndpointBudget> {
  return { ...rateLimitBudgets, "kalshi.read": budget };
}

describe("rate-limit scheduler", () => {
  it("waits for token refill when a budget is exhausted", async () => {
    const clock = fakeClock();
    const scheduler = new RateLimitScheduler(
      budgetsWithKalshiRead({ capacity: 1, refillAmount: 1, refillIntervalMs: 1000, timeoutMs: 1000 }),
      clock
    );

    await scheduler.schedule({ budgetKey: "kalshi.read", requestKey: "one", priority: 1 }, async () => "one");
    await scheduler.schedule({ budgetKey: "kalshi.read", requestKey: "two", priority: 1 }, async () => "two");

    expect(clock.current).toBeGreaterThanOrEqual(1000);
  });

  it("opens 429 backoff without tight-loop retrying", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const clock = fakeClock();
    const scheduler = new RateLimitScheduler(undefined, clock);

    await expect(
      scheduler.schedule({ budgetKey: "polymarket.gamma", requestKey: "limited", priority: 3 }, async () => {
        throw new HttpStatusError(429, "limited");
      })
    ).rejects.toThrow("limited");

    const state = scheduler.getBudgetState("polymarket.gamma");
    expect(state.backoffUntilMs).toBeGreaterThan(clock.current);
    expect(state.consecutiveFailures).toBe(1);
    warn.mockRestore();
  });

  it("coalesces duplicate in-flight requests", async () => {
    const clock = fakeClock();
    const scheduler = new RateLimitScheduler(undefined, clock);
    let calls = 0;
    let resolveValue: (value: string) => void = () => undefined;
    const task = () =>
      new Promise<string>((resolve) => {
        calls += 1;
        resolveValue = resolve;
      });

    const first = scheduler.schedule({ budgetKey: "polymarket.clob.marketData", requestKey: "same-book", priority: 1 }, task);
    const second = scheduler.schedule({ budgetKey: "polymarket.clob.marketData", requestKey: "same-book", priority: 1 }, task);
    await Promise.resolve();
    resolveValue("ok");

    await expect(Promise.all([first, second])).resolves.toEqual(["ok", "ok"]);
    expect(calls).toBe(1);
  });
});
