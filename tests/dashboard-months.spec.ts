import { expect, test, type Page } from "@playwright/test";
import type { PersistedEnvelope, TesseraState } from "../src/domain/types";
import {
  installModelContextStub,
  resetBackend,
  runTool,
  waitForSaved,
  waitForTool,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetBackend(page);
  await installModelContextStub(page);
  await page.goto("/");
  await waitForTool(page, "create_monthly_dashboard_edition");
  await waitForSaved(page);
  await expect
    .poll(async () => {
      const envelope = (await (
        await page.request.get("/api/state")
      ).json()) as PersistedEnvelope;
      return envelope.state?.projects.length ?? 0;
    })
    .toBe(1);
});

test("monthly dashboard versions stay grouped behind one month picker", async ({
  page,
}) => {
  const monthPicker = page.getByLabel("Dashboard month");
  const tabs = page.getByRole("tablist", { name: "Dashboards" });
  await expect(monthPicker).toHaveAttribute("data-value", "2026-08");
  await expect(page.locator(".month-picker select")).toHaveCount(0);
  await expect(page.locator(".month-picker__trigger > svg")).toHaveCount(1);
  await monthPicker.click();
  await expect(
    page.getByRole("listbox", { name: "Dashboard months" }).getByRole("option"),
  ).toHaveText(["August 2026"]);
  await page.keyboard.press("Escape");
  await expect(monthPicker).toBeFocused();
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  await expect(tabs).toContainText("Executive Summary");
  await expect(tabs).toContainText("Supplier Risk");
  await expect(tabs).toContainText("Inventory");

  const before = await currentState(page);
  const august = before.projects[0].dashboards.find(
    (dashboard) => dashboard.id === "northstar-executive",
  )!;
  const augustSnapshot = JSON.stringify(august);

  await approveSeptember(page);
  const executive = await runTool<{
    dashboardId: string;
    existing?: boolean;
  }>(page, "create_monthly_dashboard_edition", {
    sourceDashboardId: "northstar-executive",
    period: "2026-09",
  });

  await expect(monthPicker).toHaveAttribute("data-value", "2026-09");
  await monthPicker.click();
  await expect(
    page.getByRole("listbox", { name: "Dashboard months" }).getByRole("option"),
  ).toHaveText(["September 2026", "August 2026"]);
  await page.keyboard.press("Escape");
  await expect(tabs.getByRole("tab")).toHaveCount(1);
  await expect(tabs.getByRole("tab")).toContainText("Executive Summary");
  await expect(tabs).not.toContainText("Supplier Risk");
  await expect(tabs).not.toContainText("Inventory");
  await expect(tabs.getByText("Draft")).toBeVisible();

  await runTool(page, "create_monthly_dashboard_edition", {
    sourceDashboardId: "northstar-suppliers-dashboard",
    period: "2026-09",
  });
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await expect(tabs).toContainText("Executive Summary");
  await expect(tabs).toContainText("Supplier Risk");
  await expect(tabs).not.toContainText("Inventory");

  await monthPicker.focus();
  await monthPicker.press("ArrowDown");
  const augustOption = page
    .getByRole("listbox", { name: "Dashboard months" })
    .getByRole("option", { name: "August 2026" });
  await expect(augustOption).toBeFocused();
  await augustOption.press("Enter");
  await expect(monthPicker).toHaveAttribute("data-value", "2026-08");
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  await expect(tabs).toContainText("Inventory");

  const duplicate = await runTool<{
    dashboardId: string;
    existing?: boolean;
  }>(page, "create_monthly_dashboard_edition", {
    sourceDashboardId: "northstar-executive",
    period: "2026-09",
  });
  expect(duplicate.existing).toBe(true);
  expect(duplicate.dashboardId).toBe(executive.dashboardId);
  await expect(monthPicker).toHaveAttribute("data-value", "2026-09");
  await expect(tabs.getByRole("tab")).toHaveCount(2);

  const after = await currentState(page);
  const project = after.projects[0];
  const september = project.dashboards.find(
    (dashboard) => dashboard.id === executive.dashboardId,
  )!;
  expect(
    JSON.stringify(project.dashboards.find((item) => item.id === august.id)),
  ).toBe(augustSnapshot);
  expect(september.reportingPeriod).toBe("2026-09");
  expect(september.seriesId).toBe(august.id);
  expect(september.edition?.sourceDashboardId).toBe(august.id);
  expect(september.blocks).toHaveLength(august.blocks.length);
  expect(september.blocks.map((block) => block.id)).not.toEqual(
    august.blocks.map((block) => block.id),
  );
  expect(
    september.blocks
      .filter((block) => block.datasetId)
      .every(
        (block) =>
          block.period === "2026-09" || block.period === "through:2026-09",
      ),
  ).toBe(true);
  expect(
    project.dashboards.filter(
      (dashboard) =>
        dashboard.seriesId === august.id &&
        dashboard.reportingPeriod === "2026-09",
    ),
  ).toHaveLength(1);
});

