import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CommandBus } from "../domain/commands";
import type { StateHistoryOptions } from "../domain/commands";
import {
  defaultChartSettings,
  defaultGaugeSettings,
  defaultTableSettings,
} from "../domain/defaults";
import type {
  DashboardBlock,
  PersistedEnvelope,
  TesseraState,
} from "../domain/types";
import { BLOCK_TYPES } from "../domain/types";
import { createNorthstarState } from "../fixtures/northstar";
import {
  dashboardPeriod,
  dashboardSeriesId,
  periodForDashboardVersion,
} from "../domain/dashboardPeriods";
import {
  chooseWorkspaceFolder,
  queryWorkspaceFolderPermission,
  readWorkspaceFolder,
  recallWorkspaceFolder,
  rememberWorkspaceFolder,
  requestWorkspaceFolderPermission,
  workspaceFolderSupported,
  writeWorkspaceFolder,
  type WorkspaceDirectoryHandle,
} from "../lib/workspaceFolder";
import {
  registerWebMCPTools,
  type WebMCPRegistration,
} from "../webmcp/register";

const BROWSER_KEY = "tessera-state-v1";
const HISTORY_LIMIT = 100;
const HISTORY_GROUP_WINDOW_MS = 1500;
const SAVE_DEBOUNCE_MS = 220;
const REMOVED_CHART_KEY = /^tree(?!map)/;

export type SaveState =
  "loading" | "saved" | "saving" | "browser" | "conflict" | "error";

export type FolderSyncState = {
  supported: boolean;
  status:
    | "unavailable"
    | "not-linked"
    | "needs-permission"
    | "syncing"
    | "synced"
    | "error";
  name?: string;
  message?: string;
};

interface LiveStateEnvelope extends PersistedEnvelope {
  originClientId: string | null;
}

type AgentCommandListener = (
  name: string,
  args: Record<string, unknown>,
) => void;

