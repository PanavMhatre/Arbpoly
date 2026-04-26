import type { NormalizedOrderbook, Platform, PriceLevel } from "@/core/types";

export function normalizePrice(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid price: ${String(value)}`);
  }
  const dollars = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
  if (dollars < 0 || dollars > 1) {
    throw new Error(`Price out of binary range: ${dollars}`);
  }
  return roundPrice(dollars);
}

export function normalizeQuantity(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid quantity: ${String(value)}`);
  }
  return Number(parsed.toFixed(6));
}

export function roundPrice(value: number): number {
  return Number(value.toFixed(6));
}

export function toPriceLevels(levels: ReadonlyArray<readonly [number | string, number | string]>): PriceLevel[] {
  return levels
    .map(([price, quantity]) => ({
      price: normalizePrice(price),
      quantity: normalizeQuantity(quantity)
    }))
    .filter((level) => level.quantity > 0);
}

export function sortBidLevels(levels: PriceLevel[]): PriceLevel[] {
  return [...levels].sort((a, b) => b.price - a.price);
}

export function sortAskLevels(levels: PriceLevel[]): PriceLevel[] {
  return [...levels].sort((a, b) => a.price - b.price);
}

export function impliedAskLevelsFromOppositeBids(oppositeBids: PriceLevel[]): PriceLevel[] {
  return sortAskLevels(
    oppositeBids.map((level) => ({
      price: roundPrice(1 - level.price),
      quantity: level.quantity
    }))
  );
}

export function topBid(levels: PriceLevel[]): number | undefined {
  return sortBidLevels(levels)[0]?.price;
}

export function topAsk(levels: PriceLevel[]): number | undefined {
  return sortAskLevels(levels)[0]?.price;
}

export interface KalshiOrderbookInput {
  marketId: string;
  yesBids: PriceLevel[];
  noBids: PriceLevel[];
  timestamp?: string;
  source?: NormalizedOrderbook["source"];
}

export function normalizeKalshiOrderbook(input: KalshiOrderbookInput): NormalizedOrderbook {
  const yesBidLevels = sortBidLevels(input.yesBids);
  const noBidLevels = sortBidLevels(input.noBids);
  const yesAskLevels = impliedAskLevelsFromOppositeBids(noBidLevels);
  const noAskLevels = impliedAskLevelsFromOppositeBids(yesBidLevels);

  return {
    platform: "kalshi",
    marketId: input.marketId,
    bestYesBid: topBid(yesBidLevels),
    bestNoBid: topBid(noBidLevels),
    bestYesAsk: topAsk(yesAskLevels),
    bestNoAsk: topAsk(noAskLevels),
    yesBidLevels,
    noBidLevels,
    yesAskLevels,
    noAskLevels,
    timestamp: input.timestamp ?? new Date().toISOString(),
    source: input.source ?? "rest"
  };
}

export interface PolymarketTokenBookInput {
  marketId: string;
  yesTokenId: string;
  noTokenId: string;
  yesBids: PriceLevel[];
  yesAsks: PriceLevel[];
  noBids: PriceLevel[];
  noAsks: PriceLevel[];
  timestamp?: string;
  source?: NormalizedOrderbook["source"];
}

export function normalizePolymarketOrderbook(input: PolymarketTokenBookInput): NormalizedOrderbook {
  const yesBidLevels = sortBidLevels(input.yesBids);
  const noBidLevels = sortBidLevels(input.noBids);
  const yesAskLevels = sortAskLevels(input.yesAsks);
  const noAskLevels = sortAskLevels(input.noAsks);

  return {
    platform: "polymarket",
    marketId: input.marketId,
    bestYesBid: topBid(yesBidLevels),
    bestNoBid: topBid(noBidLevels),
    bestYesAsk: topAsk(yesAskLevels),
    bestNoAsk: topAsk(noAskLevels),
    yesBidLevels,
    noBidLevels,
    yesAskLevels,
    noAskLevels,
    timestamp: input.timestamp ?? new Date().toISOString(),
    source: input.source ?? "rest"
  };
}

export function getAskLevels(book: NormalizedOrderbook, side: "YES" | "NO"): PriceLevel[] {
  return side === "YES" ? book.yesAskLevels : book.noAskLevels;
}

export function getBestAsk(book: NormalizedOrderbook, side: "YES" | "NO"): number | undefined {
  return side === "YES" ? book.bestYesAsk : book.bestNoAsk;
}

export function platformLabel(platform: Platform): string {
  return platform === "kalshi" ? "Kalshi" : "Polymarket";
}
