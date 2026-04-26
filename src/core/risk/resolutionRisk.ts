import { riskConfig } from "@config/risk";
import type { MatchedMarketPair, MatchWarning, PlatformMarket, ResolutionRisk } from "@/core/types";

export function classifyResolutionRisk(args: {
  manualOverride: boolean;
  score: number;
  warnings: MatchWarning[];
  kalshiMarket: PlatformMarket;
  polymarketMarket: PlatformMarket;
}): ResolutionRisk {
  if (args.warnings.some((warning) => warning.code === "rejected" || warning.code === "multi_outcome")) {
    return "HIGH";
  }

  const timeDelta = closeTimeDeltaMs(args.kalshiMarket, args.polymarketMarket);
  const hasRules = Boolean(args.kalshiMarket.rules || args.kalshiMarket.description) && Boolean(args.polymarketMarket.rules || args.polymarketMarket.description);
  const sameSource = normalizedSource(args.kalshiMarket.resolutionSource) === normalizedSource(args.polymarketMarket.resolutionSource);

  if (args.manualOverride && args.score >= 0.85 && timeDelta <= riskConfig.lowTimeDeltaMs && sameSource && hasRules) {
    return "LOW";
  }

  if (args.score >= 0.72 && timeDelta <= riskConfig.mediumTimeDeltaMs && args.warnings.length <= 2) {
    return "MEDIUM";
  }

  return "HIGH";
}

export function riskFlagsForPair(pair: MatchedMarketPair): string[] {
  const flags = pair.warnings.map((warning) => warning.message);
  if (pair.resolutionRisk === "HIGH") {
    flags.push("High resolution-risk: verify settlement source, cutoff, and void/tie handling manually.");
  }
  if (!pair.manualOverride) {
    flags.push("Not manually confirmed.");
  }
  return [...new Set(flags)];
}

function closeTimeDeltaMs(a: PlatformMarket, b: PlatformMarket): number {
  const left = a.closeTime ?? a.expirationTime;
  const right = b.closeTime ?? b.expirationTime;
  if (!left || !right) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(new Date(left).getTime() - new Date(right).getTime());
}

function normalizedSource(source: string | undefined): string {
  return (source ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
