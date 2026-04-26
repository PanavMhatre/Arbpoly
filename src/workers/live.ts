import type { NormalizedOrderbook, PlatformMarket } from "@/core/types";
import { matchingConfig } from "@config/matching";
import { getPublicScanConfig } from "@/core/arbitrage/config";
import { createAiMatcherFromEnv } from "@/core/matching/aiMatcher";
import { proposeMarketPairsWithAi } from "@/core/matching/matcher";
import { RateLimitScheduler } from "@/core/rateLimit/scheduler";
import { KalshiClient } from "@/platforms/kalshi/client";
import { PolymarketClient } from "@/platforms/polymarket/client";
import { replaceStateForLiveData, runScanOnce } from "@/server/store";

export async function discoverLiveMarkets(limit: number = matchingConfig.defaultDiscoveryLimit): Promise<PlatformMarket[]> {
  const scheduler = new RateLimitScheduler();
  const kalshi = new KalshiClient(scheduler);
  const polymarket = new PolymarketClient(scheduler);
  const [kalshiMarkets, polymarketMarkets] = await Promise.all([kalshi.discoverMarkets(limit), polymarket.discoverMarkets(limit)]);
  return [...kalshiMarkets, ...polymarketMarkets];
}

export async function runLiveScan(limit: number = matchingConfig.defaultDiscoveryLimit): Promise<void> {
  const scheduler = new RateLimitScheduler();
  const kalshi = new KalshiClient(scheduler);
  const polymarket = new PolymarketClient(scheduler);
  const [kalshiMarkets, polymarketMarkets] = await Promise.all([kalshi.discoverMarkets(limit), polymarket.discoverMarkets(limit)]);
  const pairs = (await proposeMarketPairsWithAi({
    kalshiMarkets,
    polymarketMarkets,
    includeReviewPairs: getPublicScanConfig().includeReviewPairs,
    aiMatcher: createAiMatcherFromEnv()
  })).filter((pair) => pair.matchStatus === "likely" || pair.matchStatus === "confirmed");

  const orderbooks: Record<string, NormalizedOrderbook> = {};
  for (const pair of pairs.slice(0, matchingConfig.liveOrderbookPairLimit)) {
    const [kalshiBook, polymarketBook] = await Promise.allSettled([
      pair.kalshiMarket.ticker ? kalshi.getOrderbook(pair.kalshiMarket.ticker) : Promise.reject(new Error("Missing Kalshi ticker")),
      polymarket.getOrderbook(pair.polymarketMarket)
    ]);
    if (kalshiBook.status === "fulfilled") {
      orderbooks[pair.kalshiMarketId] = kalshiBook.value;
    }
    if (polymarketBook.status === "fulfilled") {
      orderbooks[pair.polymarketMarketId] = polymarketBook.value;
    }
  }

  replaceStateForLiveData([...kalshiMarkets, ...polymarketMarkets], orderbooks);
  runScanOnce();
}
