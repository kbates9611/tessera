import { expect, test } from "@playwright/test";
import {
  datasetTab,
  monthTab,
  openWarehouse,
  resetBackend,
  waitForSaved,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetBackend(page);
  await page.goto("/");
  await waitForSaved(page);
});

test("dashboard counters follow blocks and datasets as they change", async ({
  page,
}) => {
  const metrics = page.locator(".agent-metrics");
  const toolbar = page.locator(".studio-toolbar__context");
  await expect(metrics).toContainText("16 blocks");
  await expect(metrics).toContainText("5 datasets");
  await expect(toolbar).toContainText("16 blocks");
  await expect(toolbar).toContainText("5 datasets");

  await page.locator(".block-library").getByLabel("Add KPI").click();
  await expect(metrics).toContainText("17 blocks");
  await expect(toolbar).toContainText("17 blocks");

  await openWarehouse(page);
  await page.getByRole("button", { name: "New dataset" }).click();
  const dialog = page.getByRole("dialog", { name: "New dataset" });
  await dialog.getByLabel("Dataset name").fill("Store traffic");
  await dialog.getByRole("button", { name: "Create dataset" }).click();
  await expect(
    page.getByRole("dialog", { name: /Add a month to/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".warehouse-commandbar__actions")).toContainText(
    "6 datasets",
  );

  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  await expect(metrics).toContainText("6 datasets");
  await expect(toolbar).toContainText("6 datasets");
});

test("the reporting period and bound-table list stay pinned to the dashboard month", async ({
  page,
}) => {
  const subnav = page.locator(".dashboard-subnav");
  await expect(subnav).toContainText("August 2026");
  await page.getByRole("tab", { name: "Data", exact: true }).click();
  const dataList = page.locator(".agent-data-list");
  await expect(dataList).toContainText("Network Summary");
  await expect(
    dataList.locator("div", { hasText: "Network Summary" }),
  ).toContainText("August 2026");

  await openWarehouse(page);
  await datasetTab(page, "Network Summary").click();
  await monthTab(page, /^September 2026\b/).click();
  await page.getByRole("button", { name: "Outline the table" }).click();
  await page.getByRole("button", { name: "Save outline" }).click();
  await page.getByRole("button", { name: "Create clean draft" }).click();
  await page.getByRole("button", { name: "Approve for dashboards" }).click();
  await expect(monthTab(page, "September 2026")).toBeVisible();

  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  await expect(subnav).toContainText("August 2026");
  await page.getByRole("tab", { name: "Data", exact: true }).click();
  await expect(
    dataList.locator("div", { hasText: "Network Summary" }),
  ).toContainText("August 2026");
  await expect(
    dataList.locator("div", { hasText: "Network Summary" }),
  ).toContainText("6 rows");
  await expect(
    page.locator('[data-block-id="exec-cases"] .kpi-block__value-row'),
  ).toContainText("8.4M");
});
