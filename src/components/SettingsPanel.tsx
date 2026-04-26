"use client";

import { useState } from "react";
import type { PublicScanConfig } from "@/core/types";

export function SettingsPanel({ config }: { config: PublicScanConfig }) {
  const [values, setValues] = useState(config);

  return (
    <div className="panel">
      <div className="section">
        <h2>Scanner thresholds</h2>
        <div className="form-grid">
          <NumberField label="Minimum net edge (cents)" value={values.minNetEdgeCents} onChange={(value) => setValues({ ...values, minNetEdgeCents: value })} />
          <NumberField label="Minimum size" value={values.minSize} onChange={(value) => setValues({ ...values, minSize: value })} />
          <NumberField label="Max stale age (ms)" value={values.maxStalenessMs} onChange={(value) => setValues({ ...values, maxStalenessMs: value })} />
          <NumberField label="Scan quantity" value={values.scanQuantity} onChange={(value) => setValues({ ...values, scanQuantity: value })} />
          <NumberField label="Slippage buffer (cents)" value={values.slippageBufferCents} onChange={(value) => setValues({ ...values, slippageBufferCents: value })} />
          <NumberField label="Funding buffer (cents)" value={values.fundingBufferCents} onChange={(value) => setValues({ ...values, fundingBufferCents: value })} />
          <div className="field">
            <label>Include needs-review pairs</label>
            <select
              value={values.includeReviewPairs ? "true" : "false"}
              onChange={(event) => setValues({ ...values, includeReviewPairs: event.target.value === "true" })}
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </div>
          <div className="field">
            <label>Trading</label>
            <input value="Disabled in this build" readOnly />
          </div>
          <div className="field">
            <label>AI matching</label>
            <input value={values.aiMatchingEnabled ? "Groq enabled" : "Deterministic fallback"} readOnly />
          </div>
          <div className="field">
            <label>AI model</label>
            <input value={values.aiMatchingModel} readOnly />
          </div>
        </div>
      </div>
      <div className="section">
        <p className="muted">
          These controls are local UI controls for reviewing the public config shape. Runtime values are loaded from environment variables in this build.
        </p>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}
