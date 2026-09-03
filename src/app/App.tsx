import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Check,
  CalendarDays,
  Database,
  FolderSync,
  LayoutDashboard,
  Pencil,
  Redo2,
  Sparkles,
  Undo2,
} from "lucide-react";
import { revealsDashboard } from "../domain/commands";
import {
  dashboardPeriod,
  dashboardPeriods,
  dashboardSeriesId,
  dashboardsForPeriod,
  reportingPeriodLabel,
} from "../domain/dashboardPeriods";
import { activeDashboard, activeProject } from "../domain/selectors";
import { ProjectDropdown } from "../features/projects/ProjectDropdown";
import { Modal } from "./Modal";
import { TesseraMark } from "./TesseraMark";
import { TopbarPicker } from "./TopbarPicker";
import { useTessera } from "./useTessera";

type View = "dashboard" | "warehouse";
type Dialog = "project" | "rename" | "dashboard" | "agent" | null;

const DataWarehouse = lazy(() =>
  import("../features/warehouse/DataWarehouse").then((module) => ({
    default: module.DataWarehouse,
  })),
);
const DashboardStudio = lazy(() =>
  import("../features/dashboard/DashboardStudio").then((module) => ({
    default: module.DashboardStudio,
  })),
);
const AgentPanel = lazy(() =>
  import("../features/agent/AgentPanel").then((module) => ({
    default: module.AgentPanel,
  })),
);

