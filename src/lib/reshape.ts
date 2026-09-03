import type { CellValue, DataTable } from "../domain/types";
import { coerceCell } from "./csv";

/**
 * Some monthly exports list metrics as rows ("Cases shipped | 8,420 | 8,610")
 * while the canonical table keeps one row per month with a column per
 * metric. Recipes map those row labels to canonical fields; this module
 * recognises the layout and pivots it.
 */

export type TableLayout = "wide" | "metricRows";

const TARGET_HEADER =
  /plan|target|tgt|budget|ytd|fytd|prior|prev|last|\bpy\b|\bly\b|var|diff|chg|delta|fcst|forecast/i;
const PERIOD_FIELD = /^(period|month|date|reporting month)$/i;
const STATUS_FIELD = /status/i;

export function normalizedKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[%]/g, " pct ")
    .replace(/[$]/g, " usd ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Resolves a source label to a canonical field through the recipe or a prior column. */
export function canonicalFor(
  label: string,
  recipe: Record<string, string>,
  canonicalColumns: string[],
) {
  const direct = recipe[label] ?? recipe[label.trim()];
  if (direct) return direct;
  const byKey = new Map(
    Object.entries(recipe).map(([from, to]) => [normalizedKey(from), to]),
  );
  const viaRecipe = byKey.get(normalizedKey(label));
  if (viaRecipe) return viaRecipe;
  const key = normalizedKey(label);
  return canonicalColumns.find((column) => normalizedKey(column) === key);
}

/**
 * A table is "metric rows" when most first-column labels resolve to canonical
 * fields while its headers do not.
 */
export function detectLayout(
  table: DataTable,
  recipe: Record<string, string>,
  canonicalColumns: string[],
): TableLayout {
  if (
    !canonicalColumns.length ||
    table.rows.length < 2 ||
    table.columns.length < 2
  )
    return "wide";
  const labels = table.rows
    .map((row) => row[0])
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim() !== "",
    );
  if (labels.length < 2) return "wide";
  const labelHits = labels.filter((label) =>
    canonicalFor(label, recipe, canonicalColumns),
  ).length;
  const headerHits = table.columns.filter((column) =>
    canonicalFor(column, recipe, canonicalColumns),
  ).length;
  return labelHits >= Math.max(2, labels.length * 0.5) &&
    headerHits < Math.max(2, table.columns.length * 0.3)
    ? "metricRows"
    : "wide";
}

/** The column that holds this month's actuals: first mostly numeric column not named like a plan or prior period. */
export function actualsColumnIndex(table: DataTable) {
  const numericShare = (index: number) => {
    const values = table.rows
      .map((row) => row[index])
      .filter((v) => v !== null && v !== "");
    if (!values.length) return 0;
    return (
      values.filter((value) => typeof coerceCell(String(value)) === "number")
        .length / values.length
    );
  };
  const candidates = table.columns
    .map((column, index) => ({ column, index }))
    .slice(1)
    .filter(({ index }) => numericShare(index) >= 0.5);
  return (
    candidates.find(({ column }) => !TARGET_HEADER.test(column))?.index ??
    candidates[0]?.index ??
    1
  );
}

/**
 * Turns metric rows into one canonical row for `period`. Unmapped labels are
 * dropped; canonical fields missing from the source stay null.
 */
export function pivotMetricRows(
  table: DataTable,
  recipe: Record<string, string>,
  canonicalColumns: string[],
  period: string,
): { table: DataTable; headerMap: Record<string, string>; summary: string[] } {
  const actuals = actualsColumnIndex(table);
  const headerMap: Record<string, string> = {};
  const values = new Map<string, CellValue>();
  let mapped = 0;
  table.rows.forEach((row) => {
    const label = row[0];
    if (typeof label !== "string" || !label.trim()) return;
    const canonical = canonicalFor(label, recipe, canonicalColumns);
    if (!canonical) return;
    headerMap[label.trim()] = canonical;
    const raw = row[actuals];
    values.set(
      canonical,
      raw === null || raw === undefined ? null : coerceCell(String(raw)),
    );
    mapped += 1;
  });
  const columns = [...canonicalColumns];
  const row = columns.map((column) => {
    if (values.has(column)) return values.get(column) ?? null;
    if (PERIOD_FIELD.test(column)) return periodEnd(period);
    if (STATUS_FIELD.test(column)) return "Draft";
    return null;
  });
  return {
    table: { columns, rows: [row] },
    headerMap,
    summary: [
      `${mapped} metric row${mapped === 1 ? "" : "s"} pivoted into one ${period} row`,
      `Actual values read from the "${table.columns[actuals]}" column`,
      "Percent, currency, and thousands separators typed as numbers",
    ],
  };
}

/** Last calendar day of a YYYY-MM period, matching the canonical Period convention. */
export function periodEnd(period: string) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return period;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, "0")}`;
}
