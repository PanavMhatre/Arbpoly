import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addManualPair } from "@/server/store";

export const dynamic = "force-dynamic";

const ManualPairSchema = z.object({
  kalshiMarketId: z.string().min(1),
  polymarketMarketId: z.string().min(1),
  notes: z.string().optional(),
  resolutionRisk: z.enum(["LOW", "MEDIUM", "HIGH"]).optional()
});

export async function POST(request: NextRequest) {
  const body: unknown = await request.json();
  const parsed = ManualPairSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid manual pair payload.", issues: parsed.error.flatten() }, { status: 400 });
  }
  return NextResponse.json({ pairs: addManualPair(parsed.data) });
}
