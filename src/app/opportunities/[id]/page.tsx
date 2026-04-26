import { notFound } from "next/navigation";
import { OrderbookLevels } from "@/components/OrderbookLevels";
import { RiskBadge } from "@/components/RiskBadge";
import { age, bps, cents, currency, dateTime, percent } from "@/lib/format";
import { platformMarketUrl } from "@/lib/platformLinks";
import { getOpportunity, getState } from "@/server/store";

export const dynamic = "force-dynamic";

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const opportunity = getOpportunity(id);
  if (!opportunity) {
    notFound();
  }
  const state = getState();
  const polymarketBook = state.orderbooks[opportunity.pair.polymarketMarketId];
  const kalshiBook = state.orderbooks[opportunity.pair.kalshiMarketId];
  const polymarketUrl = platformMarketUrl(opportunity.pair.polymarketMarket);
  const kalshiUrl = platformMarketUrl(opportunity.pair.kalshiMarket);

  return (
    <>
      <header className="page-title">
        <div>
          <h1>Opportunity detail</h1>
          <p>{opportunity.pair.polymarketMarket.title}</p>
        </div>
        <RiskBadge risk={opportunity.pair.resolutionRisk} />
      </header>

      <div className="detail-grid">
        <section className="panel">
          <div className="section">
            <h2>Formula breakdown</h2>
            <div className="kv">
              <span>Direction</span>
              <strong>{opportunity.direction === "POLYMARKET_YES_KALSHI_NO" ? "Buy Polymarket YES + Kalshi NO" : "Buy Kalshi YES + Polymarket NO"}</strong>
              <span>Executable quantity</span>
              <strong>{opportunity.quantity.toFixed(0)} contracts</strong>
              <span>Combined VWAP cost</span>
              <strong>{currency(opportunity.formula.totalCost)}</strong>
              <span>Gross edge</span>
              <strong>{cents(opportunity.grossEdge)}</strong>
              <span>Fees per contract</span>
              <strong>{cents(opportunity.formula.totalFees)}</strong>
              <span>Risk buffer</span>
              <strong>{cents(opportunity.riskBuffer)}</strong>
              <span>Net edge</span>
              <strong>
                {cents(opportunity.netEdge)} ({bps(opportunity.netEdgeBps)})
              </strong>
              <span>Max available size</span>
              <strong>{opportunity.maxSize.toFixed(0)}</strong>
              <span>Stale data age</span>
              <strong>{age(opportunity.staleAgeMs)}</strong>
            </div>
          </div>

          <div className="section">
            <h2>Normalized orderbooks</h2>
            <div className="levels">
              {polymarketBook ? <OrderbookLevels title="Polymarket YES asks" levels={polymarketBook.yesAskLevels} /> : null}
              {polymarketBook ? <OrderbookLevels title="Polymarket NO asks" levels={polymarketBook.noAskLevels} /> : null}
              {kalshiBook ? <OrderbookLevels title="Kalshi implied YES asks" levels={kalshiBook.yesAskLevels} /> : null}
              {kalshiBook ? <OrderbookLevels title="Kalshi implied NO asks" levels={kalshiBook.noAskLevels} /> : null}
            </div>
          </div>

          <div className="section">
            <h2>Fee breakdown</h2>
            <div className="kv">
              <span>Polymarket fee</span>
              <strong>
                {currency(opportunity.legs.polymarket.fee.amount)} ({opportunity.legs.polymarket.fee.rateBps} bps)
              </strong>
              <span>Kalshi fee</span>
              <strong>
                {currency(opportunity.legs.kalshi.fee.amount)} ({opportunity.legs.kalshi.fee.rateBps} bps)
              </strong>
              <span>Slippage buffer</span>
              <strong>{cents(opportunity.formula.slippageBuffer)}</strong>
              <span>Stale-data buffer</span>
              <strong>{cents(opportunity.formula.staleDataBuffer)}</strong>
              <span>Funding buffer</span>
              <strong>{cents(opportunity.formula.fundingBuffer)}</strong>
            </div>
          </div>
        </section>

        <aside className="panel">
          <div className="section">
            <h2>Match explanation</h2>
            <div className="kv">
              <span>Match score</span>
              <strong>{percent(opportunity.pair.matchScore)}</strong>
              <span>Status</span>
              <strong>{opportunity.pair.matchStatus}</strong>
              <span>Manual override</span>
              <strong>{opportunity.pair.manualOverride ? "Yes" : "No"}</strong>
              <span>Polymarket close</span>
              <strong>{dateTime(opportunity.pair.polymarketMarket.closeTime)}</strong>
              <span>Kalshi close</span>
              <strong>{dateTime(opportunity.pair.kalshiMarket.closeTime)}</strong>
            </div>
          </div>

          <div className="section">
            <h2>Resolution rules comparison</h2>
            <p className="muted">
              <strong>Polymarket:</strong> {opportunity.pair.polymarketMarket.rules || opportunity.pair.polymarketMarket.description || "No rules provided."}
            </p>
            <p className="muted">
              <strong>Kalshi:</strong> {opportunity.pair.kalshiMarket.rules || opportunity.pair.kalshiMarket.description || "No rules provided."}
            </p>
          </div>

          <div className="section">
            <h2>Risk flags</h2>
            <ul className="warning-list">
              {opportunity.riskFlags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          </div>

          <div className="section">
            <h2>Platform links</h2>
            <div className="button-row">
              {polymarketUrl ? (
                <a className="btn" href={polymarketUrl} target="_blank" rel="noopener noreferrer">
                  Polymarket
                </a>
              ) : null}
              {kalshiUrl ? (
                <a className="btn" href={kalshiUrl} target="_blank" rel="noopener noreferrer">
                  Kalshi
                </a>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
