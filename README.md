# ArbPoly

ArbPoly is a read-only prediction-market arbitrage scanner for comparable binary contracts on Kalshi and Polymarket. It normalizes YES/NO orderbooks, walks executable depth for VWAP, estimates fees and buffers, scores market-pair equivalence risk, and surfaces only risk-labeled opportunities.

This is a research and monitoring tool only. It is not financial, legal, tax, or investment advice. Opportunities are not guaranteed profits; settlement rules, fees, slippage, stale data, outages, cancellation behavior, and platform-specific constraints can erase or reverse any displayed edge.

## Safety Posture

- Trading is disabled in this build. `TRADING_ENABLED` is hard-coded false in public config and no live order placement code exists.
- The scanner is read-only and uses public market-data endpoints or fixture data.
- Rate-limit handling uses per-provider token buckets, TTL cache, request coalescing, and exponential backoff with jitter.
- It does not implement proxy rotation, API-key cycling, CAPTCHA bypassing, multi-account bypassing, scraping behind auth, or platform-limit evasion.
- Secrets are never logged. CLI logs only structured status and opportunity summaries.

## Stack

- TypeScript, Node.js, Next.js App Router, React
- Minimal CSS for the dashboard
- Prisma schema with SQLite default
- Zod validation for external provider payloads
- Vitest unit tests
- Optional Groq-backed AI market matching with deterministic fallback

## Run Locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

To enable AI-assisted matching, put your key in `.env.local` without committing it:

```bash
GROQ_API_KEY=your_key_here
GROQ_MODEL=llama-3.1-8b-instant
AI_MATCHING_ENABLED=true
AI_MATCHING_MIN_BASELINE_SCORE=0.45
```

The matcher first builds an indexed candidate set from normalized title tokens so it can sweep large discovery sets without rendering every cross-product reject. It normalizes dates, stems simple plurals, compares source/category/time/rules, and handles common sports prop equivalence such as `8+ rebounds` vs `O/U 7.5`. Candidate pairs can then receive a Groq JSON judgment with equivalence score, title similarity, confidence, verdict, resolution-risk hint, rationale, and warnings. If Groq is unavailable, missing, rate-limited, or returns invalid JSON, ArbPoly falls back to deterministic matching.

Next.js and the CLI workers both load `.env.local`; the key is never printed in worker logs.

The default `DATA_MODE=mock` runs without credentials and includes:

- Polymarket YES ask: `$0.52`
- Kalshi implied NO ask: `$0.45`
- Gross cost: `$0.97`
- Gross edge: `$0.03`
- Fee and buffer adjusted net edge
- A false-positive Lakers pair that looks similar but has mismatched settlement criteria and is marked high risk/rejected

## CLI

```bash
npm run scan:once
npm run scan:watch
npm run discover
npm run match
npm run test
npm run build
```

For public live reads, set:

```bash
DATA_MODE=live DISCOVERY_LIMIT=50000 npm run scan:once
```

Live mode uses Kalshi public market/orderbook reads and Polymarket Gamma/CLOB market-data reads. It does not trade.

## API Routes

- `GET /api/health`
- `GET /api/markets?platform=kalshi|polymarket`
- `GET /api/pairs`
- `POST /api/pairs/manual`
- `GET /api/opportunities`
- `GET /api/opportunities/:id`
- `POST /api/scan/run-once`
- `GET /api/config/public`

## Architecture

```text
src/core/orderbook      Normalized orderbook types, Kalshi implied asks, VWAP
src/core/fees           Pluggable fee estimator
src/core/arbitrage      Cross-platform YES/NO formulas and filters
src/core/matching       Market title/rules/time/source scoring plus optional Groq AI judgment
src/core/risk           Resolution-risk classification and flags
src/core/rateLimit      Token bucket scheduler, cache, coalescing, backoff
src/platforms/kalshi    Read-only Kalshi client with Zod validation
src/platforms/polymarket Read-only Gamma/CLOB client with outcome-token mapping
src/server              Scanner state and scan orchestration
src/workers             CLI entry points
src/app                 Next.js dashboard and API routes
```

## Formula

For each matched pair and direction:

```text
legA_cost = executable VWAP cost for side A at quantity q
legB_cost = executable VWAP cost for opposite side B at quantity q
total_cost = legA_cost + legB_cost
total_fees = estimated feeA + estimated feeB
risk_buffer = slippage_buffer + stale_data_buffer + funding_buffer
net_edge_per_contract = 1.00 - total_cost_per_contract - fees_per_contract - risk_buffer
net_edge_bps = net_edge_per_contract * 10000
max_size = min(executable_size_legA, executable_size_legB)
```

An opportunity is shown only when it passes configured net-edge, size, staleness, and pair-status filters.

## Prisma

The Prisma schema defines:

- `PlatformMarket`
- `MatchedMarketPair`
- `OrderbookSnapshot`
- `Opportunity`

SQLite is the default via `DATABASE_URL="file:./dev.db"`. SQLite-backed Prisma does not support native `Json` fields in Prisma 5, so `rawJson`, `depth`, and `riskFlags` are stored as serialized JSON strings in the default schema. The running dashboard currently uses an in-memory scanner store so it works immediately with no database migration.
