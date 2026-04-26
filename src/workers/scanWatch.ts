import "@/lib/loadEnv";
import { matchingConfig } from "@config/matching";
import { runScanOnceWithAi } from "@/server/store";
import { runLiveScan } from "@/workers/live";

const intervalMs = Number.parseInt(process.env.SCAN_INTERVAL_MS ?? "10000", 10);

async function tick() {
  if (process.env.DATA_MODE === "live") {
    await runLiveScan(Number.parseInt(process.env.DISCOVERY_LIMIT ?? String(matchingConfig.defaultDiscoveryLimit), 10));
  } else {
    await runScanOnceWithAi();
  }
  console.log(JSON.stringify({ event: "scan_watch_tick", at: new Date().toISOString(), dataMode: process.env.DATA_MODE ?? "mock" }));
}

async function main() {
  await tick();
  const handle = setInterval(() => {
    void tick().catch((error: unknown) => {
      console.error(JSON.stringify({ event: "scan_watch_tick_failed", message: error instanceof Error ? error.message : "Unknown error" }));
    });
  }, intervalMs);
  process.on("SIGINT", () => {
    clearInterval(handle);
    process.exit(0);
  });
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "scan_watch_failed", message: error instanceof Error ? error.message : "Unknown error" }));
  process.exitCode = 1;
});
