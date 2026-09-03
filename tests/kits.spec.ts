import { expect, test, type Page } from "@playwright/test";
import { KITS } from "../src/domain/kits";
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
  await waitForSaved(page);
  await waitForTool(page, "set_dashboard_kit");
});

async function blockOf(page: Page, blockId: string) {
  const envelope = (await (await page.request.get("/api/state")).json()) as {
    state: {
      projects: Array<{
        dashboards: Array<{
          kit?: string;
          blocks: Array<{
            id: string;
            style: { accent: string };
            chart: { colors: string[]; heatmapMaxColor: string };
            table: { headerBackgroundColor: string };
          }>;
        }>;
      }>;
    };
  };
  for (const dashboard of envelope.state.projects.flatMap(
    (p) => p.dashboards,
  )) {
    const block = dashboard.blocks.find(
      (candidate) => candidate.id === blockId,
    );
    if (block) return { block, kit: dashboard.kit };
  }
  throw new Error(`Block ${blockId} is missing from the state.`);
}

test("a kit recolours every default but keeps emphasis and hand-set colours", async ({
  page,
}) => {
  // An emphasis accent and a hand-picked series colour, set before the switch.
  await runTool(page, "update_block", {
    blockId: "exec-otif",
    patch: { style: { accent: "#b42318" } },
  });
  const original = (await blockOf(page, "exec-volume-trend")).block.chart
    .colors;
  await runTool(page, "update_block", {
    blockId: "exec-volume-trend",
    patch: { chart: { colors: ["#123456", ...original.slice(1)] } },
  });

  await page.getByRole("tab", { name: "Kit", exact: true }).click();
  const maroon = page.getByRole("radio", { name: /Maroon/ });
  await expect(maroon).toHaveAttribute("aria-checked", "false");
  await maroon.click();
  await expect(maroon).toHaveAttribute("aria-checked", "true");
  // The save is debounced; wait for the server to carry the new kit.
  await expect
    .poll(async () => (await blockOf(page, "exec-cases")).kit)
    .toBe("maroon");

  const kit = KITS.maroon;
  expect((await blockOf(page, "exec-cases")).block.style.accent).toBe(
    kit.accent,
  );
  expect((await blockOf(page, "exec-section")).block.style.accent).toBe(
    kit.ink,
  );
  const trend = (await blockOf(page, "exec-volume-trend")).block.chart;
  expect(trend.colors[0]).toBe("#123456");
  expect(trend.colors[1]).toBe(kit.palette[1]);
  expect((await blockOf(page, "exec-otif")).block.style.accent).toBe("#b42318");
  const table = (await blockOf(page, "exec-facility-table")).block.table;
  expect(table.headerBackgroundColor).toBe(kit.soft);
  await expect(
    page.locator('[data-block-id="exec-cases"] .kpi-block__icon'),
  ).toHaveCSS("color", "rgb(138, 36, 57)");
  await expect(page.locator(".dashboard-page-band")).toHaveCSS(
    "background-image",
    /rgb\(59, 15, 29\)/,
  );
});

test("new cards are drawn in the dashboard's kit and the agent can switch kits", async ({
  page,
}) => {
  const result = await runTool<{ kit: string; accent: string }>(
    page,
    "set_dashboard_kit",
    { kit: "burnt-orange" },
  );
  expect(result.kit).toBe("burnt-orange");
  expect(result.accent).toBe(KITS["burnt-orange"].accent);
  await page.locator(".block-library").getByLabel("Add KPI").click();
  const added = await page
    .locator(".canvas-block")
    .last()
    .getAttribute("data-block-id");
  await expect
    .poll(async () => {
      try {
        return (await blockOf(page, added!)).block.style.accent;
      } catch {
        return undefined;
      }
    })
    .toBe(KITS["burnt-orange"].accent);
  await page.getByRole("tab", { name: "Kit", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: /Burnt orange/ }),
  ).toHaveAttribute("aria-checked", "true");
});
