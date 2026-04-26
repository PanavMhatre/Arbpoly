import "@/lib/loadEnv";
import { matchingConfig } from "@config/matching";
import { createAiMatcherFromEnv } from "@/core/matching/aiMatcher";
import { proposeMarketPairsWithAi } from "@/core/matching/matcher";
import { refreshPairsWithAi } from "@/server/store";
import { discoverLiveMarkets } from "@/workers/live";

const markets =
  process.env.DATA_MODE === "live"
    ? await discoverLiveMarkets(Number.parseInt(process.env.DISCOVERY_LIMIT ?? String(matchingConfig.defaultDiscoveryLimit), 10))
    : undefined;
const pairs = markets
  ? await proposeMarketPairsWithAi({
      kalshiMarkets: markets.filter((market) => market.platform === "kalshi"),
      polymarketMarkets: markets.filter((market) => market.platform === "polymarket"),
      includeReviewPairs: true,
      aiMatcher: createAiMatcherFromEnv()
    })
  : await refreshPairsWithAi(true);
console.log(
  JSON.stringify(
    {
      event: "match_complete",
      dataMode: process.env.DATA_MODE ?? "mock",
      marketCount: markets?.length,
      pairCount: pairs.length,
      aiMatchingEnabled: Boolean(process.env.GROQ_API_KEY) && process.env.AI_MATCHING_ENABLED !== "false",
      pairs: pairs.map((pair) => ({
        id: pair.id,
        score: pair.matchScore,
        status: pair.matchStatus,
        risk: pair.resolutionRisk,
        aiEquivalence: pair.scoreBreakdown.aiEquivalence,
        kalshi: pair.kalshiMarket.title,
        polymarket: pair.polymarketMarket.title
      }))
    },
    null,
    2
  )
);
