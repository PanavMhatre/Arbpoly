"use client";

import { useState } from "react";
import type { ResolutionRisk } from "@/core/types";

export function PairReviewActions({
  kalshiMarketId,
  polymarketMarketId
}: {
  kalshiMarketId: string;
  polymarketMarketId: string;
}) {
  const [status, setStatus] = useState<string>("");

  async function submit(resolutionRisk: ResolutionRisk) {
    setStatus("Saving");
    const response = await fetch("/api/pairs/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kalshiMarketId,
        polymarketMarketId,
        resolutionRisk,
        notes: `Manual ${resolutionRisk.toLowerCase()} review from dashboard.`
      })
    });
    setStatus(response.ok ? "Saved" : "Failed");
  }

  return (
    <div className="button-row">
      <button className="btn" type="button" onClick={() => void submit("LOW")}>
        Approve LOW
      </button>
      <button className="btn" type="button" onClick={() => void submit("MEDIUM")}>
        Approve MEDIUM
      </button>
      <button className="btn" type="button" onClick={() => void submit("HIGH")}>
        Mark HIGH
      </button>
      {status ? <span className="muted">{status}</span> : null}
    </div>
  );
}
