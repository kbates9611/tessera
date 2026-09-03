import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CellValue,
  DatasetMonth,
  SourceWorksheet,
  WorksheetRegion,
} from "../../domain/types";
import {
  boundsFromSelection,
  columnLabel,
  formatCell,
  insideRange,
  isNumericLikeCell,
  rangeLabel,
  type CellRange,
  type CellSelection,
} from "./model";

const MIN_COLUMNS = 12;
const MIN_ROWS = 24;
const ROW_INDEX_WIDTH = 28;
const LABEL_COLUMN_WIDTH = 150;
const COLUMN_WIDTH = 84;
const ROW_HEIGHT = 25;
const SELECTION_ID = "__selection";

interface Overlay {
  id: string;
  kind: WorksheetRegion["kind"] | "selection";
  label: string;
  range: WorksheetRegion["range"];
}

export function OriginalWorksheet({
  month,
  sheet,
  regions,
  activeRegionId,
  onRegionClick,
  selection,
  onSelection,
}: {
  month: DatasetMonth;
  sheet?: SourceWorksheet;
  regions: WorksheetRegion[];
  activeRegionId?: string | null;
  onRegionClick?: (regionId: string) => void;
  selection?: CellSelection | null;
  onSelection?: (selection: CellSelection | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [overlayStyles, setOverlayStyles] = useState<
    Record<string, { left: string; top: string; width: string; height: string }>
  >({});
  const [fill, setFill] = useState({
    columns: MIN_COLUMNS,
    rows: MIN_ROWS,
    width: 0,
  });
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const columns =
        Math.floor(
          (wrap.clientWidth - ROW_INDEX_WIDTH - LABEL_COLUMN_WIDTH) /
            COLUMN_WIDTH,
        ) + 1;
      const rows = Math.floor((wrap.clientHeight - ROW_HEIGHT) / ROW_HEIGHT);
      const width = wrap.clientWidth;
      setFill((current) =>
        current.columns === columns &&
        current.rows === rows &&
        current.width === width
          ? current
          : { columns: Math.max(1, columns), rows: Math.max(1, rows), width },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const matrix: CellValue[][] = sheet?.rows ?? [
    month.original.columns,
    ...month.original.rows,
  ];
  const usedColumns = matrix.reduce(
    (widest, row) => Math.max(widest, row.length),
    1,
  );
  const columnCount = Math.max(
    sheet?.columnCount ?? 0,
    fill.columns,
    usedColumns + 1,
  );
  const rowCount = Math.max(sheet?.rowCount ?? 0, fill.rows, matrix.length + 2);
  const naturalWidth =
    ROW_INDEX_WIDTH + LABEL_COLUMN_WIDTH + (columnCount - 1) * COLUMN_WIDTH;
  const tableWidth = Math.max(fill.width, naturalWidth);
  const lastColumnWidth = tableWidth - (naturalWidth - COLUMN_WIDTH);
  const rows = Array.from({ length: rowCount }, (_, row) =>
    Array.from({ length: columnCount }, (_, column) =>
      matrix[row]?.[column] === undefined ? null : matrix[row][column],
    ),
  );
  const selecting = Boolean(onSelection);
  const selectionRange: CellRange | undefined = selection
    ? boundsFromSelection(selection)
    : undefined;

  const overlays = useMemo<Overlay[]>(
    () => [
      ...regions.map((region) => ({
        id: region.id,
        kind: region.kind,
        label:
          region.kind === "table"
            ? region.canonicalName && region.canonicalName !== region.name
              ? `${region.name} → ${region.canonicalName}`
              : region.name
            : `${region.name} · ${region.kind === "narrative" ? "notes" : "footnote"}`,
        range: region.range,
      })),
      ...(selectionRange
        ? [
            {
              id: SELECTION_ID,
              kind: "selection" as const,
              label: rangeLabel(selectionRange),
              range: {
                startRow: selectionRange.startRow + 1,
                startColumn: selectionRange.startColumn + 1,
                endRow: selectionRange.endRow + 1,
                endColumn: selectionRange.endColumn + 1,
              },
            },
          ]
        : []),
    ],
    [regions, selectionRange],
  );
  const overlayKey = overlays
    .map(
      (overlay) =>
        `${overlay.id}:${overlay.range.startRow},${overlay.range.startColumn},${overlay.range.endRow},${overlay.range.endColumn}`,
    )
    .join("|");

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const table = wrap?.querySelector("table");
    const bodyRows = table ? Array.from(table.tBodies[0]?.rows ?? []) : [];
    if (!wrap || !table || !bodyRows.length) return;
    const measured: typeof overlayStyles = {};
    overlays.forEach((overlay) => {
      const firstRow = bodyRows[overlay.range.startRow - 1];
      const lastRow = bodyRows[overlay.range.endRow - 1];
      if (!firstRow || !lastRow) return;
      const firstCell = firstRow.querySelector<HTMLElement>(
        `td[data-column="${overlay.range.startColumn - 1}"]`,
      );
      const lastCell = firstRow.querySelector<HTMLElement>(
        `td[data-column="${overlay.range.endColumn - 1}"]`,
      );
      if (!firstCell || !lastCell) return;
      measured[overlay.id] = {
        left: `${firstCell.offsetLeft - 1}px`,
        top: `${firstRow.offsetTop - 1}px`,
        width: `${lastCell.offsetLeft + lastCell.offsetWidth - firstCell.offsetLeft + 2}px`,
        height: `${lastRow.offsetTop + lastRow.offsetHeight - firstRow.offsetTop + 2}px`,
      };
    });
    setOverlayStyles((current) =>
      JSON.stringify(current) === JSON.stringify(measured) ? current : measured,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayKey, rowCount, columnCount, tableWidth, month.id]);

  return (
    <div
      className={`worksheet-wrap${selecting ? " is-selecting" : ""}`}
      data-testid="original-worksheet"
      ref={wrapRef}
      onPointerUp={() => {
        draggingRef.current = false;
      }}
      onPointerLeave={() => {
        draggingRef.current = false;
      }}
    >
      {overlays.map((overlay) => {
        const isSelection = overlay.kind === "selection";
        const clickable = !isSelection && Boolean(onRegionClick);
        return (
          <div
            key={overlay.id}
            className={`worksheet-region-outline is-${overlay.kind}${
              overlay.id === activeRegionId ? " is-active" : ""
            }${clickable ? " is-clickable" : ""}`}
            data-testid={
              isSelection
                ? "worksheet-selection"
                : `worksheet-region-${overlay.id}`
            }
            data-start-row={overlay.range.startRow}
            data-end-row={overlay.range.endRow}
            data-start-column={overlay.range.startColumn}
            data-end-column={overlay.range.endColumn}
            style={overlayStyles[overlay.id] ?? { display: "none" }}
            aria-label={overlay.label}
          >
            <span
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={
                clickable ? () => onRegionClick?.(overlay.id) : undefined
              }
              onKeyDown={
                clickable
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onRegionClick?.(overlay.id);
                      }
                    }
                  : undefined
              }
            >
              {overlay.label}
            </span>
          </div>
        );
      })}
      <table className="worksheet-grid" style={{ width: `${tableWidth}px` }}>
        <colgroup>
          <col className="worksheet-row-index" />
          {Array.from({ length: columnCount }, (_, column) => (
            <col
              key={column}
              className={
                column === 0
                  ? "worksheet-label-column"
                  : column < columnCount - 1
                    ? "worksheet-data-column"
                    : undefined
              }
              style={
                column === columnCount - 1 && column !== 0
                  ? { width: `${lastColumnWidth}px` }
                  : undefined
              }
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="worksheet-corner" />
            {Array.from({ length: columnCount }, (_, column) => (
              <th key={column}>{columnLabel(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <th className="worksheet-row-number">{rowIndex + 1}</th>
              {row.map((value, columnIndex) => {
                const blank = value === null || value === "";
                const nextBlank =
                  row[columnIndex + 1] === null ||
                  row[columnIndex + 1] === "" ||
                  row[columnIndex + 1] === undefined;
                const overflow =
                  typeof value === "string" && !blank && nextBlank;
                const selected =
                  selectionRange &&
                  insideRange(rowIndex, columnIndex, selectionRange);
                const classes = [
                  isNumericLikeCell(value) ? "is-numeric" : "",
                  overflow ? "is-overflow" : "",
                  blank ? "is-blank" : "",
                  selected ? "is-selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <td
                    key={columnIndex}
                    data-column={columnIndex}
                    className={classes}
                    onPointerDown={
                      selecting
                        ? (event) => {
                            event.preventDefault();
                            draggingRef.current = true;
                            onSelection?.({
                              anchor: { row: rowIndex, column: columnIndex },
                              focus: { row: rowIndex, column: columnIndex },
                            });
                          }
                        : undefined
                    }
                    onPointerEnter={
                      selecting
                        ? () => {
                            if (!draggingRef.current || !selection) return;
                            onSelection?.({
                              ...selection,
                              focus: { row: rowIndex, column: columnIndex },
                            });
                          }
                        : undefined
                    }
                  >
                    {formatCell(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
