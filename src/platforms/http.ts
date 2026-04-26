import { HttpStatusError, type RateLimitScheduler } from "@/core/rateLimit/scheduler";
import { rateLimitBudgets } from "@config/rateLimits";

export async function fetchJson<T>(args: {
  url: string;
  schema: { parse(value: unknown): T };
  scheduler: RateLimitScheduler;
  budgetKey: Parameters<RateLimitScheduler["schedule"]>[0]["budgetKey"];
  requestKey: string;
  priority: Parameters<RateLimitScheduler["schedule"]>[0]["priority"];
  ttlMs?: number;
  init?: RequestInit;
}): Promise<T> {
  return args.scheduler.schedule(
    {
      budgetKey: args.budgetKey,
      requestKey: args.requestKey,
      priority: args.priority,
      ttlMs: args.ttlMs
    },
    async () => {
      const timeoutSignal = AbortSignal.timeout(rateLimitBudgets[args.budgetKey].timeoutMs);
      const signal = args.init?.signal ? AbortSignal.any([args.init.signal, timeoutSignal]) : timeoutSignal;
      const response = await fetch(args.url, {
        ...args.init,
        signal,
        headers: {
          accept: "application/json",
          ...(args.init?.headers ?? {})
        }
      });
      if (!response.ok) {
        throw new HttpStatusError(response.status, `Provider request failed with ${response.status}`);
      }
      const json: unknown = await response.json();
      return args.schema.parse(json);
    }
  );
}

export function safeProviderError(provider: string, error: unknown): Error {
  const status = typeof error === "object" && error !== null && "status" in error ? (error as { status?: unknown }).status : undefined;
  const statusText = typeof status === "number" ? ` status=${status}` : "";
  return new Error(`${provider} read failed${statusText}`);
}
