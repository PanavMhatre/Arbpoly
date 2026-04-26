import { describe, expect, it } from "vitest";
import { calculateOpportunities } from "@/core/arbitrage/calculate";
import { ConfiguredFeeModel } from "@/core/fees/model";
import { classifyResolutionRisk } from "@/core/risk/resolutionRisk";
import { proposeMarketPairs, proposeMarketPairsWithAi, scoreMarketPair } from "@/core/matching/matcher";
import { mockKalshiMarkets, mockOrderbooks, mockPolymarketMarkets } from "@/mocks/markets";
import type { PublicScanConfig } from "@/core/types";

const config: PublicScanConfig = {
  minNetEdgeCents: 0.25,
  minSize: 10,
  maxStalenessMs: 10_000,
  includeReviewPairs: false,
  tradingEnabled: false,
  scanQuantity: 25,
  slippageBufferCents: 0.15,
  staleDataBufferCents: 0.1,
  fundingBufferCents: 0.05,
  aiMatchingEnabled: false,
  aiMatchingModel: "llama-3.1-8b-instant"
};

describe("fees and arbitrage", () => {
  it("estimates conservative taker fees", () => {
    const fee = new ConfiguredFeeModel().estimate({
      platform: "polymarket",
      market: mockPolymarketMarkets[0],
      side: "YES",
      price: 0.52,
      quantity: 25,
      liquidityRole: "taker"
    });

    expect(fee.uncertain).toBe(true);
    expect(fee.amount).toBeCloseTo(0.0156, 6);
  });

  it("calculates the sample Polymarket YES + Kalshi NO opportunity", () => {
    const pairs = proposeMarketPairs({
      kalshiMarkets: [mockKalshiMarkets[0]],
      polymarketMarkets: [mockPolymarketMarkets[0]],
      manualOverrides: [
        {
          kalshiMarketId: "kalshi-btc-100k-2026",
          polymarketMarketId: "poly-btc-100k-2026",
          resolutionRisk: "MEDIUM"
        }
      ]
    });
    const books = mockOrderbooks("2026-01-01T00:00:00.000Z");
    const opportunities = calculateOpportunities({
      pair: pairs[0],
      polymarketBook: books["poly-btc-100k-2026"],
      kalshiBook: books["kalshi-btc-100k-2026"],
      feeModel: new ConfiguredFeeModel(),
      config,
      nowMs: new Date("2026-01-01T00:00:02.000Z").getTime()
    });

    expect(opportunities[0].direction).toBe("POLYMARKET_YES_KALSHI_NO");
    expect(opportunities[0].grossCost).toBe(0.97);
    expect(opportunities[0].grossEdge).toBeCloseTo(0.03, 6);
    expect(opportunities[0].netEdge).toBeGreaterThan(0.02);
  });

  it("filters stale opportunities by default", () => {
    const pairs = proposeMarketPairs({
      kalshiMarkets: [mockKalshiMarkets[0]],
      polymarketMarkets: [mockPolymarketMarkets[0]],
      manualOverrides: [
        {
          kalshiMarketId: "kalshi-btc-100k-2026",
          polymarketMarketId: "poly-btc-100k-2026"
        }
      ]
    });
    const books = mockOrderbooks("2026-01-01T00:00:00.000Z");
    const opportunities = calculateOpportunities({
      pair: pairs[0],
      polymarketBook: books["poly-btc-100k-2026"],
      kalshiBook: books["kalshi-btc-100k-2026"],
      feeModel: new ConfiguredFeeModel(),
      config,
      nowMs: new Date("2026-01-01T00:01:00.000Z").getTime()
    });

    expect(opportunities).toHaveLength(0);
  });
});

