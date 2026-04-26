import type { PriceLevel } from "@/core/types";
import { currency } from "@/lib/format";

export function OrderbookLevels({ title, levels }: { title: string; levels: PriceLevel[] }) {
  return (
    <div className="level-list">
      <h3>{title}</h3>
      {levels.slice(0, 6).map((level, index) => (
        <div className="level-row" key={`${level.price}-${level.quantity}-${index}`}>
          <span>{currency(level.price)}</span>
          <span>{level.quantity.toFixed(0)}</span>
        </div>
      ))}
      {levels.length === 0 ? <div className="muted">No depth</div> : null}
    </div>
  );
}
