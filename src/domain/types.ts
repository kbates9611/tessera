import type { KpiIconName } from "./kpiIcons";
import type {
  GeneratedIllustrationAsset,
  IllustrationSettings,
} from "./illustrations";

export type CellValue = string | number | boolean | null;

export interface DataTable {
  columns: string[];
  rows: CellValue[][];
}

export type WorksheetRegionKind = "table" | "narrative" | "footnote";

export interface WorksheetRegion {
  id: string;
  sheet?: string;
  name: string;
  kind: WorksheetRegionKind;
  confidence: number;
  canonicalName: string;
  range: {
    startRow: number;
    startColumn: number;
    endRow: number;
    endColumn: number;
  };
}

export interface SourceWorksheet {
  name: string;
  rowCount: number;
  columnCount: number;
  rows: CellValue[][];
  regions: WorksheetRegion[];
}

export interface SourceWorkbook {
  fileName: string;
  byteLength?: number;
  checksum?: string;
  /** Immutable raw object key when the exact uploaded file is retained. */
  storageKey?: string;
  contentType?: string;
  sheets: SourceWorksheet[];
}

export type DatasetProcessingStage =
  | "uploaded"
  | "outlining"
  | "needs_input"
  | "outlined"
  | "cleaning"
  | "review"
  | "approved";

export interface DatasetVariableMapping {
  source: string;
  canonical: string;
  confidence: number;
  matchedFromPrevious?: string;
  usedByCharts?: boolean;
  confirmed?: boolean;
}

export interface DatasetCleaningQuestionChoice {
  id: string;
  label: string;
  description?: string;
}

export interface DatasetCleaningQuestion {
  id: string;
  prompt: string;
  detail?: string;
  choices: DatasetCleaningQuestionChoice[];
  recommendedChoiceId?: string;
  answerChoiceId?: string;
}

export interface DatasetQualityCheck {
  id: string;
  label: string;
  status: "pass" | "review" | "fail";
  detail: string;
}

export interface DatasetMonthProcessing {
  stage: DatasetProcessingStage;
  progress: number;
  message: string;
  startedAt?: string;
  updatedAt: string;
  variableMappings: DatasetVariableMapping[];
  questions: DatasetCleaningQuestion[];
  qualityChecks: DatasetQualityCheck[];
  recipeRevision: number;
}

export interface CleaningRecipe {
  id: string;
  name: string;
  headerMap: Record<string, string>;
  notes: string[];
  updatedAt: string;
}

export interface DatasetMonth {
  id: string;
  period: string;
  label: string;
  sourceName: string;
  importedAt: string;
  /** Pending uploads preserve the source but are not available to dashboards. */
  status?: "ready" | "pending";
  original: DataTable;
  cleaned: DataTable;
  cleaningSummary: string[];
  sourceWorksheet?: SourceWorksheet;
  sourceWorkbook?: SourceWorkbook;
  processing?: DatasetMonthProcessing;
}

export interface DataAsset {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  recipe: CleaningRecipe;
  months: DatasetMonth[];
}

export const BLOCK_TYPES = [
  "sectionHeader",
  "heading",
  "text",
  "illustration",
  "kpi",
  "table",
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
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];
export const BLOCK_LABELS: Record<BlockType, string> = {
  sectionHeader: "Section header",
  heading: "Heading",
  text: "Text",
  illustration: "Illustration",
  kpi: "KPI",
  table: "Table",
  bar: "Bar",
  horizontalBar: "Horizontal bar",
  groupedBar: "Grouped bar",
  line: "Line",
  donut: "Donut",
  sankey: "Sankey",
  gauge: "Gauge",
  scatter: "Scatter",
  treemap: "Treemap",
  heatmap: "Heatmap",
};

export type ValueFormat =
  "auto" | "number" | "compact" | "percent" | "currency";

export type ScatterPointShape = "circle" | "square" | "diamond";

export interface ScatterPointStyle {
  /** Exact value from labelField. Use rowIndex when labels are not unique. */
  label?: string;
  /** One-based source row, excluding the header. */
  rowIndex?: number;
  color?: string;
  size?: number;
  opacity?: number;
  shape?: ScatterPointShape;
}

