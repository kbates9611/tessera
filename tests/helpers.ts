import { expect, type BrowserContext, type Page } from "@playwright/test";

export interface RegisteredTool {
  name: string;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

declare global {
  interface Window {
    __tesseraTools: Record<string, RegisteredTool>;
  }
}

/** Captures the WebMCP tools registered before the application loads. */
export async function installModelContextStub(
  target: Page | BrowserContext,
  { native = false }: { native?: boolean } = {},
) {
  await target.addInitScript((isNative: boolean) => {
    window.__tesseraTools = {};
    const context: Record<string, unknown> = {
      registerTool(tool: RegisteredTool) {
        window.__tesseraTools[tool.name] = tool;
      },
    };
    if (isNative) context.codexGetTools = () => undefined;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: context,
    });
  }, native);
}

export async function resetBackend(page: Page) {
  const reset = await page.request.post("/api/test/reset");
  expect(reset.ok()).toBe(true);
}

export async function waitForSaved(page: Page) {
  await expect(page.locator(".topbar__save")).toContainText("Saved", {
    timeout: 15_000,
  });
}

export async function waitForTool(page: Page, name: string) {
  await expect
    .poll(() =>
      page.evaluate((tool) => Boolean(window.__tesseraTools[tool]), name),
    )
    .toBe(true);
}

export async function runTool<T = unknown>(
  page: Page,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return page.evaluate(
    async ({ toolName, toolArgs }) => {
      const tools = window.__tesseraTools;
      if (tools[toolName]) return tools[toolName].execute(toolArgs);
      const gateway = tools.run_tessera_tool;
      if (!gateway) throw new Error(`Tool ${toolName} is not registered.`);
      const response = (await gateway.execute({
        toolName,
        arguments: toolArgs,
      })) as { result?: unknown };
      return response.result ?? response;
    },
    { toolName: name, toolArgs: args },
  ) as Promise<T>;
}

export async function registeredToolNames(page: Page) {
  return page.evaluate(() => Object.keys(window.__tesseraTools).sort());
}

export async function openWarehouse(page: Page) {
  await page
    .getByRole("button", { name: "Data Warehouse", exact: true })
    .click();
}

export function monthTab(page: Page, label: RegExp | string) {
  return page
    .getByRole("tablist", { name: "Dataset months" })
    .getByRole("tab", { name: label });
}

export function datasetTab(page: Page, name: string) {
  return page
    .getByRole("tablist", { name: "Warehouse datasets" })
    .getByRole("tab", { name: new RegExp(`^${name}\\b`) });
}

export function versionTab(page: Page, name: "Original" | "Cleaned") {
  return page
    .getByRole("tablist", { name: "Data version" })
    .getByRole("tab", { name: new RegExp(`^${name}\\b`) });
}
