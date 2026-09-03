import { expect, test } from "@playwright/test";
import {
  installModelContextStub,
  monthTab,
  openWarehouse,
  resetBackend,
  runTool,
  versionTab,
  waitForSaved,
  waitForTool,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetBackend(page);
  await installModelContextStub(page);
  await page.goto("/");
  await waitForSaved(page);
});

test("new tiles are intent-first placeholders and WebMCP fulfills them in place", async ({
  page,
}) => {
  await page.locator(".block-library").getByLabel("Add KPI").click();

  const placeholder = page.locator(".tile-placeholder").last();
  await expect(
    placeholder.getByText("KPI tile", { exact: true }),
  ).toBeVisible();
  await expect(placeholder.getByText("EMPTY", { exact: true })).toBeVisible();
  await expect(
    placeholder.getByRole("button", { name: "Manual", exact: true }),
  ).toBeVisible();

  const brief = "Show the latest cases shipped with a compact value";
  await placeholder.getByLabel("Describe the KPI tile").fill(brief);
  await placeholder.getByRole("button", { name: "Save brief" }).click();

  await waitForTool(page, "get_tile_placeholders");
  const inspected = await runTool<{
    placeholders: Array<{ blockId: string; intent: string }>;
  }>(page, "get_tile_placeholders");
  const target = inspected.placeholders.find((item) => item.intent === brief);
  expect(target).toBeDefined();
  await runTool(page, "add_kpi", {
    placeholderId: target!.blockId,
    title: "Cases shipped",
    datasetId: "northstar-network-monthly",
    valueField: "Cases shipped",
    aggregation: "last",
    valueFormat: "compact",
  });

  const completed = page.locator(`[data-block-id="${target!.blockId}"]`);
  await expect(completed.locator(".tile-placeholder")).toHaveCount(0);
  await expect(
    completed.getByText("Cases shipped", { exact: true }),
  ).toBeVisible();
});

test("a pasted source is stored as an immutable original before any cleaning", async ({
  page,
}) => {
  await openWarehouse(page);
  await page.getByRole("button", { name: "Add month", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: /Add a month to/ });
  await dialog.locator('input[type="month"]').fill("2026-10");
  await dialog
    .getByLabel("Paste CSV, TSV, or semicolon-separated data")
    .fill("Date of death;Name\n2026-10-01;Ada\n2026-10-02;Grace");
  await expect(dialog.locator(".upload-preview")).toContainText(
    "2 rows · 2 columns",
  );
  await dialog.getByRole("button", { name: "Save original" }).click();

  await expect(dialog).toBeHidden();
  await expect(monthTab(page, /^October 2026\b/)).toBeVisible();
  await expect(versionTab(page, "Cleaned")).toBeDisabled();
  await expect(page.locator(".worksheet-grid")).toContainText("Date of death");

  await page
    .getByRole("button", {
      name: /Quick clean with (saved recipe|safe defaults)/,
    })
    .click();
  const cleaned = versionTab(page, "Cleaned");
  await expect(cleaned).toBeEnabled();
  await expect(cleaned).toContainText("Draft · needs approval");
  await expect(
    page.getByRole("button", { name: "Fix blocking checks first" }),
  ).toBeDisabled();
  await expect(page.locator(".quality-check-preview .is-fail")).toContainText(
    "Prior-month schema",
  );
});
