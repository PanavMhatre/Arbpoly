import { NextResponse } from "next/server";
import { listPairs, refreshPairsWithAi } from "@/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  await refreshPairsWithAi(true);
  const pairs = listPairs();
  const visiblePairs = pairs.filter((pair) => pair.matchStatus !== "rejected");

  return NextResponse.json({
    pairs,
    visiblePairs,
    counts: {
      total: pairs.length,
      visible: visiblePairs.length,
      confirmed: pairs.filter((pair) => pair.matchStatus === "confirmed").length,
      likely: pairs.filter((pair) => pair.matchStatus === "likely").length,
      needsReview: pairs.filter((pair) => pair.matchStatus === "needs_review").length,
      rejected: pairs.filter((pair) => pair.matchStatus === "rejected").length
    }
  });
}
