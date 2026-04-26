export const riskConfig = {
  lowTimeDeltaMs: 60 * 60_000,
  mediumTimeDeltaMs: 24 * 60 * 60_000,
  highTimeDeltaMs: 72 * 60 * 60_000,
  warningTerms: ["void", "cancel", "tie", "push", "source", "deadline", "timezone", "early close"],
  defaultResolutionRisk: "HIGH"
} as const;
