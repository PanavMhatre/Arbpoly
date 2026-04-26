import { NextResponse } from "next/server";
import { runScanOnceWithAi } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json({ opportunities: await runScanOnceWithAi() });
}
