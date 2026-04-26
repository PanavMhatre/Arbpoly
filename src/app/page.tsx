import { DashboardClient } from "@/components/DashboardClient";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <>
      <header className="page-title">
        <div>
          <h1>Cross-platform binary market scanner</h1>
          <p>
            Capital-grade monitor for comparable Kalshi and Polymarket contracts. Edges are fee/slippage adjusted, always risk-labeled, and never routed to order execution.
          </p>
        </div>
        <span className="badge info">No order execution</span>
      </header>

      <DashboardClient />
    </>
  );
}
