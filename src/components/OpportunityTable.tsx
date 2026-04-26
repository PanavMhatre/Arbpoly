import Link from "next/link";
import type { Opportunity } from "@/core/types";
import { age, bps, cents, currency } from "@/lib/format";
import { RiskBadge } from "@/components/RiskBadge";

export function OpportunityTable({ opportunities }: { opportunities: Opportunity[] }) {
  return (
    <div className="panel table-wrap">
      <table>
        <thead>
          <tr>
            <th>Pair</th>
            <th>Direction</th>
            <th>Polymarket side/price</th>
            <th>Kalshi side/price</th>
            <th>Gross edge</th>
            <th>Fees</th>
            <th>Net edge</th>
            <th>Max size</th>
            <th>Stale age</th>
            <th>Resolution risk</th>
            <th>Risk flags</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.length === 0 ? (
            <tr>
              <td colSpan={11} className="muted">
                No opportunities currently pass the configured net-edge, size, staleness, and pair-risk filters.
              </td>
            </tr>
          ) : (
            opportunities.map((opportunity) => (
              <tr key={opportunity.id}>
                <td>
                  <Link href={`/opportunities/${opportunity.id}`}>
                    <strong>{opportunity.pair.polymarketMarket.title}</strong>
                  </Link>
                  <div className="muted">Score {(opportunity.pair.matchScore * 100).toFixed(0)}%</div>
                </td>
                <td>{opportunity.direction === "POLYMARKET_YES_KALSHI_NO" ? "PM YES + Kalshi NO" : "Kalshi YES + PM NO"}</td>
                <td className="mono">
                  {opportunity.legs.polymarket.side} @ {currency(opportunity.legs.polymarket.vwap)}
                </td>
                <td className="mono">
                  {opportunity.legs.kalshi.side} @ {currency(opportunity.legs.kalshi.vwap)}
                </td>
                <td className="mono">{cents(opportunity.grossEdge)}</td>
                <td className="mono">{cents(opportunity.estimatedFees)}</td>
                <td className="mono">
                  <strong>{cents(opportunity.netEdge)}</strong>
                  <div className="muted">{bps(opportunity.netEdgeBps)}</div>
                </td>
                <td className="mono">{opportunity.maxSize.toFixed(0)}</td>
                <td className="mono">{age(opportunity.staleAgeMs)}</td>
                <td>
                  <RiskBadge risk={opportunity.pair.resolutionRisk} />
                </td>
                <td>{opportunity.riskFlags.slice(0, 2).join(" ")}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
