import type { BlockType, DashboardBlock } from "./types";

/** The canvas is a 12-column grid; every block width is a span of it. */
export const CANVAS_COLUMNS = 12;
/** The narrowest span a card can take, on the canvas or inside a stack. */
export const MIN_BLOCK_WIDTH = 3;

type Width = DashboardBlock["layout"]["width"];

export const CHART_TYPES: BlockType[] = [
  "bar",
  "horizontalBar",
  "groupedBar",
  "line",
  "donut",
  "sankey",
  "gauge",
  "scatter",
  "treemap",
  "heatmap",
];

/**
 * One grid cell: a single block, or a stack of blocks that share a `stackId`.
 * A stack is itself a small grid as wide as the cell: a block whose width
 * equals the cell width takes a sub-row of its own, and two narrower blocks
 * sit side by side in one sub-row.
 */
export interface DashboardCell {
  id: string;
  blocks: DashboardBlock[];
  width: Width;
}

export function dashboardCells(blocks: DashboardBlock[]): DashboardCell[] {
  const cells: DashboardCell[] = [];
  blocks.forEach((block) => {
    const previous = cells.at(-1);
    if (
      block.layout.stackId &&
      previous?.blocks[0].layout.stackId === block.layout.stackId
    ) {
      previous.blocks.push(block);
      previous.width = Math.max(previous.width, block.layout.width) as Width;
      return;
    }
    cells.push({
      id: block.layout.stackId || block.id,
      blocks: [block],
      width: block.layout.width,
    });
  });
  return cells;
}

/** Cells flow left to right and wrap into rows exactly as the canvas draws them. */
export function dashboardRows(blocks: DashboardBlock[]): DashboardCell[][] {
  const rows: DashboardCell[][] = [];
  let row: DashboardCell[] = [];
  let used = 0;
  dashboardCells(blocks).forEach((cell) => {
    if (used > 0 && used + cell.width > CANVAS_COLUMNS) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(cell);
    used += cell.width;
    if (used === CANVAS_COLUMNS) {
      rows.push(row);
      row = [];
      used = 0;
    }
  });
  if (row.length) rows.push(row);
  return rows;
}

/**
 * A stack's blocks flow into sub-rows of the cell's width, exactly as the
 * stack grid draws them: two half-width cards share a sub-row, a full-width
 * card takes its own.
 */
export function stackRows(cell: DashboardCell): DashboardBlock[][] {
  const rows: DashboardBlock[][] = [];
  let row: DashboardBlock[] = [];
  let used = 0;
  cell.blocks.forEach((block) => {
    const width = Math.min(block.layout.width, cell.width);
    if (used > 0 && used + width > cell.width) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(block);
    used += width;
    if (used >= cell.width) {
      rows.push(row);
      row = [];
      used = 0;
    }
  });
  if (row.length) rows.push(row);
  return rows;
}

/**
 * Shares `total` columns among weights in proportion, giving each share at
 * least the minimum block width where the total allows, and summing exactly
 * to `total` (largest-remainder rounding).
 */
export function shareColumns(weights: number[], total: number): Width[] {
  if (!weights.length) return [];
  const floor = Math.max(
    1,
    Math.min(MIN_BLOCK_WIDTH, Math.floor(total / weights.length)),
  );
  const safeWeights = weights.map((weight) => (weight > 0 ? weight : 1));
  const sum = safeWeights.reduce((acc, weight) => acc + weight, 0);
  const ideals = safeWeights.map((weight) =>
    Math.max(floor, (total * weight) / sum),
  );
  const widths = ideals.map((ideal) => Math.max(floor, Math.floor(ideal)));
  let allocated = widths.reduce((acc, width) => acc + width, 0);
  while (allocated < total) {
    let best = 0;
    for (let index = 1; index < widths.length; index += 1)
      if (ideals[index] - widths[index] > ideals[best] - widths[best])
        best = index;
    widths[best] += 1;
    allocated += 1;
  }
  while (allocated > total) {
    let best = -1;
    for (let index = 0; index < widths.length; index += 1) {
      if (widths[index] <= floor) continue;
      if (
        best < 0 ||
        widths[index] - ideals[index] > widths[best] - ideals[best]
      )
        best = index;
    }
    if (best < 0) break;
    widths[best] -= 1;
    allocated -= 1;
  }
  return widths as Width[];
}

/**
 * Every sub-row of a stack spans the cell: a card left alone in its sub-row
 * takes the full width, partners keep sharing it in proportion.
 */
export function fillStackRows(cell: DashboardCell) {
  stackRows(cell).forEach((row) => {
    const widths = shareColumns(
      row.map((block) => block.layout.width),
      cell.width,
    );
    row.forEach((block, index) => {
      block.layout.width = widths[index];
    });
  });
}

/** Resizes a cell and scales every sub-row of its stack to the new width. */
export function setCellWidth(cell: DashboardCell, width: Width) {
  const rows = stackRows(cell);
  cell.width = width;
  rows.forEach((row) => {
    const widths = shareColumns(
      row.map((block) => block.layout.width),
      width,
    );
    row.forEach((block, index) => {
      block.layout.width = widths[index];
    });
  });
}

const SHORT_COMMENTARY_LIMIT = 700;

/** Flags a short commentary card stranded beside a tall visual. */
export function layoutWarnings(blocks: DashboardBlock[]): string[] {
  const warnings: string[] = [];
  dashboardRows(blocks).forEach((row) => {
    if (row.length < 2) return;
    row.forEach((cell) => {
      const [block] = cell.blocks;
      if (cell.blocks.length !== 1 || block.type !== "text") return;
      if (block.body.length > SHORT_COMMENTARY_LIMIT) return;
      const tall = row.find(
        (other) =>
          other !== cell &&
          other.blocks.some(
            (candidate) =>
              CHART_TYPES.includes(candidate.type) ||
              candidate.type === "table",
          ),
      );
      if (!tall) return;
      const neighbor = tall.blocks[0];
      warnings.push(
        `"${block.title || "Commentary"}" sits alone beside "${neighbor.title || neighbor.type}" and will stretch to that card's height, leaving empty surface. Give it a full-width row (width 12) under the chart, or stack a second short card with it in the same column using set_dashboard_layout with a shared stackId.`,
      );
    });
  });
  return warnings;
}
