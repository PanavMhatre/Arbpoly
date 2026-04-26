import type { ApiHealth, MatchedMarketPair, NormalizedOrderbook, Opportunity, Platform, PlatformMarket } from "@/core/types";
import { matchingConfig } from "@config/matching";
import { getPublicScanConfig } from "@/core/arbitrage/config";
import { calculateOpportunities } from "@/core/arbitrage/calculate";
import { ConfiguredFeeModel } from "@/core/fees/model";
import { createAiMatcherFromEnv } from "@/core/matching/aiMatcher";
import { proposeMarketPairs, proposeMarketPairsWithAi, type ManualPairOverride } from "@/core/matching/matcher";
import { RateLimitScheduler } from "@/core/rateLimit/scheduler";
import { mockKalshiMarkets, mockOrderbooks, mockPolymarketMarkets } from "@/mocks/markets";
import { KalshiClient } from "@/platforms/kalshi/client";
import { PolymarketClient } from "@/platforms/polymarket/client";

export interface ScannerState {
  markets: PlatformMarket[];
  pairs: MatchedMarketPair[];
  orderbooks: Record<string, NormalizedOrderbook>;
  opportunities: Opportunity[];
  health: ApiHealth[];
  lastScanTime?: string;
  lastDiscoveryTime?: string;
  dataMode: "mock" | "live";
}

const state: ScannerState = {
  markets: [...mockKalshiMarkets, ...mockPolymarketMarkets],
  pairs: [],
  orderbooks: mockOrderbooks(),
  opportunities: [],
  health: [
    { provider: "system", status: "ok", message: "Capital-grade scanner initialized. AI matching activates when GROQ_API_KEY is set.", lastCheckedAt: new Date().toISOString() },
    { provider: "kalshi", status: "ok", message: "Read-only market-data client configured.", lastCheckedAt: new Date().toISOString() },
    { provider: "polymarket", status: "ok", message: "Read-only Gamma/CLOB clients configured.", lastCheckedAt: new Date().toISOString() }
  ],
  dataMode: "mock"
};

const liveCache = {
  marketsLoadedAtMs: 0,
  pairsLoadedAtMs: 0,
  discoveryPromise: undefined as Promise<PlatformMarket[]> | undefined,
  pairPromise: undefined as Promise<MatchedMarketPair[]> | undefined
};

const LIVE_DISCOVERY_TTL_MS = 15 * 60_000;
const LIVE_PAIR_TTL_MS = 5 * 60_000;

const manualOverrides: ManualPairOverride[] = [
  {
    kalshiMarketId: "kalshi-btc-100k-2026",
    polymarketMarketId: "poly-btc-100k-2026",
    notes: "Seeded manual confirmation for fixture data. Reconfirm rules before using live alerts.",
    resolutionRisk: "MEDIUM"
  }
];

export function getState(): ScannerState {
  return state;
}

export function listMarkets(platform?: Platform): PlatformMarket[] {
  return getState().markets.filter((market) => (platform ? market.platform === platform : true));
}

export function listPairs(): MatchedMarketPair[] {
  return getState().pairs;
}

export function listOpportunities(): Opportunity[] {
  return getState().opportunities;
}

export function getOpportunity(id: string): Opportunity | undefined {
  return getState().opportunities.find((opportunity) => opportunity.id === id);
}

export function addManualPair(input: ManualPairOverride): MatchedMarketPair[] {
  const existingIndex = manualOverrides.findIndex(
    (override) => override.kalshiMarketId === input.kalshiMarketId && override.polymarketMarketId === input.polymarketMarketId
  );
  if (existingIndex >= 0) {
    manualOverrides[existingIndex] = input;
  } else {
    manualOverrides.push(input);
  }
  refreshPairs(true);
  runScanOnce();
  return state.pairs;
}

export function refreshPairs(includeReviewPairs = getPublicScanConfig().includeReviewPairs): MatchedMarketPair[] {
  const kalshiMarkets = state.markets.filter((market) => market.platform === "kalshi");
  const polymarketMarkets = state.markets.filter((market) => market.platform === "polymarket");
  state.pairs = proposeMarketPairs({
    kalshiMarkets,
    polymarketMarkets,
    manualOverrides,
    includeReviewPairs
  });
  return state.pairs;
}

export async function refreshPairsWithAi(includeReviewPairs = getPublicScanConfig().includeReviewPairs): Promise<MatchedMarketPair[]> {
  if (isLiveMode()) {
    await ensureLivePairs(includeReviewPairs);
    return state.pairs;
  }

  const kalshiMarkets = state.markets.filter((market) => market.platform === "kalshi");
  const polymarketMarkets = state.markets.filter((market) => market.platform === "polymarket");
  state.pairs = await proposeMarketPairsWithAi({
    kalshiMarkets,
    polymarketMarkets,
    manualOverrides,
    includeReviewPairs,
    aiMatcher: createAiMatcherFromEnv()
  });
  return state.pairs;
}

