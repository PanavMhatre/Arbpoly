import "@/lib/loadEnv";
import { matchingConfig } from "@config/matching";
import { listOpportunities, runScanOnceWithAi } from "@/server/store";
import { runLiveScan } from "@/workers/live";

async function main() {
  if (process.env.DATA_MODE === "live") {
    await runLiveScan(Number.parseInt(process.env.DISCOVERY_LIMIT ?? String(matchingConfig.defaultDiscoveryLimit), 10));
  } else {
    await runScanOnceWithAi();
  }
  const opportunities = listOpportunities();
  console.log(
    JSON.stringify(
      {
        event: "scan_once_complete",
        opportunityCount: opportunities.length,
        opportunities: opportunities.map((opportunity) => ({
          id: opportunity.id,
          direction: opportunity.direction,
          netEdge: opportunity.netEdge,
          netEdgeBps: opportunity.netEdgeBps,
          maxSize: opportunity.maxSize,
          risk: opportunity.pair.resolutionRisk,
          staleAgeMs: opportunity.staleAgeMs
        }))
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "scan_once_failed", message: error instanceof Error ? error.message : "Unknown error" }));
  process.exitCode = 1;
});
