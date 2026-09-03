import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  Clock3,
  FilePlus2,
  LayoutDashboard,
  LockKeyhole,
  MousePointer2,
  Rows3,
  ShieldCheck,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import type { CommandBus } from "../../domain/commands";
import type {
  DataAsset,
  DatasetMonth,
  DataTable,
  SourceWorksheet,
  TesseraProject,
  WorksheetRegion,
} from "../../domain/types";
import { AgentHint } from "../agent/AgentHint";
import { detectLayout, type TableLayout } from "../../lib/reshape";
import { editionPrompt, stagePrompt } from "../agent/prompts";
import {
  approvedCount,
  boundsFromSelection,
  errorMessage,
  guessTableRange,
  hasCleanDraft,
  MONTH_STEPS,
  processingForMonth,
  rangeFromRegion,
  rangeLabel,
  shortStageLabel,
  sourceRegions,
  stageLabel,
  stepIndex,
  suggestMappings,
  tableFromRange,
  type CellRange,
  type CellSelection,
  type DataView,
} from "./model";

/* ------------------------------------------------------------------ */
/* Manual outline: select the table on the worksheet, then map headers */
/* ------------------------------------------------------------------ */

export type OutlineRegionKind = WorksheetRegion["kind"];

/** A region the person has drawn on the sheet but not yet saved. */
export interface OutlineRegion {
  id: string;
  sheet: string;
  kind: OutlineRegionKind;
  name: string;
  range: CellRange;
}

export interface OutlineState {
  active: boolean;
  sheets: SourceWorksheet[];
  sheet?: SourceWorksheet;
  sheetName: string;
  setSheetName: (name: string) => void;
  /** Cells being dragged over right now. */
  selection: CellSelection | null;
  setSelection: (selection: CellSelection | null) => void;
  /** Every region drawn so far, on every sheet. */
  regions: OutlineRegion[];
  /** Regions on the sheet being shown, in the worksheet's coordinate system. */
  worksheetRegions: WorksheetRegion[];
  /** The table region that feeds this dataset. */
  primaryId: string | null;
  /** Region highlighted on the sheet and in the list. */
  activeRegionId: string | null;
  setActiveRegion: (id: string | null) => void;
  addSelection: (kind: OutlineRegionKind) => void;
  detect: () => void;
  removeRegion: (id: string) => void;
  updateRegion: (
    id: string,
    patch: Partial<Pick<OutlineRegion, "name" | "kind">>,
  ) => void;
  setPrimary: (id: string) => void;
  /** The primary table's cells. */
  table?: DataTable;
  /** "metricRows" when the sheet lists one metric per row. */
  layout: TableLayout;
  /** Source headers (wide) or row labels (metric rows) that need canonical names. */
  mappingKeys: string[];
  mappings: Record<string, string>;
  priorColumns: string[];
  start: () => void;
  cancel: () => void;
  setMapping: (source: string, canonical: string) => void;
  save: () => Promise<void>;
  saving: boolean;
  error: string;
}

