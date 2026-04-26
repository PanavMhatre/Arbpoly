import type { Platform } from "@/core/types";

export interface PlatformFeeConfig {
  takerRateBps: number;
  makerRateBps: number;
  conservativeFallbackBps: number;
  minFeeCents: number;
  roundingMode: "ceil-cent" | "none";
}

export const feeConfig: Record<Platform, PlatformFeeConfig> = {
  polymarket: {
    takerRateBps: 8,
    makerRateBps: 0,
    conservativeFallbackBps: 12,
    minFeeCents: 0,
    roundingMode: "none"
  },
  kalshi: {
    takerRateBps: 7,
    makerRateBps: 0,
    conservativeFallbackBps: 10,
    minFeeCents: 1,
    roundingMode: "ceil-cent"
  }
};