export interface BlockStyle {
  accent: string;
  background: string;
  textColor: string;
  alignH: "left" | "center" | "right";
  alignV: "top" | "middle" | "bottom";
  fontScale: number;
  padding: number;
  cornerRadius: number;
  border: boolean;
  shadow: "none" | "soft" | "raised";
}

export interface BarColorOverride {
  /** Exact rendered category label to target. */
  category: string;
  /** Optional series field; omit it to target the category across all series. */
  series?: string;
  color: string;
}

export interface DonutSliceStyle {
  /** Exact rendered category label. */
  category: string;
  color?: string;
  opacity?: number;
}

export interface TreemapTileStyle {
  /** Exact rendered category label. */
  category: string;
  color?: string;
  textColor?: string;
  opacity?: number;
}

export type GaugeAggregation =
  "sum" | "average" | "minimum" | "maximum" | "count" | "first" | "last";

export interface GaugeRange {
  /** Stable, user-facing identifier used for precise WebMCP edits. */
  id: string;
  label: string;
  from: number;
  to: number;
  color: string;
}

export interface GaugeColors {
  /** Unfilled scale behind the value and any qualitative ranges. */
  track: string;
  /** Actual-value arc in progress mode. */
  value: string;
  /** Target tick and target annotation. */
  target: string;
  /** Pointer and hub in dial mode. */
  needle: string;
}

export interface GaugeSettings {
  aggregation: GaugeAggregation;
  display: "progress" | "dial";
  min?: number;
  max?: number;
  targetValue?: number;
  valueLabel: string;
  targetLabel: string;
  showValue: boolean;
  showTarget: boolean;
  showScaleLabels: boolean;
  showPercentOfTarget: boolean;
  showRangeLabels: boolean;
  arcWidth: number;
  roundedEnds: boolean;
  colors: GaugeColors;
  ranges: GaugeRange[];
}

export type LineCurve = "straight" | "smooth" | "step";
export type LineDash = "solid" | "dashed" | "dotted";
export type LinePointShape = "circle" | "square" | "diamond";

export interface LineSeriesStyle {
  /** Exact value field name. */
  series: string;
  color?: string;
  lineWidth?: number;
  lineDash?: LineDash;
  opacity?: number;
  showPoints?: boolean;
  pointSize?: number;
  pointShape?: LinePointShape;
}

export interface LinePointStyle {
  /** Exact value field name. */
  series: string;
  /** Exact source category value bound to the x-axis, before display abbreviation. */
  category: string;
  color?: string;
  pointSize?: number;
  pointShape?: LinePointShape;
  showLabel?: boolean;
}

export type HeatmapScaleType = "sequential" | "diverging";
export type HeatmapScaleScope = "global" | "row" | "column";

export interface HeatmapCellStyle {
  /** Exact rendered row label. Use rowIndex when labels are not unique. */
  rowLabel?: string;
  /** One-based source row, excluding the header. */
  rowIndex?: number;
  /** Exact numeric value-field / rendered column heading. */
  column: string;
  color?: string;
  textColor?: string;
}

export interface SankeyNodeOverride {
  node: string;
  color?: string;
  label?: string;
  highlighted?: boolean;
}

export interface SankeyLinkOverride {
  source: string;
  target: string;
  color?: string;
  opacity?: number;
  highlighted?: boolean;
}

