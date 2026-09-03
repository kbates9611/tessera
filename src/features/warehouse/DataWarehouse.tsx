import { useEffect, useRef, useState } from "react";
import {
  Clock3,
  Database,
  Download,
  FilePlus2,
  FileSpreadsheet,
  GitBranch,
  Plus,
  Table2,
} from "lucide-react";
import type { CommandBus } from "../../domain/commands";
import type {
  DataAsset,
  DatasetMonth,
  TesseraProject,
} from "../../domain/types";
import { CleanedGrid } from "./CleanedGrid";
import { MonthDialog } from "./MonthDialog";
import { OriginalWorksheet } from "./OriginalWorksheet";
import { RecipesOverview } from "./RecipesOverview";
import { RefreshOverview } from "./RefreshOverview";
import { TableNavigator, useOutline, worksheetsOf } from "./MonthWorkflow";
import {
  DatasetDialog,
  EditionDialog,
  QuestionsDialog,
  RecipeEditorDialog,
  TableDetailsDialog,
} from "./dialogs";
import {
  hasCleanDraft,
  processingForMonth,
  selectMonth,
  sourceRegions,
  type DataView,
} from "./model";

type Section = "table" | "recipes" | "refresh";
type Dialog =
  | { kind: "dataset" }
  | { kind: "month" }
  | { kind: "questions" }
  | { kind: "details" }
  | { kind: "editions"; period: string }
  | { kind: "recipe"; assetId: string }
  | null;