test("the manual refresh dialog offers one latest template per dashboard series", async ({
  page,
}) => {
  await approveSeptember(page);
  await page
    .getByRole("button", { name: "Data Warehouse", exact: true })
    .click();
  await page.getByRole("button", { name: "Monthly refresh" }).click();
  await page.getByRole("button", { name: "Create editions" }).click();

  const dialog = page.getByRole("dialog", {
    name: "September 2026 is dashboard-ready",
  });
  const rows = dialog.locator(".edition-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Executive Summary");
  await expect(rows.nth(1)).toContainText("Supplier Risk");
  await expect(rows.nth(2)).toContainText("Inventory");
  for (let index = 0; index < 3; index += 1)
    await expect(rows.nth(index)).toContainText("template: August 2026");

  const executiveRow = rows.filter({ hasText: "Executive Summary" });
  await executiveRow
    .getByRole("button", { name: "Create September 2026 edition" })
    .click();
  await expect(executiveRow).toContainText("September 2026 edition created");
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  await expect(page.getByLabel("Dashboard month")).toHaveAttribute(
    "data-value",
    "2026-09",
  );
  await expect(
    page.getByRole("tablist", { name: "Dashboards" }).getByRole("tab"),
  ).toHaveCount(1);
});

async function currentState(page: Page) {
  const response = await page.request.get("/api/state");
  const envelope = (await response.json()) as PersistedEnvelope;
  expect(envelope.state).not.toBeNull();
  return envelope.state as TesseraState;
}

async function approveSeptember(page: Page) {
  const response = await page.request.get("/api/state");
  const envelope = (await response.json()) as PersistedEnvelope;
  const state = structuredClone(envelope.state) as TesseraState;
  const project = state.projects[0];
  for (const dataset of project.warehouse) {
    const august = dataset.months.find((month) => month.period === "2026-08")!;
    const september = dataset.months.find(
      (month) => month.period === "2026-09",
    )!;
    september.status = "ready";
    september.cleaned = structuredClone(august.cleaned);
    const periodIndex = september.cleaned.columns.indexOf("Period");
    if (periodIndex >= 0)
      september.cleaned.rows.forEach((row) => {
        row[periodIndex] = "2026-09-30";
      });
    september.cleaningSummary = ["Approved for monthly dashboard testing"];
    september.processing = {
      stage: "approved",
      progress: 100,
      message: "Approved",
      updatedAt: "2026-09-30T18:00:00.000Z",
      variableMappings: [],
      questions: [],
      qualityChecks: [],
      recipeRevision: 1,
    };
  }
  const saved = await page.request.put("/api/state", {
    headers: { "content-type": "application/json" },
    data: { expectedRevision: envelope.revision, state },
  });
  expect(saved.ok()).toBe(true);
  await expect
    .poll(async () => {
      const latest = await currentState(page);
      return latest.projects[0].warehouse.every(
        (dataset) =>
          dataset.months.find((month) => month.period === "2026-09")?.status ===
          "ready",
      );
    })
    .toBe(true);
  await page.reload();
  await waitForTool(page, "create_monthly_dashboard_edition");
  await waitForSaved(page);
  await expect
    .poll(async () => {
      const status = await runTool<{ allApproved: boolean }>(
        page,
        "get_monthly_refresh_status",
        { period: "2026-09" },
      );
      return status.allApproved;
    })
    .toBe(true);
}
