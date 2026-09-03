import type {
  CellValue,
  DataAsset,
  DatasetMonth,
  DatasetMonthProcessing,
  DataTable,
  TesseraProject,
  WorksheetRegion,
} from "../../domain/types";
import { canonicalFor } from "../../lib/reshape";

export type DataView = "original" | "cleaned";

/** Zero-based inclusive cell rectangle used while a person outlines a table. */
export interface CellRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export interface CellSelection {
  anchor: { row: number; column: number };
  focus: { row: number; column: number };
}

export function selectMonth(asset?: DataAsset, period?: string) {
  if (!asset?.months.length) return undefined;
  if (period) {
    const exact = asset.months.find((month) => month.period === period);
    if (exact) return exact;
  }
  return [...asset.months].sort((a, b) => b.period.localeCompare(a.period))[0];
}

export function selectReadyMonth(asset?: DataAsset, period?: string) {
  if (!asset?.months.length) return undefined;
  const ready = asset.months.filter((month) => month.status !== "pending");
  if (period) {
    const exact = ready.find((month) => month.period === period);
    if (exact) return exact;
  }
  return [...ready].sort((a, b) => b.period.localeCompare(a.period))[0];
}

export function processingForMonth(
  month: DatasetMonth,
): DatasetMonthProcessing {
  if (month.processing) return month.processing;
  const base = {
    updatedAt: month.importedAt,
    variableMappings: [],
    questions: [],
    qualityChecks: [],
    recipeRevision: 1,
  };
  return month.status === "pending"
    ? {
        ...base,
        stage: "uploaded",
        progress: 5,
        message: "Original saved; no clean fields exist yet",
      }
    : {
        ...base,
        stage: "approved",
        progress: 100,
        message: "Approved and available to dashboards",
      };
}

export function hasCleanDraft(month?: DatasetMonth) {
  if (!month) return false;
  if (month.status !== "pending") return true;
  const stage = processingForMonth(month).stage;
  return stage === "review" || stage === "approved";
}

/** The four visible steps of the monthly flow, in order. */
export const MONTH_STEPS = [
  "Original saved",
  "Table outlined",
  "Clean draft",
  "Approved",
] as const;

export function stepIndex(stage: DatasetMonthProcessing["stage"]) {
  if (stage === "uploaded" || stage === "outlining") return 1;
  if (stage === "needs_input" || stage === "outlined") return 2;
  if (stage === "cleaning" || stage === "review") return 3;
  return 4;
}

export function stageLabel(stage?: DatasetMonthProcessing["stage"]) {
  if (!stage || stage === "uploaded") return "Not cleaned yet";
  if (stage === "outlining") return "Outlining";
  if (stage === "needs_input") return "Needs your answer";
  if (stage === "outlined") return "Outlined";
  if (stage === "cleaning") return "Creating draft";
  if (stage === "review") return "Draft · needs approval";
  return "Approved";
}

export function shortStageLabel(stage?: DatasetMonthProcessing["stage"]) {
  if (!stage || stage === "uploaded") return "uploaded";
  if (stage === "outlining" || stage === "cleaning") return "processing";
  if (stage === "needs_input") return "needs answer";
  if (stage === "outlined") return "outlined";
  if (stage === "review") return "draft";
  return "approved";
}

export function sourceRegions(month: DatasetMonth): WorksheetRegion[] {
  return (
    month.sourceWorkbook?.sheets.flatMap((sheet) => sheet.regions) ??
    month.sourceWorksheet?.regions ??
    []
  );
}

export function approvedCount(project: TesseraProject, period: string) {
  return project.warehouse.filter((asset) =>
    asset.months.some(
      (month) => month.period === period && month.status !== "pending",
    ),
  ).length;
}

export function advancePeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) return undefined;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

