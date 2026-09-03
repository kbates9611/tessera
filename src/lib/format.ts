import type { ValueFormat } from "../domain/types";

export function formatValue(value: number, format: ValueFormat, decimals = 1) {
  if (format === "percent")
    return new Intl.NumberFormat("en-US", {
      style: "percent",
      maximumFractionDigits: decimals,
    }).format(value);
  if (format === "currency")
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: Math.abs(value) >= 10000 ? "compact" : "standard",
      maximumFractionDigits: decimals,
    }).format(value);
  return new Intl.NumberFormat("en-US", {
    notation:
      format === "compact" || (format === "auto" && Math.abs(value) >= 10000)
        ? "compact"
        : "standard",
    maximumFractionDigits: decimals,
  }).format(value);
}