export interface ChartSettings {
  showLegend: boolean;
  legendPosition: "top" | "bottom" | "right";
  showValues: boolean;
  showGridlines: boolean;
  showXAxis: boolean;
  showYAxis: boolean;
  showPoints: boolean;
  showAverageLine: boolean;
  showMinLine: boolean;
  showMaxLine: boolean;
  showReferenceLine: boolean;
  referenceValue?: number;
  referenceLabel: string;
  sortOrder: "source" | "ascending" | "descending";
  valueFormat: ValueFormat;
  decimalPlaces: number;
  colors: string[];
  seriesOpacity: number;
  barRadius: number;
  barGap: number;
  barColorOverrides: BarColorOverride[];
  lineWidth: number;
  curve: LineCurve;
  lineDash: LineDash;
  pointSize: number;
  pointShape: LinePointShape;
  connectNulls: boolean;
  fillArea: boolean;
  areaOpacity: number;
  lineSeriesStyles: LineSeriesStyle[];
  linePointStyles: LinePointStyle[];
  heatmapScaleType: HeatmapScaleType;
  heatmapScaleScope: HeatmapScaleScope;
  heatmapMinColor: string;
  heatmapMidColor: string;
  heatmapMaxColor: string;
  heatmapMidpoint?: number;
  heatmapMinValue?: number;
  heatmapMaxValue?: number;
  heatmapReverse: boolean;
  heatmapMissingColor: string;
  heatmapCellGap: number;
  heatmapCellRadius: number;
  heatmapCellStyles: HeatmapCellStyle[];
  donutHole: number;
  donutCenterLabel: string;
  donutSliceStyles: DonutSliceStyle[];
  treemapTileStyles: TreemapTileStyle[];
  sankeyNodeWidth: number;
  sankeyNodeGap: number;
  sankeyLinkOpacity: number;
  sankeyLinkThickness: number;
  sankeyStageLabels: string[];
  sankeyShowStageHeaders: boolean;
  sankeyShowNodeLabels: boolean;
  sankeyShowLinkValues: boolean;
  sankeyShowShares: boolean;
  sankeyLinkColorMode: "gradient" | "source" | "target";
  sankeyNodeSort: "auto" | "name" | "value";
  sankeyNodeOverrides: SankeyNodeOverride[];
  sankeyLinkOverrides: SankeyLinkOverride[];
  highlightNodes: string[];
  xAxisTitle: string;
  yAxisTitle: string;
  xValueFormat: ValueFormat;
  xDecimalPlaces: number;
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
  scatterPointSize: number;
  scatterPointShape: ScatterPointShape;
  scatterPointStroke: string;
  scatterPointStrokeWidth: number;
  scatterIncludeZero: boolean;
  scatterShowTrendLine: boolean;
  scatterTrendLineColor: string;
  scatterXReferenceValue?: number;
  scatterXReferenceLabel: string;
  scatterYReferenceValue?: number;
  scatterYReferenceLabel: string;
  scatterPointStyles: ScatterPointStyle[];
}

export interface TableSettings {
  /** Empty means all dataset columns, in source order. */
  visibleColumns: string[];
  rowLimit: number;
  sortColumn: string;
  sortDirection: "none" | "ascending" | "descending";
  /** Applied in array order; the first rule has highest priority. */
  sortRules: TableSortRule[];
  striped: boolean;
  compact: boolean;
  columnGridlines: boolean;
  rowGridlines: boolean;
  stickyHeader: boolean;
  freezeFirstColumn: boolean;
  showSearch: boolean;
  showDatasetName: boolean;
  showRowCount: boolean;
  showRowNumbers: boolean;
  showColumnHeaders: boolean;
  boldLastRow: boolean;
  showTotals: boolean;
  totalsLabel: string;
  /** Empty means total every visible numeric column. */
  totalColumns: string[];
  numberFormat: ValueFormat;
  decimalPlaces: number;
  nullDisplay: string;
  negativeParens: boolean;
  negativeRed: boolean;
  wrapText: boolean;
  heatmap: boolean;
  heatmapColor: string;
  headerBackgroundColor: string;
  headerTextColor: string;
  rowBackgroundColor: string;
  alternateRowBackgroundColor: string;
  cellTextColor: string;
  gridColor: string;
  /** Empty disables row grouping colors. */
  colorByColumn: string;
  groupPalette: string[];
  groupColors: TableGroupColor[];
  columnStyles: TableColumnStyle[];
  cellStyles: TableCellStyle[];
}

export interface TableSortRule {
  column: string;
  direction: "ascending" | "descending";
}

export interface TableGroupColor {
  /** Exact String() representation of a value in colorByColumn. */
  value: string;
  backgroundColor: string;
  textColor?: string;
}

