import { NextResponse } from "next/server";
import { getPublicScanConfig } from "@/core/arbitrage/config";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ config: getPublicScanConfig() });
}
