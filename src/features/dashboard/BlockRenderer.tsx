import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { defaultTableSettings } from "../../domain/defaults";
import type { KpiIconName } from "../../domain/kpiIcons";
import { selectedReadyMonth, tableForBlock } from "../../domain/selectors";
import { formatValue } from "../../lib/format";
import type {
  CellValue,
  DashboardBlock,
  DataTable,
  TableCellStyle,
  TableColumnStyle,
  TesseraProject,
} from "../../domain/types";
import { ChartRenderer, countBoundValues } from "./Charts";
import { getKpiIcon } from "./kpiIcons";
import { IllustrationCard } from "./IllustrationCard";
import {
  reportingPeriodLabel,
  throughPeriodCutoff,
} from "../../domain/dashboardPeriods";

export function BlockRenderer({
  block,
  project,
}: {
  block: DashboardBlock;
  project: TesseraProject;
}) {
  const table = tableForBlock(project, block);
  const asset = project.warehouse.find((item) => item.id === block.datasetId);
  const datasetName = asset?.name;
  const through = throughPeriodCutoff(block.period);
  const month =
    block.period === "all"
      ? undefined
      : through
        ? selectedReadyMonth(asset, through)
        : block.period === "latest"
          ? selectedReadyMonth(asset)
          : asset?.months.find((item) => item.period === block.period);
  const readyMonthCount =
    asset?.months.filter(
      (item) =>
        item.status !== "pending" && (!through || item.period <= through),
    ).length ?? 0;
  const provenance = datasetName
    ? `Source: ${datasetName} · ${
        through
          ? `${readyMonthCount} cleaned monthly table${readyMonthCount === 1 ? "" : "s"} through ${reportingPeriodLabel(through)}`
          : block.period === "all"
            ? `${readyMonthCount} cleaned monthly table${readyMonthCount === 1 ? "" : "s"}`
            : `${month?.label ?? block.period} · Cleaned warehouse view`
      } · ${table?.rows.length ?? 0} record${table?.rows.length === 1 ? "" : "s"}`
    : undefined;
  if (block.type === "sectionHeader") return <SectionHeader block={block} />;
  if (block.type === "heading") return <Heading block={block} />;
  if (block.type === "text") return <TextBlock block={block} />;
  if (block.type === "illustration") return <IllustrationCard block={block} />;
  if (block.type === "kpi") return <Kpi block={block} table={table} />;
  if (block.type === "table")
    return (
      <TableBlock
        block={block}
        table={table}
        datasetName={datasetName}
        provenance={provenance}
      />
    );
  return (
    <ChartRenderer
      block={block}
      table={table}
      datasetName={datasetName}
      provenance={provenance}
    />
  );
}

function SectionHeader({ block }: { block: DashboardBlock }) {
  return (
    <article className="section-header-block">
      <span className="section-header-block__eyebrow">{block.eyebrow}</span>
      <div>
        <h2>{block.title}</h2>
        {block.chip && (
          <span className="section-header-block__chip">{block.chip}</span>
        )}
      </div>
      {block.subtitle && <p>{block.subtitle}</p>}
      <i />
    </article>
  );
}

function Heading({ block }: { block: DashboardBlock }) {
  const Tag = `h${block.headingLevel}` as "h1" | "h2" | "h3";
  return (
    <article className="heading-block">
      <Tag>{block.title}</Tag>
      {block.subtitle && <p>{block.subtitle}</p>}
    </article>
  );
}