export function useTessera() {
  const initial = createNorthstarState();
  const [state, setRenderedState] = useState<TesseraState>(initial);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [saveMessage, setSaveMessage] = useState("");
  const [folderSync, setFolderSync] = useState<FolderSyncState>(() => ({
    supported: workspaceFolderSupported(),
    status: workspaceFolderSupported() ? "not-linked" : "unavailable",
  }));
  const stateRef = useRef(initial);
  const revisionRef = useRef(0);
  const clientIdRef = useRef(crypto.randomUUID());
  const backendRef = useRef(true);
  const pendingSaveRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const webmcpFlushRef = useRef<() => Promise<void>>(async () => undefined);
  const agentCommandRef = useRef<AgentCommandListener>(() => undefined);
  const deferredExternalRef = useRef<PersistedEnvelope | null>(null);
  const undoStackRef = useRef<TesseraState[]>([]);
  const redoStackRef = useRef<TesseraState[]>([]);
  const workspaceFolderRef = useRef<WorkspaceDirectoryHandle | undefined>(
    undefined,
  );
  const rememberedFolderRef = useRef<WorkspaceDirectoryHandle | undefined>(
    undefined,
  );
  const folderWriteRef = useRef<Promise<void>>(Promise.resolve());
  const folderGenerationRef = useRef(0);
  const folderConnectionRef = useRef(0);
  const lastHistoryGroupRef = useRef<{ group: string; at: number } | undefined>(
    undefined,
  );
  const [historyStatus, setHistoryStatus] = useState({
    canUndo: false,
    canRedo: false,
  });

  const syncHistoryStatus = useCallback(() => {
    setHistoryStatus({
      canUndo: undoStackRef.current.length > 0,
      canRedo: redoStackRef.current.length > 0,
    });
  }, []);

  const updateState = useCallback(
    (
      updater: (current: TesseraState) => TesseraState,
      history?: StateHistoryOptions,
    ) => {
      const current = stateRef.current;
      const next = updater(current);
      if (next === current) return;
      if (history?.record) {
        const now = Date.now();
        const previous = lastHistoryGroupRef.current;
        const continuesGroup = Boolean(
          history.group &&
          previous?.group === history.group &&
          now - previous.at <= HISTORY_GROUP_WINDOW_MS,
        );
        if (!continuesGroup) {
          undoStackRef.current.push(current);
          if (undoStackRef.current.length > HISTORY_LIMIT)
            undoStackRef.current.shift();
        }
        redoStackRef.current = [];
        lastHistoryGroupRef.current = history.group
          ? { group: history.group, at: now }
          : undefined;
        syncHistoryStatus();
      } else {
        lastHistoryGroupRef.current = undefined;
      }
      stateRef.current = next;
      pendingSaveRef.current = true;
      setRenderedState(next);
    },
    [syncHistoryStatus],
  );

  const restoreFromHistory = useCallback(
    (direction: "undo" | "redo") => {
      const source =
        direction === "undo" ? undoStackRef.current : redoStackRef.current;
      const destination =
        direction === "undo" ? redoStackRef.current : undoStackRef.current;
      const restored = source.pop();
      if (!restored) return;
      destination.push(stateRef.current);
      if (destination.length > HISTORY_LIMIT) destination.shift();
      stateRef.current = restored;
      pendingSaveRef.current = true;
      lastHistoryGroupRef.current = undefined;
      setRenderedState(restored);
      syncHistoryStatus();
    },
    [syncHistoryStatus],
  );

  const undo = useCallback(
    () => restoreFromHistory("undo"),
    [restoreFromHistory],
  );
  const redo = useCallback(
    () => restoreFromHistory("redo"),
    [restoreFromHistory],
  );

  const busRef = useRef<CommandBus | null>(null);
  if (!busRef.current)
    busRef.current = new CommandBus({
      getState: () => stateRef.current,
      setState: updateState,
      afterExecute: (source, changed, command) => {
        if (source === "webmcp")
          agentCommandRef.current(command.name, command.args);
        return source === "webmcp" && changed
          ? webmcpFlushRef.current()
          : Promise.resolve();
      },
      revealDashboardStep: async (delayMs) => {
        flushSync(() => setRenderedState(stateRef.current));
        await new Promise<void>((resolve) =>
          window.setTimeout(
            () => requestAnimationFrame(() => resolve()),
            delayMs,
          ),
        );
      },
    });
  const bus = busRef.current;

  const resetHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    lastHistoryGroupRef.current = undefined;
    syncHistoryStatus();
  }, [syncHistoryStatus]);

  const adoptWorkspaceState = useCallback(
    (workspaceState: TesseraState) => {
      const loaded = hydrateState(workspaceState);
      if (JSON.stringify(loaded) === JSON.stringify(stateRef.current)) return;
      stateRef.current = loaded;
      pendingSaveRef.current = true;
      setRenderedState(loaded);
      resetHistory();
    },
    [resetHistory],
  );

  const adoptExternalState = useCallback(
    (envelope: PersistedEnvelope) => {
      if (!envelope.state || envelope.revision <= revisionRef.current) return;
      const loaded = hydrateState(envelope.state);
      // Another client saving the same content (a fresh tab, a re-save) is
      // not a change: keep the undo history instead of wiping it.
      if (JSON.stringify(loaded) === JSON.stringify(stateRef.current)) {
        revisionRef.current = envelope.revision;
        return;
      }
      revisionRef.current = envelope.revision;
      stateRef.current = loaded;
      pendingSaveRef.current = loaded !== envelope.state;
      setRenderedState(loaded);
      setSaveState(backendRef.current ? "saved" : "browser");
      setSaveMessage("");
      resetHistory();
    },
    [resetHistory],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const envelope = await fetchEnvelope();
        if (cancelled) return;
        revisionRef.current = envelope.revision;
        // An empty backend adopts any state this browser saved while offline.
        const persisted = envelope.state ?? readLocalState();
        const loaded = hydrateState(persisted);
        stateRef.current = loaded;
        setRenderedState(loaded);
        resetHistory();
        const needsInitialSave =
          envelope.state === null || loaded !== envelope.state;
        pendingSaveRef.current = needsInitialSave;
        setSaveState(needsInitialSave ? "saving" : "saved");
      } catch {
        backendRef.current = false;
        const local = readLocalState();
        const loaded = hydrateState(local);
        stateRef.current = loaded;
        setRenderedState(loaded);
        resetHistory();
        pendingSaveRef.current = local === null || loaded !== local;
        setSaveState("browser");
        setSaveMessage("Backend unavailable; saving in this browser.");
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resetHistory]);

  useEffect(() => {
    if (!ready || !folderSync.supported || workspaceFolderRef.current) return;
    let cancelled = false;
    const connection = folderConnectionRef.current;
    void (async () => {
      const handle = await recallWorkspaceFolder();
      if (cancelled || !handle || connection !== folderConnectionRef.current)
        return;
      rememberedFolderRef.current = handle;
      setFolderSync({
        supported: true,
        status: "needs-permission",
        name: handle.name,
        message: "Reconnect this folder to resume automatic saves.",
      });
      if (
        !(await queryWorkspaceFolderPermission(handle)) ||
        cancelled ||
        connection !== folderConnectionRef.current
      )
        return;
      try {
        const workspaceState = await readWorkspaceFolder(handle);
        if (cancelled || connection !== folderConnectionRef.current) return;
        workspaceFolderRef.current = handle;
        folderGenerationRef.current += 1;
        if (workspaceState) adoptWorkspaceState(workspaceState);
        else await writeWorkspaceFolder(handle, stateRef.current);
        if (!cancelled)
          setFolderSync({
            supported: true,
            status: "synced",
            name: handle.name,
          });
      } catch (error) {
        if (!cancelled)
          setFolderSync({
            supported: true,
            status: "error",
            name: handle.name,
            message:
              error instanceof Error
                ? error.message
                : "Could not read this Tessera workspace.",
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adoptWorkspaceState, folderSync.supported, ready]);

  const flushPendingState = useCallback((): Promise<void> => {
    if (savePromiseRef.current) return savePromiseRef.current;
    if (!pendingSaveRef.current) return Promise.resolve();
    saveInFlightRef.current = true;
    const work = (async () => {
      let conflicted = false;
      try {
        while (pendingSaveRef.current) {
          const snapshot = stateRef.current;
          pendingSaveRef.current = false;
          if (!backendRef.current) {
            localStorage.setItem(BROWSER_KEY, JSON.stringify(snapshot));
            setSaveState("browser");
            continue;
          }
          setSaveState("saving");
          try {
            const envelope = await saveEnvelope(
              revisionRef.current,
              snapshot,
              clientIdRef.current,
            );
            revisionRef.current = envelope.revision;
            setSaveState("saved");
            setSaveMessage("");
          } catch (error: unknown) {
            pendingSaveRef.current = false;
            if (error instanceof RevisionConflict) {
              conflicted = true;
              setSaveState("conflict");
              setSaveMessage(
                "This project changed in another window. Reload before making more edits.",
              );
            } else {
              setSaveState("error");
              setSaveMessage(
                error instanceof Error
                  ? error.message
                  : "Could not save the project.",
              );
            }
            throw error;
          }
        }
      } finally {
        saveInFlightRef.current = false;
        const deferred = deferredExternalRef.current;
        if (
          !conflicted &&
          !pendingSaveRef.current &&
          deferred &&
          deferred.revision > revisionRef.current
        ) {
          deferredExternalRef.current = null;
          adoptExternalState(deferred);
        } else if (deferred && deferred.revision <= revisionRef.current) {
          deferredExternalRef.current = null;
        }
      }
    })();
    const tracked = work.finally(() => {
      if (savePromiseRef.current === tracked) savePromiseRef.current = null;
    });
    savePromiseRef.current = tracked;
    return tracked;
  }, [adoptExternalState]);
  webmcpFlushRef.current = flushPendingState;

  useEffect(() => {
    if (!ready || !pendingSaveRef.current) return;
    const timer = window.setTimeout(
      () => void flushPendingState(),
      SAVE_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [flushPendingState, ready, state]);

  useEffect(() => {
    const handle = workspaceFolderRef.current;
    if (!ready || !handle) return;
    const snapshot = state;
    const generation = folderGenerationRef.current;
    const timer = window.setTimeout(() => {
      if (
        workspaceFolderRef.current !== handle ||
        folderGenerationRef.current !== generation
      )
        return;
      setFolderSync((current) => ({
        ...current,
        status: "syncing",
        message: undefined,
      }));
      const save = folderWriteRef.current
        .catch(() => undefined)
        .then(() => writeWorkspaceFolder(handle, snapshot));
      folderWriteRef.current = save;
      void save.then(
        () => {
          if (
            workspaceFolderRef.current === handle &&
            folderGenerationRef.current === generation
          )
            setFolderSync({
              supported: true,
              status: "synced",
              name: handle.name,
            });
        },
        (error: unknown) => {
          if (
            workspaceFolderRef.current === handle &&
            folderGenerationRef.current === generation
          )
            setFolderSync({
              supported: true,
              status: "error",
              name: handle.name,
              message:
                error instanceof Error
                  ? error.message
                  : "Could not save to this folder.",
            });
        },
      );
    }, 400);
    return () => window.clearTimeout(timer);
  }, [ready, state]);

  useEffect(() => {
    if (!ready || !backendRef.current) return;
    const events = new EventSource("/api/state/events");
    const handleState = (event: MessageEvent<string>) => {
      try {
        const envelope = JSON.parse(event.data) as LiveStateEnvelope;
        if (envelope.originClientId === clientIdRef.current) return;
        if (pendingSaveRef.current || saveInFlightRef.current) {
          if (
            !deferredExternalRef.current ||
            envelope.revision > deferredExternalRef.current.revision
          )
            deferredExternalRef.current = envelope;
          return;
        }
        adoptExternalState(envelope);
      } catch (error) {
        console.error("[Tessera live state] Invalid update", error);
      }
    };
    events.addEventListener("state", handleState as EventListener);
    return () => events.close();
  }, [adoptExternalState, ready]);

  useEffect(() => {
    if (!ready || backendRef.current) return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== BROWSER_KEY || !event.newValue) return;
      try {
        const external = JSON.parse(event.newValue) as TesseraState;
        const envelope = {
          revision: revisionRef.current + 1,
          state: external,
        } satisfies PersistedEnvelope;
        if (pendingSaveRef.current || saveInFlightRef.current) {
          deferredExternalRef.current = envelope;
          return;
        }
        adoptExternalState(envelope);
      } catch (error) {
        console.error("[Tessera live state] Invalid browser update", error);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [adoptExternalState, ready]);

  const [webmcp, setWebmcp] = useState<
    Pick<WebMCPRegistration, "available" | "toolCount" | "registeredCount">
  >(() => ({
    available: Boolean(document.modelContext?.registerTool),
    toolCount: 0,
    registeredCount: 0,
  }));
  useEffect(() => {
    const registration = registerWebMCPTools(bus);
    setWebmcp({
      available: registration.available,
      toolCount: registration.toolCount,
      registeredCount: registration.registeredCount,
    });
    return registration.cleanup;
  }, [bus]);

  // The app watches agent commands so it can follow the agent's work.
  const onAgentCommand = useCallback((listener: AgentCommandListener) => {
    agentCommandRef.current = listener;
  }, []);

  const connectWorkspaceFolder = useCallback(async () => {
    if (!workspaceFolderSupported()) return;
    folderConnectionRef.current += 1;
    const previous = folderSync;
    setFolderSync((current) => ({
      ...current,
      status: "syncing",
      message: undefined,
    }));
    try {
      let handle =
        folderSync.status === "synced"
          ? undefined
          : (workspaceFolderRef.current ?? rememberedFolderRef.current);
      if (handle) {
        const granted = await requestWorkspaceFolderPermission(handle);
        if (!granted) {
          setFolderSync({
            supported: true,
            status: "needs-permission",
            name: handle.name,
            message: "Folder access is needed to keep saving here.",
          });
          return;
        }
      } else {
        // Keep Chromium's short-lived file-picker permission attached to the
        // click instead of awaiting an IndexedDB lookup first.
        handle = await chooseWorkspaceFolder();
      }

      const workspaceState = await readWorkspaceFolder(handle);
      workspaceFolderRef.current = handle;
      rememberedFolderRef.current = handle;
      folderGenerationRef.current += 1;
      folderWriteRef.current = Promise.resolve();
      await rememberWorkspaceFolder(handle);
      if (workspaceState) adoptWorkspaceState(workspaceState);
      else await writeWorkspaceFolder(handle, stateRef.current);
      setFolderSync({
        supported: true,
        status: "synced",
        name: handle.name,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setFolderSync(previous);
        return;
      }
      setFolderSync({
        supported: true,
        status: "error",
        name: workspaceFolderRef.current?.name ?? previous.name,
        message:
          error instanceof Error
            ? error.message
            : "Could not connect this folder.",
      });
    }
  }, [adoptWorkspaceState, folderSync]);

  return {
    state,
    ready,
    saveState,
    saveMessage,
    bus,
    webmcp,
    canUndo: historyStatus.canUndo,
    canRedo: historyStatus.canRedo,
    undo,
    redo,
    onAgentCommand,
    folderSync,
    connectWorkspaceFolder,
  };
}

async function fetchEnvelope(): Promise<PersistedEnvelope> {
  const response = await fetch("/api/state", { cache: "no-store" });
  if (!response.ok) throw new Error("The Tessera backend is unavailable.");
  return response.json() as Promise<PersistedEnvelope>;
}

async function saveEnvelope(
  expectedRevision: number,
  state: TesseraState,
  clientId: string,
): Promise<PersistedEnvelope> {
  const response = await fetch("/api/state", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-tessera-client-id": clientId,
    },
    body: JSON.stringify({ expectedRevision, state }),
  });
  if (response.status === 409) throw new RevisionConflict();
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error || "The backend could not save the project.");
  }
  return response.json() as Promise<PersistedEnvelope>;
}

function readLocalState(): TesseraState | null {
  try {
    const value = localStorage.getItem(BROWSER_KEY);
    return value ? (JSON.parse(value) as TesseraState) : null;
  } catch {
    return null;
  }
}

export function hydrateState(state: TesseraState | null): TesseraState {
  if (!state || state.schemaVersion !== 1 || !Array.isArray(state.projects))
    return createNorthstarState();
  let changed = false;
  const chartKeys = new Set(Object.keys(defaultChartSettings()));
  const projects = state.projects.map((project) => {
    let projectChanged = false;
    const generatedIllustrations = [...(project.generatedIllustrations ?? [])];
    const dashboards = project.dashboards.map((dashboard) => {
      let dashboardChanged = false;
      const reportingPeriod = dashboardPeriod(project, dashboard);
      const freezeLegacyBindings = !dashboard.reportingPeriod;
      const kit =
        (dashboard.kit as string | undefined) === "northstar-blue"
          ? "slate-blue"
          : dashboard.kit;
      if (kit !== dashboard.kit) dashboardChanged = true;
      const blocks = dashboard.blocks.flatMap((block) => {
        if (!(BLOCK_TYPES as readonly string[]).includes(block.type)) {
          dashboardChanged = true;
          return [];
        }
        let next = block;
        const storedBuildMode = (block as { buildMode?: string }).buildMode;
        if (storedBuildMode !== "agent" && storedBuildMode !== "manual")
          next = { ...next, buildMode: "agent" };
        const chart = { ...defaultChartSettings(), ...block.chart };
        // Optional settings (axis bounds, reference values) are absent from the
        // defaults; only settings for removed chart types are stripped.
        const strayChartKeys = Object.keys(chart).filter(
          (key) => !chartKeys.has(key) && REMOVED_CHART_KEY.test(key),
        );
        strayChartKeys.forEach(
          (key) => delete (chart as Record<string, unknown>)[key],
        );
        const chartMissing = Object.keys(defaultChartSettings()).some(
          (key) => !(key in (block.chart ?? {})),
        );
        if (chartMissing || strayChartKeys.length) next = { ...next, chart };
        const tableMissing = Object.keys(defaultTableSettings()).some(
          (key) => !(key in (block.table ?? {})),
        );
        if (tableMissing)
          next = {
            ...next,
            table: { ...defaultTableSettings(), ...block.table },
          };
        if (!block.gauge?.colors || block.gauge.ranges === undefined) {
          const defaults = defaultGaugeSettings();
          next = {
            ...next,
            gauge: {
              ...defaults,
              ...block.gauge,
              colors: { ...defaults.colors, ...block.gauge?.colors },
              ranges: block.gauge?.ranges ?? [],
            },
          };
        }
        next = indexGeneratedIllustration(next, generatedIllustrations);
        if (freezeLegacyBindings && reportingPeriod && block.datasetId)
          next = {
            ...next,
            period: periodForDashboardVersion(block.period, reportingPeriod),
          };
        if (next !== block) dashboardChanged = true;
        return [next];
      });
      const seriesId = dashboardSeriesId(project, dashboard);
      if (
        dashboard.reportingPeriod !== reportingPeriod ||
        dashboard.seriesId !== seriesId
      )
        dashboardChanged = true;
      return dashboardChanged
        ? { ...dashboard, reportingPeriod, seriesId, kit, blocks }
        : dashboard;
    });
    if (
      dashboards.some(
        (dashboard, index) => dashboard !== project.dashboards[index],
      ) ||
      generatedIllustrations.length !==
        (project.generatedIllustrations ?? []).length ||
      !project.generatedIllustrations
    )
      projectChanged = true;
    if (!projectChanged) return project;
    changed = true;
    return { ...project, dashboards, generatedIllustrations };
  });
  return changed ? { ...state, projects } : state;
}

function indexGeneratedIllustration(
  block: DashboardBlock,
  library: TesseraState["projects"][number]["generatedIllustrations"],
) {
  const mask = block.illustration?.bitmapMask;
  if (block.type !== "illustration" || !mask) return block;
  let saved = library.find(
    (asset) =>
      asset.bitmapMask.encoding === mask.encoding &&
      asset.bitmapMask.width === mask.width &&
      asset.bitmapMask.height === mask.height &&
      asset.bitmapMask.bits === mask.bits,
  );
  if (!saved) {
    saved = {
      id: `generated-${block.id}`,
      name: block.title || "Generated illustration",
      altText: block.illustration.altText,
      bitmapMask: structuredClone(mask),
      createdAt: block.createdAt,
      updatedAt: block.updatedAt,
    };
    library.push(saved);
  }
  if (block.illustration.libraryAssetId === saved.id) return block;
  return {
    ...block,
    illustration: { ...block.illustration, libraryAssetId: saved.id },
  };
}

class RevisionConflict extends Error {}
