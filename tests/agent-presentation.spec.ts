import { expect, test } from "@playwright/test";
import { DEFAULT_SANKEY_COLORS } from "../src/domain/defaults";
import {
  installModelContextStub,
  openWarehouse,
  resetBackend,
  runTool,
  waitForSaved,
  waitForTool,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetBackend(page);
  await installModelContextStub(page);
  await page.goto("/");
  await waitForSaved(page);
  await waitForTool(page, "create_dashboard");
});

test("the canvas opens on the dashboard the agent starts building", async ({
  page,
}) => {
  await openWarehouse(page);
  await expect(page.locator(".warehouse-commandbar")).toBeVisible();

  const created = await runTool<{ id: string }>(page, "create_dashboard", {
    name: "Agent build",
  });
  await expect(page.locator(".warehouse-commandbar")).toHaveCount(0);
  await expect(page.getByLabel("Current dashboard")).toHaveValue(created.id);

  // Editing a different dashboard brings that dashboard forward.
  await runTool(page, "add_text", {
    dashboardId: "northstar-executive",
    body: "Agent note",
  });
  await expect(page.locator('[data-block-id="exec-cases"]')).toBeVisible();
});

test("card surfaces stay white and the inspector offers no surface color", async ({
  page,
}) => {
  await expect(
    runTool(page, "update_block", {
      blockId: "exec-cases",
      patch: { style: { background: "#fff4e5" } },
    }),
  ).rejects.toThrow(/white|background is not allowed/);

  const card = page.locator('[data-block-id="exec-cases"]');
  await expect(card).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await card.click();
  const inspector = page.getByRole("complementary", { name: "KPI settings" });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByLabel("Surface")).toHaveCount(0);
});

test("a KPI icon takes the KPI accent color", async ({ page }) => {
  await runTool(page, "update_block", {
    blockId: "exec-cases",
    patch: { style: { accent: "#b42318" } },
  });
  await expect(
    page.locator('[data-block-id="exec-cases"] .kpi-block__icon'),
  ).toHaveCSS("color", "rgb(180, 35, 24)");
});

test("a fast build warns when short commentary would stretch beside a chart", async ({
  page,
}) => {
  const result = await runTool<{ layoutWarnings: string[] }>(
    page,
    "build_dashboard_fast",
    {
      operations: [
        { toolName: "create_dashboard", arguments: { name: "Layout check" } },
        {
          toolName: "add_horizontal_bar_chart",
          arguments: {
            title: "Cases by month",
            datasetId: "northstar-network-monthly",
            categoryField: "Period",
            valueField: "Cases shipped",
          },
        },
        {
          toolName: "add_text",
          arguments: { title: "Takeaway", body: "Short note.", width: 4 },
        },
      ],
    },
  );
  expect(result.layoutWarnings).toHaveLength(1);
  expect(result.layoutWarnings[0]).toMatch(/"Takeaway" sits alone beside/);
});

test("the default Sankey palette is blues and greys", () => {
  for (const color of DEFAULT_SANKEY_COLORS) {
    const [red, green, blue] = [1, 3, 5].map((offset) =>
      parseInt(color.slice(offset, offset + 2), 16),
    );
    expect(blue).toBeGreaterThanOrEqual(red);
    expect(blue).toBeGreaterThanOrEqual(green);
  }
});
