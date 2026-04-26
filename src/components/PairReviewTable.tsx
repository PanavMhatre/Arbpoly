"use client";

import { useEffect, useState } from "react";
import type { MatchedMarketPair } from "@/core/types";
import { percent } from "@/lib/format";
import { PairReviewActions } from "@/components/PairReviewActions";
import { RiskBadge } from "@/components/RiskBadge";

interface PairResponse {
  visiblePairs: MatchedMarketPair[];
  counts?: {
    total: number;
    visible: number;
    confirmed: number;
    likely: number;
    needsReview: number;
    rejected: number;
  };
}

export function PairReviewTable() {
  const [pairs, setPairs] = useState<MatchedMarketPair[]>([]);
  const [counts, setCounts] = useState<PairResponse["counts"]>();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;

    async function loadPairs() {
      setStatus("loading");
      try {
        const response = await fetch("/api/pairs", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Pair request failed with ${response.status}`);
        }
        const payload = (await response.json()) as PairResponse;
        if (!cancelled) {
          setPairs(payload.visiblePairs ?? []);
          setCounts(payload.counts);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
        }
      }
    }

    void loadPairs();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="panel table-wrap">
      <div className="table-toolbar">
        <span className="muted">
          {counts
            ? `${counts.visible} reviewable of ${counts.total} live candidates. ${counts.rejected} rejected by matching rules.`
            : "Loading live pair candidates..."}
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Kalshi</th>
            <th>Polymarket</th>
            <th>Score</th>
            <th>Status</th>
            <th>Risk</th>
            <th>Warnings</th>
            <th>Manual override</th>
          </tr>
        </thead>
        <tbody>
          {status === "loading" ? (
            <tr>
              <td colSpan={7}>Loading live pair candidates...</td>
            </tr>
          ) : null}
          {status === "error" ? (
            <tr>
              <td colSpan={7}>Pair discovery failed. Check API health and provider rate-limit logs.</td>
            </tr>
          ) : null}
          {status === "ready" && pairs.length === 0 ? (
            <tr>
              <td colSpan={7}>No reviewable pairs found for the current discovery window.</td>
            </tr>
          ) : null}
          {status === "ready"
            ? pairs.map((pair) => (
                <tr key={pair.id}>
                  <td>
                    <strong>{pair.kalshiMarket.title}</strong>
                    <div className="muted">{pair.kalshiMarket.ticker}</div>
                  </td>
                  <td>
                    <strong>{pair.polymarketMarket.title}</strong>
                    <div className="muted">{pair.polymarketMarket.conditionId}</div>
                  </td>
                  <td className="mono">{percent(pair.matchScore)}</td>
                  <td>{pair.matchStatus}</td>
                  <td>
                    <RiskBadge risk={pair.resolutionRisk} />
                  </td>
                  <td>{pair.warnings.map((warning) => warning.message).join(" ") || "No warnings"}</td>
                  <td>
                    <PairReviewActions kalshiMarketId={pair.kalshiMarketId} polymarketMarketId={pair.polymarketMarketId} />
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>
    </div>
  );
}