export function runScanOnce(): Opportunity[] {
  const config = getPublicScanConfig();
  const feeModel = new ConfiguredFeeModel();
  const opportunities: Opportunity[] = [];
  refreshMockOrderbooksIfNeeded();
  const eligiblePairs = state.pairs.length > 0 ? state.pairs : refreshPairs(config.includeReviewPairs);

  for (const pair of eligiblePairs) {
    if (pair.matchStatus === "needs_review" && !config.includeReviewPairs) {
      continue;
    }
    if (pair.matchStatus === "rejected") {
      continue;
    }
    const polymarketBook = state.orderbooks[pair.polymarketMarketId];
    const kalshiBook = state.orderbooks[pair.kalshiMarketId];
    if (!polymarketBook || !kalshiBook) {
      continue;
    }
    opportunities.push(
      ...calculateOpportunities({
        pair,
        polymarketBook,
        kalshiBook,
        feeModel,
        config
      })
    );
  }

  state.opportunities = opportunities.sort((a, b) => b.netEdge - a.netEdge);
  state.lastScanTime = new Date().toISOString();
  state.health = state.health.map((entry) => ({ ...entry, lastCheckedAt: state.lastScanTime ?? entry.lastCheckedAt }));
  return state.opportunities;
}

export async function runScanOnceWithAi(): Promise<Opportunity[]> {
  const config = getPublicScanConfig();
  await refreshPairsWithAi(config.includeReviewPairs);
  return runScanOnce();
}

export function replaceStateForLiveData(markets: PlatformMarket[], orderbooks: Record<string, NormalizedOrderbook>): void {
  state.markets = markets;
  state.orderbooks = orderbooks;
  refreshPairs();
  runScanOnce();
}

function refreshMockOrderbooksIfNeeded(): void {
  if (process.env.DATA_MODE === "live") {
    return;
  }
  state.orderbooks = mockOrderbooks();
}

function isLiveMode(): boolean {
  return process.env.DATA_MODE === "live";
}

async function ensureLivePairs(includeReviewPairs: boolean): Promise<void> {
  const nowMs = Date.now();
  if (state.dataMode === "live" && state.pairs.length > 0 && nowMs - liveCache.pairsLoadedAtMs < LIVE_PAIR_TTL_MS) {
    return;
  }

  liveCache.pairPromise ??= loadLivePairs(includeReviewPairs).finally(() => {
    liveCache.pairPromise = undefined;
  });
  await liveCache.pairPromise;
}

async function loadLivePairs(includeReviewPairs: boolean): Promise<MatchedMarketPair[]> {
  await ensureLiveMarkets();
  const kalshiMarkets = state.markets.filter((market) => market.platform === "kalshi");
  const polymarketMarkets = state.markets.filter((market) => market.platform === "polymarket");
  console.info(
    JSON.stringify({
      level: "info",
      event: "live_pair_matching_started",
      kalshiMarketCount: kalshiMarkets.length,
      polymarketMarketCount: polymarketMarkets.length,
      includeReviewPairs
    })
  );

  state.pairs = await proposeMarketPairsWithAi({
    kalshiMarkets,
    polymarketMarkets,
    manualOverrides: [],
    includeReviewPairs,
    aiMatcher: createAiMatcherFromEnv()
  });
  state.dataMode = "live";
  liveCache.pairsLoadedAtMs = Date.now();
  console.info(
    JSON.stringify({
      level: "info",
      event: "live_pair_matching_completed",
      pairCount: state.pairs.length,
      visiblePairCount: state.pairs.filter((pair) => pair.matchStatus !== "rejected").length
    })
  );
  state.health = state.health.map((entry) =>
    entry.provider === "system"
      ? {
          ...entry,
          status: "ok",
          message: `Live discovery loaded ${kalshiMarkets.length} Kalshi and ${polymarketMarkets.length} Polymarket markets.`,
          lastCheckedAt: new Date().toISOString()
        }
      : entry
  );
  return state.pairs;
}

async function ensureLiveMarkets(): Promise<void> {
  const nowMs = Date.now();
  if (state.dataMode === "live" && state.markets.length > 0 && nowMs - liveCache.marketsLoadedAtMs < LIVE_DISCOVERY_TTL_MS) {
    return;
  }

  liveCache.discoveryPromise ??= discoverLiveMarketsForServer().finally(() => {
    liveCache.discoveryPromise = undefined;
  });
  state.markets = await liveCache.discoveryPromise;
  state.orderbooks = {};
  state.opportunities = [];
  state.dataMode = "live";
  state.lastDiscoveryTime = new Date().toISOString();
  liveCache.marketsLoadedAtMs = Date.now();
}

async function discoverLiveMarketsForServer(): Promise<PlatformMarket[]> {
  const scheduler = new RateLimitScheduler();
  const kalshi = new KalshiClient(scheduler);
  const polymarket = new PolymarketClient(scheduler);
  const limit = Number.parseInt(process.env.DISCOVERY_LIMIT ?? String(matchingConfig.defaultDiscoveryLimit), 10);
  console.info(JSON.stringify({ level: "info", event: "live_market_discovery_started", perProviderLimit: limit }));
  const [kalshiMarkets, polymarketMarkets] = await Promise.all([kalshi.discoverMarkets(limit), polymarket.discoverMarkets(limit)]);
  console.info(
    JSON.stringify({
      level: "info",
      event: "live_market_discovery_completed",
      kalshiMarketCount: kalshiMarkets.length,
      polymarketMarketCount: polymarketMarkets.length
    })
  );
  return [...kalshiMarkets, ...polymarketMarkets];
}
