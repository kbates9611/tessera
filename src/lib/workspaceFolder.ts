import type {
  Dashboard,
  DataAsset,
  TesseraProject,
  TesseraState,
} from "../domain/types";

const MANIFEST_FILE = "tessera-workspace.json";
const HANDLE_DATABASE = "tessera-local-workspace";
const HANDLE_STORE = "handles";
const HANDLE_KEY = "active-directory";

interface WorkspaceFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: string | Blob): Promise<void>;
    close(): Promise<void>;
  }>;
}

export interface WorkspaceDirectoryHandle {
  name: string;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<WorkspaceDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<WorkspaceFileHandle>;
  queryPermission?(options?: { mode?: "read" | "readwrite" }): Promise<string>;
  requestPermission?(options?: {
    mode?: "read" | "readwrite";
  }): Promise<string>;
}

interface WorkspaceManifest {
  format: "tessera-workspace-v1";
  schemaVersion: 1;
  savedAt: string;
  generation?: "a" | "b";
  activeProjectId: string;
  projects: Array<{
    id: string;
    name: string;
    directory: string;
    index: string;
  }>;
}

interface ProjectIndex {
  format: "tessera-project-v1";
  project: Omit<TesseraProject, "dashboards" | "warehouse">;
  dashboards: Array<{ id: string; file: string }>;
  datasets: Array<{
    id: string;
    file: string;
    sources?: StoredDatasetSource[];
  }>;
}

interface StoredDatasetSource {
  period: string;
  file: string;
  checksum?: string;
  contentType?: string;
}

