import type { ResolutionRisk } from "@/core/types";

export function RiskBadge({ risk }: { risk: ResolutionRisk }) {
  return <span className={`badge ${risk.toLowerCase()}`}>{risk}</span>;
}
