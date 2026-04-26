import { riskConfig } from "@config/risk";
import { matchingConfig } from "@config/matching";
import type { MatchedMarketPair, MatchStatus, MatchWarning, PlatformMarket } from "@/core/types";
import { classifyResolutionRisk } from "@/core/risk/resolutionRisk";
import { aiMatchingConcurrency, maxAiPairsPerRun, minAiBaselineScore, type AiMarketMatcher, type AiMatchResult } from "@/core/matching/aiMatcher";

export interface ManualPairOverride {
  kalshiMarketId: string;
  polymarketMarketId: string;
  notes?: string;
  resolutionRisk?: "LOW" | "MEDIUM" | "HIGH";
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
] as const;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "it",
  "of",
  "on",
  "or",
  "the",
  "their",
  "this",
  "to",
  "will",
  "with",
  "yes",
  "no"
]);

const HARD_REJECT_WARNING_CODES = new Set(["deadline_far", "multi_outcome", "rejected"]);
const DAY_MS = 24 * 60 * 60 * 1000;
const featureCache = new WeakMap<PlatformMarket, MarketMatchFeatures>();

interface MatchScoreResult {
  score: number;
  breakdown: Record<string, number>;
  warnings: MatchWarning[];
}

export function normalizeTitle(title: string): string {
  const dateStandardized = title
    .replace(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g, (_match, month: string, day: string, year: string | undefined) => {
      const monthName = monthNameFromNumber(month);
      return `${monthName} ${Number(day)}${year ? ` ${normalizeYear(year)}` : ""}`;
    })
    .replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (_match, year: string, month: string, day: string) => {
      return `${monthNameFromNumber(month)} ${Number(day)} ${year}`;
    });

  return dateStandardized
    .toLowerCase()
    .replace(/\bjan(?:uary)?\b/g, "january")
    .replace(/\bfeb(?:ruary)?\b/g, "february")
    .replace(/\bmar(?:ch)?\b/g, "march")
    .replace(/\bapr(?:il)?\b/g, "april")
    .replace(/\bjun(?:e)?\b/g, "june")
    .replace(/\bjul(?:y)?\b/g, "july")
    .replace(/\baug(?:ust)?\b/g, "august")
    .replace(/\bsep(?:t(?:ember)?)?\b/g, "september")
    .replace(/\boct(?:ober)?\b/g, "october")
    .replace(/\bnov(?:ember)?\b/g, "november")
    .replace(/\bdec(?:ember)?\b/g, "december")
    .replace(/\bwill\b|\bmarket\b|\bresolve\b|\bkalshi\b|\bpolymarket\b/g, " ")
    .replace(/[$,]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenSimilarity(a: string, b: string): number {
  const left = new Set(importantTokens(a));
  const right = new Set(importantTokens(b));
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

export function importantTokens(title: string): string[] {
  return importantTokensFromNormalized(normalizeTitle(title));
}

function importantTokensFromNormalized(normalizedTitle: string): string[] {
  return normalizedTitle
    .split(" ")
    .map((token) => stemToken(token))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function scoreMarketPair(kalshiMarket: PlatformMarket, polymarketMarket: PlatformMarket): MatchScoreResult {
  return scoreMarketFeatures(featuresFor(kalshiMarket), featuresFor(polymarketMarket));
}

function scoreMarketFeatures(kalshiMarket: MarketMatchFeatures, polymarketMarket: MarketMatchFeatures): MatchScoreResult {
  const title = tokenSetSimilarity(kalshiMarket.tokenSet, polymarketMarket.tokenSet);
  const category = similarityFromTokenSets(kalshiMarket.categoryTokens, polymarketMarket.categoryTokens);
  const source = similarityFromTokenSets(kalshiMarket.sourceTokens, polymarketMarket.sourceTokens);
  const timeProximity = timeScoreFromFeatures(kalshiMarket, polymarketMarket);
  const outcomeCompatibility = kalshiMarket.binaryOutcome && polymarketMarket.binaryOutcome ? 1 : 0;
  const thresholdCompatibility = thresholdCompatibilityFromThresholds(kalshiMarket.threshold, polymarketMarket.threshold);
  const wordingPenalty = rulesWarningPenaltyFromFeatures(kalshiMarket, polymarketMarket);

  const score =
    title * 0.38 +
    category * 0.08 +
    source * 0.12 +
    timeProximity * 0.12 +
    outcomeCompatibility * 0.15 +
    thresholdCompatibility.score * 0.15 -
    wordingPenalty.penalty;

  const warnings = [...dateWarningsFromTimeScore(timeProximity), ...thresholdCompatibility.warnings, ...wordingPenalty.warnings];
  if (outcomeCompatibility < 1) {
    warnings.push({ code: "multi_outcome", message: "Outcome labels are not a clean YES/NO binary mapping." });
  }

  return {
    score: clamp(score),
    breakdown: { title, category, source, timeProximity, outcomeCompatibility, thresholdCompatibility: thresholdCompatibility.score },
    warnings
  };
}

export function classifyMatch(score: number, warnings: MatchWarning[], manualOverride: boolean): MatchStatus {
  if (manualOverride) {
    return "confirmed";
  }
  if (warnings.some((warning) => HARD_REJECT_WARNING_CODES.has(warning.code))) {
    return "rejected";
  }
  if (score >= 0.78) {
    return "likely";
  }
  if (score >= 0.55) {
    return "needs_review";
  }
  return "rejected";
}

export function proposeMarketPairs(args: {
  kalshiMarkets: PlatformMarket[];
  polymarketMarkets: PlatformMarket[];
  manualOverrides?: ManualPairOverride[];
  includeReviewPairs?: boolean;
}): MatchedMarketPair[] {
  const manualOverrides = args.manualOverrides ?? [];
  const manualKeys = new Map(
    manualOverrides.map((override) => [`${override.kalshiMarketId}:${override.polymarketMarketId}`, override])
  );
  const now = new Date().toISOString();
  const pairs: MatchedMarketPair[] = [];

  for (const candidate of generatePairCandidates(args.kalshiMarkets, args.polymarketMarkets, manualKeys)) {
    const { kalshiMarket, polymarketMarket, manualOverride } = candidate;
    const scored = candidate.scored ?? scoreMarketPair(kalshiMarket, polymarketMarket);
    const matchStatus = classifyMatch(scored.score, scored.warnings, Boolean(manualOverride));
    if (matchStatus === "rejected" && !manualOverride) {
      if (args.includeReviewPairs !== true || scored.score < matchingConfig.minReviewableRejectedScore) {
        continue;
      }
    }
    if (matchStatus === "needs_review" && args.includeReviewPairs !== true) {
      continue;
    }
    pairs.push(buildMatchedPair({ kalshiMarket, polymarketMarket, scored, matchStatus, manualOverride, now }));
  }

  return pairs.sort((a, b) => b.matchScore - a.matchScore);
}

export async function proposeMarketPairsWithAi(args: {
  kalshiMarkets: PlatformMarket[];
  polymarketMarkets: PlatformMarket[];
  manualOverrides?: ManualPairOverride[];
  includeReviewPairs?: boolean;
  aiMatcher?: AiMarketMatcher;
}): Promise<MatchedMarketPair[]> {
  const manualOverrides = args.manualOverrides ?? [];
  const manualKeys = new Map(
    manualOverrides.map((override) => [`${override.kalshiMarketId}:${override.polymarketMarketId}`, override])
  );
  const now = new Date().toISOString();
  const pairs: MatchedMarketPair[] = [];
  const aiMinBaseline = minAiBaselineScore();
  const baselineCandidates = generatePairCandidates(args.kalshiMarkets, args.polymarketMarkets, manualKeys).map((candidate) => ({
    ...candidate,
    key: `${candidate.kalshiMarket.id}:${candidate.polymarketMarket.id}`,
    baseline: candidate.scored ?? scoreMarketPair(candidate.kalshiMarket, candidate.polymarketMarket)
  }));

  const aiResults = new Map<string, AiMatchResult | null>();
  if (args.aiMatcher) {
    const aiLimit = maxAiPairsPerRun();
    const aiCandidates =
      aiLimit > 0
        ? baselineCandidates
            .filter((candidate) => Boolean(candidate.manualOverride) || candidate.baseline.score >= aiMinBaseline)
            .sort((a, b) => Number(Boolean(b.manualOverride)) - Number(Boolean(a.manualOverride)) || b.baseline.score - a.baseline.score)
            .slice(0, aiLimit)
        : [];

    await mapWithConcurrency(aiCandidates, aiMatchingConcurrency(), async (candidate) => {
      const aiResult = await args.aiMatcher?.scorePair(candidate.kalshiMarket, candidate.polymarketMarket, candidate.baseline);
      aiResults.set(candidate.key, aiResult ?? null);
    });
  }

  for (const candidate of baselineCandidates) {
    const { kalshiMarket, polymarketMarket, manualOverride } = candidate;
    const aiResult = aiResults.get(candidate.key) ?? null;
    const scored = aiResult ? mergeAiScore(candidate.baseline, aiResult) : candidate.baseline;
    const matchStatus = classifyAiAwareMatch(scored.score, scored.warnings, Boolean(manualOverride), aiResult);
    const reviewScore = Math.max(scored.score, candidate.baseline.score);

    if (matchStatus === "rejected" && !manualOverride) {
      if (args.includeReviewPairs !== true || reviewScore < matchingConfig.minReviewableRejectedScore) {
        continue;
      }
    }
    if (matchStatus === "needs_review" && args.includeReviewPairs !== true) {
      continue;
    }

    pairs.push(buildMatchedPair({ kalshiMarket, polymarketMarket, scored, matchStatus, manualOverride, now, aiResult }));
  }

  return pairs.sort((a, b) => b.matchScore - a.matchScore);
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, mapper: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        const item = items[index];
        if (item === undefined) {
          return;
        }
        await mapper(item);
      }
    })
  );
}