export function workspaceFolderSupported() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function chooseWorkspaceFolder() {
  const picker = (
    window as typeof window & {
      showDirectoryPicker?: (options?: {
        id?: string;
        mode?: "read" | "readwrite";
      }) => Promise<WorkspaceDirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (!picker)
    throw new Error(
      "Folder autosave is available in a local Chromium browser, not this cloud browser.",
    );
  return picker({ id: "tessera-workspace", mode: "readwrite" });
}

export async function requestWorkspaceFolderPermission(
  handle: WorkspaceDirectoryHandle,
) {
  const current = await handle.queryPermission?.({ mode: "readwrite" });
  if (current === "granted") return true;
  return (
    (await handle.requestPermission?.({ mode: "readwrite" })) === "granted"
  );
}

export async function queryWorkspaceFolderPermission(
  handle: WorkspaceDirectoryHandle,
) {
  return (await handle.queryPermission?.({ mode: "readwrite" })) === "granted";
}

export async function writeWorkspaceFolder(
  handle: WorkspaceDirectoryHandle,
  state: TesseraState,
) {
  const previousManifest = await readJsonIfPresent<WorkspaceManifest>(
    handle,
    MANIFEST_FILE,
  );
  const generation = previousManifest?.generation === "a" ? "b" : "a";
  const projectEntries: WorkspaceManifest["projects"] = [];
  for (const project of state.projects) {
    const directory = `${safeName(project.name)}--${safeName(project.id)}`;
    const projectDirectory = await handle.getDirectoryHandle(directory, {
      create: true,
    });
    const dashboardDirectory = await projectDirectory.getDirectoryHandle(
      "dashboards",
      { create: true },
    );
    const datasetDirectory = await projectDirectory.getDirectoryHandle(
      "datasets",
      { create: true },
    );
    const sourceDirectory = await datasetDirectory.getDirectoryHandle(
      "source-files",
      { create: true },
    );
    const previousEntry = previousManifest?.projects.find(
      (entry) => entry.id === project.id && entry.directory === directory,
    );
    const previousIndex = previousEntry
      ? await readJsonIfPresent<ProjectIndex>(
          projectDirectory,
          previousEntry.index,
        )
      : undefined;
    const dashboards = project.dashboards.map((dashboard) => ({
      id: dashboard.id,
      file: `${safeName(dashboard.name)}--${safeName(dashboard.id)}--${generation}.json`,
    }));
    const datasets = await Promise.all(
      project.warehouse.map(async (dataset) => ({
        id: dataset.id,
        file: `${safeName(dataset.name)}--${safeName(dataset.id)}--${generation}.json`,
        sources: await archiveDatasetSources(
          sourceDirectory,
          dataset,
          previousIndex?.datasets.find((entry) => entry.id === dataset.id)
            ?.sources ?? [],
        ),
      })),
    );

    await Promise.all([
      ...project.dashboards.map((dashboard, index) =>
        writeJson(dashboardDirectory, dashboards[index].file, dashboard),
      ),
      ...project.warehouse.map((dataset, index) =>
        writeJson(datasetDirectory, datasets[index].file, dataset),
      ),
    ]);
    const {
      dashboards: _dashboards,
      warehouse: _warehouse,
      ...projectMeta
    } = project;
    const index: ProjectIndex = {
      format: "tessera-project-v1",
      project: projectMeta,
      dashboards,
      datasets,
    };
    const indexFile = `project-${generation}.json`;
    await writeJson(projectDirectory, indexFile, index);
    projectEntries.push({
      id: project.id,
      name: project.name,
      directory,
      index: indexFile,
    });
  }

  const manifest: WorkspaceManifest = {
    format: "tessera-workspace-v1",
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    generation,
    activeProjectId: state.activeProjectId,
    projects: projectEntries,
  };
  // Alternate between two complete generations. The manifest is switched
  // last, so an interrupted write still points at the previous complete set.
  await writeJson(handle, MANIFEST_FILE, manifest);
}

export async function readWorkspaceFolder(
  handle: WorkspaceDirectoryHandle,
): Promise<TesseraState | null> {
  let manifest: WorkspaceManifest;
  try {
    manifest = await readJson<WorkspaceManifest>(handle, MANIFEST_FILE);
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
  if (
    manifest.format !== "tessera-workspace-v1" ||
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.projects)
  )
    throw new Error("This folder is not a Tessera workspace.");

  const projects: TesseraProject[] = [];
  for (const entry of manifest.projects) {
    const projectDirectory = await handle.getDirectoryHandle(entry.directory);
    const dashboardDirectory =
      await projectDirectory.getDirectoryHandle("dashboards");
    const datasetDirectory =
      await projectDirectory.getDirectoryHandle("datasets");
    const index = await readJson<ProjectIndex>(projectDirectory, entry.index);
    if (index.format !== "tessera-project-v1")
      throw new Error(`${entry.name} has an unsupported project index.`);
    const dashboards = await Promise.all(
      index.dashboards.map(({ file }) =>
        readJson<Dashboard>(dashboardDirectory, file),
      ),
    );
    const warehouse = await Promise.all(
      index.datasets.map(async ({ file, sources }) => {
        const dataset = await readJson<DataAsset>(datasetDirectory, file);
        return restoreDatasetSources(dataset, sources ?? [], datasetDirectory);
      }),
    );
    projects.push({ ...index.project, dashboards, warehouse });
  }
  return {
    schemaVersion: 1,
    activeProjectId: manifest.activeProjectId,
    projects,
  };
}

export async function rememberWorkspaceFolder(
  handle: WorkspaceDirectoryHandle,
) {
  try {
    const database = await openHandleDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(HANDLE_STORE, "readwrite");
      transaction.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch {
    // Folder sync still works for this session when a browser cannot persist handles.
  }
}

export async function recallWorkspaceFolder() {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const database = await openHandleDatabase();
    const handle = await new Promise<WorkspaceDirectoryHandle | undefined>(
      (resolve, reject) => {
        const request = database
          .transaction(HANDLE_STORE, "readonly")
          .objectStore(HANDLE_STORE)
          .get(HANDLE_KEY);
        request.onsuccess = () =>
          resolve(request.result as WorkspaceDirectoryHandle | undefined);
        request.onerror = () => reject(request.error);
      },
    );
    database.close();
    return handle;
  } catch {
    return undefined;
  }
}

async function writeJson(
  directory: WorkspaceDirectoryHandle,
  name: string,
  value: unknown,
) {
  const file = await directory.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(`${JSON.stringify(value, null, 2)}\n`);
  await writable.close();
}

async function archiveDatasetSources(
  directory: WorkspaceDirectoryHandle,
  dataset: DataAsset,
  previous: StoredDatasetSource[],
) {
  const sources: StoredDatasetSource[] = [];
  for (const month of dataset.months) {
    const workbook = month.sourceWorkbook;
    if (!workbook) continue;
    const existing = previous.find(
      (source) =>
        source.period === month.period &&
        (!workbook.checksum || source.checksum === workbook.checksum),
    );
    if (existing && (await fileExists(directory, existing.file))) {
      sources.push(existing);
      continue;
    }
    if (!workbook.storageKey) continue;
    try {
      const response = await fetch(
        `/api/uploads?key=${encodeURIComponent(workbook.storageKey)}`,
      );
      if (!response.ok) throw new Error("The original upload is unavailable.");
      const file = sourceFileName(month.period, workbook.fileName);
      await writeFile(directory, file, await response.blob());
      sources.push({
        period: month.period,
        file,
        checksum: workbook.checksum,
        contentType: workbook.contentType,
      });
    } catch {
      const fallback = previous.find(
        (source) => source.period === month.period,
      );
      if (fallback && (await fileExists(directory, fallback.file)))
        sources.push(fallback);
    }
  }
  return sources;
}

async function restoreDatasetSources(
  dataset: DataAsset,
  sources: StoredDatasetSource[],
  datasetDirectory: WorkspaceDirectoryHandle,
) {
  if (!sources.length) return dataset;
  let sourceDirectory: WorkspaceDirectoryHandle;
  try {
    sourceDirectory = await datasetDirectory.getDirectoryHandle("source-files");
  } catch {
    return dataset;
  }
  let changed = false;
  const months = await Promise.all(
    dataset.months.map(async (month) => {
      const source = sources.find((item) => item.period === month.period);
      if (!source || !month.sourceWorkbook) return month;
      if (
        month.sourceWorkbook.storageKey &&
        (await uploadAvailable(month.sourceWorkbook.storageKey))
      )
        return month;
      try {
        const handle = await sourceDirectory.getFileHandle(source.file);
        const file = await handle.getFile();
        const response = await fetch(
          `/api/uploads?filename=${encodeURIComponent(month.sourceWorkbook.fileName)}`,
          {
            method: "POST",
            headers: {
              "content-type":
                source.contentType ||
                month.sourceWorkbook.contentType ||
                file.type ||
                "application/octet-stream",
            },
            body: file,
          },
        );
        if (!response.ok) return month;
        const stored = (await response.json()) as {
          storageKey: string;
          checksum?: string;
          contentType?: string;
          byteLength?: number;
        };
        changed = true;
        return {
          ...month,
          sourceWorkbook: {
            ...month.sourceWorkbook,
            storageKey: stored.storageKey,
            checksum: stored.checksum ?? month.sourceWorkbook.checksum,
            contentType: stored.contentType ?? month.sourceWorkbook.contentType,
            byteLength: stored.byteLength ?? month.sourceWorkbook.byteLength,
          },
        };
      } catch {
        return month;
      }
    }),
  );
  return changed ? { ...dataset, months } : dataset;
}

async function uploadAvailable(storageKey: string) {
  try {
    const response = await fetch(
      `/api/uploads?key=${encodeURIComponent(storageKey)}`,
      { cache: "no-store" },
    );
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

async function fileExists(directory: WorkspaceDirectoryHandle, name: string) {
  try {
    await directory.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function writeFile(
  directory: WorkspaceDirectoryHandle,
  name: string,
  value: Blob,
) {
  const file = await directory.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(value);
  await writable.close();
}

async function readJsonIfPresent<T>(
  directory: WorkspaceDirectoryHandle,
  name: string,
) {
  try {
    return await readJson<T>(directory, name);
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    return undefined;
  }
}

async function readJson<T>(directory: WorkspaceDirectoryHandle, name: string) {
  const handle = await directory.getFileHandle(name);
  return JSON.parse(await (await handle.getFile()).text()) as T;
}

function safeName(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "untitled"
  );
}

function sourceFileName(period: string, fileName: string) {
  const lastDot = fileName.lastIndexOf(".");
  const base = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
  const extension = lastDot > 0 ? fileName.slice(lastDot + 1) : "bin";
  return `${safeName(period)}--${safeName(base)}.${safeName(extension)}`;
}

function isMissingFile(error: unknown) {
  return error instanceof DOMException && error.name === "NotFoundError";
}

function openHandleDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HANDLE_STORE))
        request.result.createObjectStore(HANDLE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