export interface TableColumnStyle {
  /** Exact dataset column name to target. */
  column: string;
  label?: string;
  width?: number;
  align?: "auto" | "left" | "center" | "right";
  wrap?: boolean;
  numberFormat?: ValueFormat;
  decimalPlaces?: number;
  prefix?: string;
  suffix?: string;
  backgroundColor?: string;
  textColor?: string;
  headerBackgroundColor?: string;
  headerTextColor?: string;
}

export interface TableCellStyle {
  /** Exact dataset column name for the cell being styled. */
  column: string;
  /** One-based row in the source dataset. Stable across search and sorting. */
  rowIndex?: number;
  /** Alternative stable row selector; use with matchValue. */
  matchColumn?: string;
  /** Compared to the rendered source value after String() conversion. */
  matchValue?: string;
  backgroundColor?: string;
  textColor?: string;
  fontWeight?: "normal" | "medium" | "bold";
  textAlign?: "left" | "center" | "right";
}

export interface KpiSettings {
  aggregation:
    "sum" | "average" | "count" | "minimum" | "maximum" | "first" | "last";
  valueFormat: ValueFormat;
  decimalPlaces: number;
  prefix: string;
  suffix: string;
  comparisonLabel: string;
  comparisonValue?: number;
  targetValue?: number;
  showProgress: boolean;
  positiveDirection: "up" | "down";
  icon: KpiIconName;
}

export interface BlockLayout {
  width: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  minHeight: number;
  /** Consecutive blocks with the same ID share one grid cell vertically. */
  stackId?: string;
}

export interface DashboardBlock {
  id: string;
  type: BlockType;
  /** New tiles remain placeholders until an agent or person completes them. */
  buildState: "placeholder" | "ready";
  buildMode: "agent" | "manual";
  /** Plain-language brief stored on the tile for later WebMCP fulfillment. */
  intent: string;
  title: string;
  subtitle: string;
  eyebrow: string;
  chip: string;
  body: string;
  headingLevel: 1 | 2 | 3;
  datasetId?: string;
  period: "latest" | string;
  categoryField?: string;
  labelField?: string;
  seriesField?: string;
  valueFields: string[];
  targetField?: string;
  valueField?: string;
  style: BlockStyle;
  chart: ChartSettings;
  /** Gauge-only semantics and named visual elements. */
  gauge: GaugeSettings;
  table: TableSettings;
  kpi: KpiSettings;
  illustration: IllustrationSettings;
  layout: BlockLayout;
  createdBy: "human" | "webmcp";
  createdAt: string;
  updatedAt: string;
}

/** The brand kits a dashboard can be drawn in; see domain/kits.ts. */
export type DashboardKitId = "slate-blue" | "burnt-orange" | "maroon";

export interface Dashboard {
  id: string;
  name: string;
  description: string;
  /** Reporting month this durable dashboard version presents. */
  reportingPeriod?: string;
  /** Stable identity shared by monthly versions of the same dashboard. */
  seriesId?: string;
  headerEyebrow?: string;
  createdAt: string;
  updatedAt: string;
  /** Brand kit supplying the dashboard's default colours. */
  kit?: DashboardKitId;
  blocks: DashboardBlock[];
  edition?: {
    period: string;
    sourceDashboardId?: string;
    status: "draft" | "published";
    createdFromPeriod?: string;
  };
}

export interface ActivityEntry {
  id: string;
  at: string;
  source: "human" | "webmcp";
  tool: string;
  summary: string;
}

export interface TesseraProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  warehouse: DataAsset[];
  generatedIllustrations: GeneratedIllustrationAsset[];
  dashboards: Dashboard[];
  activeDashboardId: string;
  activity: ActivityEntry[];
}

export interface TesseraState {
  schemaVersion: 1;
  activeProjectId: string;
  projects: TesseraProject[];
}

export interface PersistedEnvelope {
  revision: number;
  state: TesseraState | null;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  execute: (
    args: Record<string, unknown>,
    source: "human" | "webmcp",
  ) => Promise<unknown> | unknown;
}