export function DataWarehouse({
  project,
  bus,
  agentConnected,
  selectedAssetId,
  selectedPeriod,
  onSelectAsset,
  onSelectPeriod,
  onOpenAgent,
  initialView = "original",
}: {
  project: TesseraProject;
  bus: CommandBus;
  agentConnected: boolean;
  selectedAssetId?: string;
  selectedPeriod?: string;
  onSelectAsset: (id?: string) => void;
  onSelectPeriod: (period?: string) => void;
  onOpenAgent: () => void;
  initialView?: DataView;
}) {
  const [view, setView] = useState<DataView>(initialView);
  const [section, setSection] = useState<Section>("table");
  const [dialog, setDialog] = useState<Dialog>(null);
  const promptedMonthsRef = useRef(new Set<string>());
  const asset =
    project.warehouse.find((candidate) => candidate.id === selectedAssetId) ??
    project.warehouse[0];
  const month = selectMonth(asset, selectedPeriod);
  const processing = month ? processingForMonth(month) : undefined;
  const drafted = hasCleanDraft(month);
  const effectiveView: DataView = drafted ? view : "original";
  const outline = useOutline(project, asset, month, bus);
  const totalVersions = project.warehouse.reduce(
    (total, item) =>
      total +
      item.months.reduce(
        (versions, item) => versions + (hasCleanDraft(item) ? 2 : 1),
        0,
      ),
    0,
  );

  useEffect(() => {
    if (!asset) return;
    if (!selectedAssetId) onSelectAsset(asset.id);
    if (!selectedPeriod && asset.months.length)
      onSelectPeriod(selectMonth(asset)?.period);
  }, [asset, onSelectAsset, onSelectPeriod, selectedAssetId, selectedPeriod]);

  useEffect(() => {
    if (!month || processing?.stage !== "needs_input") return;
    if (promptedMonthsRef.current.has(month.id)) return;
    promptedMonthsRef.current.add(month.id);
    setDialog({ kind: "questions" });
  }, [month, processing?.stage]);

  useEffect(() => {
    if (outline.active) setView("original");
  }, [outline.active]);

  const openMonth = (item: DataAsset, period?: string) => {
    onSelectAsset(item.id);
    const target = selectMonth(item, period);
    onSelectPeriod(target?.period);
    setView(hasCleanDraft(target) ? "cleaned" : "original");
    setSection("table");
    if (outline.active) outline.cancel();
  };

  return (
    <main className="warehouse-page">
      <header className="warehouse-commandbar">
        <div className="warehouse-commandbar__identity">
          <span className="warehouse-commandbar__icon">
            <Database size={16} />
          </span>
          <div>
            <span className="eyebrow">PROJECT DATA</span>
            <h1>Data Warehouse</h1>
            <p>
              {project.name} <i /> Private to this project
            </p>
          </div>
        </div>
        <div className="warehouse-commandbar__actions">
          <span>
            <b>{project.warehouse.length}</b> dataset
            {project.warehouse.length === 1 ? "" : "s"} <i /> {totalVersions}{" "}
            version{totalVersions === 1 ? "" : "s"}
          </span>
          <button
            className={`warehouse-commandbar__recipes${section === "recipes" ? " is-active" : ""}`}
            onClick={() =>
              setSection(section === "recipes" ? "table" : "recipes")
            }
          >
            <GitBranch size={14} />
            {section === "recipes" ? "Back to tables" : "Recipes"}
          </button>
          <button
            className={`warehouse-commandbar__refresh${section === "refresh" ? " is-active" : ""}`}
            onClick={() =>
              setSection(section === "refresh" ? "table" : "refresh")
            }
          >
            <Clock3 size={14} />
            {section === "refresh" ? "Back to tables" : "Monthly refresh"}
          </button>
          <button
            className="secondary-button"
            onClick={() => setDialog({ kind: "dataset" })}
          >
            <Plus size={14} /> New dataset
          </button>
        </div>
      </header>

      {!project.warehouse.length ? (
        <div className="warehouse-shell warehouse-shell--empty">
          <section
            className="warm-empty warehouse-empty"
            data-testid="warehouse-empty"
          >
            <span className="empty-icon">
              <FileSpreadsheet size={23} />
            </span>
            <span className="eyebrow">EMPTY WAREHOUSE · {project.name}</span>
            <h2>Start with one dataset.</h2>
            <p>
              A dataset is the stable home for one table across months. Add this
              month now and the next one later; each keeps its untouched
              original beside a cleaned version that you approve.
            </p>
            <button
              className="primary-button"
              onClick={() => setDialog({ kind: "dataset" })}
            >
              <Plus size={15} /> Add the first dataset
            </button>
            <ol className="warehouse-empty__steps">
              <li>
                <b>Upload</b> a CSV or workbook. It is stored exactly as
                received.
              </li>
              <li>
                <b>Outline and clean</b> it yourself, with the saved recipe, or
                by asking your agent.
              </li>
              <li>
                <b>Approve</b> the cleaned table. Only then can dashboards use
                it.
              </li>
            </ol>
          </section>
        </div>
      ) : (
        <section
          className={`warehouse-shell is-${section === "table" ? (effectiveView === "original" ? "sources" : "clean") : section}`}
        >
          <DatasetBrowser
            project={project}
            asset={asset}
            onSelect={openMonth}
          />

          {section === "recipes" ? (
            <div className="warehouse-overview-stage">
              <RecipesOverview
                project={project}
                onEdit={(item) =>
                  setDialog({ kind: "recipe", assetId: item.id })
                }
              />
            </div>
          ) : section === "refresh" ? (
            <div className="warehouse-overview-stage warehouse-overview-stage--refresh">
              <RefreshOverview
                project={project}
                onAddMonth={(item) => {
                  onSelectAsset(item.id);
                  onSelectPeriod(selectMonth(item)?.period);
                  setDialog({ kind: "month" });
                }}
                onOpen={openMonth}
                onEditions={(period) => setDialog({ kind: "editions", period })}
              />
            </div>
          ) : (
            <>
              <section className="warehouse-workbench warehouse-main">
                {asset && (
                  <div className="dataset-panel">
                    {!asset.months.length ? (
                      <section className="warm-empty dataset-empty">
                        <span className="empty-icon">
                          <FilePlus2 size={22} />
                        </span>
                        <h2>Add the first month of {asset.name}.</h2>
                        <p>
                          Paste rows or upload a CSV, TSV, or workbook. Tessera
                          stores the original and helps you create a separate
                          cleaned table.
                        </p>
                        <button
                          className="primary-button"
                          onClick={() => setDialog({ kind: "month" })}
                        >
                          <FilePlus2 size={14} /> Add first month
                        </button>
                      </section>
                    ) : (
                      month &&
                      (effectiveView === "cleaned" ? (
                        <CleanedGrid
                          asset={asset}
                          month={month}
                          bus={bus}
                          locked={processing?.stage === "cleaning"}
                        />
                      ) : (
                        <OriginalPanel
                          month={month}
                          outlineActive={outline.active}
                        >
                          <OriginalWorksheet
                            month={month}
                            sheet={
                              outline.active
                                ? outline.sheet
                                : (worksheetsOf(month).find(
                                    (sheet) =>
                                      sheet.name ===
                                      month.sourceWorksheet?.name,
                                  ) ?? worksheetsOf(month)[0])
                            }
                            regions={
                              outline.active
                                ? outline.worksheetRegions
                                : visibleRegions(month)
                            }
                            activeRegionId={
                              outline.active ? outline.activeRegionId : null
                            }
                            onRegionClick={
                              outline.active
                                ? outline.setActiveRegion
                                : undefined
                            }
                            selection={
                              outline.active ? outline.selection : undefined
                            }
                            onSelection={
                              outline.active ? outline.setSelection : undefined
                            }
                          />
                        </OriginalPanel>
                      ))
                    )}
                  </div>
                )}
              </section>
              {asset && (
                <TableNavigator
                  asset={asset}
                  project={project}
                  bus={bus}
                  month={month}
                  view={effectiveView}
                  agentConnected={agentConnected}
                  outline={outline}
                  onSelectPeriod={(period) => {
                    onSelectPeriod(period);
                    if (outline.active) outline.cancel();
                  }}
                  onSelectView={setView}
                  onAddMonth={() => setDialog({ kind: "month" })}
                  onOpenDetails={() => setDialog({ kind: "details" })}
                  onAnswerQuestions={() => setDialog({ kind: "questions" })}
                  onEditions={(period) =>
                    setDialog({ kind: "editions", period })
                  }
                  onOpenAgent={onOpenAgent}
                />
              )}
            </>
          )}
        </section>
      )}

      {dialog?.kind === "dataset" && (
        <DatasetDialog
          bus={bus}
          onClose={() => setDialog(null)}
          onCreated={(id) => {
            onSelectAsset(id);
            onSelectPeriod(undefined);
            setView("original");
            setSection("table");
            setDialog({ kind: "month" });
          }}
        />
      )}
      {dialog?.kind === "month" && asset && (
        <MonthDialog
          asset={asset}
          bus={bus}
          onClose={() => setDialog(null)}
          onCreated={(period) => {
            onSelectPeriod(period);
            setView("original");
            setSection("table");
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "questions" && asset && month && (
        <QuestionsDialog
          asset={asset}
          month={month}
          bus={bus}
          agentConnected={agentConnected}
          onClose={() => setDialog(null)}
          onDraftCreated={() => {
            setView("cleaned");
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "details" && month && (
        <TableDetailsDialog
          month={month}
          view={effectiveView}
          onClose={() => setDialog(null)}
          onOpenClean={() => {
            setView("cleaned");
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "editions" && (
        <EditionDialog
          project={project}
          period={dialog.period}
          bus={bus}
          agentConnected={agentConnected}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "recipe" && (
        <RecipeEditorDialog
          asset={
            project.warehouse.find((item) => item.id === dialog.assetId) ??
            project.warehouse[0]
          }
          bus={bus}
          agentConnected={agentConnected}
          onClose={() => setDialog(null)}
          onOpenClean={() => {
            const item = project.warehouse.find(
              (candidate) => candidate.id === dialog.assetId,
            );
            if (item) openMonth(item);
            setDialog(null);
          }}
        />
      )}
    </main>
  );
}

function DatasetBrowser({
  project,
  asset,
  onSelect,
}: {
  project: TesseraProject;
  asset?: DataAsset;
  onSelect: (asset: DataAsset) => void;
}) {
  return (
    <aside className="warehouse-sidebar warehouse-browser">
      <div className="warehouse-browser__section-heading">
        <span>DATASETS</span>
      </div>
      <div
        className="warehouse-sidebar__sources"
        role="tablist"
        aria-label="Warehouse datasets"
      >
        {project.warehouse.map((item) => {
          const active = asset?.id === item.id;
          const pending = item.months.filter(
            (month) => month.status === "pending",
          ).length;
          return (
            <button
              role="tab"
              key={item.id}
              className={active ? "is-active" : ""}
              onClick={() => onSelect(item)}
              aria-selected={active}
            >
              <Table2 size={13} />
              <span>
                <b>{item.name}</b>
                <em>
                  {item.months.length} month
                  {item.months.length === 1 ? "" : "s"}
                  {pending ? ` · ${pending} pending` : ""}
                </em>
              </span>
              {pending ? (
                <Clock3 size={12} />
              ) : (
                <small>{item.months.length}</small>
              )}
            </button>
          );
        })}
      </div>
      <footer className="warehouse-browser__status">
        <small>Originals are never overwritten.</small>
      </footer>
    </aside>
  );
}

function OriginalPanel({
  month,
  outlineActive,
  children,
}: {
  month: DatasetMonth;
  outlineActive: boolean;
  children: React.ReactNode;
}) {
  const regions = sourceRegions(month);
  return (
    <section className="month-table" aria-label="Original source">
      <header className="month-table__meta">
        <div>
          <strong>
            {outlineActive ? "Outline the table" : "Original source"}
          </strong>
          <span>{month.sourceName}</span>
        </div>
        <div>
          <span>
            {outlineActive
              ? "Drag across the header row and every data row"
              : regions.length
                ? `${regions.length} outlined region${regions.length === 1 ? "" : "s"}`
                : "Stored exactly as received"}
          </span>
          {month.sourceWorkbook?.storageKey && (
            <a
              className="secondary-button"
              href={`/api/uploads?key=${encodeURIComponent(month.sourceWorkbook.storageKey)}&download=1`}
              download={month.sourceName}
            >
              <Download size={13} /> Download original
            </a>
          )}
        </div>
      </header>
      {children}
    </section>
  );
}

/** Regions are shown once an outline exists, not while the source is still raw. */
function visibleRegions(month: DatasetMonth) {
  const stage = processingForMonth(month).stage;
  if (
    month.status === "pending" &&
    (stage === "uploaded" || stage === "outlining")
  )
    return [];
  const sheetName = month.sourceWorksheet?.name;
  return sourceRegions(month).filter(
    (region) => !region.sheet || !sheetName || region.sheet === sheetName,
  );
}
