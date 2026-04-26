import { NextResponse } from "next/server";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";

export function GET() {
  const state = getState();
  return NextResponse.json({
    ok: true,
    tradingEnabled: false,
    lastScanTime: state.lastScanTime,
    health: state.health
  });
}
