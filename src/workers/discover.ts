import "@/lib/loadEnv";
import { matchingConfig } from "@config/matching";
import { discoverLiveMarkets } from "@/workers/live";
import { listMarkets } from "@/server/store";

async function main() {
  const markets =
    process.env.DATA_MODE === "live"
      ? await discoverLiveMarkets(Number.parseInt(process.env.DISCOVERY_LIMIT ?? String(matchingConfig.defaultDiscoveryLimit), 10))
      : listMarkets();
  console.log(
    JSON.stringify(
      {
        event: "discover_complete",
        marketCount: markets.length,
        platforms: {
          kalshi: markets.filter((market) => market.platform === "kalshi").length,
          polymarket: markets.filter((market) => market.platform === "polymarket").length
        }
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "discover_failed", message: error instanceof Error ? error.message : "Unknown error" }));
  process.exitCode = 1;
});
