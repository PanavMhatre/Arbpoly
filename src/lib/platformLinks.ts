import type { PlatformMarket } from "@/core/types";

const KALSHI_HOST = "kalshi.com";
const POLYMARKET_HOST = "polymarket.com";

export function platformMarketUrl(market: PlatformMarket): string | undefined {
  return market.platform === "kalshi" ? kalshiMarketUrl(market) : polymarketMarketUrl(market);
}

export function buildKalshiMarketUrl(ticker?: string, seriesTicker?: string, fallbackUrl?: string): string | undefined {
  const normalizedTicker = clean(ticker);
  const normalizedSeriesTicker = clean(seriesTicker) ?? inferKalshiSeriesTicker(normalizedTicker);
  if (normalizedSeriesTicker) {
    const url = new URL(`https://${KALSHI_HOST}/markets/${encodeURIComponent(normalizedSeriesTicker.toLowerCase())}`);
    if (normalizedTicker) {
      url.hash = `market=${normalizedTicker}`;
    }
    return url.toString();
  }
  return trustedPlatformUrl(fallbackUrl, KALSHI_HOST);
}

export function buildPolymarketMarketUrl(slug?: string, fallbackUrl?: string): string | undefined {
  const normalizedSlug = clean(slug);
  if (normalizedSlug) {
    return `https://${POLYMARKET_HOST}/event/${encodeURIComponent(normalizedSlug)}`;
  }
  return trustedPlatformUrl(fallbackUrl, POLYMARKET_HOST);
}

function kalshiMarketUrl(market: PlatformMarket): string | undefined {
  return buildKalshiMarketUrl(
    market.ticker ?? market.platformMarketId,
    rawString(market, "series_ticker"),
    market.url
  );
}

function polymarketMarketUrl(market: PlatformMarket): string | undefined {
  return buildPolymarketMarketUrl(rawString(market, "slug"), market.url);
}

function inferKalshiSeriesTicker(ticker?: string): string | undefined {
  return ticker?.split("-")[0];
}

function rawString(market: PlatformMarket, key: string): string | undefined {
  const raw = market.rawJson;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const value = raw[key];
  return typeof value === "string" ? clean(value) : undefined;
}

function trustedPlatformUrl(value: string | undefined, expectedHost: string): string | undefined {
  const cleaned = clean(value);
  if (!cleaned) {
    return undefined;
  }
  try {
    const url = new URL(cleaned);
    const hostname = url.hostname.toLowerCase();
    const isExpectedHost = hostname === expectedHost || hostname.endsWith(`.${expectedHost}`);
    return isExpectedHost && (url.protocol === "https:" || url.protocol === "http:") ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