export function useOutline(
  project: TesseraProject,
  asset: DataAsset | undefined,
  month: DatasetMonth | undefined,
  bus: CommandBus,
): OutlineState {
  const [active, setActive] = useState(false);
  const [sheetName, setSheetName] = useState("");
  const [selection, setSelection] = useState<CellSelection | null>(null);
  const [regions, setRegions] = useState<OutlineRegion[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [activeRegionId, setActiveRegion] = useState<string | null>(null);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const sheets = useMemo(() => (month ? worksheetsOf(month) : []), [month]);
  const sheet = sheets.find((item) => item.name === sheetName) ?? sheets[0];
  const priorColumns = useMemo(
    () => (asset && month ? priorApprovedColumns(asset, month) : []),
    [asset, month],
  );
  const primary = regions.find((region) => region.id === primaryId);
  const primarySheet = sheets.find((item) => item.name === primary?.sheet);
  const table = useMemo(
    () =>
      primary && primarySheet
        ? tableFromRange(primarySheet.rows, primary.range)
        : undefined,
    [primary, primarySheet],
  );
  const layout: TableLayout = useMemo(
    () =>
      table && asset
        ? detectLayout(table, asset.recipe.headerMap, priorColumns)
        : "wide",
    [asset, priorColumns, table],
  );
  const mappingKeys = useMemo(
    () => (table ? mappingKeysFor(table, layout) : []),
    [layout, table],
  );
  const worksheetRegions = useMemo<WorksheetRegion[]>(
    () =>
      regions
        .filter((region) => region.sheet === sheet?.name)
        .map((region) => ({
          id: region.id,
          sheet: region.sheet,
          name: region.name,
          kind: region.kind,
          confidence: region.id === primaryId ? 1 : 0.9,
          canonicalName:
            region.id === primaryId && asset ? asset.name : region.name,
          range: {
            startRow: region.range.startRow + 1,
            startColumn: region.range.startColumn + 1,
            endRow: region.range.endRow + 1,
            endColumn: region.range.endColumn + 1,
          },
        })),
    [asset, primaryId, regions, sheet?.name],
  );

  /** Suggest canonical names for a table, keeping names the person already typed. */
  const suggestFor = useCallback(
    (nextTable: DataTable, keep: Record<string, string>) => {
      if (!asset) return {};
      const keys = mappingKeysFor(
        nextTable,
        detectLayout(nextTable, asset.recipe.headerMap, priorColumns),
      );
      const suggested = suggestMappings(
        keys,
        asset.recipe.headerMap,
        priorColumns,
      );
      return Object.fromEntries(
        keys.map((key) => [key, keep[key] ?? suggested[key]]),
      );
    },
    [asset, priorColumns],
  );

  const makePrimary = useCallback(
    (region: OutlineRegion, all: OutlineRegion[]) => {
      const regionSheet = sheets.find((item) => item.name === region.sheet);
      setPrimaryId(region.id);
      if (regionSheet)
        setMappings((current) =>
          suggestFor(tableFromRange(regionSheet.rows, region.range), current),
        );
      return all;
    },
    [sheets, suggestFor],
  );

  const defaultName = useCallback(
    (kind: OutlineRegionKind, existing: OutlineRegion[]) => {
      const count = existing.filter((region) => region.kind === kind).length;
      if (kind === "table")
        return count === 0 && asset
          ? `${asset.name} table`
          : `Table ${count + 1}`;
      if (kind === "narrative")
        return count === 0 ? "Notes" : `Notes ${count + 1}`;
      return count === 0 ? "Footnote" : `Footnote ${count + 1}`;
    },
    [asset],
  );

  const start = useCallback(() => {
    if (!month) return;
    const saved = sourceRegions(month);
    const initialSheet =
      sheets.find(
        (item) => item.name === saved.find((r) => r.kind === "table")?.sheet,
      ) ?? sheets[0];
    setSheetName(initialSheet?.name ?? "");
    setError("");
    setSelection(null);
    setActive(true);
    let seeded: OutlineRegion[] = saved.map((region) => ({
      id: region.id,
      sheet: region.sheet ?? initialSheet?.name ?? "",
      kind: region.kind,
      name: region.name,
      range: rangeFromRegion(region),
    }));
    if (!seeded.some((region) => region.kind === "table") && initialSheet) {
      const guess = guessTableRange(
        initialSheet.rows,
        asset?.recipe.headerMap,
        priorColumns,
      );
      if (guess)
        seeded = [
          ...seeded,
          {
            id: crypto.randomUUID(),
            sheet: initialSheet.name,
            kind: "table",
            name: defaultName("table", seeded),
            range: guess,
          },
        ];
    }
    setRegions(seeded);
    const savedPrimary = saved
      .filter((region) => region.kind === "table")
      .sort((a, b) => b.confidence - a.confidence)[0];
    const primaryRegion =
      seeded.find((region) => region.id === savedPrimary?.id) ??
      seeded.find((region) => region.kind === "table");
    setActiveRegion(primaryRegion?.id ?? null);
    if (primaryRegion) {
      const regionSheet = sheets.find(
        (item) => item.name === primaryRegion.sheet,
      );
      setPrimaryId(primaryRegion.id);
      setMappings(
        regionSheet
          ? suggestFor(
              tableFromRange(regionSheet.rows, primaryRegion.range),
              {},
            )
          : {},
      );
    } else {
      setPrimaryId(null);
      setMappings({});
    }
  }, [asset, defaultName, month, priorColumns, sheets, suggestFor]);

  const cancel = useCallback(() => {
    setActive(false);
    setSelection(null);
    setActiveRegion(null);
    setError("");
  }, []);

  useEffect(() => {
    if (!active) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selection) {
        event.stopPropagation();
        setSelection(null);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [active, selection]);

  const addSelection = useCallback(
    (kind: OutlineRegionKind) => {
      if (!selection || !sheet) return;
      const range = boundsFromSelection(selection);
      if (kind === "table" && range.endRow <= range.startRow) {
        setError("A table needs its header row and at least one data row.");
        return;
      }
      setError("");
      const region: OutlineRegion = {
        id: crypto.randomUUID(),
        sheet: sheet.name,
        kind,
        name: defaultName(kind, regions),
        range,
      };
      const next = [...regions, region];
      setRegions(next);
      setSelection(null);
      setActiveRegion(region.id);
      if (kind === "table" && !primaryId) makePrimary(region, next);
    },
    [defaultName, makePrimary, primaryId, regions, selection, sheet],
  );

  const detect = useCallback(() => {
    if (!sheet) return;
    const guess = guessTableRange(
      sheet.rows,
      asset?.recipe.headerMap,
      priorColumns,
    );
    if (!guess) {
      setError("No rectangular table was found on this sheet.");
      return;
    }
    setError("");
    const duplicate = regions.find(
      (region) =>
        region.sheet === sheet.name &&
        region.range.startRow === guess.startRow &&
        region.range.endRow === guess.endRow &&
        region.range.startColumn === guess.startColumn &&
        region.range.endColumn === guess.endColumn,
    );
    if (duplicate) {
      setActiveRegion(duplicate.id);
      return;
    }
    const region: OutlineRegion = {
      id: crypto.randomUUID(),
      sheet: sheet.name,
      kind: "table",
      name: defaultName("table", regions),
      range: guess,
    };
    const next = [...regions, region];
    setRegions(next);
    setActiveRegion(region.id);
    if (!primaryId) makePrimary(region, next);
  }, [
    asset,
    defaultName,
    makePrimary,
    primaryId,
    priorColumns,
    regions,
    sheet,
  ]);

  const removeRegion = useCallback(
    (id: string) => {
      const next = regions.filter((region) => region.id !== id);
      setRegions(next);
      if (activeRegionId === id) setActiveRegion(null);
      if (primaryId === id) {
        const replacement = next.find((region) => region.kind === "table");
        if (replacement) makePrimary(replacement, next);
        else {
          setPrimaryId(null);
          setMappings({});
        }
      }
    },
    [activeRegionId, makePrimary, primaryId, regions],
  );

  const updateRegion = useCallback(
    (id: string, patch: Partial<Pick<OutlineRegion, "name" | "kind">>) => {
      const next = regions.map((region) =>
        region.id === id ? { ...region, ...patch } : region,
      );
      setRegions(next);
      const changed = next.find((region) => region.id === id);
      if (!changed) return;
      if (patch.kind && patch.kind !== "table" && primaryId === id) {
        const replacement = next.find((region) => region.kind === "table");
        if (replacement) makePrimary(replacement, next);
        else {
          setPrimaryId(null);
          setMappings({});
        }
      }
      if (patch.kind === "table" && !primaryId) makePrimary(changed, next);
    },
    [makePrimary, primaryId, regions],
  );

  const setPrimary = useCallback(
    (id: string) => {
      const region = regions.find((candidate) => candidate.id === id);
      if (region && region.kind === "table") makePrimary(region, regions);
    },
    [makePrimary, regions],
  );

  const setMapping = useCallback((source: string, canonical: string) => {
    setMappings((current) => ({ ...current, [source]: canonical }));
  }, []);

  const save = useCallback(async () => {
    if (!asset || !month) return;
    if (!primary || !table) {
      setError("Add the table that feeds this dataset before saving.");
      return;
    }
    if (!table.columns.length || !table.rows.length) {
      setError("The table must include headers and at least one data row.");
      return;
    }
    const blank = mappingKeys.find((key) => !mappings[key]?.trim());
    if (blank) {
      setError(`Give “${blank}” a canonical field name.`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const stage = processingForMonth(month).stage;
      if (stage === "uploaded")
        await bus.execute("start_dataset_month_processing", {
          datasetId: asset.id,
          period: month.period,
        });
      const critical = chartCriticalFields(project, asset.id);
      await bus.execute("propose_dataset_month_outline", {
        datasetId: asset.id,
        period: month.period,
        regions: regions.map((region) => ({
          id: region.id,
          sheet: region.sheet,
          name: region.name.trim() || defaultName(region.kind, []),
          kind: region.kind,
          confidence:
            region.id === primary.id ? 1 : region.kind === "table" ? 0.9 : 0.8,
          canonicalName: region.id === primary.id ? asset.name : region.name,
          range: {
            startRow: region.range.startRow + 1,
            startColumn: region.range.startColumn + 1,
            endRow: region.range.endRow + 1,
            endColumn: region.range.endColumn + 1,
          },
        })),
        variableMappings: mappingKeys.map((key) => ({
          source: key,
          canonical: mappings[key].trim(),
          confidence: 1,
          confirmed: true,
          ...(priorColumns.includes(mappings[key].trim())
            ? { matchedFromPrevious: mappings[key].trim() }
            : {}),
          ...(critical.includes(mappings[key].trim())
            ? { usedByCharts: true }
            : {}),
        })),
        questions: [],
      });
      setActive(false);
      setSelection(null);
      setActiveRegion(null);
    } catch (reason) {
      setError(errorMessage(reason, "The outline could not be saved."));
    } finally {
      setSaving(false);
    }
  }, [
    asset,
    bus,
    defaultName,
    mappingKeys,
    mappings,
    month,
    primary,
    priorColumns,
    project,
    regions,
    table,
  ]);

  return {
    active,
    sheets,
    sheet,
    sheetName: sheet?.name ?? "",
    setSheetName: (name) => {
      setSheetName(name);
      setSelection(null);
    },
    selection,
    setSelection,
    regions,
    worksheetRegions,
    primaryId,
    activeRegionId,
    setActiveRegion,
    addSelection,
    detect,
    removeRegion,
    updateRegion,
    setPrimary,
    table,
    layout,
    mappingKeys,
    mappings,
    priorColumns,
    start,
    cancel,
    setMapping,
    save,
    saving,
    error,
  };
}

function mappingKeysFor(table: DataTable, layout: TableLayout) {
  if (layout === "wide") return table.columns;
  const seen = new Set<string>();
  return table.rows
    .map((row) => row[0])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((label) => label && !seen.has(label) && seen.add(label));
}

export function worksheetsOf(month: DatasetMonth): SourceWorksheet[] {
  if (month.sourceWorkbook?.sheets.length) return month.sourceWorkbook.sheets;
  if (month.sourceWorksheet) return [month.sourceWorksheet];
  const rows = [month.original.columns, ...month.original.rows];
  return [
    {
      name: "Imported table",
      rowCount: rows.length,
      columnCount: month.original.columns.length,
      rows,
      regions: [],
    },
  ];
}

function priorApprovedColumns(asset: DataAsset, month: DatasetMonth) {
  return (
    [...asset.months]
      .filter((item) => item.status !== "pending" && item.period < month.period)
      .sort((a, b) => b.period.localeCompare(a.period))[0]?.cleaned.columns ??
    []
  );
}

function chartCriticalFields(project: TesseraProject, datasetId: string) {
  const fields = new Set<string>();
  project.dashboards.forEach((dashboard) =>
    dashboard.blocks.forEach((block) => {
      if (block.datasetId !== datasetId) return;
      [
        block.categoryField,
        block.labelField,
        block.seriesField,
        block.valueField,
        block.targetField,
        ...block.valueFields,
      ].forEach((field) => {
        if (field) fields.add(field);
      });
    }),
  );
  return [...fields];
}

/* ------------------------------------------------------------------ */
/* Right rail: months, versions, and the workflow for the open month    */
/* ------------------------------------------------------------------ */

export function TableNavigator({
  asset,
  project,
  bus,
  month,
  view,
  agentConnected,
  outline,
  onSelectPeriod,
  onSelectView,
  onAddMonth,
  onDeleteDataset,
  onOpenDetails,
  onAnswerQuestions,
  onEditions,
  onOpenAgent,
}: {
  asset: DataAsset;
  project: TesseraProject;
  bus: CommandBus;
  month?: DatasetMonth;
  view: DataView;
  agentConnected: boolean;
  outline: OutlineState;
  onSelectPeriod: (period: string) => void;
  onSelectView: (view: DataView) => void;
  onAddMonth: () => void;
  onDeleteDataset: () => void;
  onOpenDetails: () => void;
  onAnswerQuestions: () => void;
  onEditions: (period: string) => void;
  onOpenAgent: () => void;
}) {
  const drafted = hasCleanDraft(month);
  const table = month
    ? view === "cleaned" && drafted
      ? month.cleaned
      : month.original
    : undefined;

  return (
    <aside className="warehouse-table-nav" aria-label="Table navigation">
      <header className="warehouse-table-nav__dataset">
        <div>
          <span className="eyebrow">DATASET</span>
          <button
            type="button"
            className="warehouse-table-nav__delete"
            aria-label={`Delete dataset ${asset.name}`}
            title={`Delete ${asset.name}`}
            onClick={onDeleteDataset}
          >
            <Trash2 size={13} />
          </button>
        </div>
        <h2 tabIndex={-1}>{asset.name}</h2>
        <p>
          {asset.description ||
            "One table, one immutable original and one cleaned version per month."}
        </p>
      </header>

      <section className="warehouse-table-nav__months">
        <header>
          <span>MONTHS</span>
          <b>{month?.label ?? "None yet"}</b>
        </header>
        {!!asset.months.length && (
          <div role="tablist" aria-label="Dataset months">
            {asset.months.map((item) => (
              <button
                role="tab"
                aria-selected={month?.period === item.period}
                key={item.id}
                className={month?.period === item.period ? "is-active" : ""}
                onClick={() => onSelectPeriod(item.period)}
              >
                <span>
                  {item.label}
                  {item.status === "pending"
                    ? ` · ${shortStageLabel(processingForMonth(item).stage)}`
                    : ""}
                </span>
                {item.status === "pending" ? (
                  <Clock3 size={13} />
                ) : (
                  <Check size={13} />
                )}
              </button>
            ))}
          </div>
        )}
        <button
          className="primary-button warehouse-table-nav__add"
          onClick={onAddMonth}
        >
          <FilePlus2 size={14} />
          {asset.months.length ? "Add month" : "Add first month"}
        </button>
      </section>

      {month && (
        <section className="warehouse-table-nav__versions">
          <header>
            <span>VERSION</span>
          </header>
          <div role="tablist" aria-label="Data version">
            <button
              role="tab"
              aria-selected={view === "original"}
              className={view === "original" ? "is-active" : ""}
              onClick={() => onSelectView("original")}
            >
              <span>
                <LockKeyhole size={13} />
              </span>
              <div>
                <b>Original</b>
                <small>As uploaded · read-only</small>
              </div>
              {view === "original" && <Check size={13} />}
            </button>
            <button
              role="tab"
              aria-selected={view === "cleaned"}
              className={view === "cleaned" ? "is-active" : ""}
              disabled={!drafted}
              onClick={() => onSelectView("cleaned")}
            >
              <span>
                <Sparkles size={13} />
              </span>
              <div>
                <b>Cleaned</b>
                <small>
                  {month.status === "pending"
                    ? drafted
                      ? "Draft · needs approval"
                      : stageLabel(processingForMonth(month).stage)
                    : "Approved · used by dashboards"}
                </small>
              </div>
              {view === "cleaned" && <Check size={13} />}
            </button>
          </div>
        </section>
      )}

      {month && month.status === "pending" && (
        <MonthWorkflowPanel
          asset={asset}
          project={project}
          bus={bus}
          month={month}
          agentConnected={agentConnected}
          outline={outline}
          onAnswerQuestions={onAnswerQuestions}
          onOpenDraft={() => onSelectView("cleaned")}
          onEditions={onEditions}
          onOpenAgent={onOpenAgent}
        />
      )}

      {month && month.status !== "pending" && (
        <ApprovedMonthCard
          project={project}
          month={month}
          agentConnected={agentConnected}
          onEditions={onEditions}
        />
      )}

      {month && table && (
        <footer className="warehouse-table-nav__footer">
          <span>
            {view === "original" && month.sourceWorksheet ? (
              <>
                {sourceRegions(month).length
                  ? `${sourceRegions(month).length} outlined region${sourceRegions(month).length === 1 ? "" : "s"}`
                  : "Not outlined yet"}{" "}
                <i /> {month.sourceWorksheet.rowCount} source rows
              </>
            ) : (
              <>
                {table.rows.length} rows <i /> {table.columns.length} fields
              </>
            )}
          </span>
          <button className="secondary-button" onClick={onOpenDetails}>
            <Rows3 size={14} /> Table details
          </button>
        </footer>
      )}
    </aside>
  );
}

function MonthWorkflowPanel({
  asset,
  project,
  bus,
  month,
  agentConnected,
  outline,
  onAnswerQuestions,
  onOpenDraft,
  onEditions,
  onOpenAgent,
}: {
  asset: DataAsset;
  project: TesseraProject;
  bus: CommandBus;
  month: DatasetMonth;
  agentConnected: boolean;
  outline: OutlineState;
  onAnswerQuestions: () => void;
  onOpenDraft: () => void;
  onEditions: (period: string) => void;
  onOpenAgent: () => void;
}) {
  const processing = processingForMonth(month);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const current = stepIndex(processing.stage);
  const regions = sourceRegions(month);
  const questionsRemaining = processing.questions.filter(
    (question) => !question.answerChoiceId,
  ).length;
  const blocking = processing.qualityChecks.filter(
    (check) => check.status === "fail",
  );
  const hasRecipe = Object.keys(asset.recipe.headerMap).length > 0;
  const prompt = stagePrompt(asset, month);

  const run = async (
    label: string,
    tool: string,
    args: Record<string, unknown>,
  ) => {
    setBusy(label);
    setError("");
    try {
      const result = (await bus.execute(tool, {
        datasetId: asset.id,
        period: month.period,
        ...args,
      })) as { refresh?: { allApproved?: boolean } } | undefined;
      if (tool === "approve_dataset_month" && result?.refresh?.allApproved)
        onEditions(month.period);
    } catch (reason) {
      setError(errorMessage(reason, "That step could not be completed."));
    } finally {
      setBusy(null);
    }
  };

  const stepDetail = (index: number): string => {
    if (index === 0)
      return month.sourceWorkbook?.storageKey
        ? "Exact file retained, read-only"
        : "Source rows retained, read-only";
    if (index === 1)
      return regions.length
        ? `${regions.length} region${regions.length === 1 ? "" : "s"} outlined · ${processing.variableMappings.length} field${processing.variableMappings.length === 1 ? "" : "s"} mapped`
        : "Which cells are the table, and what each header means";
    if (index === 2)
      return processing.stage === "review"
        ? `${month.cleaned.rows.length} rows ready to review`
        : "A separate cleaned table, never the original";
    return "Only this step lets dashboards use the month";
  };

  return (
    <section
      className={`month-processing-panel is-${processing.stage.replace("_", "-")}`}
      aria-label="Monthly workflow"
    >
      <header>
        <span>
          <Wand2 size={13} /> MONTH WORKFLOW
        </span>
        <b>{processing.progress}%</b>
      </header>
      <div
        className="month-processing-progress"
        role="progressbar"
        aria-label="Monthly workflow progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={processing.progress}
      >
        <span style={{ width: `${processing.progress}%` }} />
      </div>
      <p>{processing.message}</p>

      <ol className="month-processing-steps">
        {MONTH_STEPS.map((label, index) => (
          <li
            key={label}
            className={
              index < current
                ? "is-complete"
                : index === current
                  ? "is-active"
                  : ""
            }
          >
            <span>{index < current ? <Check size={11} /> : index + 1}</span>
            <div>
              <b>{label}</b>
              <small>{stepDetail(index)}</small>
            </div>
          </li>
        ))}
      </ol>

      {outline.active ? (
        <OutlinePanel outline={outline} />
      ) : (
        <div className="workflow-paths">
          <section className="workflow-path workflow-path--manual">
            <span className="eyebrow">
              <MousePointer2 size={12} /> BY HAND
            </span>
            {(processing.stage === "uploaded" ||
              processing.stage === "outlining") && (
              <>
                <button className="primary-button" onClick={outline.start}>
                  Outline the table
                </button>
                <button
                  className="secondary-button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("quick", "clean_dataset_month", {
                      useRecipe: true,
                    })
                  }
                >
                  <Sparkles size={13} />
                  {busy === "quick"
                    ? "Cleaning…"
                    : hasRecipe
                      ? "Quick clean with saved recipe"
                      : "Quick clean with safe defaults"}
                </button>
                <small>
                  Outline to choose the exact table and confirm every header, or
                  quick-clean the whole sheet and edit the draft.
                </small>
              </>
            )}
            {processing.stage === "needs_input" && (
              <>
                <button className="primary-button" onClick={onAnswerQuestions}>
                  <Clock3 size={13} /> Answer {questionsRemaining} question
                  {questionsRemaining === 1 ? "" : "s"}
                </button>
                <small>
                  The agent stopped at a choice it should not make. Nothing
                  continues until you answer.
                </small>
              </>
            )}
            {processing.stage === "outlined" && (
              <>
                <button
                  className="primary-button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("draft", "create_dataset_month_cleaning_draft", {})
                  }
                >
                  <Sparkles size={13} />
                  {busy === "draft" ? "Creating draft…" : "Create clean draft"}
                </button>
                <button className="secondary-button" onClick={outline.start}>
                  Edit outline
                </button>
              </>
            )}
            {processing.stage === "cleaning" && (
              <span className="processing-live-status">
                <Sparkles size={13} /> Creating the clean draft…
              </span>
            )}
            {processing.stage === "review" && (
              <>
                <button className="secondary-button" onClick={onOpenDraft}>
                  Review the draft
                </button>
                <button
                  className="primary-button"
                  disabled={busy !== null || blocking.length > 0}
                  onClick={() =>
                    void run("approve", "approve_dataset_month", {})
                  }
                >
                  <ShieldCheck size={13} />
                  {busy === "approve"
                    ? "Approving…"
                    : blocking.length
                      ? "Fix blocking checks first"
                      : "Approve for dashboards"}
                </button>
                <button className="link-button" onClick={outline.start}>
                  Redo the outline
                </button>
              </>
            )}
          </section>
          {prompt && processing.stage !== "needs_input" && (
            <AgentHint
              title={prompt.title}
              prompt={prompt.text}
              connected={agentConnected}
              onOpenAgent={onOpenAgent}
            />
          )}
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      {!!processing.variableMappings.length && !outline.active && (
        <div className="variable-match-preview">
          <header>
            <span>FIELD MAPPING</span>
            <b>
              {
                processing.variableMappings.filter(
                  (mapping) => mapping.usedByCharts,
                ).length
              }{" "}
              used by charts
            </b>
          </header>
          {processing.variableMappings.slice(0, 8).map((mapping) => (
            <div key={`${mapping.source}-${mapping.canonical}`}>
              <code>{mapping.source}</code>
              <ArrowRight size={10} />
              <code>{mapping.canonical}</code>
              {mapping.usedByCharts && <em>chart</em>}
            </div>
          ))}
          {processing.variableMappings.length > 8 && (
            <small>+ {processing.variableMappings.length - 8} more</small>
          )}
        </div>
      )}

      {!!processing.qualityChecks.length && (
        <div className="quality-check-preview" aria-label="Clean draft checks">
          <header>
            <span>APPROVAL CHECKS</span>
            <b>
              {blocking.length
                ? `${blocking.length} blocking`
                : "Ready to approve"}
            </b>
          </header>
          {processing.qualityChecks.map((check) => (
            <div key={check.id} className={`is-${check.status}`}>
              <span>
                {check.status === "pass" ? (
                  <Check size={10} />
                ) : check.status === "fail" ? (
                  <X size={10} />
                ) : (
                  <Clock3 size={10} />
                )}
              </span>
              <p>
                <b>{check.label}</b>
                <small>{check.detail}</small>
              </p>
            </div>
          ))}
        </div>
      )}

      <small className="month-processing-safety">
        {approvedCount(project, month.period)} of {project.warehouse.length}{" "}
        datasets approved for {month.label}
      </small>
    </section>
  );
}

const REGION_KINDS: Array<{
  kind: OutlineRegionKind;
  label: string;
  hint: string;
}> = [
  { kind: "table", label: "Table", hint: "Rows and columns to clean" },
  { kind: "narrative", label: "Notes", hint: "Titles, commentary, or prose" },
  { kind: "footnote", label: "Footnote", hint: "Footers, sources, or totals" },
];

function OutlinePanel({ outline }: { outline: OutlineState }) {
  const selectionRange = outline.selection
    ? boundsFromSelection(outline.selection)
    : null;
  const primary = outline.regions.find(
    (region) => region.id === outline.primaryId,
  );
  const tableCount = outline.regions.filter(
    (region) => region.kind === "table",
  ).length;
  return (
    <section className="outline-panel" aria-label="Outline the table">
      <header>
        <span className="eyebrow">
          <MousePointer2 size={12} /> OUTLINE BY HAND
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label="Cancel outlining"
          onClick={outline.cancel}
        >
          <X size={14} />
        </button>
      </header>
      <p>
        Drag across a block of cells, then add it as the table, notes, or a
        footnote. Outline every region the sheet has; one table feeds this
        dataset.
      </p>
      {outline.sheets.length > 1 && (
        <label>
          Sheet
          <select
            value={outline.sheetName}
            onChange={(event) => outline.setSheetName(event.target.value)}
          >
            {outline.sheets.map((sheet) => (
              <option key={sheet.name} value={sheet.name}>
                {sheet.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div
        className={`outline-panel__selection${selectionRange ? " has-selection" : ""}`}
        aria-live="polite"
      >
        <span>
          {selectionRange
            ? `Selected ${rangeLabel(selectionRange)} · add it as`
            : "Drag on the sheet to select cells"}
        </span>
        <div
          className="outline-panel__kinds"
          role="group"
          aria-label="Add selection as"
        >
          {REGION_KINDS.map((item) => (
            <button
              key={item.kind}
              type="button"
              className={`region-chip is-${item.kind}`}
              disabled={!selectionRange}
              title={item.hint}
              onClick={() => outline.addSelection(item.kind)}
            >
              <Plus size={11} /> {item.label}
            </button>
          ))}
        </div>
        <button type="button" className="link-button" onClick={outline.detect}>
          Detect the table for me
        </button>
      </div>

      {outline.regions.length > 0 && (
        <div
          className="outline-panel__regions"
          role="list"
          aria-label="Outlined regions"
        >
          <header>
            <span>REGIONS</span>
            <b>
              {outline.regions.length} outlined · {tableCount} table
              {tableCount === 1 ? "" : "s"}
            </b>
          </header>
          {outline.regions.map((region) => {
            const isPrimary = region.id === outline.primaryId;
            const isActive = region.id === outline.activeRegionId;
            return (
              <div
                key={region.id}
                role="listitem"
                className={`outline-region is-${region.kind}${isActive ? " is-active" : ""}${isPrimary ? " is-primary" : ""}`}
                onClick={() => outline.setActiveRegion(region.id)}
              >
                <select
                  aria-label={`Kind of ${region.name}`}
                  className={`region-chip is-${region.kind}`}
                  value={region.kind}
                  onChange={(event) =>
                    outline.updateRegion(region.id, {
                      kind: event.target.value as OutlineRegionKind,
                    })
                  }
                >
                  {REGION_KINDS.map((item) => (
                    <option key={item.kind} value={item.kind}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={`Name of region ${rangeLabel(region.range)}`}
                  value={region.name}
                  onFocus={() => outline.setActiveRegion(region.id)}
                  onChange={(event) =>
                    outline.updateRegion(region.id, {
                      name: event.target.value,
                    })
                  }
                />
                <code>{rangeLabel(region.range)}</code>
                {region.kind === "table" && (
                  <label
                    className="outline-region__primary"
                    title="This table's rows become the cleaned month"
                  >
                    <input
                      type="radio"
                      name="outline-primary-table"
                      checked={isPrimary}
                      onChange={() => outline.setPrimary(region.id)}
                    />
                    <span>
                      {isPrimary ? "Feeds dataset" : "Use as dataset"}
                    </span>
                  </label>
                )}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${region.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    outline.removeRegion(region.id);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {outline.table && primary && (
        <div className="outline-panel__mappings">
          <header>
            <span>
              {outline.layout === "metricRows"
                ? "METRIC ROWS → CANONICAL FIELDS"
                : "HEADERS → CANONICAL FIELDS"}
            </span>
            <b>
              {primary.name} · {outline.table.columns.length} columns ·{" "}
              {outline.table.rows.length} rows
            </b>
          </header>
          {outline.layout === "metricRows" && (
            <small>
              This table lists one metric per row. Each row label becomes a
              canonical field, and this month’s actual values are read from the
              first numeric column.
            </small>
          )}
          {outline.mappingKeys.map((column) => (
            <label key={column}>
              <span title={column}>{column}</span>
              <ArrowRight size={11} />
              <input
                aria-label={`Canonical field for ${column}`}
                list="outline-prior-columns"
                value={outline.mappings[column] ?? ""}
                onChange={(event) =>
                  outline.setMapping(column, event.target.value)
                }
              />
            </label>
          ))}
          <datalist id="outline-prior-columns">
            {outline.priorColumns.map((column) => (
              <option key={column} value={column} />
            ))}
          </datalist>
          {outline.priorColumns.length > 0 && (
            <small>
              Matching a prior month’s field keeps charts bound to it.
            </small>
          )}
        </div>
      )}
      {outline.error && <p className="form-error">{outline.error}</p>}
      <footer>
        <button
          type="button"
          className="secondary-button"
          onClick={outline.cancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={!outline.table || outline.saving}
          onClick={() => void outline.save()}
        >
          <Check size={13} /> {outline.saving ? "Saving…" : "Save outline"}
        </button>
      </footer>
    </section>
  );
}

function ApprovedMonthCard({
  project,
  month,
  agentConnected,
  onEditions,
}: {
  project: TesseraProject;
  month: DatasetMonth;
  agentConnected: boolean;
  onEditions: (period: string) => void;
}) {
  const approved = approvedCount(project, month.period);
  const complete = approved === project.warehouse.length;
  return (
    <section
      className="month-processing-panel is-approved"
      aria-label="Approved month"
    >
      <header>
        <span>
          <ShieldCheck size={13} /> APPROVED
        </span>
        <b>
          {approved}/{project.warehouse.length}
        </b>
      </header>
      <p>
        {complete
          ? `Every dataset has an approved ${month.label} version. Dashboards can move to this month.`
          : `${project.warehouse.length - approved} dataset${project.warehouse.length - approved === 1 ? "" : "s"} still need${project.warehouse.length - approved === 1 ? "s" : ""} an approved ${month.label} version.`}
      </p>
      {complete && (
        <div className="workflow-paths">
          <section className="workflow-path workflow-path--manual">
            <span className="eyebrow">
              <LayoutDashboard size={12} /> BY HAND
            </span>
            <button
              className="primary-button"
              onClick={() => onEditions(month.period)}
            >
              Create {month.label} editions
            </button>
          </section>
          <AgentHint
            title={editionPrompt("all").title}
            prompt={editionPrompt("all").text}
            connected={agentConnected}
          />
        </div>
      )}
      {!complete && (
        <small className="month-processing-safety">
          <Bot size={11} /> Ask the agent to process the remaining uploads, or
          open each dataset and clean it by hand.
        </small>
      )}
    </section>
  );
}
