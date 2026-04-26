import { SettingsPanel } from "@/components/SettingsPanel";
import { getPublicScanConfig } from "@/core/arbitrage/config";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <>
      <header className="page-title">
        <div>
          <h1>Settings</h1>
          <p>Runtime thresholds, stale-data controls, polling posture, and execution-disabled guardrails.</p>
        </div>
        <span className="badge info">TRADING_ENABLED=false</span>
      </header>
      <SettingsPanel config={getPublicScanConfig()} />
    </>
  );
}
