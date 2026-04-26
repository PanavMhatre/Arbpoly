import type { NormalizedOrderbook, PlatformMarket } from "@/core/types";
import { normalizeKalshiOrderbook, normalizePolymarketOrderbook } from "@/core/orderbook/normalize";

const now = () => new Date().toISOString();
const closeTime = "2026-12-31T23:59:00Z";

export const mockKalshiMarkets: PlatformMarket[] = [
  {
    id: "kalshi-btc-100k-2026",
    platform: "kalshi",
    platformMarketId: "KXBTC-26DEC31-T100000",
    ticker: "KXBTC-26DEC31-T100000",
    title: "Will Bitcoin close above $100,000 on Dec 31, 2026?",
    description: "Resolves Yes if the official BTC/USD reference rate is above 100,000 at the close deadline.",
    rules: "Settlement uses the listed BTC/USD reference source at 23:59 UTC on Dec 31, 2026. Market may be voided for source disruption.",
    category: "Crypto",
    status: "open",
    closeTime,
    expirationTime: closeTime,
    resolutionSource: "BTC/USD reference rate",
    outcomeLabels: ["Yes", "No"],
    volume: 250_000,
    liquidity: 36_000,
    url: "https://kalshi.com/markets/kxbtc#market=KXBTC-26DEC31-T100000",
    rawJson: { fixture: true, series_ticker: "KXBTC" },
    createdAt: now(),
    updatedAt: now()
  },
  {
    id: "kalshi-lakers-game-2026",
    platform: "kalshi",
    platformMarketId: "KXNBA-LAL-20260410",
    ticker: "KXNBA-LAL-20260410",
    title: "Will the Lakers win their Apr 10, 2026 game?",
    description: "Single regular-season game market. Overtime counts. Postponement or cancellation may void.",
    rules: "Resolves from official NBA game result for the Apr 10 game only. Tie/push/void and postponement rules apply.",
    category: "Sports",
    status: "open",
    closeTime: "2026-04-10T23:30:00Z",
    expirationTime: "2026-04-11T06:00:00Z",
    resolutionSource: "NBA official result",
    outcomeLabels: ["Yes", "No"],
    volume: 18_500,
    liquidity: 2_000,
    url: "https://kalshi.com/markets/kxnba#market=KXNBA-LAL-20260410",
    rawJson: { fixture: true, series_ticker: "KXNBA" },
    createdAt: now(),
    updatedAt: now()
  }
];

export const mockPolymarketMarkets: PlatformMarket[] = [
  {
    id: "poly-btc-100k-2026",
    platform: "polymarket",
    platformMarketId: "pm-btc-100k-2026",
    conditionId: "0xb100000000000000000000000000000000000026",
    title: "Will Bitcoin close above $100,000 on December 31, 2026?",
    description: "This market resolves Yes if BTC/USD closes above $100,000 at the specified Dec 31, 2026 deadline.",
    rules: "Settlement uses the BTC/USD reference rate at 23:59 UTC on Dec 31, 2026. Source disruption may lead to cancellation.",
    category: "Crypto",
    status: "open",
    closeTime,
    expirationTime: closeTime,
    resolutionSource: "BTC/USD reference rate",
    outcomeLabels: ["Yes", "No"],
    outcomeTokenIds: { yes: "poly-yes-btc-100k-2026", no: "poly-no-btc-100k-2026" },
    volume: 410_000,
    liquidity: 52_000,
    url: "https://polymarket.com/event/bitcoin-above-100k-december-2026",
    rawJson: { fixture: true, slug: "bitcoin-above-100k-december-2026" },
    createdAt: now(),
    updatedAt: now()
  },
  {
    id: "poly-lakers-series-2026",
    platform: "polymarket",
    platformMarketId: "pm-lakers-series-2026",
    conditionId: "0xlakersseries2026",
    title: "Will the Lakers win their 2026 playoff series?",
    description: "Series market, not a single-game market. Resolves based on playoff series result if matchup occurs.",
    rules: "Different inclusion criteria from a regular-season game. Early close and cancellation behavior can differ.",
    category: "Sports",
    status: "open",
    closeTime: "2026-06-30T23:59:00Z",
    expirationTime: "2026-07-01T04:00:00Z",
    resolutionSource: "NBA official playoff results",
    outcomeLabels: ["Yes", "No"],
    outcomeTokenIds: { yes: "poly-yes-lakers-series", no: "poly-no-lakers-series" },
    volume: 95_000,
    liquidity: 12_000,
    url: "https://polymarket.com/event/lakers-playoff-series-2026",
    rawJson: { fixture: true, slug: "lakers-playoff-series-2026" },
    createdAt: now(),
    updatedAt: now()
  }
];

export function mockOrderbooks(timestamp = now()): Record<string, NormalizedOrderbook> {
  const kalshiBtc = normalizeKalshiOrderbook({
    marketId: "kalshi-btc-100k-2026",
    source: "mock",
    timestamp,
    yesBids: [
      { price: 0.54, quantity: 50 },
      { price: 0.55, quantity: 200 }
    ],
    noBids: [
      { price: 0.47, quantity: 180 },
      { price: 0.46, quantity: 120 }
    ]
  });

  const kalshiLakers = normalizeKalshiOrderbook({
    marketId: "kalshi-lakers-game-2026",
    source: "mock",
    timestamp,
    yesBids: [{ price: 0.49, quantity: 100 }],
    noBids: [{ price: 0.48, quantity: 100 }]
  });

  const polyBtc = normalizePolymarketOrderbook({
    marketId: "poly-btc-100k-2026",
    yesTokenId: "poly-yes-btc-100k-2026",
    noTokenId: "poly-no-btc-100k-2026",
    source: "mock",
    timestamp,
    yesBids: [{ price: 0.5, quantity: 120 }],
    yesAsks: [
      { price: 0.52, quantity: 150 },
      { price: 0.53, quantity: 300 }
    ],
    noBids: [{ price: 0.46, quantity: 100 }],
    noAsks: [{ price: 0.49, quantity: 140 }]
  });

  const polyLakers = normalizePolymarketOrderbook({
    marketId: "poly-lakers-series-2026",
    yesTokenId: "poly-yes-lakers-series",
    noTokenId: "poly-no-lakers-series",
    source: "mock",
    timestamp,
    yesBids: [{ price: 0.51, quantity: 200 }],
    yesAsks: [{ price: 0.55, quantity: 200 }],
    noBids: [{ price: 0.42, quantity: 200 }],
    noAsks: [{ price: 0.47, quantity: 200 }]
  });

  return {
    [kalshiBtc.marketId]: kalshiBtc,
    [kalshiLakers.marketId]: kalshiLakers,
    [polyBtc.marketId]: polyBtc,
    [polyLakers.marketId]: polyLakers
  };
}
