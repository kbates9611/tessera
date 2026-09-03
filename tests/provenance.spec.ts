import { expect, test } from "@playwright/test";
import {
  datasetTab,
  monthTab,
  resetBackend,
  versionTab,
  waitForSaved,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetBackend(page);
  await page.goto("/");
  await waitForSaved(page);
});

test("one click takes a bound KPI back to its cleaned table and source", async ({
  page,
}) => {
  const kpi = page.locator('[data-block-id="exec-cases"]');
  await kpi.click();
  await expect(kpi).toHaveClass(/is-selected/);

  const provenance = page.getByTestId("block-provenance");
  await expect(provenance).toContainText("August 2026 · Network Summary");
  await expect(provenance).toContainText(
    "Cleaned table from Northstar_August_Supply_Chain.xlsx",
  );

  await provenance.getByRole("button", { name: "Open in warehouse" }).click();

  await expect(
    page.getByRole("heading", { name: "Data Warehouse", level: 1 }),
  ).toBeVisible();
  await expect(datasetTab(page, "Network Summary")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(monthTab(page, "August 2026")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(versionTab(page, "Cleaned")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".data-grid")).toBeVisible();
  await expect(page.locator(".data-grid thead")).toContainText("Cases shipped");

  await versionTab(page, "Original").click();
  await expect(page.getByTestId("original-worksheet")).toBeVisible();
  await expect(page.getByTestId("original-worksheet")).toContainText(
    "Cases Shipped (000s)",
  );
});

test("a cumulative monthly chart opens its frozen cutoff month", async ({
  page,
}) => {
  const trend = page.locator('[data-block-type="line"]').first();
  await trend.click();
  const provenance = page.getByTestId("block-provenance");
  await expect(provenance).toContainText("Through August 2026");
  await provenance.getByRole("button", { name: "Open in warehouse" }).click();
  await expect(monthTab(page, "August 2026")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(versionTab(page, "Cleaned")).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("approving September does not overwrite the durable August dashboard", async ({
  context,
  page,
}) => {
  const kpi = page.locator(
    '[data-block-id="exec-cases"] .kpi-block__value-row',
  );
  await expect(kpi).toContainText("8.4M");
  // Tag the live DOM node so a remount (which would replay entrance
  // animations) is detectable: a remounted node loses the property.
  await page.locator('[data-block-id="exec-cases"]').evaluate((node) => {
    (node as HTMLElement & { __tesseraSameNode?: boolean }).__tesseraSameNode =
      true;
  });

  const warehouse = await context.newPage();
  await warehouse.goto("/");
  await waitForSaved(warehouse);
  await warehouse
    .getByRole("button", { name: "Data Warehouse", exact: true })
    .click();
  await monthTab(warehouse, /^September 2026\b/).click();
  await warehouse.getByRole("button", { name: "Outline the table" }).click();
  await warehouse.getByRole("button", { name: "Save outline" }).click();
  await warehouse.getByRole("button", { name: "Create clean draft" }).click();
  await warehouse
    .getByRole("button", { name: "Approve for dashboards" })
    .click();
  await expect(versionTab(warehouse, "Cleaned")).toContainText("Approved");

  await expect
    .poll(async () => {
      const response = await page.request.get("/api/state");
      const envelope = (await response.json()) as {
        state: {
          projects: Array<{
            warehouse: Array<{
              months: Array<{ period: string; status?: string }>;
            }>;
          }>;
        };
      };
      return envelope.state.projects[0].warehouse[0].months.find(
        (month) => month.period === "2026-09",
      )?.status;
    })
    .toBe("ready");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(kpi).toContainText("8.4M");
  const sameNode = await page
    .locator('[data-block-id="exec-cases"]')
    .evaluate(
      (node) =>
        (node as HTMLElement & { __tesseraSameNode?: boolean })
          .__tesseraSameNode === true,
    );
  expect(sameNode).toBe(true);
  await expect(page.locator(".canvas-block")).toHaveCount(16);
  await expect(
    page.getByRole("tab", { name: "Executive Summary" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Dashboard month")).toHaveAttribute(
    "data-value",
    "2026-08",
  );
});