describe("matching and risk", () => {
  it("scores matching market titles higher than false-positive titles", () => {
    const trueScore = scoreMarketPair(mockKalshiMarkets[0], mockPolymarketMarkets[0]).score;
    const falseScore = scoreMarketPair(mockKalshiMarkets[1], mockPolymarketMarkets[1]).score;
    expect(trueScore).toBeGreaterThan(falseScore);
  });

  it("keeps obvious non-matching cross-products out of review candidates", () => {
    const pairs = proposeMarketPairs({
      kalshiMarkets: [mockKalshiMarkets[1]],
      polymarketMarkets: [mockPolymarketMarkets[1]],
      includeReviewPairs: true
    });
    expect(pairs).toHaveLength(0);
  });

  it("normalizes natural and numeric date wording for title scoring", () => {
    const kalshiMarket = {
      ...mockKalshiMarkets[0],
      id: "kalshi-fed-march",
      platformMarketId: "KXFED-MARCH",
      ticker: "KXFED-MARCH",
      url: undefined,
      title: "Will Fed cut rates in March?",
      category: "Economics",
      resolutionSource: "Federal Reserve",
      description: "Resolves from Federal Reserve target rate decision.",
      rules: "Resolves Yes if the Federal Reserve cuts rates by the March meeting.",
      closeTime: "2026-03-31T20:00:00Z",
      expirationTime: "2026-03-31T20:00:00Z"
    };
    const polymarketMarket = {
      ...mockPolymarketMarkets[0],
      id: "poly-fed-march",
      platformMarketId: "fed-march",
      url: undefined,
      title: "Fed rate cut by 3/31 meeting?",
      category: "Economics",
      resolutionSource: "Federal Reserve",
      description: "Resolves from Federal Reserve target rate decision.",
      rules: "Resolves Yes if the Federal Reserve cuts rates by the March meeting.",
      closeTime: "2026-03-31T20:00:00Z",
      expirationTime: "2026-03-31T20:00:00Z"
    };

    expect(scoreMarketPair(kalshiMarket, polymarketMarket).score).toBeGreaterThan(0.7);
  });

  it("treats integer plus props as equivalent to half-point over/under props", () => {
    const kalshiMarket = {
      ...mockKalshiMarkets[1],
      title: "Rudy Gobert: 8+ rebounds",
      category: "Sports",
      closeTime: "2026-04-27T01:00:00Z",
      expirationTime: "2026-04-27T04:00:00Z",
      resolutionSource: "NBA official result",
      rules: "Official NBA box score."
    };
    const polymarketMarket = {
      ...mockPolymarketMarkets[1],
      title: "Rudy Gobert: Rebounds O/U 7.5",
      category: "Sports",
      closeTime: "2026-04-27T01:00:00Z",
      expirationTime: "2026-04-27T04:00:00Z",
      resolutionSource: "NBA official result",
      rules: "Official NBA box score."
    };

    const pair = proposeMarketPairs({
      kalshiMarkets: [kalshiMarket],
      polymarketMarkets: [polymarketMarket],
      includeReviewPairs: true
    })[0];

    expect(["likely", "needs_review"]).toContain(pair.matchStatus);
    expect(pair.scoreBreakdown.thresholdCompatibility).toBe(1);
  });

  it("uses explicit event dates from tickers and URLs before close-time fallbacks", () => {
    const kalshiMarket = {
      ...mockKalshiMarkets[1],
      id: "kalshi-KXNBAREB-26APR27MINDEN-MINJRANDLE30-7",
      platformMarketId: "KXNBAREB-26APR27MINDEN-MINJRANDLE30-7",
      ticker: "KXNBAREB-26APR27MINDEN-MINJRANDLE30-7",
      title: "Julius Randle: 7+ rebounds",
      category: "Sports",
      closeTime: "2026-05-12T02:30:00Z",
      expirationTime: "2026-05-12T02:30:00Z",
      resolutionSource: "NBA official result"
    };
    const correctDateMarket = {
      ...mockPolymarketMarkets[1],
      id: "poly-correct",
      platformMarketId: "correct",
      title: "Julius Randle: Rebounds O/U 6.5",
      category: "Sports",
      url: "https://polymarket.com/event/nba-min-den-2026-04-27-rebounds-julius-randle-6pt5",
      closeTime: "2026-04-28T02:30:00Z",
      expirationTime: "2026-04-28T02:30:00Z",
      resolutionSource: "NBA official result"
    };
    const wrongDateMarket = {
      ...correctDateMarket,
      id: "poly-wrong",
      platformMarketId: "wrong",
      url: "https://polymarket.com/event/nba-den-min-2026-04-25-rebounds-julius-randle-6pt5",
      closeTime: "2026-04-26T00:30:00Z",
      expirationTime: "2026-04-26T00:30:00Z"
    };

    const pairs = proposeMarketPairs({
      kalshiMarkets: [kalshiMarket],
      polymarketMarkets: [correctDateMarket, wrongDateMarket],
      includeReviewPairs: true
    });

    const correctPair = pairs.find((pair) => pair.polymarketMarketId === "poly-correct");
    const wrongPair = pairs.find((pair) => pair.polymarketMarketId === "poly-wrong");
    expect(correctPair?.matchStatus).not.toBe("rejected");
    expect(correctPair?.scoreBreakdown.timeProximity).toBe(1);
    expect(wrongPair?.matchStatus).toBe("rejected");
    expect(wrongPair?.warnings.some((warning) => warning.code === "deadline_far")).toBe(true);
  });

  it("rejects sports props with mismatched thresholds", () => {
    const kalshiMarket = {
      ...mockKalshiMarkets[1],
      title: "Rudy Gobert: 8+ rebounds",
      category: "Sports",
      closeTime: "2026-04-27T01:00:00Z",
      expirationTime: "2026-04-27T04:00:00Z",
      resolutionSource: "NBA official result"
    };
    const polymarketMarket = {
      ...mockPolymarketMarkets[1],
      title: "Rudy Gobert: Rebounds O/U 2.5",
      category: "Sports",
      closeTime: "2026-04-27T01:00:00Z",
      expirationTime: "2026-04-27T04:00:00Z",
      resolutionSource: "NBA official result"
    };

    const pair = proposeMarketPairs({
      kalshiMarkets: [kalshiMarket],
      polymarketMarkets: [polymarketMarket],
      includeReviewPairs: true
    })[0];

    expect(pair.matchStatus).toBe("rejected");
    expect(pair.warnings.some((warning) => warning.message.includes("thresholds differ"))).toBe(true);
  });

  it("rejects sports props with mismatched stat categories beyond points rebounds and assists", () => {
    const kalshiMarket = {
      ...mockKalshiMarkets[1],
      title: "Marcus Smart: 1+ steals",
      category: "Sports",
      closeTime: "2026-04-27T01:00:00Z",
      expirationTime: "2026-04-27T04:00:00Z",
      resolutionSource: "NBA official result"
    };
    const polymarketMarket = {
      ...mockPolymarketMarkets[1],
      title: "Marcus Smart: Rebounds O/U 0.5",
      category: "Sports",
      closeTime: "2026-04-27T01:00:00Z",
      expirationTime: "2026-04-27T04:00:00Z",
      resolutionSource: "NBA official result"
    };

    const scored = scoreMarketPair(kalshiMarket, polymarketMarket);

    expect(scored.warnings.some((warning) => warning.message.includes("Stat category mismatch"))).toBe(true);
  });

  it("classifies manually confirmed near-identical markets as low risk", () => {
    const risk = classifyResolutionRisk({
      manualOverride: true,
      score: 0.95,
      warnings: [],
      kalshiMarket: { ...mockKalshiMarkets[0], rules: "same", description: "same" },
      polymarketMarket: { ...mockPolymarketMarkets[0], rules: "same", description: "same" }
    });

    expect(risk).toBe("LOW");
  });

  it("uses AI matching output when an AI matcher is provided", async () => {
    const pairs = await proposeMarketPairsWithAi({
      kalshiMarkets: [mockKalshiMarkets[0]],
      polymarketMarkets: [mockPolymarketMarkets[0]],
      includeReviewPairs: true,
      aiMatcher: {
        async scorePair() {
          return {
            equivalenceScore: 0.94,
            titleSimilarity: 0.9,
            confidence: 0.86,
            verdict: "equivalent",
            resolutionRisk: "MEDIUM",
            warnings: [],
            rationale: "Same BTC threshold and close deadline."
          };
        }
      }
    });

    expect(pairs[0].scoreBreakdown.aiEquivalence).toBe(0.94);
    expect(pairs[0].matchScore).toBeGreaterThan(0.85);
  });

  it("lets AI reject a text-similar pair that needs review visibility", async () => {
    const pairs = await proposeMarketPairsWithAi({
      kalshiMarkets: [mockKalshiMarkets[0]],
      polymarketMarkets: [mockPolymarketMarkets[0]],
      includeReviewPairs: true,
      aiMatcher: {
        async scorePair() {
          return {
            equivalenceScore: 0.12,
            titleSimilarity: 0.7,
            confidence: 0.9,
            verdict: "not_equivalent",
            resolutionRisk: "HIGH",
            warnings: [{ code: "ai_warning_1", message: "AI match warning: Settlement source differs." }],
            rationale: "Different settlement source."
          };
        }
      }
    });

    expect(pairs[0].matchStatus).toBe("rejected");
    expect(pairs[0].resolutionRisk).toBe("HIGH");
  });
});
