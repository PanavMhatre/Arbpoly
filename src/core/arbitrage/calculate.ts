import type {
  BinarySide,
  Direction,
  MatchedMarketPair,
  NormalizedOrderbook,
  Opportunity,
  OpportunityLeg,
  Platform,
  PublicScanConfig
} from "@/core/types";
import type { FeeModel } from "@/core/fees/model";
import { getAskLevels, getBestAsk } from "@/core/orderbook/normalize";
import { availableSize, calculateExecutableVwap } from "@/core/orderbook/vwap";
import { riskFlagsForPair } from "@/core/risk/resolutionRisk";

export interface ArbitrageInput {
  pair: MatchedMarketPair;
  polymarketBook: NormalizedOrderbook;
  kalshiBook: NormalizedOrderbook;
  feeModel: FeeModel;
  config: PublicScanConfig;
  nowMs?: number;
  excludeStale?: boolean;
}

export function calculateOpportunities(input: ArbitrageInput): Opportunity[] {
  const directions: Direction[] = ["POLYMARKET_YES_KALSHI_NO", "KALSHI_YES_POLYMARKET_NO"];
  return directions
    .map((direction) => calculateDirection(input, direction))
    .filter((opportunity): opportunity is Opportunity => opportunity !== null)
    .sort((a, b) => {
      const riskRank = riskSortValue(a.pair.resolutionRisk) - riskSortValue(b.pair.resolutionRisk);
      if (riskRank !== 0) {
        return riskRank;
      }
      return b.netEdge - a.netEdge;
    });
}

function calculateDirection(input: ArbitrageInput, direction: Direction): Opportunity | null {
  const nowMs = input.nowMs ?? Date.now();
  const staleAgeMs = Math.max(
    Math.max(0, nowMs - new Date(input.polymarketBook.timestamp).getTime()),
    Math.max(0, nowMs - new Date(input.kalshiBook.timestamp).getTime())
  );
  const stale = staleAgeMs > input.config.maxStalenessMs;

  if (stale && input.excludeStale !== false) {
    return null;
  }

  const legsSpec = legSpecs(direction);
  const polyLevels = getAskLevels(input.polymarketBook, legsSpec.polymarket.side);
  const kalshiLevels = getAskLevels(input.kalshiBook, legsSpec.kalshi.side);
  const maxSize = Math.min(availableSize(polyLevels), availableSize(kalshiLevels));

  if (maxSize < input.config.minSize) {
    return null;
  }

  const quantity = Math.min(input.config.scanQuantity, maxSize);
  const polyVwap = calculateExecutableVwap(polyLevels, quantity);
  const kalshiVwap = calculateExecutableVwap(kalshiLevels, quantity);

  if (!polyVwap.fullyFilled || !kalshiVwap.fullyFilled) {
    return null;
  }

  const polyFee = input.feeModel.estimate({
    platform: "polymarket",
    market: input.pair.polymarketMarket,
    side: legsSpec.polymarket.side,
    price: polyVwap.vwap,
    quantity,
    liquidityRole: "taker"
  });
  const kalshiFee = input.feeModel.estimate({
    platform: "kalshi",
    market: input.pair.kalshiMarket,
    side: legsSpec.kalshi.side,
    price: kalshiVwap.vwap,
    quantity,
    liquidityRole: "taker"
  });

  const totalCost = polyVwap.cost + kalshiVwap.cost;
  const grossCostPerContract = totalCost / quantity;
  const grossEdge = 1 - grossCostPerContract;
  const totalFeesPerContract = (polyFee.amount + kalshiFee.amount) / quantity;
  const slippageBuffer = input.config.slippageBufferCents / 100;
  const staleDataBuffer = input.config.staleDataBufferCents / 100;
  const fundingBuffer = input.config.fundingBufferCents / 100;
  const riskBuffer = slippageBuffer + staleDataBuffer + fundingBuffer;
  const netEdge = grossEdge - totalFeesPerContract - riskBuffer;
  const minNetEdge = input.config.minNetEdgeCents / 100;

  if (netEdge < minNetEdge) {
    return null;
  }

  const riskFlags = [
    ...riskFlagsForPair(input.pair),
    ...(stale ? [`Stale data: max leg age ${staleAgeMs}ms exceeds ${input.config.maxStalenessMs}ms.`] : []),
    ...(polyFee.uncertain || kalshiFee.uncertain ? ["Fee estimate uncertain; conservative fallback applied."] : [])
  ];

  const polyLeg: OpportunityLeg = {
    platform: "polymarket",
    marketId: input.polymarketBook.marketId,
    side: legsSpec.polymarket.side,
    vwap: polyVwap.vwap,
    bestAsk: getBestAsk(input.polymarketBook, legsSpec.polymarket.side),
    quantity,
    cost: polyVwap.cost,
    fee: polyFee
  };
  const kalshiLeg: OpportunityLeg = {
    platform: "kalshi",
    marketId: input.kalshiBook.marketId,
    side: legsSpec.kalshi.side,
    vwap: kalshiVwap.vwap,
    bestAsk: getBestAsk(input.kalshiBook, legsSpec.kalshi.side),
    quantity,
    cost: kalshiVwap.cost,
    fee: kalshiFee
  };

  return {
    id: `opp-${input.pair.id}-${direction}-${Math.round(nowMs / 1000)}`,
    matchedPairId: input.pair.id,
    pair: input.pair,
    direction,
    quantity,
    grossCost: Number(grossCostPerContract.toFixed(6)),
    grossEdge: Number(grossEdge.toFixed(6)),
    estimatedFees: Number(totalFeesPerContract.toFixed(6)),
    riskBuffer: Number(riskBuffer.toFixed(6)),
    netEdge: Number(netEdge.toFixed(6)),
    netEdgeBps: Number((netEdge * 10_000).toFixed(2)),
    maxSize: Number(maxSize.toFixed(6)),
    staleAgeMs,
    stale,
    liquidityDepth: {
      polymarket: availableSize(polyLevels),
      kalshi: availableSize(kalshiLevels)
    },
    riskFlags,
    platformRisks: {
      polymarket: [
        "CLOB orderbook can move before execution.",
        "Token/outcome mapping must be verified against condition ID and outcome labels."
      ],
      kalshi: [
        "Orderbook asks are implied from opposite-side bids.",
        "Fee rounding and settlement rules can differ from Polymarket."
      ]
    },
    legs: {
      polymarket: polyLeg,
      kalshi: kalshiLeg
    },
    formula: {
      totalCost: Number(grossCostPerContract.toFixed(6)),
      totalFees: Number(totalFeesPerContract.toFixed(6)),
      slippageBuffer,
      staleDataBuffer,
      fundingBuffer
    },
    detectedAt: new Date(nowMs).toISOString()
  };
}

function legSpecs(direction: Direction): Record<Platform, { side: BinarySide }> {
  if (direction === "POLYMARKET_YES_KALSHI_NO") {
    return {
      polymarket: { side: "YES" },
      kalshi: { side: "NO" }
    };
  }
  return {
    polymarket: { side: "NO" },
    kalshi: { side: "YES" }
  };
}

function riskSortValue(risk: MatchedMarketPair["resolutionRisk"]): number {
  if (risk === "LOW") {
    return 0;
  }
  if (risk === "MEDIUM") {
    return 1;
  }
  return 2;
}