interface PairCandidate {
  kalshiMarket: PlatformMarket;
  polymarketMarket: PlatformMarket;
  manualOverride?: ManualPairOverride;
  scored?: MatchScoreResult;
}

function generatePairCandidates(
  kalshiMarkets: PlatformMarket[],
  polymarketMarkets: PlatformMarket[],
  manualKeys: Map<string, ManualPairOverride>
): PairCandidate[] {
  const polymarketById = new Map(polymarketMarkets.map((market) => [market.id, market]));
  const kalshiById = new Map(kalshiMarkets.map((market) => [market.id, market]));
  const kalshiFeatures = new Map(kalshiMarkets.map((market) => [market.id, featuresFor(market)]));
  const polymarketFeatures = new Map(polymarketMarkets.map((market) => [market.id, featuresFor(market)]));
  const tokenIndex = buildTokenIndex([...polymarketFeatures.values()]);
  const candidates: PairCandidate[] = [];
  const seen = new Set<string>();

  for (const [key, manualOverride] of manualKeys) {
    const [kalshiId, polymarketId] = key.split(":");
    const kalshiMarket = kalshiById.get(kalshiId);
    const polymarketMarket = polymarketById.get(polymarketId);
    if (kalshiMarket && polymarketMarket) {
      candidates.push({ kalshiMarket, polymarketMarket, manualOverride });
      seen.add(key);
    }
  }

  for (const kalshiMarket of kalshiMarkets) {
    const kalshiFeature = kalshiFeatures.get(kalshiMarket.id);
    if (!kalshiFeature) {
      continue;
    }
    const hitCounts = new Map<string, { hits: number; weight: number }>();
    const indexedTokens = kalshiFeature.tokens
      .map((token) => ({ token, indexed: tokenIndex.get(token) ?? [] }))
      .filter((entry) => entry.indexed.length > 0 && entry.indexed.length <= matchingConfig.candidateTokenLimit)
      .sort((a, b) => a.indexed.length - b.indexed.length)
      .slice(0, matchingConfig.maxIndexedTokensPerKalshiMarket);

    for (const { indexed } of indexedTokens) {
      const tokenWeight = 1 / Math.sqrt(indexed.length);
      for (const polymarketId of indexed) {
        const current = hitCounts.get(polymarketId) ?? { hits: 0, weight: 0 };
        current.hits += 1;
        current.weight += tokenWeight;
        hitCounts.set(polymarketId, current);
      }
    }

    const rankedCandidates = [...hitCounts.entries()]
      .filter(([, hit]) => hit.hits >= matchingConfig.minCandidateTokenOverlap)
      .sort((a, b) => b[1].hits - a[1].hits || b[1].weight - a[1].weight)
      .slice(0, matchingConfig.maxPreScoreCandidatesPerKalshiMarket)
      .map(([polymarketId, hit]) => {
        const polymarketMarket = polymarketById.get(polymarketId);
        if (!polymarketMarket) {
          return null;
        }
        const polymarketFeature = polymarketFeatures.get(polymarketId);
        if (!polymarketFeature) {
          return null;
        }
        const scored = scoreMarketFeatures(kalshiFeature, polymarketFeature);
        return { polymarketMarket, hits: hit.hits, weight: hit.weight, scored };
      })
      .filter((candidate): candidate is { polymarketMarket: PlatformMarket; hits: number; weight: number; scored: MatchScoreResult } => {
        return candidate !== null && candidate.scored.score >= matchingConfig.minCandidateBaselineScore;
      })
      .sort((a, b) => b.scored.score - a.scored.score || b.hits - a.hits || b.weight - a.weight)
      .slice(0, matchingConfig.maxCandidatesPerKalshiMarket);

    for (const candidate of rankedCandidates) {
      const key = `${kalshiMarket.id}:${candidate.polymarketMarket.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push({ kalshiMarket, polymarketMarket: candidate.polymarketMarket, scored: candidate.scored });
    }
  }

  return candidates;
}

function buildTokenIndex(markets: MarketMatchFeatures[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const market of markets) {
    for (const token of market.tokens) {
      const list = index.get(token);
      if (list) {
        list.push(market.market.id);
      } else {
        index.set(token, [market.market.id]);
      }
    }
  }
  return index;
}

interface MarketMatchFeatures {
  market: PlatformMarket;
  tokens: string[];
  tokenSet: Set<string>;
  categoryTokens?: Set<string>;
  sourceTokens?: Set<string>;
  normalizedSource?: string;
  eventDate?: ExtractedMarketDate;
  threshold?: PropThreshold;
  binaryOutcome: boolean;
  ruleWarnings: MatchWarning[];
}

function featuresFor(market: PlatformMarket): MarketMatchFeatures {
  const cached = featureCache.get(market);
  if (cached) {
    return cached;
  }

  const normalizedTitle = normalizeTitle(market.title);
  const tokens = [...new Set(importantTokensFromNormalized(normalizedTitle))];
  const normalizedSource = market.resolutionSource ? normalizeTitle(market.resolutionSource) : undefined;
  const features: MarketMatchFeatures = {
    market,
    tokens,
    tokenSet: new Set(tokens),
    categoryTokens: optionalTokenSet(market.category),
    sourceTokens: normalizedSource ? new Set(importantTokensFromNormalized(normalizedSource)) : undefined,
    normalizedSource,
    eventDate: marketEventDate(market),
    threshold: extractPropThreshold(market.title, normalizedTitle),
    binaryOutcome: isBinaryOutcome(market),
    ruleWarnings: marketRuleWarnings(market)
  };
  featureCache.set(market, features);
  return features;
}

function optionalTokenSet(value: string | undefined): Set<string> | undefined {
  if (!value) {
    return undefined;
  }
  return new Set(importantTokens(value));
}

function tokenSetSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  const smaller = left.size <= right.size ? left : right;
  const larger = left.size <= right.size ? right : left;
  for (const token of smaller) {
    if (larger.has(token)) {
      intersection += 1;
    }
  }
  return intersection / (left.size + right.size - intersection);
}

function similarityFromTokenSets(a: Set<string> | undefined, b: Set<string> | undefined): number {
  if (!a || !b) {
    return 0.35;
  }
  return tokenSetSimilarity(a, b);
}

function similarityValue(a: string | undefined, b: string | undefined): number {
  if (!a || !b) {
    return 0.35;
  }
  return tokenSimilarity(a, b);
}

function timeScore(a: PlatformMarket, b: PlatformMarket): number {
  return timeScoreFromFeatures(featuresFor(a), featuresFor(b));
}

function timeScoreFromFeatures(a: MarketMatchFeatures, b: MarketMatchFeatures): number {
  const leftEventDate = a.eventDate;
  const rightEventDate = b.eventDate;
  if (leftEventDate && rightEventDate && (leftEventDate.source === "explicit" || rightEventDate.source === "explicit")) {
    const dayDelta = Math.abs(startOfUtcDayMs(leftEventDate.timeMs) - startOfUtcDayMs(rightEventDate.timeMs)) / DAY_MS;
    if (dayDelta === 0) {
      return 1;
    }
    if (dayDelta <= 1) {
      return 0.35;
    }
    return 0;
  }

  const left = leftEventDate?.iso ?? a.market.closeTime ?? a.market.expirationTime;
  const right = rightEventDate?.iso ?? b.market.closeTime ?? b.market.expirationTime;
  if (!left || !right) {
    return 0.25;
  }
  const delta = Math.abs(new Date(left).getTime() - new Date(right).getTime());
  if (delta <= riskConfig.lowTimeDeltaMs) {
    return 1;
  }
  if (delta <= riskConfig.mediumTimeDeltaMs) {
    return 0.75;
  }
  if (delta <= riskConfig.highTimeDeltaMs) {
    return 0.35;
  }
  return 0;
}

function binaryOutcomeScore(a: PlatformMarket, b: PlatformMarket): number {
  return isBinaryOutcome(a) && isBinaryOutcome(b) ? 1 : 0;
}

function isBinaryOutcome(market: PlatformMarket): boolean {
  return market.outcomeLabels.map((label) => label.toLowerCase()).sort().join(",") === "no,yes";
}

function dateWarnings(a: PlatformMarket, b: PlatformMarket): MatchWarning[] {
  return dateWarningsFromTimeScore(timeScore(a, b));
}

function dateWarningsFromTimeScore(score: number): MatchWarning[] {
  if (score === 0) {
    return [{ code: "deadline_far", message: "Close/expiration times are too far apart; verify this is the same event window." }];
  }
  if (score < 0.75) {
    return [{ code: "deadline_mismatch", message: "Deadlines differ enough to create cutoff risk." }];
  }
  if (score < 1) {
    return [{ code: "deadline_slight", message: "Deadlines are close but not identical." }];
  }
  return [];
}

interface ExtractedMarketDate {
  timeMs: number;
  iso: string;
  source: "explicit" | "fallback";
}

function marketEventDate(market: PlatformMarket): ExtractedMarketDate | undefined {
  const fallbackYear = yearFromIso(market.closeTime ?? market.expirationTime);
  const explicit = extractExplicitDate(
    [market.platformMarketId, market.ticker, market.title, market.description, market.rules, market.url].filter(Boolean).join(" "),
    fallbackYear
  );
  if (explicit) {
    return explicit;
  }
  const fallback = market.closeTime ?? market.expirationTime;
  if (!fallback) {
    return undefined;
  }
  const timeMs = new Date(fallback).getTime();
  if (!Number.isFinite(timeMs)) {
    return undefined;
  }
  return { timeMs, iso: new Date(timeMs).toISOString(), source: "fallback" };
}

function extractExplicitDate(text: string, fallbackYear: number | undefined): ExtractedMarketDate | undefined {
  const lower = text.toLowerCase();
  const iso = lower.match(/\b(20\d{2})[-_/](\d{1,2})[-_/](\d{1,2})\b/);
  if (iso) {
    return buildExtractedDate(Number.parseInt(iso[1], 10), Number.parseInt(iso[2], 10), Number.parseInt(iso[3], 10));
  }

  const compact = lower.match(/\b(\d{2})(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\d{1,2})/);
  if (compact) {
    return buildExtractedDate(2000 + Number.parseInt(compact[1], 10), monthNumber(compact[2]), Number.parseInt(compact[3], 10));
  }

  const slash = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const year = slash[3] ? Number.parseInt(normalizeYear(slash[3]), 10) : fallbackYear;
    if (year) {
      return buildExtractedDate(year, Number.parseInt(slash[1], 10), Number.parseInt(slash[2], 10));
    }
  }

  const monthName = lower.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:\s*,?\s*(20\d{2}|\d{2}))?\b/
  );
  if (monthName) {
    const year = monthName[3] ? Number.parseInt(normalizeYear(monthName[3]), 10) : fallbackYear;
    if (year) {
      return buildExtractedDate(year, monthNumber(monthName[1]), Number.parseInt(monthName[2], 10));
    }
  }

  return undefined;
}

function buildExtractedDate(year: number, month: number, day: number): ExtractedMarketDate | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }
  const timeMs = Date.UTC(year, month - 1, day);
  const date = new Date(timeMs);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return { timeMs, iso: date.toISOString(), source: "explicit" };
}

function startOfUtcDayMs(timeMs: number): number {
  const date = new Date(timeMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function yearFromIso(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const year = new Date(value).getUTCFullYear();
  return Number.isFinite(year) ? year : undefined;
}

function monthNumber(value: string): number {
  const normalized = value.slice(0, 3).toLowerCase();
  const index = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(normalized);
  return index >= 0 ? index + 1 : 0;
}

function thresholdCompatibilityScore(aTitle: string, bTitle: string): { score: number; warnings: MatchWarning[] } {
  return thresholdCompatibilityFromThresholds(extractPropThreshold(aTitle), extractPropThreshold(bTitle));
}

function thresholdCompatibilityFromThresholds(
  left: PropThreshold | undefined,
  right: PropThreshold | undefined
): { score: number; warnings: MatchWarning[] } {
  if (!left && !right) {
    return { score: 0.5, warnings: [] };
  }
  if (!left || !right) {
    return {
      score: 0.35,
      warnings: [{ code: "threshold_unclear", message: "Only one side exposes an obvious prop threshold." }]
    };
  }
  if (left.stat && right.stat && left.stat !== right.stat) {
    return {
      score: 0,
      warnings: [{ code: "rejected", message: `Stat category mismatch: ${left.stat} vs ${right.stat}.` }]
    };
  }

  const compatible = thresholdsEquivalent(left, right);
  if (compatible === true) {
    return { score: 1, warnings: [] };
  }
  if (compatible === false) {
    return {
      score: 0,
      warnings: [{ code: "rejected", message: "Prop thresholds differ, so the contracts are not equivalent." }]
    };
  }
  return {
    score: 0.6,
    warnings: [{ code: "threshold_review", message: "Prop threshold could not be compared exactly; manual review required." }]
  };
}

interface PropThreshold {
  stat?: "points" | "rebounds" | "assists" | "steals" | "blocks" | "threePointers";
  plusThreshold?: number;
  overUnderThreshold?: number;
}

function extractPropThreshold(title: string, normalized = normalizeTitle(title)): PropThreshold | undefined {
  const stat = normalized.includes("assist")
    ? "assists"
    : normalized.includes("rebound")
      ? "rebounds"
      : normalized.includes("point")
        ? "points"
        : normalized.includes("steal")
          ? "steals"
          : normalized.includes("block")
            ? "blocks"
            : normalized.includes("3 pointer") || normalized.includes("three pointer")
              ? "threePointers"
              : undefined;
  const plus = title.match(/\b(\d+(?:\.\d+)?)\s*\+/);
  const overUnder = title.match(/\b(?:o\/u|over\s*\/\s*under|over under)\s*(\d+(?:\.\d+)?)\b/i);
  if (!stat && !plus && !overUnder) {
    return undefined;
  }
  return {
    stat,
    plusThreshold: plus ? Number.parseFloat(plus[1]) : undefined,
    overUnderThreshold: overUnder ? Number.parseFloat(overUnder[1]) : undefined
  };
}

function thresholdsEquivalent(left: PropThreshold, right: PropThreshold): boolean | undefined {
  if (left.plusThreshold !== undefined && right.overUnderThreshold !== undefined) {
    return nearlyEqual(left.plusThreshold, right.overUnderThreshold + 0.5);
  }
  if (right.plusThreshold !== undefined && left.overUnderThreshold !== undefined) {
    return nearlyEqual(right.plusThreshold, left.overUnderThreshold + 0.5);
  }
  if (left.plusThreshold !== undefined && right.plusThreshold !== undefined) {
    return nearlyEqual(left.plusThreshold, right.plusThreshold);
  }
  if (left.overUnderThreshold !== undefined && right.overUnderThreshold !== undefined) {
    return nearlyEqual(left.overUnderThreshold, right.overUnderThreshold);
  }
  return undefined;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001;
}

function rulesWarningPenalty(a: PlatformMarket, b: PlatformMarket): { penalty: number; warnings: MatchWarning[] } {
  return rulesWarningPenaltyFromFeatures(featuresFor(a), featuresFor(b));
}

function rulesWarningPenaltyFromFeatures(a: MarketMatchFeatures, b: MarketMatchFeatures): { penalty: number; warnings: MatchWarning[] } {
  const warnings = dedupeWarnings([...a.ruleWarnings, ...b.ruleWarnings]);
  const sourceMismatch = a.normalizedSource && b.normalizedSource && a.normalizedSource !== b.normalizedSource;
  if (sourceMismatch) {
    warnings.push({ code: "source_mismatch", message: "Resolution sources differ across platforms." });
  }
  return { penalty: Math.min(0.18, warnings.length * 0.035), warnings };
}

function marketRuleWarnings(market: PlatformMarket): MatchWarning[] {
  const combined = `${market.rules ?? ""} ${market.description ?? ""}`.toLowerCase();
  const warnings: MatchWarning[] = [];
  for (const term of riskConfig.warningTerms) {
    if (combined.includes(term)) {
      warnings.push({ code: `term_${term.replace(/\s+/g, "_")}`, message: `Rules mention ${term}; verify settlement edge cases.` });
    }
  }
  return warnings;
}

function dedupeWarnings(warnings: MatchWarning[]): MatchWarning[] {
  const seen = new Set<string>();
  const deduped: MatchWarning[] = [];
  for (const warning of warnings) {
    if (seen.has(warning.code)) {
      continue;
    }
    seen.add(warning.code);
    deduped.push(warning);
  }
  return deduped;
}

function clamp(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

function mergeAiScore(
  baseline: ReturnType<typeof scoreMarketPair>,
  aiResult: AiMatchResult
): ReturnType<typeof scoreMarketPair> {
  const score = clamp(baseline.score * 0.3 + aiResult.equivalenceScore * 0.7);
  const aiWarnings: MatchWarning[] = [
    ...aiResult.warnings,
    ...(aiResult.verdict === "not_equivalent"
      ? [{ code: "rejected", message: "AI matcher judged this pair not equivalent." }]
      : []),
    ...(aiResult.verdict === "needs_review" ? [{ code: "ai_needs_review", message: "AI matcher requires manual review." }] : []),
    ...(aiResult.rationale ? [{ code: "ai_rationale", message: `AI rationale: ${aiResult.rationale}` }] : [])
  ];

  return {
    score,
    breakdown: {
      ...baseline.breakdown,
      deterministic: baseline.score,
      aiEquivalence: aiResult.equivalenceScore,
      aiTitleSimilarity: aiResult.titleSimilarity,
      aiConfidence: aiResult.confidence
    },
    warnings: [...baseline.warnings, ...aiWarnings]
  };
}

function classifyAiAwareMatch(score: number, warnings: MatchWarning[], manualOverride: boolean, aiResult: AiMatchResult | null): MatchStatus {
  if (manualOverride) {
    return "confirmed";
  }
  if (warnings.some((warning) => HARD_REJECT_WARNING_CODES.has(warning.code))) {
    return "rejected";
  }
  if (aiResult?.verdict === "not_equivalent") {
    return "rejected";
  }
  if (aiResult?.verdict === "needs_review") {
    return "needs_review";
  }
  return classifyMatch(score, warnings, manualOverride);
}

function buildMatchedPair(args: {
  kalshiMarket: PlatformMarket;
  polymarketMarket: PlatformMarket;
  scored: ReturnType<typeof scoreMarketPair>;
  matchStatus: MatchStatus;
  manualOverride?: ManualPairOverride;
  now: string;
  aiResult?: AiMatchResult | null;
}): MatchedMarketPair {
  const baseRisk = classifyResolutionRisk({
    manualOverride: Boolean(args.manualOverride),
    score: args.scored.score,
    warnings: args.scored.warnings,
    kalshiMarket: args.kalshiMarket,
    polymarketMarket: args.polymarketMarket
  });
  const risk = args.manualOverride?.resolutionRisk ?? conservativeRisk(baseRisk, args.aiResult?.resolutionRisk);

  return {
    id: `pair-${args.kalshiMarket.id}-${args.polymarketMarket.id}`,
    kalshiMarketId: args.kalshiMarket.id,
    polymarketMarketId: args.polymarketMarket.id,
    kalshiMarket: args.kalshiMarket,
    polymarketMarket: args.polymarketMarket,
    matchScore: args.scored.score,
    matchStatus: args.matchStatus,
    resolutionRisk: risk,
    notes: args.manualOverride?.notes,
    manualOverride: Boolean(args.manualOverride),
    warnings: args.scored.warnings,
    scoreBreakdown: args.scored.breakdown,
    createdAt: args.now,
    updatedAt: args.now
  };
}

function conservativeRisk(baseRisk: "LOW" | "MEDIUM" | "HIGH", aiRisk: "LOW" | "MEDIUM" | "HIGH" | undefined): "LOW" | "MEDIUM" | "HIGH" {
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
  const byRank = ["LOW", "MEDIUM", "HIGH"] as const;
  return byRank[Math.max(rank[baseRisk], aiRisk ? rank[aiRisk] : 0)];
}

function monthNameFromNumber(value: string): string {
  const index = Number.parseInt(value, 10) - 1;
  return MONTH_NAMES[index] ?? value;
}

function normalizeYear(value: string): string {
  if (value.length === 2) {
    const year = Number.parseInt(value, 10);
    return String(year >= 70 ? 1900 + year : 2000 + year);
  }
  return value;
}

function stemToken(token: string): string {
  if (/^\d+$/.test(token)) {
    return token;
  }
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (/(ches|shes|sses|xes|zes)$/.test(token) && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}
