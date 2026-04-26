import type { PublicScanConfig } from "@/core/types";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getPublicScanConfig(): PublicScanConfig {
  const aiMatchingModel = process.env.GROQ_MODEL ?? "llama-3.1-8b-instant";
  return {
    minNetEdgeCents: envNumber("MIN_NET_EDGE_CENTS", 0.25),
    minSize: envNumber("MIN_SIZE", 10),
    maxStalenessMs: envNumber("MAX_STALENESS_MS", 10_000),
    includeReviewPairs: process.env.INCLUDE_REVIEW_PAIRS === "true",
    tradingEnabled: false,
    scanQuantity: envNumber("SCAN_QUANTITY", 25),
    slippageBufferCents: envNumber("SLIPPAGE_BUFFER_CENTS", 0.15),
    staleDataBufferCents: envNumber("STALE_DATA_BUFFER_CENTS", 0.1),
    fundingBufferCents: envNumber("FUNDING_BUFFER_CENTS", 0.05),
    aiMatchingEnabled: Boolean(process.env.GROQ_API_KEY) && process.env.AI_MATCHING_ENABLED !== "false",
    aiMatchingModel
  };
}
