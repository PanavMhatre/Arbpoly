"use client";

import { useEffect, useState } from "react";
import type { ApiHealth, Opportunity } from "@/core/types";
import { OpportunityTable } from "@/components/OpportunityTable";
import { SummaryCards } from "@/components/SummaryCards";

interface PairCounts {
  visible: number;
}

interface PairResponse {
  counts?: PairCounts;
}

interface HealthResponse {
  health?: ApiHealth[];
  lastScanTime?: string;
}

const initialHealth: ApiHealth[] = [
  {
    provider: "system",
    status: "ok",
    message: "Dashboard loaded. Live discovery runs through API refreshes.",
    lastCheckedAt: new Date(0).toISOString()
  }
];

export function DashboardClient() {
  const [activePairs, setActivePairs] = useState(0);
  const [opportunities] = useState<Opportunity[]>([]);
  const [health, setHealth] = useState<ApiHealth[]>(initialHealth);
  const [lastScanTime, setLastScanTime] = useState<string>();
  const [status, setStatus] = useState("Loading cached scanner status...");

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const [healthResponse, pairResponse] = await Promise.all([
          fetch("/api/health", { cache: "no-store" }),
          fetch("/api/pairs", { cache: "no-store" })
        ]);
        const healthPayload = (await healthResponse.json()) as HealthResponse;
        const pairPayload = (await pairResponse.json()) as PairResponse;
        if (!cancelled) {
          setHealth(healthPayload.health ?? initialHealth);
          setLastScanTime(healthPayload.lastScanTime);
          setActivePairs(pairPayload.counts?.visible ?? 0);
          setStatus("Live pair cache is current.");
        }
      } catch {
        if (!cancelled) {
          setHealth([{ ...initialHealth[0], status: "degraded", message: "Status refresh failed." }]);
          setStatus("Status refresh failed. Try the pair review page or API health endpoint.");
        }
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <SummaryCards activePairs={activePairs} opportunities={opportunities} averageDataAgeMs={0} health={health} lastScanTime={lastScanTime} />
      <div className="status-strip">
        <span>{status}</span>
        <a className="btn" href="/pairs">
          Review pairs
        </a>
      </div>
      <OpportunityTable opportunities={opportunities} />
    </>
  );
}
