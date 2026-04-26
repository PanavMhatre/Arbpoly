export interface PolymarketOutcomeMapping {
  yesTokenId: string;
  noTokenId: string;
  labels: string[];
}

export function parseJsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function mapPolymarketOutcomes(outcomesInput: unknown, tokenIdsInput: unknown): PolymarketOutcomeMapping {
  const outcomes = parseJsonStringArray(outcomesInput);
  const tokenIds = parseJsonStringArray(tokenIdsInput);
  const yesIndex = outcomes.findIndex((label) => label.trim().toLowerCase() === "yes");
  const noIndex = outcomes.findIndex((label) => label.trim().toLowerCase() === "no");
  if (yesIndex < 0 || noIndex < 0 || !tokenIds[yesIndex] || !tokenIds[noIndex]) {
    throw new Error("Polymarket market does not expose a clean YES/NO token mapping");
  }
  return {
    yesTokenId: tokenIds[yesIndex],
    noTokenId: tokenIds[noIndex],
    labels: outcomes
  };
}
