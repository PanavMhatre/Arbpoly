export interface EndpointBudget {
  capacity: number;
  refillAmount: number;
  refillIntervalMs: number;
  timeoutMs: number;
}

export type BudgetKey =
  | "kalshi.read"
  | "kalshi.write"
  | "polymarket.gamma"
  | "polymarket.data"
  | "polymarket.clob.marketData"
  | "polymarket.clob.trading"
  | "ai.groq.matching";

export const rateLimitBudgets: Record<BudgetKey, EndpointBudget> = {
  "kalshi.read": { capacity: 80, refillAmount: 80, refillIntervalMs: 10_000, timeoutMs: 10_000 },
  "kalshi.write": { capacity: 0, refillAmount: 0, refillIntervalMs: 10_000, timeoutMs: 10_000 },
  "polymarket.gamma": { capacity: 250, refillAmount: 250, refillIntervalMs: 10_000, timeoutMs: 10_000 },
  "polymarket.data": { capacity: 150, refillAmount: 150, refillIntervalMs: 10_000, timeoutMs: 10_000 },
  "polymarket.clob.marketData": { capacity: 400, refillAmount: 400, refillIntervalMs: 10_000, timeoutMs: 10_000 },
  "polymarket.clob.trading": { capacity: 0, refillAmount: 0, refillIntervalMs: 10_000, timeoutMs: 10_000 },
  "ai.groq.matching": { capacity: 4, refillAmount: 4, refillIntervalMs: 60_000, timeoutMs: 15_000 }
};

export const endpointCacheTtlMs = {
  orderbook: 1_500,
  marketMetadata: 10 * 60_000,
  discovery: 30 * 60_000
} as const;
