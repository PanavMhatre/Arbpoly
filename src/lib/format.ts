export function currency(value: number): string {
  return `$${value.toFixed(4)}`;
}

export function cents(value: number): string {
  return `${(value * 100).toFixed(2)}c`;
}

export function bps(value: number): string {
  return `${value.toFixed(1)} bps`;
}

export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function age(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.round(ms / 60_000)}m`;
}

export function dateTime(value: string | undefined): string {
  if (!value) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}
