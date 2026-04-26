export const matchingConfig = {
  candidateTokenLimit: 150,
  maxIndexedTokensPerKalshiMarket: 8,
  maxPreScoreCandidatesPerKalshiMarket: 30,
  maxCandidatesPerKalshiMarket: 12,
  minCandidateTokenOverlap: 1,
  minCandidateBaselineScore: 0.18,
  minReviewableRejectedScore: 0.45,
  defaultDiscoveryLimit: 50_000,
  liveOrderbookPairLimit: 100
} as const;
