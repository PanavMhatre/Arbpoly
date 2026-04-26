import { NextResponse } from "next/server";
import { listOpportunities, runScanOnceWithAi } from "@/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  await runScanOnceWithAi();
  return NextResponse.json({ opportunities: listOpportunities() });
}
