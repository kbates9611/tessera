import type { CellValue, DataTable } from "../domain/types";

export interface TableColumnProfile {
  name: string;
  type: "number" | "date" | "boolean" | "text" | "mixed" | "empty";
  populated: number;
  missing: number;
  distinct: number;
  minimum?: number;
  maximum?: number;
  examples: CellValue[];
}

export interface TableProfile {
  rows: number;
  columns: number;
  populatedCells: number;
  missingCells: number;
  completeness: number;
  duplicateRows: number;
  emptyRows: number;
  emptyColumns: string[];
  columnProfiles: TableColumnProfile[];
  issues: Array<{
    severity: "info" | "review";
    title: string;
    detail: string;
  }>;
}

export function parseDelimitedText(input: string): DataTable {
  const normalized = input.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return { columns: [], rows: [] };
  const delimiter = sniffDelimiter(normalized.split("\n", 1)[0]);
  const matrix: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '"') {
      if (quoted && normalized[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if (character === "\n" && !quoted) {
      row.push(cell.trim());
      matrix.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  row.push(cell.trim());
  matrix.push(row);

  const width = Math.max(...matrix.map((candidate) => candidate.length));
  const header = matrix[0].map(
    (value, index) => value || `Column ${index + 1}`,
  );
  while (header.length < width) header.push(`Column ${header.length + 1}`);
  return {
    columns: header,
    rows: matrix
      .slice(1)
      .map((candidate) =>
        Array.from({ length: width }, (_, index) =>
          coerce(candidate[index] ?? ""),
        ),
      ),
  };
}

/** Tab, semicolon, or comma, chosen from the header line. */
function sniffDelimiter(headerLine: string) {
  if (headerLine.includes("\t")) return "\t";
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

export function cleanImportedTable(original: DataTable): {
  table: DataTable;
  headerMap: Record<string, string>;
  summary: string[];
} {
  const before = profileTable(original);
  const retainedColumns = original.columns
    .map((column, index) => ({ column, index }))
    .filter(({ index }) =>
      original.rows.some((row) => !isBlank(row[index] ?? null)),
    );
  const used = new Map<string, number>();
  const headerMap: Record<string, string> = {};
  const columns = retainedColumns.map(({ column }, retainedIndex) => {
    const base =
      column
        .trim()
        .toLowerCase()
        .replace(/[%]/g, " pct ")
        .replace(/[$]/g, " usd ")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || `column_${retainedIndex + 1}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    const clean = count === 1 ? base : `${base}_${count}`;
    headerMap[column] = clean;
    return clean;
  });
  const normalizedRows = original.rows
    .map((row) =>
      retainedColumns.map(({ index }) => normalizeCell(row[index] ?? null)),
    )
    .filter((row) => row.some((value) => value !== null && value !== ""));
  const seenRows = new Set<string>();
  const rows = normalizedRows.filter((row) => {
    const signature = JSON.stringify(row);
    if (seenRows.has(signature)) return false;
    seenRows.add(signature);
    return true;
  });
  const renamed = columns.filter(
    (column, index) => column !== retainedColumns[index]?.column,
  ).length;
  const removedEmptyColumns = original.columns.length - retainedColumns.length;
  const removedDuplicates = normalizedRows.length - rows.length;
  const summary = [
    `${renamed} header${renamed === 1 ? "" : "s"} normalized`,
    `${rows.length} non-empty row${rows.length === 1 ? "" : "s"} retained`,
    "Numeric, currency, boolean, and percentage values typed where unambiguous",
  ];
  if (before.emptyRows)
    summary.splice(
      1,
      0,
      `${before.emptyRows} empty row${before.emptyRows === 1 ? "" : "s"} removed`,
    );
  if (removedEmptyColumns)
    summary.splice(
      1,
      0,
      `${removedEmptyColumns} empty column${removedEmptyColumns === 1 ? "" : "s"} removed`,
    );
  if (removedDuplicates)
    summary.push(
      `${removedDuplicates} exact duplicate row${removedDuplicates === 1 ? "" : "s"} removed`,
    );
  return {
    table: { columns, rows },
    headerMap,
    summary,
  };
}

export function profileTable(table: DataTable): TableProfile {
  const width = table.columns.length;
  const emptyRows = table.rows.filter((row) =>
    Array.from({ length: width }, (_, index) => row[index] ?? null).every(
      isBlank,
    ),
  ).length;
  const signatures = new Map<string, number>();
  table.rows
    .filter((row) => row.some((value) => !isBlank(value)))
    .forEach((row) => {
      const signature = JSON.stringify(
        Array.from({ length: width }, (_, index) => row[index] ?? null),
      );
      signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
    });
  const duplicateRows = [...signatures.values()].reduce(
    (total, count) => total + Math.max(0, count - 1),
    0,
  );
  const columnProfiles = table.columns.map((name, column) => {
    const values = table.rows.map((row) => row[column] ?? null);
    const populated = values.filter((value) => !isBlank(value));
    const types = new Set(populated.map(valueType));
    const numeric = populated.filter(
      (value): value is number => typeof value === "number",
    );
    const type: TableColumnProfile["type"] = !populated.length
      ? "empty"
      : types.size === 1
        ? ([...types][0] as TableColumnProfile["type"])
        : "mixed";
    return {
      name,
      type,
      populated: populated.length,
      missing: table.rows.length - populated.length,
      distinct: new Set(populated.map((value) => JSON.stringify(value))).size,
      ...(numeric.length
        ? { minimum: Math.min(...numeric), maximum: Math.max(...numeric) }
        : {}),
      examples: [
        ...new Map(populated.map((value) => [String(value), value])).values(),
      ].slice(0, 3),
    };
  });
  const populatedCells = columnProfiles.reduce(
    (total, column) => total + column.populated,
    0,
  );
  const totalCells = Math.max(1, table.rows.length * Math.max(width, 1));
  const missingCells = Math.max(0, totalCells - populatedCells);
  const emptyColumns = columnProfiles
    .filter((column) => column.type === "empty")
    .map((column) => column.name);
  const mixedColumns = columnProfiles.filter(
    (column) => column.type === "mixed",
  );
  const issues: TableProfile["issues"] = [];
  if (emptyRows)
    issues.push({
      severity: "info",
      title: `${emptyRows} empty row${emptyRows === 1 ? "" : "s"}`,
      detail: "Safe cleaning removes rows with no values.",
    });
  if (emptyColumns.length)
    issues.push({
      severity: "info",
      title: `${emptyColumns.length} empty column${emptyColumns.length === 1 ? "" : "s"}`,
      detail: `No values were found in ${emptyColumns.join(", ")}.`,
    });
  if (duplicateRows)
    issues.push({
      severity: "review",
      title: `${duplicateRows} duplicate row${duplicateRows === 1 ? "" : "s"}`,
      detail:
        "Safe cleaning removes exact duplicates and records the decision.",
    });
  if (mixedColumns.length)
    issues.push({
      severity: "review",
      title: `${mixedColumns.length} mixed-type field${mixedColumns.length === 1 ? "" : "s"}`,
      detail: `Review ${mixedColumns.map((column) => column.name).join(", ")} before publishing.`,
    });
  if (!issues.length)
    issues.push({
      severity: "info",
      title: "No structural issues detected",
      detail:
        "Headers, row shape, and value types are ready for safe cleaning.",
    });
  return {
    rows: table.rows.length,
    columns: width,
    populatedCells,
    missingCells,
    completeness: populatedCells / totalCells,
    duplicateRows,
    emptyRows,
    emptyColumns,
    columnProfiles,
    issues,
  };
}

/** Public alias used by table reshaping. */
export function coerceCell(value: string): CellValue {
  return coerce(value);
}

function coerce(value: string): CellValue {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  const percent = /^\(?-?[$]?([\d,.]+(?:\.\d+)?)%\)?$/.exec(trimmed);
  if (percent) {
    // Divide, then drop binary float noise so "2.7%" is 0.027, not 0.027000000000000003.
    const parsed = Number(
      (Number(percent[1].replaceAll(",", "")) / 100).toPrecision(12),
    );
    return trimmed.startsWith("(") || trimmed.startsWith("-")
      ? -parsed
      : parsed;
  }
  const numeric = /^\(?-?[$]?([\d,.]+(?:\.\d+)?)\)?$/.exec(trimmed);
  if (numeric) {
    const parsed = Number(numeric[1].replaceAll(",", ""));
    return trimmed.startsWith("(") || trimmed.startsWith("-")
      ? -parsed
      : parsed;
  }
  return trimmed;
}

function normalizeCell(value: CellValue): CellValue {
  if (typeof value !== "string") return value;
  return coerce(value);
}

function isBlank(value: CellValue) {
  return value === null || value === undefined || value === "";
}

function valueType(
  value: CellValue,
): Exclude<TableColumnProfile["type"], "mixed" | "empty"> {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (
    typeof value === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)
  )
    return "date";
  return "text";
}

export function periodLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return period;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}
