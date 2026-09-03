import type {
  Dashboard,
  DashboardBlock,
  DataAsset,
  DatasetMonth,
  DataTable,
  TesseraProject,
  TesseraState,
} from "./types";
import { throughPeriodCutoff } from "./dashboardPeriods";

export function activeProject(state: TesseraState): TesseraProject {
  return (
    state.projects.find((project) => project.id === state.activeProjectId) ??
    state.projects[0]
  );
}

export function activeDashboard(project: TesseraProject): Dashboard {
  return (
    project.dashboards.find(
      (dashboard) => dashboard.id === project.activeDashboardId,
    ) ?? project.dashboards[0]
  );
}

export function findAsset(
  project: TesseraProject,
  assetId?: string,
): DataAsset | undefined {
  return project.warehouse.find((asset) => asset.id === assetId);
}

export function selectedMonth(
  asset: DataAsset | undefined,
  period: "latest" | string = "latest",
): DatasetMonth | undefined {
  if (!asset?.months.length) return undefined;
  if (period !== "latest")
    return asset.months.find((month) => month.period === period);
  return [...asset.months].sort((a, b) => b.period.localeCompare(a.period))[0];
}

export function isDatasetMonthReady(month: DatasetMonth | undefined) {
  return Boolean(month && month.status !== "pending");
}

export function selectedReadyMonth(
  asset: DataAsset | undefined,
  period: "latest" | string = "latest",
): DatasetMonth | undefined {
  if (!asset?.months.length) return undefined;
  if (period !== "latest") {
    const match = asset.months.find((month) => month.period === period);
    return isDatasetMonthReady(match) ? match : undefined;
  }
  return [...asset.months]
    .filter((month) => isDatasetMonthReady(month))
    .sort((a, b) => b.period.localeCompare(a.period))[0];
}

export function tableForBlock(
  project: TesseraProject,
  block: DashboardBlock,
): DataTable | undefined {
  const asset = findAsset(project, block.datasetId);
  const cutoff = throughPeriodCutoff(block.period);
  if (asset && (block.period === "all" || cutoff))
    return combineAssetMonths(asset, cutoff);
  const table = selectedReadyMonth(asset, block.period)?.cleaned;
  if (!table) return table;
  const periodIndex = table.columns.indexOf("Period");
  if (periodIndex < 0 || table.rows.length < 2) return table;
  const selectedPeriod =
    block.period === "latest"
      ? table.rows
          .map((row) => row[periodIndex])
          .filter((value): value is string => typeof value === "string")
          .sort()
          .at(-1)
          ?.slice(0, 7)
      : /^\d{4}-\d{2}$/.test(block.period)
        ? block.period
        : undefined;
  if (!selectedPeriod) return table;
  const rows = table.rows.filter(
    (row) =>
      typeof row[periodIndex] === "string" &&
      row[periodIndex].startsWith(selectedPeriod),
  );
  return rows.length ? { columns: table.columns, rows } : table;
}

export function combineAssetMonths(
  asset: DataAsset,
  through?: string,
): DataTable | undefined {
  if (!asset.months.length) return undefined;
  const months = [...asset.months]
    .filter((month) => isDatasetMonthReady(month))
    .filter((month) => !through || month.period <= through)
    .sort((a, b) => a.period.localeCompare(b.period));
  if (!months.length) return undefined;
  const columns = [
    ...new Set(months.flatMap((month) => month.cleaned.columns)),
  ];
  return {
    columns,
    rows: months.flatMap((month) => {
      const indexes = columns.map((column) =>
        month.cleaned.columns.indexOf(column),
      );
      return month.cleaned.rows.map((row) =>
        indexes.map((index) => (index < 0 ? null : (row[index] ?? null))),
      );
    }),
  };
}

export function numericColumns(table?: DataTable): string[] {
  if (!table) return [];
  return table.columns.filter((_, column) =>
    table.rows.some((row) => typeof row[column] === "number"),
  );
}

export function textColumns(table?: DataTable): string[] {
  if (!table) return [];
  const numeric = new Set(numericColumns(table));
  return table.columns.filter((column) => !numeric.has(column));
}

export function projectSummary(project: TesseraProject) {
  return {
    id: project.id,
    name: project.name,
    datasets: project.warehouse.map((asset) => ({
      id: asset.id,
      name: asset.name,
      months: asset.months.map((month) => month.period),
      monthStates: asset.months.map((month) => ({
        period: month.period,
        status: month.status ?? "ready",
        stage:
          month.processing?.stage ??
          (month.status === "pending" ? "uploaded" : "approved"),
        questionsRemaining:
          month.processing?.questions.filter(
            (question) => !question.answerChoiceId,
          ).length ?? 0,
        sourceSheets:
          month.sourceWorkbook?.sheets.length ??
          (month.sourceWorksheet ? 1 : 0),
      })),
      latestPeriod: selectedMonth(asset)?.period,
      latestReadyPeriod: selectedReadyMonth(asset)?.period,
      pendingPeriods: asset.months
        .filter((month) => !isDatasetMonthReady(month))
        .map((month) => month.period),
      columns: selectedReadyMonth(asset)?.cleaned.columns ?? [],
      rows: selectedReadyMonth(asset)?.cleaned.rows.length ?? 0,
    })),
    dashboards: project.dashboards.map((dashboard) => ({
      id: dashboard.id,
      name: dashboard.name,
      blockCount: dashboard.blocks.length,
      reportingPeriod: dashboard.reportingPeriod,
      seriesId: dashboard.seriesId,
      edition: dashboard.edition,
    })),
    generatedIllustrations: (project.generatedIllustrations ?? []).map(
      (asset) => ({
        id: asset.id,
        name: asset.name,
        width: asset.bitmapMask.width,
        height: asset.bitmapMask.height,
      }),
    ),
  };
}