function TextBlock({ block }: { block: DashboardBlock }) {
  const lines = block.body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const bulletLines = lines.filter((line) => BULLET_PATTERN.test(line));
  // Keep source order: consecutive bullet lines share one list, and any
  // non-bullet line between them renders as its own paragraph.
  const segments = lines.reduce<TextSegment[]>((acc, line) => {
    if (BULLET_PATTERN.test(line)) {
      const item = line.replace(BULLET_PATTERN, "");
      const last = acc.at(-1);
      if (last?.kind === "list") last.items.push(item);
      else acc.push({ kind: "list", items: [item] });
    } else {
      acc.push({ kind: "paragraph", text: line });
    }
    return acc;
  }, []);
  return (
    <article
      className={`text-block${bulletLines.length ? " is-commentary" : ""}`}
    >
      {block.title && (
        <header className="text-block__header">
          <h3>{block.title}</h3>
        </header>
      )}
      {bulletLines.length ? (
        segments.map((segment, segmentIndex) =>
          segment.kind === "list" ? (
            <ul key={segmentIndex}>
              {segment.items.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : (
            <p key={segmentIndex}>{segment.text}</p>
          ),
        )
      ) : (
        <p>{block.body}</p>
      )}
    </article>
  );
}

const BULLET_PATTERN = /^(?:•|-|✓)\s+/;

type TextSegment =
  { kind: "list"; items: string[] } | { kind: "paragraph"; text: string };

function Kpi({ block, table }: { block: DashboardBlock; table?: DataTable }) {
  const value = aggregate(table, block.valueField, block.kpi.aggregation);
  const comparison = block.kpi.comparisonValue;
  const delta =
    comparison === undefined || value === null ? null : value - comparison;
  const deltaIsDown = delta !== null && delta < 0;
  const DeltaIcon = deltaIsDown ? ArrowDown : ArrowUp;
  const formattedDelta =
    delta === null
      ? null
      : formatValue(
          Math.abs(delta),
          block.kpi.valueFormat,
          block.kpi.decimalPlaces,
        );
  const target = block.kpi.targetValue;
  const targetMet =
    target === undefined || value === null
      ? null
      : block.kpi.positiveDirection === "up"
        ? value >= target
        : value <= target;
  const selectedIcon = block.kpi.icon ?? "auto";
  const KpiIcon = getKpiIcon(
    selectedIcon === "auto" ? automaticKpiIcon(block) : selectedIcon,
  );
  return (
    <article
      className="kpi-block"
      aria-label={`${block.title} KPI`}
      title={block.subtitle || undefined}
    >
      <header>
        <span className="kpi-block__icon" aria-hidden="true">
          <KpiIcon size={14} strokeWidth={1.9} />
        </span>
        <div>
          <h3>{block.title}</h3>
          <small>{block.eyebrow || kpiCategory(block)}</small>
        </div>
      </header>
      {delta !== null && (
        <span
          className={`kpi-delta ${deltaIsDown ? "is-negative" : "is-positive"}`}
          title={block.kpi.comparisonLabel || undefined}
          aria-label={`${deltaIsDown ? "Down" : "Up"} ${formattedDelta}`}
        >
          <DeltaIcon size={10} strokeWidth={2.4} aria-hidden="true" />
          {formattedDelta}
        </span>
      )}
      <div className="kpi-block__value-row">
        <strong>
          {value === null
            ? "—"
            : `${block.kpi.prefix}${formatValue(value, block.kpi.valueFormat, block.kpi.decimalPlaces)}${block.kpi.suffix}`}
        </strong>
        {block.kpi.showProgress && target !== undefined && (
          <div className={`kpi-target ${targetMet ? "is-met" : "is-gap"}`}>
            <span>Target</span>
            <strong>
              {formatValue(
                target,
                block.kpi.valueFormat,
                block.kpi.decimalPlaces,
              )}
            </strong>
          </div>
        )}
      </div>
      {!table && (
        <p className="block-placeholder">Choose a dataset and value field.</p>
      )}
    </article>
  );
}

function kpiCategory(block: DashboardBlock) {
  const field = (block.valueField || block.title).toLowerCase();
  if (field.includes("ship")) return "Network volume";
  if (field.includes("fill")) return "Store service";
  if (field.includes("otif") || field.includes("on time"))
    return "Delivery reliability";
  if (field.includes("inventory") || field.includes("days"))
    return "Working capital";
  if (field.includes("spoil") || field.includes("waste"))
    return "Fresh quality";
  if (field.includes("cost") || field.includes("spend"))
    return "Unit economics";
  return "Operating measure";
}

function automaticKpiIcon(block: DashboardBlock): KpiIconName {
  const field = (block.valueField || block.title).toLowerCase();
  if (field.includes("ship")) return "shipping-box";
  if (field.includes("fill")) return "store";
  if (field.includes("otif") || field.includes("on time")) return "check";
  if (field.includes("inventory") || field.includes("days")) return "inventory";
  if (field.includes("spoil") || field.includes("waste"))
    return "sustainability";
  if (field.includes("cost") || field.includes("spend")) return "truck";
  return "auto";
}

function TableBlock({
  block,
  table,
  datasetName,
  provenance,
}: {
  block: DashboardBlock;
  table?: DataTable;
  datasetName?: string;
  provenance?: string;
}) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  if (!table)
    return (
      <Placeholder
        title={block.title}
        text="Choose a dataset to render this table."
      />
    );
  const settings = { ...defaultTableSettings(), ...block.table };
  const columnStyles = settings.columnStyles ?? [];
  const cellStyles = settings.cellStyles ?? [];
  const visible = settings.visibleColumns.length
    ? settings.visibleColumns.filter((column) => table.columns.includes(column))
    : table.columns;
  const indexes = visible.map((column) => table.columns.indexOf(column));
  const normalizedQuery = settings.showSearch ? query.trim().toLowerCase() : "";
  const filteredRows = table.rows
    .map((row, sourceIndex) => ({ row, sourceIndex }))
    .filter(
      ({ row }) =>
        !normalizedQuery ||
        row.some((value) =>
          String(value ?? "")
            .toLowerCase()
            .includes(normalizedQuery),
        ),
    );
  const sortRules = settings.sortRules.length
    ? settings.sortRules
    : settings.sortColumn && settings.sortDirection !== "none"
      ? [
          {
            column: settings.sortColumn,
            direction: settings.sortDirection,
          },
        ]
      : [];
  if (sortRules.length)
    filteredRows.sort((a, b) => {
      for (const rule of sortRules) {
        const sortIndex = table.columns.indexOf(rule.column);
        if (sortIndex < 0) continue;
        const compared = compareTableCells(
          a.row[sortIndex],
          b.row[sortIndex],
          rule.direction,
        );
        if (compared) return compared;
      }
      return a.sourceIndex - b.sourceIndex;
    });
  const rows = filteredRows.slice(0, settings.rowLimit);
  const groupColumnIndex = table.columns.indexOf(settings.colorByColumn);
  const groupStyles = buildTableGroupStyles(settings, table, groupColumnIndex);
  const groupStyleForRow = (row: CellValue[]) =>
    groupColumnIndex < 0
      ? undefined
      : groupStyles.get(String(row[groupColumnIndex] ?? ""));
  const numericMax = new Map<number, number>();
  indexes.forEach((column) => {
    const values = rows
      .map(({ row }) => row[column])
      .filter((value): value is number => typeof value === "number");
    numericMax.set(column, Math.max(...values.map(Math.abs), 0));
  });
  return (
    <article
      className={`table-block${settings.compact ? " is-compact" : ""}${settings.wrapText ? " wraps-text" : ""}${settings.rowGridlines ? "" : " no-row-grid"}`}
    >
      <header>
        <div>
          <h3>{block.title}</h3>
          {block.subtitle && <p>{block.subtitle}</p>}
        </div>
        <div className="table-block__tools">
          {block.datasetId && settings.showDatasetName && (
            <span className="table-block__dataset">
              {datasetName ?? "Linked dataset"}
            </span>
          )}
          {settings.showSearch && (
            <>
              <button
                type="button"
                className="table-block__search-toggle"
                aria-label={`${searchOpen ? "Close" : "Open"} search for ${block.title}`}
                aria-pressed={searchOpen}
                onClick={() => {
                  if (searchOpen) setQuery("");
                  setSearchOpen(!searchOpen);
                }}
              >
                {searchOpen ? <X size={13} /> : <Search size={13} />}
              </button>
              {searchOpen && (
                <input
                  type="search"
                  aria-label={`Search ${block.title}`}
                  placeholder="Search rows…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  autoFocus
                />
              )}
            </>
          )}
          {settings.showRowCount && (
            <span className="table-block__count">
              {rows.length}
              {rows.length !== table.rows.length
                ? ` of ${table.rows.length}`
                : ""}{" "}
              rows
            </span>
          )}
        </div>
      </header>
      <div className="table-block__wrap">
        <table
          className={`${settings.striped ? "is-striped" : ""}${settings.columnGridlines ? " has-grid" : ""}`}
        >
          {settings.showColumnHeaders && (
            <thead className={settings.stickyHeader ? "is-sticky" : ""}>
              <tr>
                {settings.showRowNumbers && (
                  <th
                    className={`table-row-number${settings.freezeFirstColumn ? " is-frozen" : ""}`}
                    style={tableHeaderStyle(settings)}
                  >
                    #
                  </th>
                )}
                {visible.map((column, visibleIndex) => {
                  const columnStyle = findTableColumnStyle(
                    columnStyles,
                    column,
                  );
                  return (
                    <th
                      key={column}
                      className={
                        settings.freezeFirstColumn && visibleIndex === 0
                          ? "is-frozen"
                          : ""
                      }
                      style={tableHeaderStyle(
                        settings,
                        columnStyle,
                        settings.showRowNumbers ? 29 : 0,
                      )}
                      data-column={column}
                    >
                      {columnStyle?.label ?? column}
                    </th>
                  );
                })}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map(({ row, sourceIndex }, rowIndex) => (
              <tr
                key={sourceIndex}
                className={
                  settings.boldLastRow && rowIndex === rows.length - 1
                    ? "is-total"
                    : ""
                }
                style={{
                  backgroundColor:
                    groupStyleForRow(row)?.backgroundColor ??
                    (settings.striped && rowIndex % 2 === 1
                      ? settings.alternateRowBackgroundColor
                      : settings.rowBackgroundColor),
                }}
                data-group-value={
                  groupColumnIndex < 0
                    ? undefined
                    : String(row[groupColumnIndex] ?? "")
                }
                data-source-row-index={sourceIndex + 1}
              >
                {settings.showRowNumbers && (
                  <th
                    className={`table-row-number${settings.freezeFirstColumn ? " is-frozen" : ""}`}
                    style={{
                      left: 0,
                      backgroundColor:
                        groupStyleForRow(row)?.backgroundColor ??
                        (settings.striped && rowIndex % 2 === 1
                          ? settings.alternateRowBackgroundColor
                          : settings.rowBackgroundColor),
                    }}
                  >
                    {rowIndex + 1}
                  </th>
                )}
                {indexes.map((column, visibleIndex) => {
                  const value = row[column];
                  const numeric = typeof value === "number";
                  const columnName = visible[visibleIndex];
                  const columnStyle = findTableColumnStyle(
                    columnStyles,
                    columnName,
                  );
                  const cellStyle = resolveTableCellStyle(
                    cellStyles,
                    table,
                    row,
                    sourceIndex,
                    columnName,
                  );
                  const intensity = numeric
                    ? Math.abs(value) / Math.max(1, numericMax.get(column) ?? 1)
                    : 0;
                  const heatmapBackground =
                    settings.heatmap && numeric
                      ? colorWithAlpha(
                          settings.heatmapColor,
                          0.08 + intensity * 0.25,
                        )
                      : undefined;
                  return (
                    <td
                      key={column}
                      className={`${numeric ? "numeric" : ""}${typeof value === "number" && value < 0 && settings.negativeRed ? " is-negative" : ""}${settings.freezeFirstColumn && visibleIndex === 0 ? " is-frozen" : ""}`}
                      style={tableCellStyle(
                        settings,
                        columnStyle,
                        cellStyle,
                        heatmapBackground,
                        numeric && value < 0,
                        settings.showRowNumbers ? 29 : 0,
                        groupStyleForRow(row)?.textColor,
                      )}
                      data-column={columnName}
                      data-source-row-index={sourceIndex + 1}
                    >
                      {numeric
                        ? formatTableNumber(
                            value,
                            settings,
                            columnName,
                            columnStyle,
                          )
                        : formatCell(value, settings.nullDisplay)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {settings.showTotals && (
              <tr className="is-total">
                {settings.showRowNumbers && <th />}
                {indexes.map((column, index) => {
                  const values = table.rows
                    .map((row) => row[column])
                    .filter(
                      (value): value is number => typeof value === "number",
                    );
                  const shouldTotal =
                    values.length > 0 &&
                    (!settings.totalColumns.length ||
                      settings.totalColumns.includes(visible[index]));
                  const columnStyle = findTableColumnStyle(
                    columnStyles,
                    visible[index],
                  );
                  return (
                    <td key={column} className={values.length ? "numeric" : ""}>
                      {index === 0 && !values.length
                        ? settings.totalsLabel
                        : shouldTotal
                          ? formatTableNumber(
                              values.reduce((sum, item) => sum + item, 0),
                              settings,
                              visible[index],
                              columnStyle,
                            )
                          : ""}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {provenance && <footer className="block-provenance">{provenance}</footer>}
    </article>
  );
}

function compareTableCells(
  left: CellValue,
  right: CellValue,
  direction: "ascending" | "descending",
) {
  if (left === right) return 0;
  if (left === null || left === "") return 1;
  if (right === null || right === "") return -1;
  const compared =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right), undefined, {
          numeric: true,
          sensitivity: "base",
        });
  return direction === "ascending" ? compared : -compared;
}

function findTableColumnStyle(styles: TableColumnStyle[], column: string) {
  return styles.find((style) => style.column === column);
}

function resolveTableCellStyle(
  styles: TableCellStyle[],
  table: DataTable,
  row: CellValue[],
  sourceIndex: number,
  column: string,
) {
  return styles.reduce<TableCellStyle | undefined>((resolved, style) => {
    if (style.column !== column) return resolved;
    const rowMatches =
      style.rowIndex === undefined || style.rowIndex === sourceIndex + 1;
    const matchColumnIndex = style.matchColumn
      ? table.columns.indexOf(style.matchColumn)
      : -1;
    const valueMatches =
      style.matchColumn === undefined ||
      (matchColumnIndex >= 0 &&
        String(row[matchColumnIndex] ?? "") === style.matchValue);
    return rowMatches && valueMatches ? { ...resolved, ...style } : resolved;
  }, undefined);
}

function buildTableGroupStyles(
  settings: DashboardBlock["table"],
  table: DataTable,
  groupColumnIndex: number,
) {
  const styles = new Map<
    string,
    { backgroundColor: string; textColor?: string }
  >();
  if (groupColumnIndex < 0 || !settings.groupPalette.length) return styles;
  const values = [
    ...new Set(table.rows.map((row) => String(row[groupColumnIndex] ?? ""))),
  ];
  values.forEach((value, index) => {
    const override = settings.groupColors.find(
      (candidate) => candidate.value === value,
    );
    styles.set(value, {
      backgroundColor:
        override?.backgroundColor ??
        settings.groupPalette[index % settings.groupPalette.length],
      ...(override?.textColor ? { textColor: override.textColor } : {}),
    });
  });
  return styles;
}

function tableHeaderStyle(
  settings: DashboardBlock["table"],
  column?: TableColumnStyle,
  frozenLeft = 0,
): CSSProperties {
  return {
    color: column?.headerTextColor ?? settings.headerTextColor,
    backgroundColor:
      column?.headerBackgroundColor ?? settings.headerBackgroundColor,
    borderBottomColor: settings.rowGridlines
      ? settings.gridColor
      : "transparent",
    borderRightColor: settings.columnGridlines
      ? settings.gridColor
      : "transparent",
    width: column?.width,
    minWidth: column?.width,
    maxWidth: column?.width,
    textAlign:
      column?.align && column.align !== "auto" ? column.align : undefined,
    whiteSpace: (column?.wrap ?? settings.wrapText) ? "normal" : "nowrap",
    left: frozenLeft,
  };
}

function tableCellStyle(
  settings: DashboardBlock["table"],
  column: TableColumnStyle | undefined,
  cell: TableCellStyle | undefined,
  heatmapBackground: string | undefined,
  negative: boolean,
  frozenLeft: number,
  groupTextColor?: string,
): CSSProperties {
  const weight =
    cell?.fontWeight === "bold"
      ? 700
      : cell?.fontWeight === "medium"
        ? 600
        : cell?.fontWeight === "normal"
          ? 400
          : undefined;
  const align =
    cell?.textAlign ??
    (column?.align && column.align !== "auto" ? column.align : undefined);
  return {
    color:
      cell?.textColor ??
      (negative && settings.negativeRed
        ? "var(--red)"
        : (column?.textColor ?? groupTextColor ?? settings.cellTextColor)),
    backgroundColor:
      cell?.backgroundColor ?? heatmapBackground ?? column?.backgroundColor,
    borderBottomColor: settings.rowGridlines
      ? settings.gridColor
      : "transparent",
    borderRightColor: settings.columnGridlines
      ? settings.gridColor
      : "transparent",
    width: column?.width,
    minWidth: column?.width,
    maxWidth: column?.width,
    textAlign: align,
    whiteSpace: (column?.wrap ?? settings.wrapText) ? "normal" : "nowrap",
    fontWeight: weight,
    left: frozenLeft,
  };
}

function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <article className="block-placeholder-card">
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function aggregate(
  table: DataTable | undefined,
  field: string | undefined,
  aggregation: DashboardBlock["kpi"]["aggregation"],
) {
  if (!table || !field) return null;
  const column = table.columns.indexOf(field);
  if (column < 0) return null;
  const values = table.rows
    .map((row) => row[column])
    .filter((value): value is number => typeof value === "number");
  // Count non-null cells of the bound field so KPI and gauge `count` agree.
  if (aggregation === "count") return countBoundValues(table, field);
  if (!values.length) return null;
  if (aggregation === "average")
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (aggregation === "minimum") return Math.min(...values);
  if (aggregation === "maximum") return Math.max(...values);
  if (aggregation === "first") return values[0];
  if (aggregation === "last") return values[values.length - 1];
  return values.reduce((sum, value) => sum + value, 0);
}

function formatCell(value: CellValue | undefined, nullDisplay = "") {
  if (value === null || value === undefined || value === "") return nullDisplay;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatTableNumber(
  value: number,
  settings: DashboardBlock["table"],
  columnName = "",
  column?: TableColumnStyle,
) {
  const formatted = formatValue(
    value,
    inferredTableFormat(
      columnName,
      column?.numberFormat ?? settings.numberFormat,
    ),
    column?.decimalPlaces ?? settings.decimalPlaces,
  );
  const signed =
    value < 0 && settings.negativeParens
      ? `(${formatted.replace("-", "")})`
      : formatted;
  return `${column?.prefix ?? ""}${signed}${column?.suffix ?? ""}`;
}

function inferredTableFormat(
  column: string,
  requested: DashboardBlock["table"]["numberFormat"],
) {
  if (requested !== "auto") return requested;
  // Generic cues only: unit words in the heading pick the notation, and
  // everything else follows the magnitude of the value.
  if (/rate|share|pct|percent|%/i.test(column)) return "percent";
  if (/cost|spend|price|revenue|\$|usd/i.test(column)) return "currency";
  return "auto";
}

function colorWithAlpha(hex: string, alpha: number) {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!match) return `rgb(47 111 202 / ${alpha})`;
  return `rgb(${Number.parseInt(match[1], 16)} ${Number.parseInt(match[2], 16)} ${Number.parseInt(match[3], 16)} / ${alpha})`;
}
