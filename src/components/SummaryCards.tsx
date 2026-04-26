import type { ApiHealth, Opportunity } from "@/core/types";
import { age } from "@/lib/format";

export function SummaryCards({
  activePairs,
  opportunities,
  averageDataAgeMs,
  health,
  lastScanTime
}: {
  activePairs: number;
  opportunities: Opportunity[];
  averageDataAgeMs: number;
  health: ApiHealth[];
  lastScanTime?: string;
}) {
  const positive = opportunities.filter((opportunity) => opportunity.netEdge > 0).length;
  const apiStatus = health.some((entry) => entry.status === "down")
    ? "down"
    : health.some((entry) => entry.status === "degraded")
      ? "degraded"
      : "ok";

  return (
    <section className="summary-grid" aria-label="Scanner summary">
      <div className="metric">
        <span>Active matched pairs</span>
        <strong>{activePairs}</strong>
      </div>
      <div className="metric">
        <span>Positive net opportunities</span>
        <strong>{positive}</strong>
      </div>
      <div className="metric">
        <span>Average data age</span>
        <strong>{age(Math.round(averageDataAgeMs))}</strong>
      </div>
      <div className="metric">
        <span>API health</span>
        <strong className={apiStatus === "ok" ? "badge ok" : apiStatus === "degraded" ? "badge warn" : "badge down"}>{apiStatus}</strong>
      </div>
      <div className="metric">
        <span>Last scan time</span>
        <strong>{lastScanTime ? new Date(lastScanTime).toLocaleTimeString() : "Never"}</strong>
      </div>
    </section>
  );
}
