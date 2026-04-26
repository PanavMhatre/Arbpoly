export type Platform = "kalshi" | "polymarket";
export type BinarySide = "YES" | "NO";
export type LiquidityRole = "maker" | "taker";
export type MatchStatus = "confirmed" | "likely" | "needs_review" | "rejected";
export type ResolutionRisk = "LOW" | "MEDIUM" | "HIGH";
export type Direction = "POLYMARKET_YES_KALSHI_NO" | "KALSHI_YES_POLYMARKET_NO";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface PriceLevel {
  price: number;
  quantity: number;
}

export interface NormalizedOrderbook {
  platform: Platform;
  marketId: string;
  bestYesBid?: number;
  bestYesAsk?: number;
  bestNoBid?: number;
  bestNoAsk?: number;
  yesBidLevels: PriceLevel[];
  noBidLevels: PriceLevel[];
  yesAskLevels: PriceLevel[];
  noAskLevels: PriceLevel[];
  timestamp: string;
  source: "rest" | "websocket" | "mock";
}

export interface PlatformMarket {
  id: string;
  platform: Platform;
  platformMarketId: string;
  ticker?: string;
  conditionId?: string;
  title: string;
  description?: string;
  rules?: string;
  category?: string;
  status: string;
  closeTime?: string;
  expirationTime?: string;
  resolutionSource?: string;
  outcomeLabels: string[];
  outcomeTokenIds?: {
    yes?: string;
    no?: string;
  };
  url?: string;
  volume?: number;
  liquidity?: number;
  rawJson: JsonValue;
  createdAt: string;
  updatedAt: string;
}

export interface MatchWarning {
  code: string;
  message: string;
}

export interface MatchedMarketPair {
  id: string;
  kalshiMarketId: string;
  polymarketMarketId: string;
  kalshiMarket: PlatformMarket;
  polymarketMarket: PlatformMarket;
  matchScore: number;
  matchStatus: MatchStatus;
  resolutionRisk: ResolutionRisk;
  notes?: string;
  manualOverride: boolean;
  warnings: MatchWarning[];
  scoreBreakdown: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface OrderbookSnapshot {
  id: string;
  platformMarketId: string;
  orderbook: NormalizedOrderbook;
  sourceTimestamp: string;
  fetchedAt: string;
}

export interface FeeEstimate {
  platform: Platform;
  amount: number;
  rateBps: number;
  uncertain: boolean;
  notes: string[];
}

export interface OpportunityLeg {
  platform: Platform;
  marketId: string;
  side: BinarySide;
  vwap: number;
  bestAsk?: number;
  quantity: number;
  cost: number;
  fee: FeeEstimate;
}

export interface Opportunity {
  id: string;
  matchedPairId: string;
  pair: MatchedMarketPair;
  direction: Direction;
  quantity: number;
  grossCost: number;
  grossEdge: number;
  estimatedFees: number;
  riskBuffer: number;
  netEdge: number;
  netEdgeBps: number;
  maxSize: number;
  staleAgeMs: number;
  stale: boolean;
  liquidityDepth: {
    polymarket: number;
    kalshi: number;
  };
  riskFlags: string[];
  platformRisks: Record<Platform, string[]>;
  legs: {
    polymarket: OpportunityLeg;
    kalshi: OpportunityLeg;
  };
  formula: {
    totalCost: number;
    totalFees: number;
    slippageBuffer: number;
    staleDataBuffer: number;
    fundingBuffer: number;
  };
  detectedAt: string;
}

export interface PublicScanConfig {
  minNetEdgeCents: number;
  minSize: number;
  maxStalenessMs: number;
  includeReviewPairs: boolean;
  tradingEnabled: false;
  scanQuantity: number;
  slippageBufferCents: number;
  staleDataBufferCents: number;
  fundingBufferCents: number;
  aiMatchingEnabled: boolean;
  aiMatchingModel: string;
}

export interface ApiHealth {
  provider: Platform | "system";
  status: "ok" | "degraded" | "down";
  message: string;
  lastCheckedAt: string;
}
