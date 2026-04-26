import { z } from "zod";
import { endpointCacheTtlMs } from "@config/rateLimits";
import type { NormalizedOrderbook, PlatformMarket, PriceLevel } from "@/core/types";
import { normalizeKalshiOrderbook, toPriceLevels } from "@/core/orderbook/normalize";
import { fetchJson, safeProviderError } from "@/platforms/http";
import type { RateLimitScheduler } from "@/core/rateLimit/scheduler";
import { buildKalshiMarketUrl } from "@/lib/platformLinks";

const KalshiMarketSchema = z
  .object({
    ticker: z.string(),
    event_ticker: z.string().optional(),
    series_ticker: z.string().optional(),
    title: z.string().default("Untitled Kalshi market"),
    subtitle: z.string().optional(),
    rules_primary: z.string().optional(),
    rules_secondary: z.string().optional(),
    category: z.string().optional(),
    status: z.string().optional(),
    close_time: z.string().optional(),
    expiration_time: z.string().optional(),
    settlement_source: z.string().optional(),
    volume: z.number().optional(),
    liquidity: z.number().optional()
  })
  .passthrough();

const KalshiMarketsResponseSchema = z.object({
  markets: z.array(KalshiMarketSchema).default([]),
  cursor: z.string().optional()
});

const FixedPointLevelSchema = z.tuple([z.union([z.string(), z.number()]), z.union([z.string(), z.number()])]);
const KalshiOrderbookResponseSchema = z
  .object({
    orderbook_fp: z
      .object({
        yes_dollars: z.array(FixedPointLevelSchema).default([]),
        no_dollars: z.array(FixedPointLevelSchema).default([])
      })
      .optional(),
    orderbook: z
      .object({
        yes: z.array(FixedPointLevelSchema).default([]),
        no: z.array(FixedPointLevelSchema).default([])
      })
      .optional()
  })
  .passthrough();

export class KalshiClient {
  constructor(
    private readonly scheduler: RateLimitScheduler,
    private readonly baseUrl = "https://api.elections.kalshi.com/trade-api/v2"
  ) {}

  async discoverMarkets(limit = 100): Promise<PlatformMarket[]> {
    const markets: PlatformMarket[] = [];
    let cursor: string | undefined;
    const pageSize = Math.min(1000, Math.max(1, limit));
    try {
      while (markets.length < limit) {
        const url = new URL(`${this.baseUrl}/markets`);
        url.searchParams.set("limit", String(Math.min(pageSize, limit - markets.length)));
        url.searchParams.set("status", "open");
        if (cursor) {
          url.searchParams.set("cursor", cursor);
        }
        const payload = await fetchJson({
          url: url.toString(),
          schema: KalshiMarketsResponseSchema,
          scheduler: this.scheduler,
          budgetKey: "kalshi.read",
          requestKey: `kalshi:markets:${url.searchParams.toString()}`,
          priority: 3,
          ttlMs: endpointCacheTtlMs.discovery
        });
        markets.push(...payload.markets.map(toPlatformMarket));
        if (!payload.cursor || payload.markets.length === 0) {
          break;
        }
        cursor = payload.cursor;
      }
      return markets;
    } catch (error) {
      throw safeProviderError("Kalshi", error);
    }
  }

  async getOrderbook(ticker: string, depth = 100): Promise<NormalizedOrderbook> {
    const url = new URL(`${this.baseUrl}/markets/${encodeURIComponent(ticker)}/orderbook`);
    url.searchParams.set("depth", String(depth));
    try {
      const payload = await fetchJson({
        url: url.toString(),
        schema: KalshiOrderbookResponseSchema,
        scheduler: this.scheduler,
        budgetKey: "kalshi.read",
        requestKey: `kalshi:orderbook:${ticker}:${depth}`,
        priority: 1,
        ttlMs: endpointCacheTtlMs.orderbook
      });
      const orderbook = payload.orderbook_fp ?? payload.orderbook;
      const yesRaw = orderbook && "yes_dollars" in orderbook ? orderbook.yes_dollars : orderbook?.yes ?? [];
      const noRaw = orderbook && "no_dollars" in orderbook ? orderbook.no_dollars : orderbook?.no ?? [];
      return normalizeKalshiOrderbook({
        marketId: `kalshi-${ticker}`,
        yesBids: toPriceLevels(yesRaw) as PriceLevel[],
        noBids: toPriceLevels(noRaw) as PriceLevel[],
        source: "rest"
      });
    } catch (error) {
      throw safeProviderError("Kalshi", error);
    }
  }
}

function toPlatformMarket(market: z.infer<typeof KalshiMarketSchema>): PlatformMarket {
  const now = new Date().toISOString();
  return {
    id: `kalshi-${market.ticker}`,
    platform: "kalshi",
    platformMarketId: market.ticker,
    ticker: market.ticker,
    title: market.title,
    description: market.subtitle,
    rules: [market.rules_primary, market.rules_secondary].filter(Boolean).join("\n"),
    category: market.category,
    status: market.status ?? "open",
    closeTime: market.close_time,
    expirationTime: market.expiration_time,
    resolutionSource: market.settlement_source,
    outcomeLabels: ["Yes", "No"],
    volume: market.volume,
    liquidity: market.liquidity,
    url: buildKalshiMarketUrl(market.ticker, market.series_ticker),
    rawJson: sanitizeRecord(market),
    createdAt: now,
    updatedAt: now
  };
}

function sanitizeRecord(value: z.infer<typeof KalshiMarketSchema>): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean" || entry === null) {
      output[key] = entry;
    }
  }
  return output;
}
