import { expect, test, type Page } from "@playwright/test";
import { datasetTab, resetBackend } from "./helpers";

declare global {
  interface Window {
    __workspaceFiles: {
      dump(): Record<string, string>;
    };
  }
}

test("a chosen workspace folder mirrors JSON files and restores them after browser state is reset", async ({
  context,
  page,
}) => {
  await resetBackend(page);
  await installMemoryFolder(page);
  await page.goto("/");

  const folderButton = page.getByRole("button", {
    name: "Choose a folder for automatic workspace saves",
  });
  await expect(folderButton).toBeVisible();
  await folderButton.click();
  await expect(page.getByText("Folder synced", { exact: true })).toBeVisible();

  await page
    .getByRole("button", { name: "New dashboard", exact: true })
    .click();
  const dashboardDialog = page.getByRole("dialog", { name: "New dashboard" });
  await dashboardDialog
    .getByRole("textbox", { name: "Name" })
    .fill("Folder recovery test");
  await dashboardDialog
    .getByRole("button", { name: "Create dashboard" })
    .click();

  const originalUpload = Buffer.from(
    "Check,Status,Exceptions\nCounted,Pass,0\nMissing,Fail,3\n",
    "utf8",
  );
  await page
    .getByRole("button", { name: "Data Warehouse", exact: true })
    .click();
  await page.getByRole("button", { name: "New dataset" }).click();
  const datasetDialog = page.getByRole("dialog", { name: "New dataset" });
  await datasetDialog.getByLabel("Dataset name").fill("Audit source archive");
  await datasetDialog.getByRole("button", { name: "Create dataset" }).click();
  const monthDialog = page.getByRole("dialog", {
    name: "Add a month to Audit source archive",
  });
  await monthDialog.locator('input[type="month"]').fill("2026-10");
  await monthDialog.locator('input[type="file"]').setInputFiles({
    name: "october-audit.csv",
    mimeType: "text/csv",
    buffer: originalUpload,
  });
  await expect(monthDialog.locator(".upload-preview")).toContainText(
    "2 rows · 3 columns",
  );
  await monthDialog.getByRole("button", { name: "Save original" }).click();
  await expect
    .poll(async () => {
      const files = await page.evaluate(() => window.__workspaceFiles.dump());
      const manifest = files["tessera-workspace.json"]
        ? (JSON.parse(files["tessera-workspace.json"]) as {
            projects: Array<{ directory: string; index: string }>;
          })
        : undefined;
      const project = manifest?.projects[0];
      const index = project
        ? files[`${project.directory}/${project.index}`]
        : undefined;
      return Boolean(
        Object.keys(files).some((path) =>
          path.includes("/datasets/source-files/2026-10--october-audit.csv"),
        ) &&
        index &&
        (JSON.parse(index) as { datasets: unknown[] }).datasets.length === 6,
      );
    })
    .toBe(true);

  await expect
    .poll(async () => {
      const files = await page.evaluate(() => window.__workspaceFiles.dump());
      return Object.values(files).some((contents) =>
        contents.includes('"name": "Folder recovery test"'),
      );
    })
    .toBe(true);

  const savedFiles = await page.evaluate(() => window.__workspaceFiles.dump());
  const paths = Object.keys(savedFiles);
  expect(paths).toContain("tessera-workspace.json");

  const manifest = JSON.parse(savedFiles["tessera-workspace.json"]) as {
    format: string;
    activeProjectId: string;
    generation: "a" | "b";
    projects: Array<{ directory: string; index: string }>;
  };
  expect(manifest).toMatchObject({
    format: "tessera-workspace-v1",
    activeProjectId: "northstar-supply-chain",
  });
  expect(manifest.projects).toHaveLength(1);
  const projectEntry = manifest.projects[0];
  const projectIndexPath = `${projectEntry.directory}/${projectEntry.index}`;
  expect(paths).toContain(projectIndexPath);
  const projectIndex = JSON.parse(savedFiles[projectIndexPath]) as {
    dashboards: Array<{ file: string }>;
    datasets: Array<{ file: string }>;
  };
  expect(projectIndex.dashboards).toHaveLength(4);
  expect(projectIndex.datasets).toHaveLength(6);
  projectIndex.dashboards.forEach(({ file }) =>
    expect(paths).toContain(`${projectEntry.directory}/dashboards/${file}`),
  );
  projectIndex.datasets.forEach(({ file }) =>
    expect(paths).toContain(`${projectEntry.directory}/datasets/${file}`),
  );
  const sourcePath = paths.find((path) =>
    path.includes("/datasets/source-files/2026-10--october-audit.csv"),
  );
  expect(sourcePath).toBeTruthy();
  expect(savedFiles[sourcePath!]).toBe(originalUpload.toString("utf8"));

  await resetBackend(page);
  const restoredPage = await context.newPage();
  await installMemoryFolder(restoredPage, savedFiles);
  await restoredPage.goto("/");
  await restoredPage
    .getByRole("button", {
      name: "Choose a folder for automatic workspace saves",
    })
    .click();
  await expect(
    restoredPage.getByRole("tab", { name: "Folder recovery test" }),
  ).toBeVisible();
  await expect(
    restoredPage.getByText("Folder synced", { exact: true }),
  ).toBeVisible();
  await restoredPage
    .getByRole("button", { name: "Data Warehouse", exact: true })
    .click();
  await datasetTab(restoredPage, "Audit source archive").click();
  const download = restoredPage.getByRole("link", {
    name: "Download original",
  });
  await expect(download).toBeVisible();
  const href = await download.getAttribute("href");
  expect(href).toBeTruthy();
  const restoredUpload = await restoredPage.request.get(href!);
  const uploadError = restoredUpload.ok() ? "" : await restoredUpload.text();
  expect(
    restoredUpload.ok(),
    `${restoredUpload.status()} ${uploadError} (${href})`,
  ).toBe(true);
  expect(await restoredUpload.body()).toEqual(originalUpload);
});

