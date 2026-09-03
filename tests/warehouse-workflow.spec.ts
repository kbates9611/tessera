import { expect, test } from "@playwright/test";
import {
  datasetTab,
  installModelContextStub,
  monthTab,
  openWarehouse,
  registeredToolNames,
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
  await openWarehouse(page);
  await waitForTool(page, "get_project_context");
});

test("a person outlines, drafts, reviews, and approves a month by hand", async ({
  page,
}) => {
  await monthTab(page, /^September 2026\b/).click();
  await expect(page.locator(".worksheet-region-outline")).toHaveCount(0);

  await page.getByRole("button", { name: "Outline the table" }).click();
  const outline = page.getByRole("region", { name: "Outline the table" });
  await expect(outline).toBeVisible();
  await expect(outline).toContainText("METRIC ROWS → CANONICAL FIELDS");
  await expect(
    outline.getByLabel("Canonical field for Units Shpd"),
  ).toHaveValue("Cases shipped");
  await expect(outline.getByLabel("Canonical field for Svc%")).toHaveValue(
    "Fill rate",
  );

  await outline.getByRole("button", { name: "Save outline" }).click();
  await expect(page.locator(".worksheet-region-outline")).toHaveCount(1);
  await expect(page.locator(".worksheet-region-outline")).toHaveAttribute(
    "data-start-row",
    "6",
  );

  await page.getByRole("button", { name: "Create clean draft" }).click();
  const cleaned = versionTab(page, "Cleaned");
  await expect(cleaned).toBeEnabled();
  await expect(cleaned).toContainText("Draft · needs approval");

  await page.getByRole("button", { name: "Review the draft" }).click();
  const rows = page.locator(".data-grid tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("2026-09-30");
  await expect(rows.first()).toContainText("8560000");
  await expect(page.locator(".quality-check-preview")).toContainText(
    "Ready to approve",
  );

  await page.getByRole("button", { name: "Approve for dashboards" }).click();
  await expect(monthTab(page, "September 2026")).toBeVisible();
  await expect(cleaned).toContainText("Approved");

  const status = await runTool<{ approved: number; allApproved: boolean }>(
    page,
    "get_monthly_refresh_status",
    { period: "2026-09" },
  );
  expect(status).toEqual(
    expect.objectContaining({ approved: 1, allApproved: false }),
  );
});

test("quick clean applies the saved recipe and records the field mapping", async ({
  page,
}) => {
  await datasetTab(page, "Distribution Centers").click();
  await monthTab(page, /^September 2026\b/).click();
  await page
    .getByRole("button", { name: "Quick clean with saved recipe" })
    .click();

  await expect(versionTab(page, "Cleaned")).toContainText(
    "Draft · needs approval",
  );
  const mapping = page.locator(".variable-match-preview");
  await expect(mapping).toContainText("Units Shipped");
  await expect(mapping).toContainText("Cases shipped");
});

test("the cleaned draft can be edited cell by cell, decimals included", async ({
  page,
}) => {
  await datasetTab(page, "Distribution Centers").click();
  await monthTab(page, /^September 2026\b/).click();
  await page
    .getByRole("button", { name: "Quick clean with saved recipe" })
    .click();
  await page.getByRole("button", { name: "Review the draft" }).click();

  await page.getByRole("button", { name: "Edit table" }).click();
  const cell = page.getByLabel("Cases shipped row 1", { exact: true });
  await cell.fill("12.5");
  await expect(cell).toHaveValue("12.5");
  await page
    .getByLabel("Rename column 1", { exact: true })
    .fill("Facility name");
  await page.getByRole("button", { name: "Save table" }).click();

  await expect(page.getByRole("button", { name: "Edit table" })).toBeVisible();
  await expect(page.locator(".data-grid thead")).toContainText("Facility name");
  await expect(page.locator(".data-grid tbody tr").first()).toContainText(
    "12.5",
  );
});

test("recipes are editable and the change persists", async ({ page }) => {
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  await page.getByRole("button", { name: "Edit recipe" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Network Summary recipe" });
  await dialog.getByRole("button", { name: "Add mapping" }).click();
  const row = dialog.locator(".recipe-editor__row").last();
  await row.getByLabel("Source header").fill("Ship qty");
  await row.getByLabel("Canonical field").fill("Cases shipped");
  await dialog.getByRole("button", { name: "Save recipe" }).click();
  await expect(dialog.getByRole("button", { name: "Saved" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Edit recipe" }).first().click();
  await expect(
    page
      .getByRole("dialog", { name: "Network Summary recipe" })
      .locator('input[value="Ship qty"]'),
  ).toHaveCount(1);

  const names = await registeredToolNames(page);
  expect(names).toContain("update_dataset_recipe");
});

test("an agent outline pauses on a question that only the person can answer", async ({
  page,
}) => {
  await monthTab(page, /^September 2026\b/).click();
  await waitForTool(page, "propose_dataset_month_outline");
  const names = await registeredToolNames(page);
  expect(names).not.toContain("approve_dataset_month");
  expect(names).not.toContain("answer_dataset_month_questions");

  await runTool(page, "start_dataset_month_processing", {
    datasetId: "northstar-network-monthly",
    period: "2026-09",
  });
  const inspection = await runTool(page, "inspect_dataset_month_source", {
    datasetId: "northstar-network-monthly",
    period: "2026-09",
  });
  expect(inspection).toEqual(
    expect.objectContaining({
      priorApproved: expect.objectContaining({ period: "2026-08" }),
      chartCriticalFields: expect.arrayContaining(["Period", "Cases shipped"]),
    }),
  );

  await runTool(page, "propose_dataset_month_outline", {
    datasetId: "northstar-network-monthly",
    period: "2026-09",
    regions: [
      {
        id: "network-september-table",
        sheet: "Report Summary",
        name: "Enterprise network performance",
        kind: "table",
        confidence: 0.98,
        canonicalName: "Network Summary",
        range: { startRow: 6, startColumn: 1, endRow: 14, endColumn: 6 },
      },
    ],
    variableMappings: [
      {
        source: "Units Shpd",
        canonical: "Cases shipped",
        matchedFromPrevious: "Cases shipped",
        confidence: 0.99,
        usedByCharts: true,
      },
      {
        source: "Svc%",
        canonical: "Fill rate",
        matchedFromPrevious: "Fill rate",
        confidence: 0.98,
        usedByCharts: true,
      },
    ],
    questions: [
      {
        id: "fresno-waste",
        prompt: "Fresno fresh waste is missing. What should September use?",
        detail: "The facility table has no September value.",
        recommendedChoiceId: "leave-missing",
        choices: [
          { id: "leave-missing", label: "Leave September missing" },
          { id: "use-august", label: "Use August's 2.4%" },
        ],
      },
    ],
  });

  await expect(page.locator(".worksheet-region-outline")).toHaveCount(1);
  const dialog = page.getByRole("dialog", { name: "Your decision is needed" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Submit all choices" }),
  ).toBeDisabled();
  await dialog.getByLabel("Leave September missing", { exact: false }).check();
  await dialog.getByRole("button", { name: "Submit all choices" }).click();

  const saved = page.getByRole("dialog", { name: "Decisions saved" });
  await expect(saved).toContainText("Create the clean draft now");
  await saved.getByRole("button", { name: "Create clean draft" }).click();
  await expect(saved).toBeHidden();
  await expect(versionTab(page, "Cleaned")).toContainText(
    "Draft · needs approval",
  );

  await page.getByRole("button", { name: "Approve for dashboards" }).click();
  await expect(versionTab(page, "Cleaned")).toContainText("Approved");
});

test("existing monthly dashboards are recognized from the refresh board", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Monthly refresh", exact: true })
    .click();
  const banner = page.getByRole("region", { name: "Dashboard editions" });
  await expect(banner).toContainText("August 2026 is fully approved");
  await banner.getByRole("button", { name: "Create editions" }).click();

  const dialog = page.getByRole("dialog", {
    name: "August 2026 is dashboard-ready",
  });
  const executive = dialog
    .locator(".edition-row")
    .filter({ hasText: "Executive Summary" });
  await expect(executive).toContainText("August 2026 edition created");
  await dialog.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  await expect(page.getByLabel("Dashboard month")).toHaveAttribute(
    "data-value",
    "2026-08",
  );
  await expect(
    page.getByRole("tab", { name: "Executive Summary", exact: true }),
  ).toBeVisible();
  const context = await runTool<{
    dashboards: Array<{
      name: string;
      blockCount: number;
      reportingPeriod?: string;
    }>;
  }>(page, "get_project_context");
  const source = context.dashboards.find(
    (dashboard) => dashboard.name === "Executive Summary",
  );
  expect(source?.blockCount).toBe(16);
  expect(source?.reportingPeriod).toBe("2026-08");
  expect(context.dashboards).toHaveLength(3);
});

test("the exact uploaded file is retained and downloadable", async ({
  page,
}) => {
  const original = Buffer.from("Month,Value\n2026-10,42\n", "utf8");
  const upload = await page.request.post(
    "/api/uploads?filename=october-source.csv",
    { headers: { "content-type": "text/csv" }, data: original },
  );
  expect(upload.status()).toBe(201);
  const stored = (await upload.json()) as {
    storageKey: string;
    checksum: string;
  };
  expect(stored.storageKey).toMatch(
    /^uploads\/[0-9a-f-]+\/october-source\.csv$/i,
  );
  expect(stored.checksum).toHaveLength(64);

  const downloaded = await page.request.get(
    `/api/uploads?key=${encodeURIComponent(stored.storageKey)}&download=1`,
  );
  expect(downloaded.ok()).toBe(true);
  expect(await downloaded.body()).toEqual(original);
  expect(downloaded.headers()["content-disposition"]).toContain("attachment");
});

test("several labelled regions can be outlined by hand and all are kept", async ({
  page,
}) => {
  await monthTab(page, /^September 2026\b/).click();
  await page.getByRole("button", { name: "Outline the table" }).click();
  const outline = page.getByRole("region", { name: "Outline the table" });
  const drawn = page.locator("[data-testid^='worksheet-region-']");
  await expect(drawn).toHaveCount(1);
  await expect(drawn.first()).toContainText("Network Summary table");
  await expect(
    outline.getByRole("list", { name: "Outlined regions" }),
  ).toContainText("1 outlined · 1 table");

  // Drag across the ops-notes block (rows 16-21, columns A-B) and label it.
  const cell = (row: number, column: number) =>
    page
      .locator(".worksheet-grid tbody tr")
      .nth(row)
      .locator(`td[data-column="${column}"]`);
  await cell(15, 0).hover();
  await page.mouse.down();
  await cell(20, 1).hover();
  await expect(page.getByTestId("worksheet-selection")).toContainText(
    "A16:B21",
  );
  await page.mouse.up();
  await outline.getByRole("button", { name: "Notes", exact: true }).click();

  await expect(drawn).toHaveCount(2);
  await expect(page.getByTestId("worksheet-selection")).toHaveCount(0);
  await outline.getByLabel("Name of region A16:B21").fill("Ops notes");
  await expect(drawn.filter({ hasText: "Ops notes · notes" })).toHaveCount(1);
  await expect(
    outline.getByRole("list", { name: "Outlined regions" }),
  ).toContainText("2 outlined · 1 table");
  await expect(
    outline.getByLabel("Canonical field for Units Shpd"),
  ).toHaveValue("Cases shipped");

  await outline.getByRole("button", { name: "Save outline" }).click();
  await expect(outline).toBeHidden();
  await expect(page.locator(".worksheet-region-outline")).toHaveCount(2);
  await expect(
    page.locator(".worksheet-region-outline.is-narrative"),
  ).toContainText("Ops notes");

  await page.getByRole("button", { name: "Create clean draft" }).click();
  await page.getByRole("button", { name: "Review the draft" }).click();
  const rows = page.locator(".data-grid tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("8560000");
});
