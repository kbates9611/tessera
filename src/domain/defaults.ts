import type {
  BlockLayout,
  BlockStyle,
  BlockType,
  ChartSettings,
  Dashboard,
  DashboardBlock,
  GaugeSettings,
  KpiSettings,
  TableSettings,
  TesseraProject,
} from "./types";
import type { IllustrationSettings } from "./illustrations";

export const DEFAULT_COLORS = [
  "#1c2b4a",
  "#355f9d",
  "#4d76b3",
  "#7897c4",
  "#b7c9e2",
  "#dbe6f3",
];

/** Sankey branches stay in the house blues and greys; emphasis is applied per element. */
export const DEFAULT_SANKEY_COLORS = [
  "#1c2b4a",
  "#355f9d",
  "#4d76b3",
  "#7897c4",
  "#8a97ab",
  "#a9b6c8",
  "#b7c9e2",
  "#cfd7e2",
];

/**
 * The only colors that carry meaning on a dashboard. Everything else stays in
 * the blue-and-grey house palette, and card surfaces are always white.
 */
export const EMPHASIS_COLORS = {
  positive: "#1f7a4d",
  negative: "#b42318",
  warning: "#b7791f",
  focus: "#1478ff",
} as const;

export const defaultBlockStyle = (): BlockStyle => ({
  accent: "#355f9d",
  background: "#ffffff",
  textColor: "#1f2637",
  alignH: "left",
  alignV: "top",
  fontScale: 100,
  padding: 16,
  cornerRadius: 11,
  border: true,
  shadow: "soft",
});

export const defaultChartSettings = (): ChartSettings => ({
  showLegend: true,
  legendPosition: "bottom",
  showValues: false,
  showGridlines: true,
  showXAxis: true,
  showYAxis: true,
  showPoints: true,
  showAverageLine: false,
  showMinLine: false,
  showMaxLine: false,
  showReferenceLine: false,
  referenceLabel: "Target",
  sortOrder: "source",
  valueFormat: "auto",
  decimalPlaces: 1,
  colors: [...DEFAULT_COLORS],
  seriesOpacity: 1,
  barRadius: 4,
  barGap: 28,
  barColorOverrides: [],
  lineWidth: 2.2,
  curve: "straight",
  lineDash: "solid",
  pointSize: 4,
  pointShape: "circle",
  connectNulls: false,
  fillArea: false,
  areaOpacity: 0.12,
  lineSeriesStyles: [],
  linePointStyles: [],
  heatmapScaleType: "sequential",
  heatmapScaleScope: "global",
  heatmapMinColor: "#edf4fb",
  heatmapMidColor: "#7897c4",
  heatmapMaxColor: "#1c2b4a",
  heatmapReverse: false,
  heatmapMissingColor: "#e8edf3",
  heatmapCellGap: 3,
  heatmapCellRadius: 5,
  heatmapCellStyles: [],
  donutHole: 58,
  donutCenterLabel: "Total",
  donutSliceStyles: [],
  treemapTileStyles: [],
  sankeyNodeWidth: 16,
  sankeyNodeGap: 14,
  sankeyLinkOpacity: 0.28,
  sankeyLinkThickness: 1,
  sankeyStageLabels: [],
  sankeyShowStageHeaders: true,
  sankeyShowNodeLabels: true,
  sankeyShowLinkValues: false,
  sankeyShowShares: true,
  sankeyLinkColorMode: "gradient",
  sankeyNodeSort: "auto",
  sankeyNodeOverrides: [],
  sankeyLinkOverrides: [],
  highlightNodes: [],
  xAxisTitle: "",
  yAxisTitle: "",
  xValueFormat: "auto",
  xDecimalPlaces: 1,
  scatterPointSize: 6,
  scatterPointShape: "circle",
  scatterPointStroke: "#ffffff",
  scatterPointStrokeWidth: 2,
  scatterIncludeZero: false,
  scatterShowTrendLine: false,
  scatterTrendLineColor: "#1c2b4a",
  scatterXReferenceLabel: "",
  scatterYReferenceLabel: "",
  scatterPointStyles: [],
});

export const defaultTableSettings = (): TableSettings => ({
  visibleColumns: [],
  rowLimit: 20,
  sortColumn: "",
  sortDirection: "none",
  sortRules: [],
  striped: true,
  compact: false,
  columnGridlines: false,
  rowGridlines: true,
  stickyHeader: true,
  freezeFirstColumn: false,
  showSearch: false,
  showDatasetName: true,
  showRowCount: true,
  showRowNumbers: false,
  showColumnHeaders: true,
  boldLastRow: false,
  showTotals: false,
  totalsLabel: "Total",
  totalColumns: [],
  numberFormat: "auto",
  decimalPlaces: 1,
  nullDisplay: "",
  negativeParens: true,
  negativeRed: false,
  wrapText: false,
  heatmap: false,
  heatmapColor: "#355f9d",
  headerBackgroundColor: "#dbe6f3",
  headerTextColor: "#1c2b4a",
  rowBackgroundColor: "#ffffff",
  alternateRowBackgroundColor: "#f7f9fc",
  cellTextColor: "#3c4b60",
  gridColor: "#dbe3ed",
  colorByColumn: "",
  groupPalette: [
    "#eef4fb",
    "#e2edf9",
    "#f3f6fa",
    "#dbe6f3",
    "#edf1f7",
    "#e7eff8",
  ],
  groupColors: [],
  columnStyles: [],
  cellStyles: [],
});