async function installMemoryFolder(
  page: Page,
  seed: Record<string, string> = {},
) {
  await page.addInitScript((initialFiles: Record<string, string>) => {
    indexedDB.deleteDatabase("tessera-local-workspace");
    const files = new Map(Object.entries(initialFiles));
    const directories = new Set<string>([""]);
    Object.keys(initialFiles).forEach((path) => {
      const parts = path.split("/");
      parts.pop();
      for (let index = 1; index <= parts.length; index += 1)
        directories.add(parts.slice(0, index).join("/"));
    });
    const join = (parent: string, child: string) =>
      parent ? `${parent}/${child}` : child;
    const missing = () => new DOMException("Not found", "NotFoundError");

    class MemoryFileHandle {
      constructor(private readonly path: string) {}

      async getFile() {
        if (!files.has(this.path)) throw missing();
        return new File(
          [files.get(this.path) ?? ""],
          this.path.split("/").at(-1) ?? "file",
        );
      }

      async createWritable() {
        return {
          write: async (value: string | Blob) => {
            files.set(
              this.path,
              typeof value === "string" ? value : await value.text(),
            );
          },
          close: async () => undefined,
        };
      }
    }

    class MemoryDirectoryHandle {
      readonly name: string;
      // Native directory handles are structured-cloneable; this in-memory
      // test double intentionally is not, so the test exercises re-picking.
      readonly __uncloneable = () => undefined;

      constructor(private readonly path: string) {
        this.name = path.split("/").at(-1) || "Tessera workspace";
      }

      async getDirectoryHandle(name: string, options?: { create?: boolean }) {
        const path = join(this.path, name);
        if (!directories.has(path)) {
          if (!options?.create) throw missing();
          directories.add(path);
        }
        return new MemoryDirectoryHandle(path);
      }

      async getFileHandle(name: string, options?: { create?: boolean }) {
        const path = join(this.path, name);
        if (!files.has(path) && !options?.create) throw missing();
        return new MemoryFileHandle(path);
      }

      async queryPermission() {
        return "granted";
      }

      async requestPermission() {
        return "granted";
      }
    }

    window.__workspaceFiles = {
      dump: () => Object.fromEntries(files),
    };
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => new MemoryDirectoryHandle(""),
    });
  }, seed);
}
