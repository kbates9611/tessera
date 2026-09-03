import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __tesseraFastTools: Record<
      string,
      {
        execute: (args: Record<string, unknown>) => Promise<unknown>;
      }
    >;
  }
}

test.beforeEach(async ({ page }) => {
  const reset = await page.request.post("/api/test/reset");
  expect(reset.ok()).toBe(true);
  await page.addInitScript(() => {
    window.__tesseraFastTools = {};
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        codexGetTools() {},
        registerTool(tool: {
          name: string;
          execute: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          window.__tesseraFastTools[tool.name] = tool;
        },
      },
    });
  });
  await page.goto("/");
});

test("native WebMCP exposes a lightweight gateway with mutation snapshots", async ({
  page,
}) => {
  await expect
    .poll(() =>
      page.evaluate(() => Object.keys(window.__tesseraFastTools).sort()),
    )
    .toContain("run_tessera_tool");

  const names = await page.evaluate(() =>
    Object.keys(window.__tesseraFastTools).sort(),
  );
  expect(names).toEqual([
    "add_generated_illustration_card",
    "build_dashboard_fast",
    "get_project_context",
    "get_tessera_tool_schema",
    "inspect_dashboard",
    "list_tessera_tools",
    "run_tessera_tool",
  ]);
  expect(names).not.toContain("style_bar");

  const result = await page.evaluate(async () => {
    const added = (await window.__tesseraFastTools.run_tessera_tool.execute({
      toolName: "add_tile_placeholder",
      arguments: { type: "kpi", intent: "Fast-path test" },
    })) as {
      result: { id: string };
      dashboard: { blocks: Array<{ id: string }> };
    };
    const removed = (await window.__tesseraFastTools.run_tessera_tool.execute({
      toolName: "remove_block",
      arguments: { blockId: added.result.id },
    })) as {
      result: { removed: boolean };
      dashboard: { blocks: Array<{ id: string }> };
    };
    return {
      id: added.result.id,
      presentAfterAdd: added.dashboard.blocks.some(
        (block) => block.id === added.result.id,
      ),
      removed: removed.result.removed,
      presentAfterRemove: removed.dashboard.blocks.some(
        (block) => block.id === added.result.id,
      ),
    };
  });

  expect(result.presentAfterAdd).toBe(true);
  expect(result.removed).toBe(true);
  expect(result.presentAfterRemove).toBe(false);
});

test("dashboard creation is idempotent and tool-added cards snap into rows", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const gateway = window.__tesseraFastTools.run_tessera_tool;
    const run = async (toolName: string, arguments_: Record<string, unknown>) =>
      gateway.execute({ toolName, arguments: arguments_ }) as Promise<{
        result: { id: string; layout?: { width: number } };
      }>;
    const first = await run("create_dashboard", {
      name: "Snap Test",
      description: "First create",
    });
    const second = await run("create_dashboard", {
      name: "  snap test  ",
      description: "Retry with the same normalized name",
    });
    const dashboardId = first.result.id;
    await run("add_section_header", {
      dashboardId,
      title: "Full-width section",
    });
    const line = await run("add_line_chart", {
      dashboardId,
      title: "Service trend",
      datasetId: "northstar-network-monthly",
      period: "all",
      categoryField: "Period",
      valueFields: ["Cases shipped", "Cases ordered"],
      width: 8,
    });
    const commentary = await run("add_text", {
      dashboardId,
      body: "Commentary beside the chart.",
      width: 4,
    });
    await run("add_section_header", {
      dashboardId,
      title: "KPI section",
    });
    const kpiArguments = (title: string, valueField: string) => ({
      dashboardId,
      title,
      datasetId: "northstar-network-monthly",
      period: "latest",
      valueField,
      width: 4,
    });
    const kpi1 = await run(
      "add_kpi",
      kpiArguments("Cases shipped", "Cases shipped"),
    );
    const kpi2 = await run("add_kpi", kpiArguments("Fill rate", "Fill rate"));
    const kpi3 = await run("add_kpi", kpiArguments("OTIF", "OTIF"));
    const dashboard =
      (await window.__tesseraFastTools.inspect_dashboard.execute({
        dashboardId,
      })) as {
        blocks: Array<{ id: string; layout: { width: number } }>;
      };
    const project =
      (await window.__tesseraFastTools.get_project_context.execute({})) as {
        dashboards: Array<{ id: string; name: string }>;
      };
    const width = (id: string) =>
      dashboard.blocks.find((block) => block.id === id)?.layout.width;
    return {
      firstId: first.result.id,
      secondId: second.result.id,
      matchingDashboards: project.dashboards.filter(
        (dashboard) => dashboard.name.toLocaleLowerCase() === "snap test",
      ).length,
      widths: {
        lineInitial: line.result.layout?.width,
        line: width(line.result.id),
        commentary: width(commentary.result.id),
        kpiInitial: kpi1.result.layout?.width,
        kpi1: width(kpi1.result.id),
        kpi2: width(kpi2.result.id),
        kpi3: width(kpi3.result.id),
      },
    };
  });

  expect(result.firstId).toBe(result.secondId);
  expect(result.matchingDashboards).toBe(1);
  expect(result.widths).toEqual({
    lineInitial: 12,
    line: 8,
    commentary: 4,
    kpiInitial: 12,
    kpi1: 4,
    kpi2: 4,
    kpi3: 4,
  });
});