export const defaultKpiSettings = (): KpiSettings => ({
  aggregation: "sum",
  valueFormat: "compact",
  decimalPlaces: 1,
  prefix: "",
  suffix: "",
  comparisonLabel: "",
  showProgress: false,
  positiveDirection: "up",
  icon: "auto",
});

export const defaultIllustrationSettings = (): IllustrationSettings => ({
  preset: "people-at-desks",
  altText: "Two colleagues working side by side at office desks.",
  primaryColor: "#111111",
  showCaption: false,
  libraryAssetId: "",
  bitmapMask: null,
  accentColor: "#111111",
  strokeWidth: 3.1,
  elements: [],
});

export const defaultGaugeSettings = (): GaugeSettings => ({
  aggregation: "average",
  display: "progress",
  valueLabel: "",
  targetLabel: "Target",
  showValue: true,
  showTarget: true,
  showScaleLabels: true,
  showPercentOfTarget: false,
  showRangeLabels: false,
  arcWidth: 22,
  roundedEnds: true,
  colors: {
    track: "#dbe6f3",
    value: "#355f9d",
    target: "#1c2b4a",
    needle: "#1c2b4a",
  },
  ranges: [],
});

const defaultLayout = (type: BlockType): BlockLayout => {
  if (type === "sectionHeader") return { width: 12, minHeight: 108 };
  if (type === "heading" || type === "text")
    return { width: 12, minHeight: type === "heading" ? 84 : 120 };
  if (type === "illustration") return { width: 12, minHeight: 460 };
  if (type === "kpi") return { width: 3, minHeight: 96 };
  if (type === "table") return { width: 12, minHeight: 300 };
  return { width: 6, minHeight: 300 };
};

export function createBlock(
  type: BlockType,
  patch: Partial<DashboardBlock> = {},
  source: "human" | "webmcp" = "human",
): DashboardBlock {
  const now = new Date().toISOString();
  const labels: Record<BlockType, string> = {
    sectionHeader: "New section",
    heading: "Heading",
    text: "Add context, interpretation, or a concise narrative here.",
    illustration: "People at desks",
    kpi: "Key metric",
    table: "Table",
    bar: "Bar chart",
    horizontalBar: "Horizontal bar chart",
    groupedBar: "Grouped bar chart",
    line: "Line chart",
    donut: "Donut chart",
    sankey: "Sankey chart",
    gauge: "Gauge",
    scatter: "Scatter plot",
    treemap: "Treemap",
    heatmap: "Heatmap",
  };
  return {
    id: crypto.randomUUID(),
    type,
    buildState: "ready",
    buildMode: "agent",
    intent: "",
    title: labels[type],
    subtitle: "",
    eyebrow: type === "sectionHeader" ? "SECTION" : "",
    chip: "",
    body: type === "text" ? labels.text : "",
    headingLevel: 2,
    period: "latest",
    valueFields: [],
    style:
      type === "kpi"
        ? { ...defaultBlockStyle(), padding: 12, shadow: "none" }
        : defaultBlockStyle(),
    chart:
      type === "sankey"
        ? {
            ...defaultChartSettings(),
            showValues: true,
            colors: [...DEFAULT_SANKEY_COLORS],
            sankeyNodeWidth: 16,
            sankeyNodeGap: 12,
            sankeyLinkOpacity: 0.52,
            sankeyLinkThickness: 1.45,
          }
        : defaultChartSettings(),
    gauge: defaultGaugeSettings(),
    table: defaultTableSettings(),
    kpi: defaultKpiSettings(),
    illustration: defaultIllustrationSettings(),
    layout: defaultLayout(type),
    createdBy: source,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

export function createDashboard(
  name = "Dashboard 1",
  reportingPeriod?: string,
): Dashboard {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  return {
    id,
    name,
    description: "",
    reportingPeriod,
    seriesId: id,
    createdAt: now,
    updatedAt: now,
    blocks: [],
  };
}

export function createProject(name = "New project"): TesseraProject {
  const now = new Date().toISOString();
  const dashboard = createDashboard();
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    warehouse: [],
    generatedIllustrations: [],
    dashboards: [dashboard],
    activeDashboardId: dashboard.id,
    activity: [],
  };
}