export function nextUploadPeriod(asset: DataAsset) {
  const latest = selectMonth(asset);
  if (latest) return advancePeriod(latest.period) ?? latest.period;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function isValidPeriod(period: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}

/** Excel-style column letters: 0 → A, 25 → Z, 26 → AA. */
export function columnLabel(index: number) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

export function rangeLabel(range: CellRange) {
  return `${columnLabel(range.startColumn)}${range.startRow + 1}:${columnLabel(range.endColumn)}${range.endRow + 1}`;
}

export function boundsFromSelection(selection: CellSelection): CellRange {
  return {
    startRow: Math.min(selection.anchor.row, selection.focus.row),
    endRow: Math.max(selection.anchor.row, selection.focus.row),
    startColumn: Math.min(selection.anchor.column, selection.focus.column),
    endColumn: Math.max(selection.anchor.column, selection.focus.column),
  };
}

export function insideRange(row: number, column: number, range: CellRange) {
  return (
    row >= range.startRow &&
    row <= range.endRow &&
    column >= range.startColumn &&
    column <= range.endColumn
  );
}

/** One-based inclusive worksheet range → zero-based cell rectangle. */
export function rangeFromRegion(region: WorksheetRegion): CellRange {
  return {
    startRow: region.range.startRow - 1,
    endRow: region.range.endRow - 1,
    startColumn: region.range.startColumn - 1,
    endColumn: region.range.endColumn - 1,
  };
}

/** Header row plus data rows inside a rectangle of worksheet cells. */
export function tableFromRange(
  rows: CellValue[][],
  range: CellRange,
): DataTable {
  const width = Math.max(0, range.endColumn - range.startColumn + 1);
  const used = new Map<string, number>();
  const columns = Array.from({ length: width }, (_, offset) => {
    const source = formatCell(
      rows[range.startRow]?.[range.startColumn + offset] ?? null,
    ).trim();
    const base = source || `Column ${offset + 1}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
  return {
    columns,
    rows: rows
      .slice(range.startRow + 1, range.endRow + 1)
      .map((row) =>
        Array.from(
          { length: width },
          (_, offset) => row[range.startColumn + offset] ?? null,
        ),
      ),
  };
}

/**
 * Guesses which cells hold the table for this dataset. Every block of
 * consecutive filled rows is scored by the width of its densest column run,
 * how numeric it is, and, most of all, how many of its headers or row labels
 * the recipe and the prior month already recognise. Titles, notes, and
 * unrelated tables on the same sheet lose.
 */
export function guessTableRange(
  rows: CellValue[][],
  recipe: Record<string, string> = {},
  canonicalColumns: string[] = [],
): CellRange | undefined {
  const filled = (value: CellValue) => value !== null && value !== "";
  const numeric = (value: CellValue) =>
    typeof value === "number" || isNumericLikeCell(value);
  let best: CellRange | undefined;
  let bestScore = 0;
  const blocks: Array<[number, number]> = [];
  let start = -1;
  for (let index = 0; index <= rows.length; index += 1) {
    const wide =
      index < rows.length && (rows[index] ?? []).filter(filled).length >= 2;
    if (wide && start < 0) start = index;
    if (!wide && start >= 0) {
      blocks.push([start, index - 1]);
      start = -1;
    }
  }
  for (const [first, last] of blocks) {
    const block = rows.slice(first, last + 1);
    if (block.length < 2) continue;
    const width = block.reduce(
      (widest, row) => Math.max(widest, row.length),
      0,
    );
    const density = Array.from(
      { length: width },
      (_, column) =>
        block.filter((row) => filled(row[column] ?? null)).length /
        block.length,
    );
    let runStart = 0;
    let bestRun: [number, number] | undefined;
    for (let column = 0; column <= width; column += 1) {
      const dense = column < width && density[column] >= 0.6;
      if (!dense) {
        if (column - runStart > (bestRun ? bestRun[1] - bestRun[0] + 1 : 0))
          bestRun = [runStart, column - 1];
        runStart = column + 1;
      }
    }
    if (!bestRun || bestRun[1] < bestRun[0]) continue;
    const range: CellRange = {
      startRow: first,
      endRow: last,
      startColumn: bestRun[0],
      endColumn: bestRun[1],
    };
    const table = tableFromRange(rows, range);
    const numericCells = table.rows.reduce(
      (total, row) => total + row.filter((value) => numeric(value)).length,
      0,
    );
    const cells = Math.max(1, table.rows.length * table.columns.length);
    const recognised = Math.max(
      table.columns.filter((column) =>
        canonicalFor(column, recipe, canonicalColumns),
      ).length,
      table.rows.filter(
        (row) =>
          typeof row[0] === "string" &&
          canonicalFor(row[0], recipe, canonicalColumns),
      ).length,
    );
    const score =
      block.length *
      (bestRun[1] - bestRun[0] + 1) *
      (1 + numericCells / cells) *
      (1 + recognised * 2);
    if (score > bestScore) {
      bestScore = score;
      best = range;
    }
  }
  return best;
}

export function canonicalHeader(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[%]/g, " pct ")
      .replace(/[$]/g, " usd ")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "field"
  );
}

/**
 * Proposes a canonical name for each source header: an exact recipe match
 * first, then a prior-month column with the same normalized key, then the
 * header itself.
 */
export function suggestMappings(
  columns: string[],
  recipe: Record<string, string>,
  priorColumns: string[],
) {
  const priorByKey = new Map(
    priorColumns.map((column) => [canonicalHeader(column), column]),
  );
  return Object.fromEntries(
    columns.map((column) => {
      const fromRecipe = recipe[column];
      const fromPrior = priorByKey.get(canonicalHeader(column));
      return [
        column,
        fromRecipe ??
          fromPrior ??
          closestPriorColumn(column, priorColumns) ??
          column.trim(),
      ];
    }),
  );
}

/** A prior column that shares most of its words with the header, offered as a suggestion only. */
function closestPriorColumn(column: string, priorColumns: string[]) {
  const words = (value: string) =>
    new Set(
      canonicalHeader(value)
        .split("_")
        .filter((word) => word.length > 1),
    );
  const source = words(column);
  if (!source.size) return undefined;
  let best: { column: string; score: number } | undefined;
  priorColumns.forEach((candidate) => {
    const target = words(candidate);
    const shared = [...source].filter((word) => target.has(word)).length;
    const score = shared / new Set([...source, ...target]).size;
    if (score >= 0.5 && (!best || score > best.score))
      best = { column: candidate, score };
  });
  return best?.column;
}

export function parseCell(value: string): CellValue {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  if (/^-?[\d,]*\.?\d+$/.test(trimmed) || /^-?\d+\.?$/.test(trimmed)) {
    const numeric = Number(trimmed.replaceAll(",", ""));
    if (Number.isFinite(numeric)) return numeric;
  }
  return value;
}

export function formatCell(value: CellValue | undefined) {
  if (value === null || value === undefined) return "";
  // Excel's general format: a number is shown without binary float noise.
  if (typeof value === "number" && Number.isFinite(value))
    return String(Number(value.toPrecision(12)));
  return String(value);
}

export function isNumericLikeCell(value: CellValue) {
  if (typeof value === "number") return true;
  if (typeof value !== "string") return false;
  const normalized = value
    .trim()
    .replace(/[,$%]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  return normalized.length > 0 && Number.isFinite(Number(normalized));
}

export function normalizeExcelCell(value: unknown): CellValue {
  if (value instanceof Date) return excelDate(value);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  )
    return value;
  return value === undefined ? null : String(value);
}

/** Excel dates arrive as local midnight; format them in local time so the day never shifts. */
function excelDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function excelRowsToTable(rows: Array<Array<unknown>>): DataTable {
  if (!rows.length) return { columns: [], rows: [] };
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  const used = new Map<string, number>();
  const columns = Array.from({ length: width }, (_, index) => {
    const value = rows[0]?.[index];
    const base =
      value === null || value === undefined || value === ""
        ? `Column ${index + 1}`
        : formatCell(normalizeExcelCell(value));
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
  return {
    columns,
    rows: rows
      .slice(1)
      .map((row) =>
        Array.from({ length: width }, (_, index) =>
          normalizeExcelCell(row[index]),
        ),
      ),
  };
}

export async function persistSourceFile(file: File): Promise<{
  storageKey: string;
  checksum: string;
  contentType: string;
}> {
  const response = await fetch(
    `/api/uploads?filename=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      headers: {
        "content-type": file.type || "application/octet-stream",
      },
      body: file,
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error || "The exact original file could not be stored.",
    );
  }
  return response.json() as Promise<{
    storageKey: string;
    checksum: string;
    contentType: string;
  }>;
}

export function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}
