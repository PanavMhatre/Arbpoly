import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listMarkets } from "@/server/store";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  platform: z.enum(["kalshi", "polymarket"]).optional()
});

export function GET(request: NextRequest) {
  const parsed = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid platform query." }, { status: 400 });
  }
  return NextResponse.json({ markets: listMarkets(parsed.data.platform) });
}
