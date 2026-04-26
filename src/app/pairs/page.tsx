import { PairReviewTable } from "@/components/PairReviewTable";

export const dynamic = "force-dynamic";

export default function PairReviewPage() {
  return (
    <>
      <header className="page-title">
        <div>
          <h1>Pair review</h1>
          <p>
            Reviewable live candidates are shown here. Rejected cross-market mismatches are excluded from this page and remain available through the
            API counts.
          </p>
        </div>
      </header>

      <PairReviewTable />
    </>
  );
}
