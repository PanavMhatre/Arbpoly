import type { PriceLevel } from "@/core/types";
import { sortAskLevels } from "@/core/orderbook/normalize";

export interface ExecutableVwap {
  requestedQuantity: number;
  filledQuantity: number;
  vwap: number;
  cost: number;
  fullyFilled: boolean;
  levelsConsumed: PriceLevel[];
}

export function availableSize(levels: PriceLevel[]): number {
  return levels.reduce((sum, level) => sum + level.quantity, 0);
}

export function calculateExecutableVwap(levels: PriceLevel[], quantity: number): ExecutableVwap {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("VWAP quantity must be positive");
  }

  let remaining = quantity;
  let cost = 0;
  const levelsConsumed: PriceLevel[] = [];

  for (const level of sortAskLevels(levels)) {
    if (remaining <= 0) {
      break;
    }
    const fillQuantity = Math.min(remaining, level.quantity);
    cost += fillQuantity * level.price;
    remaining -= fillQuantity;
    levelsConsumed.push({ price: level.price, quantity: fillQuantity });
  }

  const filledQuantity = Number((quantity - remaining).toFixed(6));
  return {
    requestedQuantity: quantity,
    filledQuantity,
    vwap: filledQuantity > 0 ? Number((cost / filledQuantity).toFixed(6)) : 0,
    cost: Number(cost.toFixed(6)),
    fullyFilled: remaining <= 1e-9,
    levelsConsumed
  };
}
