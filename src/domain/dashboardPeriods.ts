import type { Dashboard, TesseraProject } from "./types";

export const REPORTING_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const THROUGH_PERIOD_PREFIX = "through:";

export function throughPeriod(period: string) {
  return `${THROUGH_PERIOD_PREFIX}${period}`;
}

export function throughPeriodCutoff(period: string) {
  const cutoff = period.startsWith(THROUGH_PERIOD_PREFIX)
    ? period.slice(THROUGH_PERIOD_PREFIX.length)
    : "";
  return REPORTING_PERIOD_PATTERN.test(cutoff) ? cutoff : undefined;
}

export function periodForDashboardVersion(
  requestedPeriod: string,
  reportingPeriod: string,
) {
  return requestedPeriod === "all" || throughPeriodCutoff(requestedPeriod)
    ? throughPeriod(reportingPeriod)
    : reportingPeriod;
}

export function latestApprovedProjectPeriod(project: TesseraProject) {
  return project.warehouse
    .flatMap((asset) =>
      asset.months
        .filter((month) => month.status !== "pending")
        .map((month) => month.period),
    )
    .filter((period) => REPORTING_PERIOD_PATTERN.test(period))
    .sort()
    .at(-1);
}

/** Resolve the reporting month an existing dashboard actually presents. */
export function dashboardPeriod(
  project: TesseraProject,
  dashboard: Dashboard,
): string | undefined {
  if (
    dashboard.reportingPeriod &&
    REPORTING_PERIOD_PATTERN.test(dashboard.reportingPeriod)
  )
    return dashboard.reportingPeriod;
  if (
    dashboard.edition?.period &&
    REPORTING_PERIOD_PATTERN.test(dashboard.edition.period)
  )
    return dashboard.edition.period;

  const exact = dashboard.blocks
    .map((block) => block.period)
    .filter((period) => REPORTING_PERIOD_PATTERN.test(period));
  if (exact.length) return mostFrequentPeriod(exact);

  const latestBindings = dashboard.blocks.flatMap((block) => {
    if (!block.datasetId || block.period === "all") return [];
    const asset = project.warehouse.find((item) => item.id === block.datasetId);
    const period = asset?.months
      .filter((month) => month.status !== "pending")
      .map((month) => month.period)
      .filter((item) => REPORTING_PERIOD_PATTERN.test(item))
      .sort()
      .at(-1);
    return period ? [period] : [];
  });
  if (latestBindings.length) return mostFrequentPeriod(latestBindings);

  const writtenPeriod = [
    dashboard.headerEyebrow,
    dashboard.name,
    dashboard.description,
  ]
    .filter(Boolean)
    .map((value) => periodFromText(String(value)))
    .find(Boolean);
  return writtenPeriod ?? latestApprovedProjectPeriod(project);
}

/** Stable identity shared by every monthly version of one dashboard. */
export function dashboardSeriesId(
  project: TesseraProject,
  dashboard: Dashboard,
) {
  if (dashboard.seriesId) return dashboard.seriesId;
  let current = dashboard;
  const visited = new Set<string>();
  while (current.edition?.sourceDashboardId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = project.dashboards.find(
      (item) => item.id === current.edition?.sourceDashboardId,
    );
    if (!parent) return current.edition.sourceDashboardId;
    if (parent.seriesId) return parent.seriesId;
    current = parent;
  }
  return current.id;
}

export function dashboardSeriesName(
  project: TesseraProject,
  dashboard: Dashboard,
) {
  const seriesId = dashboardSeriesId(project, dashboard);
  const root = project.dashboards.find(
    (item) => item.id === seriesId || item.seriesId === seriesId,
  );
  return root?.name ?? stripEditionSuffix(dashboard.name);
}

export function dashboardPeriods(project: TesseraProject) {
  return [
    ...new Set(
      project.dashboards
        .map((dashboard) => dashboardPeriod(project, dashboard))
        .filter((period): period is string => Boolean(period)),
    ),
  ].sort((a, b) => b.localeCompare(a));
}

export function dashboardsForPeriod(project: TesseraProject, period: string) {
  return project.dashboards.filter(
    (dashboard) => dashboardPeriod(project, dashboard) === period,
  );
}

export function reportingPeriodLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return period;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function mostFrequentPeriod(periods: string[]) {
  const counts = new Map<string, number>();
  periods.forEach((period) =>
    counts.set(period, (counts.get(period) ?? 0) + 1),
  );
  return [...counts].sort(
    (a, b) => b[1] - a[1] || b[0].localeCompare(a[0]),
  )[0]?.[0];
}

function periodFromText(value: string) {
  const iso = value.match(/\b(\d{4}-(?:0[1-9]|1[0-2]))\b/)?.[1];
  if (iso) return iso;
  const match = value.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i,
  );
  if (!match) return undefined;
  const month = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].indexOf(match[1].toLowerCase());
  return `${match[2]}-${String(month + 1).padStart(2, "0")}`;
}

function stripEditionSuffix(name: string) {
  return name
    .replace(
      /\s*[·—-]\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}(?:\s+Draft)?$/i,
      "",
    )
    .trim();
}
