import { z } from "zod";
import { endpointCacheTtlMs } from "@config/rateLimits";
import type { NormalizedOrderbook, PlatformMarket } from "@/core/types";
import { normalizePolymarketOrderbook, toPriceLevels } from "@/core/orderbook/normalize";
import type { RateLimitScheduler } from "@/core/rateLimit/scheduler";
import { fetchJson, safeProviderError } from "@/platforms/http";
import { mapPolymarketOutcomes, parseJsonStringArray } from "@/platforms/polymarket/outcomes";

const GammaMarketSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    question: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    resolutionSource: z.string().optional(),
    endDate: z.string().optional(),
    closeTime: z.string().optional(),
    category: z.string().optional(),
    active: z.boolean().optional(),
    closed: z.boolean().optional(),
    conditionId: z.string().optional(),
    outcomes: z.unknown().optional(),
    clobTokenIds: z.unknown().optional(),
    volume: z.union([z.number(), z.string()]).optional(),
    liquidity: z.union([z.number(), z.string()]).optional(),
    slug: z.string().optional(),
    enableOrderBook: z.boolean().optional()
  })
  .passthrough();

const GammaMarketsSchema = z.array(GammaMarketSchema);

const ClobBookSchema = z.object({
  market: z.string().optional(),
  asset_id: z.string().optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  bids: z.array(z.object({ price: z.union([z.string(), z.number()]), size: z.union([z.string(), z.number()]) })).default([]),
  asks: z.array(z.object({ price: z.union([z.string(), z.number()]), size: z.union([z.string(), z.number()]) })).default([])
});

export class PolymarketClient {
  constructor(
    private readonly scheduler: RateLimitScheduler,
    private readonly gammaBaseUrl = "https://gamma-api.polymarket.com",
    private readonly clobBaseUrl = "https://clob.polymarket.com"
  ) {}

  async discoverMarkets(limit = 100): Promise<PlatformMarket[]> {
    const markets: PlatformMarket[] = [];
    const pageSize = Math.min(500, Math.max(1, limit));
    let offset = 0;
    try {
      while (markets.length < limit) {
        const url = new URL(`${this.gammaBaseUrl}/markets`);
        url.searchParams.set("limit", String(Math.min(pageSize, limit - markets.length)));
        url.searchParams.set("offset", String(offset));
        url.searchParams.set("active", "true");
        url.searchParams.set("closed", "false");
        const payload = await fetchJson({
          url: url.toString(),
          schema: GammaMarketsSchema,
          scheduler: this.scheduler,
          budgetKey: "polymarket.gamma",
          requestKey: `polymarket:gamma:markets:${url.searchParams.toString()}`,
          priority: 3,
          ttlMs: endpointCacheTtlMs.discovery
        });
        const page = payload.flatMap(toPlatformMarket);
        markets.push(...page);
        if (payload.length < pageSize) {
          break;
        }
        offset += pageSize;
      }
      return markets;
    } catch (error) {
      throw safeProviderError("Polymarket", error);
    }
  }

  async getOrderbook(market: PlatformMarket): Promise<NormalizedOrderbook> {
    const yesTokenId = market.outcomeTokenIds?.yes;
    const noTokenId = market.outcomeTokenIds?.no;
    if (!yesTokenId || !noTokenId) {
      throw new Error(`Missing Polymarket token mapping for ${market.id}`);
    }

    const [yesBook, noBook] = await Promise.all([this.getTokenBook(yesTokenId), this.getTokenBook(noTokenId)]);
    const timestamp = timestampFromBooks(yesBook.timestamp, noBook.timestamp);
    return normalizePolymarketOrderbook({
      marketId: market.id,
      yesTokenId,
      noTokenId,
      yesBids: toPriceLevels(yesBook.bids.map((level) => [level.price, level.size])),
      yesAsks: toPriceLevels(yesBook.asks.map((level) => [level.price, level.size])),
      noBids: toPriceLevels(noBook.bids.map((level) => [level.price, level.size])),
      noAsks: toPriceLevels(noBook.asks.map((level) => [level.price, level.size])),
      timestamp,
      source: "rest"
    });
  }

  private async getTokenBook(tokenId: string): Promise<z.infer<typeof ClobBookSchema>> {
    const url = new URL(`${this.clobBaseUrl}/book`);
    url.searchParams.set("token_id", tokenId);
    return fetchJson({
      url: url.toString(),
      schema: ClobBookSchema,
      scheduler: this.scheduler,
      budgetKey: "polymarket.clob.marketData",
      requestKey: `polymarket:clob:book:${tokenId}`,
      priority: 1,
      ttlMs: endpointCacheTtlMs.orderbook
    });
  }
}

function toPlatformMarket(market: z.infer<typeof GammaMarketSchema>): PlatformMarket[] {
  try {
    const now = new Date().toISOString();
    const mapping = mapPolymarketOutcomes(market.outcomes, market.clobTokenIds);
    const id = String(market.id);
    return [
      {
        id: `poly-${id}`,
        platform: "polymarket",
        platformMarketId: id,
        conditionId: market.conditionId,
        title: market.question ?? market.title ?? "Untitled Polymarket market",
        description: market.description,
        rules: market.description,
        category: market.category,
        status: market.closed ? "closed" : market.active === false ? "inactive" : "open",
        closeTime: market.closeTime ?? market.endDate,
        expirationTime: market.endDate,
        resolutionSource: market.resolutionSource,
        outcomeLabels: mapping.labels,
        outcomeTokenIds: { yes: mapping.yesTokenId, no: mapping.noTokenId },
        volume: numeric(market.volume),
        liquidity: numeric(market.liquidity),
        url: market.slug ? `https://polymarket.com/event/${market.slug}` : undefined,
        rawJson: sanitizeRecord(market),
        createdAt: now,
        updatedAt: now
      }
    ];
  } catch {
    return [];
  }
}

function numeric(value: string | number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timestampFromBooks(left: string | number | undefined, right: string | number | undefined): string {
  const values = [left, right]
    .map((value) => {
      if (typeof value === "number") {
        return value > 10_000_000_000 ? value : value * 1000;
      }
      if (typeof value === "string") {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) {
          return parsed > 10_000_000_000 ? parsed : parsed * 1000;
        }
        return new Date(value).getTime();
      }
      return 0;
    })
    .filter((value) => value > 0);
  return new Date(values.length ? Math.max(...values) : Date.now()).toISOString();
}

function sanitizeRecord(value: z.infer<typeof GammaMarketSchema>): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean" || entry === null) {
      output[key] = entry;
    }
  }
  const outcomes = parseJsonStringArray(value.outcomes);
  if (outcomes.length > 0) {
    output.outcomes = outcomes.join(",");
  }
  return output;
}
