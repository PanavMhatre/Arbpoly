import { z } from "zod";
import type { MatchWarning, PlatformMarket, ResolutionRisk } from "@/core/types";
import { RateLimitScheduler } from "@/core/rateLimit/scheduler";
import { rateLimitBudgets } from "@config/rateLimits";

export interface BaselineMatchScore {
  score: number;
  breakdown: Record<string, number>;
  warnings: MatchWarning[];
}

export interface AiMatchResult {
  equivalenceScore: number;
  titleSimilarity: number;
  confidence: number;
  verdict: "equivalent" | "needs_review" | "not_equivalent";
  resolutionRisk: ResolutionRisk;
  warnings: MatchWarning[];
  rationale: string;
}

export interface AiMarketMatcher {
  scorePair(kalshiMarket: PlatformMarket, polymarketMarket: PlatformMarket, baseline: BaselineMatchScore): Promise<AiMatchResult | null>;
}

const GroqChatResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullable()
      })
    })
  )
});

const AiMatchPayloadSchema = z.object({
  equivalenceScore: z.number().min(0).max(1),
  titleSimilarity: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  verdict: z.enum(["equivalent", "needs_review", "not_equivalent"]),
  resolutionRisk: z.enum(["LOW", "MEDIUM", "HIGH"]),
  warnings: z
    .array(
      z.union([
        z.string(),
        z
          .object({
            code: z.string().optional(),
            message: z.string().optional()
          })
          .passthrough()
      ])
    )
    .default([]),
  rationale: z.string().default("")
});

export class GroqMarketMatcher implements AiMarketMatcher {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly scheduler: RateLimitScheduler;
  private readonly endpoint = "https://api.groq.com/openai/v1/chat/completions";
  private disabledUntilMs = 0;

  constructor(args: { apiKey: string; model?: string; scheduler?: RateLimitScheduler }) {
    this.apiKey = args.apiKey;
    this.model = args.model ?? "llama-3.1-8b-instant";
    this.scheduler = args.scheduler ?? new RateLimitScheduler();
  }

  async scorePair(kalshiMarket: PlatformMarket, polymarketMarket: PlatformMarket, baseline: BaselineMatchScore): Promise<AiMatchResult | null> {
    if (Date.now() < this.disabledUntilMs) {
      return null;
    }
    const requestKey = `groq:match:${kalshiMarket.id}:${polymarketMarket.id}:${baseline.score}`;
    try {
      return await this.scheduler.schedule(
        {
          budgetKey: "ai.groq.matching",
          requestKey,
          priority: 2,
          ttlMs: 30 * 60_000,
          maxRetries: 1
        },
        async () => this.callGroq(kalshiMarket, polymarketMarket, baseline)
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("status 429")) {
        this.disabledUntilMs = Date.now() + 60_000;
      }
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "ai_match_failed",
          provider: "groq",
          message: error instanceof Error ? error.message : "Unknown Groq matching failure"
        })
      );
      return null;
    }
  }

  private async callGroq(
    kalshiMarket: PlatformMarket,
    polymarketMarket: PlatformMarket,
    baseline: BaselineMatchScore
  ): Promise<AiMatchResult | null> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(rateLimitBudgets["ai.groq.matching"].timeoutMs),
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        max_completion_tokens: 600,
        messages: [
          {
            role: "system",
            content:
              "You are a production-grade prediction-market matching engine evaluating real capital exposure. Compare Kalshi and Polymarket binary contracts with full scrutiny even when the surrounding app is read-only and cannot place orders. Return only strict JSON. Never claim risk-free equivalence. Penalize different cutoff times, resolution sources, void/tie/cancel rules, multi-outcome wording, and ambiguous wording."
          },
          {
            role: "user",
            content: JSON.stringify({
              task:
                "Score whether these two binary prediction markets are economically equivalent enough to be considered for live-grade arbitrage monitoring. Do not relax standards because no order will be executed by this app.",
              outputSchema: {
                equivalenceScore: "number 0..1",
                titleSimilarity: "number 0..1",
                confidence: "number 0..1",
                verdict: "equivalent | needs_review | not_equivalent",
                resolutionRisk: "LOW | MEDIUM | HIGH",
                warnings: "short string array",
                rationale: "one short sentence"
              },
              baseline,
              kalshi: marketPromptPayload(kalshiMarket),
              polymarket: marketPromptPayload(polymarketMarket)
            })
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Groq matching failed with status ${response.status}`);
    }

    const parsed = GroqChatResponseSchema.parse(await response.json());
    const content = parsed.choices[0]?.message.content;
    if (!content) {
      return null;
    }
    const json = extractJson(content);
    const payload = AiMatchPayloadSchema.parse(JSON.parse(json));
    return {
      equivalenceScore: payload.equivalenceScore,
      titleSimilarity: payload.titleSimilarity,
      confidence: payload.confidence,
      verdict: payload.verdict,
      resolutionRisk: payload.resolutionRisk,
      warnings: payload.warnings.map((warning, index) => ({
        code: `ai_warning_${index + 1}`,
        message: `AI match warning: ${typeof warning === "string" ? warning : warning.message ?? warning.code ?? "Manual review required."}`
      })),
      rationale: payload.rationale
    };
  }
}

export function createAiMatcherFromEnv(): AiMarketMatcher | undefined {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || process.env.AI_MATCHING_ENABLED === "false") {
    return undefined;
  }
  return new GroqMarketMatcher({
    apiKey,
    model: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant"
  });
}

export function minAiBaselineScore(): number {
  const parsed = Number.parseFloat(process.env.AI_MATCHING_MIN_BASELINE_SCORE ?? "0.45");
  return Number.isFinite(parsed) ? parsed : 0.45;
}

export function maxAiPairsPerRun(): number {
  const parsed = Number.parseInt(process.env.AI_MATCHING_MAX_PAIRS_PER_RUN ?? "4", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 4;
}

export function aiMatchingConcurrency(): number {
  const parsed = Number.parseInt(process.env.AI_MATCHING_CONCURRENCY ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 4) : 1;
}

function marketPromptPayload(market: PlatformMarket): Record<string, string | number | string[] | undefined> {
  return {
    id: market.id,
    platform: market.platform,
    title: market.title,
    description: truncate(market.description, 900),
    rules: truncate(market.rules, 900),
    category: market.category,
    closeTime: market.closeTime,
    expirationTime: market.expirationTime,
    resolutionSource: market.resolutionSource,
    outcomeLabels: market.outcomeLabels,
    volume: market.volume,
    liquidity: market.liquidity
  };
}

function truncate(value: string | undefined, limit: number): string | undefined {
  if (!value || value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}...`;
}

function extractJson(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Groq matching response did not contain JSON");
  }
  return trimmed.slice(start, end + 1);
}
