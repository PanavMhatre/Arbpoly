import { feeConfig, type PlatformFeeConfig } from "@config/fees";
import type { BinarySide, FeeEstimate, LiquidityRole, Platform, PlatformMarket } from "@/core/types";

export interface FeeQuoteInput {
  platform: Platform;
  market: PlatformMarket;
  side: BinarySide;
  price: number;
  quantity: number;
  liquidityRole: LiquidityRole;
  feeRateBpsOverride?: number;
}

export interface FeeModel {
  estimate(input: FeeQuoteInput): FeeEstimate;
}

export class ConfiguredFeeModel implements FeeModel {
  private readonly config: Record<Platform, PlatformFeeConfig>;

  constructor(config: Record<Platform, PlatformFeeConfig> = feeConfig) {
    this.config = config;
  }

  estimate(input: FeeQuoteInput): FeeEstimate {
    const platformConfig = this.config[input.platform];
    const notional = input.price * input.quantity;
    const rateBps =
      input.feeRateBpsOverride ??
      (input.liquidityRole === "maker" ? platformConfig.makerRateBps : platformConfig.takerRateBps);
    const uncertain = input.feeRateBpsOverride === undefined && platformConfig.conservativeFallbackBps > rateBps;
    const effectiveRateBps = uncertain ? platformConfig.conservativeFallbackBps : rateBps;
    const rawFee = notional * (effectiveRateBps / 10_000);
    const withMinFee = input.quantity > 0 ? Math.max(rawFee, platformConfig.minFeeCents / 100) : 0;
    const amount = platformConfig.roundingMode === "ceil-cent" ? Math.ceil(withMinFee * 100) / 100 : withMinFee;

    return {
      platform: input.platform,
      amount: Number(amount.toFixed(6)),
      rateBps: effectiveRateBps,
      uncertain,
      notes: uncertain
        ? [`Using conservative fallback ${effectiveRateBps} bps for ${input.platform} ${input.side}.`]
        : [`Using configured ${input.liquidityRole} rate ${effectiveRateBps} bps.`]
    };
  }
}
