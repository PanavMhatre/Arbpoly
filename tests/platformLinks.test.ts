import { describe, expect, it } from "vitest";
import { buildKalshiMarketUrl, buildPolymarketMarketUrl } from "@/lib/platformLinks";

describe("platform market links", () => {
  it("links Kalshi markets through the series page with the market anchor", () => {
    expect(buildKalshiMarketUrl("KXBTC-26DEC31-T100000", "KXBTC")).toBe(
      "https://kalshi.com/markets/kxbtc#market=KXBTC-26DEC31-T100000"
    );
  });

  it("infers Kalshi series tickers from full market tickers", () => {
    expect(buildKalshiMarketUrl("KXNBA-LAL-20260410")).toBe(
      "https://kalshi.com/markets/kxnba#market=KXNBA-LAL-20260410"
    );
  });

  it("links Polymarket markets by event slug", () => {
    expect(buildPolymarketMarketUrl("bitcoin-above-100k-december-2026")).toBe(
      "https://polymarket.com/event/bitcoin-above-100k-december-2026"
    );
  });
});
