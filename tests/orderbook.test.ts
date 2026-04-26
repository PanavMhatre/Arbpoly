import { describe, expect, it } from "vitest";
import { mapPolymarketOutcomes } from "@/platforms/polymarket/outcomes";
import { normalizeKalshiOrderbook, normalizePrice } from "@/core/orderbook/normalize";
import { calculateExecutableVwap } from "@/core/orderbook/vwap";

describe("orderbook normalization", () => {
  it("normalizes prices into decimal dollars", () => {
    expect(normalizePrice("0.5200")).toBe(0.52);
    expect(normalizePrice(52)).toBe(0.52);
    expect(() => normalizePrice(101)).toThrow();
  });

  it("converts Kalshi bid-side depth into implied asks", () => {
    const book = normalizeKalshiOrderbook({
      marketId: "kalshi-test",
      yesBids: [{ price: 0.55, quantity: 10 }],
      noBids: [{ price: 0.47, quantity: 20 }],
      timestamp: "2026-01-01T00:00:00.000Z"
    });

    expect(book.bestYesBid).toBe(0.55);
    expect(book.bestYesAsk).toBe(0.53);
    expect(book.bestNoAsk).toBe(0.45);
    expect(book.noAskLevels[0]).toEqual({ price: 0.45, quantity: 10 });
  });

  it("maps Polymarket outcome labels to YES/NO tokens", () => {
    const mapping = mapPolymarketOutcomes('["No","Yes"]', '["no-token","yes-token"]');
    expect(mapping).toEqual({ yesTokenId: "yes-token", noTokenId: "no-token", labels: ["No", "Yes"] });
  });

  it("walks depth to compute executable VWAP", () => {
    const vwap = calculateExecutableVwap(
      [
        { price: 0.52, quantity: 10 },
        { price: 0.54, quantity: 20 }
      ],
      25
    );

    expect(vwap.fullyFilled).toBe(true);
    expect(vwap.cost).toBe(13.3);
    expect(vwap.vwap).toBe(0.532);
  });
});