export function App() {
  const {
    state,
    ready,
    saveState,
    saveMessage,
    bus,
    webmcp,
    canUndo,
    canRedo,
    undo,
    redo,
    onAgentCommand,
    folderSync,
    connectWorkspaceFolder,
  } = useTessera();
  const project = activeProject(state);
  const dashboard = activeDashboard(project);
  const availableDashboardMonths = dashboardPeriods(project);
  const activeDashboardMonth = dashboardPeriod(project, dashboard);
  const [dashboardMonth, setDashboardMonth] = useState(
    activeDashboardMonth ?? availableDashboardMonths[0] ?? "",
  );
  const [view, setView] = useState<View>("dashboard");
  const [selectedAssetId, setSelectedAssetId] = useState<string | undefined>();
  const [selectedPeriod, setSelectedPeriod] = useState<string | undefined>();
  const [selectedBlockId, setSelectedBlockId] = useState<string | undefined>();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [warehouseView, setWarehouseView] = useState<"original" | "cleaned">(
    "original",
  );
  const openWarehouse = (datasetId: string, period?: string) => {
    setSelectedAssetId(datasetId);
    setSelectedPeriod(period);
    setWarehouseView("cleaned");
    setSelectedBlockId(undefined);
    setView("warehouse");
  };
  const activeDashboardIdRef = useRef(project.activeDashboardId);
  activeDashboardIdRef.current = project.activeDashboardId;
  useEffect(
    () =>
      onAgentCommand((name, args) => {
        if (!revealsDashboard(name)) return;
        setView("dashboard");
        const target =
          typeof args.dashboardId === "string" ? args.dashboardId : undefined;
        if (target && target !== activeDashboardIdRef.current)
          void bus.execute("activate_dashboard", { dashboardId: target });
      }),
    [bus, onAgentCommand],
  );
  const saveLabel =
    saveMessage ||
    (saveState === "saving"
      ? "Saving…"
      : saveState === "browser"
        ? "Saved in browser"
        : saveState === "error"
          ? "Save failed"
          : "Saved");

  useEffect(() => {
    setSelectedAssetId(project.warehouse[0]?.id);
    setSelectedPeriod(undefined);
    setSelectedBlockId(undefined);
  }, [project.id]);

  useEffect(() => {
    if (activeDashboardMonth) setDashboardMonth(activeDashboardMonth);
  }, [activeDashboardMonth, dashboard.id, project.id]);

  const openDashboardMonth = (period: string) => {
    setDashboardMonth(period);
    const candidates = dashboardsForPeriod(project, period);
    const currentSeries = dashboardSeriesId(project, dashboard);
    const target =
      candidates.find(
        (candidate) => dashboardSeriesId(project, candidate) === currentSeries,
      ) ?? candidates[0];
    if (target && target.id !== dashboard.id)
      void bus.execute("activate_dashboard", { dashboardId: target.id });
    setSelectedBlockId(undefined);
  };

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target as HTMLElement | null;
      const isLocallyEditable = Boolean(
        target?.matches("input, textarea, [contenteditable='true']") &&
        !target.closest(".inspector"),
      );
      if (isLocallyEditable) return;
      const wantsRedo = key === "y" || (key === "z" && event.shiftKey);
      if (wantsRedo ? !canRedo : !canUndo) return;
      event.preventDefault();
      if (wantsRedo) redo();
      else undo();
    };
    window.addEventListener("keydown", handleHistoryShortcut, {
      capture: true,
    });
    return () =>
      window.removeEventListener("keydown", handleHistoryShortcut, {
        capture: true,
      });
  }, [canRedo, canUndo, redo, undo]);

  const mountedAtRef = useRef(Date.now());
  const [splash, setSplash] = useState<"shown" | "fading" | "gone">("shown");
  useEffect(() => {
    if (!ready || splash !== "shown") return;
    const minimumShow = 900;
    const settle = 200;
    const wait = Math.max(
      settle,
      minimumShow - (Date.now() - mountedAtRef.current),
    );
    const timer = window.setTimeout(() => setSplash("fading"), wait);
    return () => window.clearTimeout(timer);
  }, [ready, splash]);
  useEffect(() => {
    if (splash !== "fading") return;
    const fade = 480;
    const timer = window.setTimeout(() => setSplash("gone"), fade + 40);
    return () => window.clearTimeout(timer);
  }, [splash]);

  const loadingScreen =
    splash !== "gone" ? (
      <main
        className={`loading-screen${ready ? " is-ready" : ""}${splash === "fading" ? " is-fading" : ""}`}
        aria-hidden={ready || undefined}
      >
        <div className="loading-screen__lockup">
          <span className="brand-mark">
            <TesseraMark size={64} />
            <i aria-hidden="true" />
          </span>
          <strong>Tessera</strong>
        </div>
        <span className="loading-screen__tagline">
          Data to decisions, in one governed workspace
        </span>
      </main>
    ) : null;

  if (!ready) return loadingScreen;

  return (
    <>
      {loadingScreen}
      <div className="app-shell">
        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark">
              <TesseraMark size={30} title="Tessera" />
            </span>
          </div>

          <div className="topbar__project">
            <span className="topbar__project-label" aria-hidden="true">
              Project:
            </span>
            <ProjectDropdown
              projects={state.projects}
              activeId={project.id}
              onSelect={(projectId) => {
                void bus.execute("activate_project", { projectId });
              }}
              onNew={() => setDialog("project")}
            />
          </div>

          <nav className="main-nav" aria-label="Project sections">
            <button
              className={view === "dashboard" ? "is-active" : ""}
              onClick={() => setView("dashboard")}
            >
              <LayoutDashboard size={15} /> Dashboards
            </button>
            <button
              className={view === "warehouse" ? "is-active" : ""}
              onClick={() => {
                setWarehouseView("original");
                setView("warehouse");
              }}
            >
              <Database size={15} /> Data Warehouse
            </button>
          </nav>

          <div
            className="topbar__project-actions"
            role="group"
            aria-label="Project settings"
          >
            <button
              type="button"
              className="topbar__project-action project-rename"
              onClick={() => setDialog("rename")}
              aria-label="Rename dashboard group"
              title="Rename dashboard group"
            >
              <Pencil size={13} aria-hidden="true" />
            </button>
            {folderSync.supported && (
              <button
                type="button"
                className={`topbar__project-action folder-sync is-${folderSync.status}`}
                onClick={() => void connectWorkspaceFolder()}
                disabled={folderSync.status === "syncing"}
                aria-busy={folderSync.status === "syncing"}
                aria-label={
                  folderSync.status === "synced"
                    ? `Workspace folder ${folderSync.name ?? "connected"}`
                    : "Choose a folder for automatic workspace saves"
                }
                title={
                  folderSync.message ||
                  (folderSync.status === "synced"
                    ? `Automatically saving to ${folderSync.name}`
                    : "Keep projects as readable JSON files on this computer")
                }
              >
                <FolderSync size={13} aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="topbar__meta" aria-label="Workspace status">
            <span className={`topbar__save is-${saveState}`}>
              <Check size={11} /> {saveLabel}
            </span>
            <button
              type="button"
              className={`webmcp-status${webmcp.available ? " is-live" : ""}`}
              onClick={() => setDialog("agent")}
              aria-label="Open the agent panel"
              title="What your agent can do here"
            >
              <Sparkles size={11} />
              {webmcp.available
                ? "Agent connected"
                : `Agent ready · ${webmcp.toolCount} operations`}
            </button>
          </div>

          {view === "dashboard" && availableDashboardMonths.length > 0 && (
            <TopbarPicker
              ariaLabel="Dashboard month"
              listLabel="Dashboard months"
              value={dashboardMonth}
              options={availableDashboardMonths.map((period) => ({
                value: period,
                label: reportingPeriodLabel(period),
              }))}
              onSelect={openDashboardMonth}
              icon={<CalendarDays size={14} aria-hidden="true" />}
              variant="month-picker"
            />
          )}

          <div
            className="topbar__history"
            role="group"
            aria-label="Edit history"
          >
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              aria-label="Undo last action"
              title="Undo (Ctrl/Cmd+Z)"
            >
              <Undo2 size={15} />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              aria-label="Redo last action"
              title="Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)"
            >
              <Redo2 size={15} />
            </button>
          </div>
        </header>

        {view === "warehouse" ? (
          <Suspense fallback={<FeatureLoading label="Data Warehouse" />}>
            <DataWarehouse
              project={project}
              bus={bus}
              agentConnected={webmcp.available}
              selectedAssetId={selectedAssetId}
              selectedPeriod={selectedPeriod}
              onSelectAsset={setSelectedAssetId}
              onSelectPeriod={setSelectedPeriod}
              onOpenAgent={() => setDialog("agent")}
              initialView={warehouseView}
            />
          </Suspense>
        ) : (
          <Suspense fallback={<FeatureLoading label="dashboard" />}>
            <DashboardStudio
              project={project}
              dashboard={dashboard}
              bus={bus}
              agentConnected={webmcp.available}
              selectedBlockId={selectedBlockId}
              onSelectBlock={setSelectedBlockId}
              onNewDashboard={() => setDialog("dashboard")}
              reportingPeriod={dashboardMonth}
              onOpenAgent={() => setDialog("agent")}
              onOpenWarehouse={openWarehouse}
            />
          </Suspense>
        )}

        {dialog === "project" && (
          <NameDialog
            title="New dashboard group"
            description="A dashboard group is a private Data Warehouse plus the dashboards built from it."
            submitLabel="Create group"
            initial="Untitled group"
            onClose={() => setDialog(null)}
            onSubmit={(name) => {
              void bus.execute("create_project", { name });
              setDialog(null);
            }}
          />
        )}
        {dialog === "rename" && (
          <NameDialog
            title="Rename dashboard group"
            description="The group’s warehouse and dashboards stay together under the new name."
            submitLabel="Save name"
            initial={project.name}
            onClose={() => setDialog(null)}
            onSubmit={(name) => {
              void bus.execute("rename_project", { name });
              setDialog(null);
            }}
          />
        )}
        {dialog === "dashboard" && (
          <NameDialog
            title="New dashboard"
            description={`Create a blank canvas inside ${project.name}.`}
            submitLabel="Create dashboard"
            initial={`Dashboard ${project.dashboards.length + 1}`}
            onClose={() => setDialog(null)}
            onSubmit={(name) => {
              void bus.execute("create_dashboard", {
                name,
                period: dashboardMonth || undefined,
              });
              setSelectedBlockId(undefined);
              setDialog(null);
            }}
          />
        )}
        {dialog === "agent" && (
          <Suspense fallback={<FeatureLoading label="Agent panel" />}>
            <AgentPanel
              bus={bus}
              project={project}
              context={{
                view,
                datasetId: selectedAssetId,
                period: selectedPeriod,
              }}
              connected={webmcp.available}
              registeredCount={webmcp.registeredCount}
              onClose={() => setDialog(null)}
            />
          </Suspense>
        )}
      </div>
    </>
  );
}

function FeatureLoading({ label }: { label: string }) {
  return (
    <div className="feature-loading" role="status">
      <span aria-hidden="true" />
      Loading {label}…
    </div>
  );
}

function NameDialog({
  title,
  description,
  submitLabel,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  submitLabel: string;
  initial: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Modal title={title} description={description} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onSubmit(name.trim());
        }}
      >
        <label>
          Name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="modal__actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={!name.trim()}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
