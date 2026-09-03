import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __tesseraPerformanceTools: Record<
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
    window.__tesseraPerformanceTools = {};
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: {
          name: string;
          execute: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          window.__tesseraPerformanceTools[tool.name] = tool;
        },
      },
    });
  });
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() => Object.keys(window.__tesseraPerformanceTools).length),
    )
    .toBe(64);
  await expect(page.locator(".topbar__save")).toContainText("Saved");
});

test("every agent-facing WebMCP operation executes and persists under ten seconds", async ({
  page,
}) => {
  const benchmark = await page.evaluate(async () => {
    const tools = window.__tesseraPerformanceTools;
    const measurements: Array<{ name: string; ms: number }> = [];
    const run = async <T = Record<string, unknown>>(
      name: string,
      args: Record<string, unknown> = {},
    ) => {
      const started = performance.now();
      const result = (await tools[name].execute(args)) as T;
      measurements.push({
        name,
        ms: Number((performance.now() - started).toFixed(2)),
      });
      return result;
    };

    await run("get_project_context");
    await run("build_dashboard_fast", {
      operations: [
        {
          toolName: "create_dashboard",
          arguments: { name: "Fast performance dashboard" },
        },
        {
          toolName: "add_text",
          arguments: { body: "Built in one WebMCP round trip" },
        },
      ],
    });
    const createdProject = await run<{ id: string }>("create_project", {
      name: "Performance sandbox",
    });
    await run("activate_project", { projectId: "northstar-supply-chain" });
    await run("rename_project", { name: "Northstar performance" });
    const createdDashboard = await run<{ id: string }>("create_dashboard", {
      name: "Performance dashboard",
    });
    const dashboardId = createdDashboard.id;
    await run("activate_dashboard", { dashboardId: "northstar-executive" });
    await run("update_dashboard", {
      dashboardId,
      name: "Full operation sweep",
      description: "Isolated persisted WebMCP performance benchmark",
    });
    await run("set_dashboard_kit", { dashboardId, kit: "maroon" });
    await run("inspect_dashboard", { dashboardId });
    await run("get_tile_placeholders", { dashboardId });

    const placeholder = await run<{ id: string }>("add_tile_placeholder", {
      dashboardId,
      type: "text",
      intent: "Performance placeholder",
      mode: "manual",
      width: 4,
    });
    await run("update_tile_placeholder", {
      blockId: placeholder.id,
      intent: "Prepared performance placeholder",
      mode: "manual",
    });
    await run("update_block", {
      dashboardId,
      blockId: placeholder.id,
      patch: { body: "Ready" },
    });
    await run("complete_tile_placeholder", { blockId: placeholder.id });

    await run("add_section_header", {
      dashboardId,
      title: "Performance section",
    });
    await run("add_heading", { dashboardId, title: "Performance heading" });
    const textBlock = await run<{ id: string }>("add_text", {
      dashboardId,
      body: "Performance narrative",
    });
    await run("add_illustration_card", {
      dashboardId,
      title: "People at desks",
      altText: "Two colleagues working at desks.",
      preset: "people-at-desks",
      primaryColor: "#123456",
    });

    const width = 144;
    const height = 96;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgba(0,0,0,0.9)";
    context.fillRect(40, 26, 64, 44);
    const maskPng = canvas.toDataURL("image/png").split(",")[1];
    await run("add_generated_illustration_card", {
      dashboardId,
      title: "Generated performance scene",
      altText: "A generated editorial collaboration scene.",
      styleContract: "tessera-editorial-v1",
      maskEncoding: "alpha-png-base64-v1",
      maskWidth: width,
      maskHeight: height,
      maskPng,
      primaryColor: "#234567",
    });
    const library = await run<Array<{ id: string }>>(
      "list_generated_illustrations",
    );
    await run("add_saved_illustration_card", {
      dashboardId,
      assetId: library[0].id,
      primaryColor: "#345678",
    });

    await run("add_kpi", {
      dashboardId,
      title: "Cases shipped",
      datasetId: "northstar-network-monthly",
      period: "latest",
      valueField: "Cases shipped",
    });
    const table = await run<{ id: string }>("add_table", {
      dashboardId,
      title: "Facility table",
      datasetId: "northstar-distribution-centers",
      period: "latest",
    });
    const bar = await run<{ id: string }>("add_bar_chart", {
      dashboardId,
      title: "Cases by center",
      datasetId: "northstar-distribution-centers",
      period: "latest",
      categoryField: "Distribution center",
      valueField: "Cases shipped",
    });
    await run("add_horizontal_bar_chart", {
      dashboardId,
      title: "Cases ranking",
      datasetId: "northstar-distribution-centers",
      period: "latest",
      categoryField: "Distribution center",
      valueField: "Cases shipped",
    });
    await run("add_grouped_bar_chart", {
      dashboardId,
      title: "Service by center",
      datasetId: "northstar-distribution-centers",
      period: "latest",
      categoryField: "Distribution center",
      valueFields: ["Fill rate", "OTIF"],
    });
    const line = await run<{ id: string }>("add_line_chart", {
      dashboardId,
      title: "Volume trend",
      datasetId: "northstar-network-monthly",
      period: "all",
      categoryField: "Period",
      valueFields: ["Cases shipped", "Cases ordered"],
    });
    await run("style_line_chart_element", {
      dashboardId,
      blockId: line.id,
      series: "Cases shipped",
      color: "#456789",
      lineWidth: 3,
    });
    const donut = await run<{ id: string }>("add_donut_chart", {
      dashboardId,
      title: "Risk mix",
      datasetId: "northstar-suppliers",
      period: "latest",
      categoryField: "Category",
      valueField: "At-risk spend",
    });
    await run("style_donut_slice", {
      dashboardId,
      blockId: donut.id,
      category: "Produce",
      color: "#456789",
    });
    const gauge = await run<{ id: string }>("add_gauge_chart", {
      dashboardId,
      title: "Shipment progress",
      datasetId: "northstar-network-monthly",
      period: "latest",
      valueField: "Cases shipped",
      targetValue: 9_000_000,
      minY: 0,
      maxY: 10_000_000,
    });
    await run("style_gauge_element", {
      dashboardId,
      blockId: gauge.id,
      element: "value",
      color: "#456789",
    });
    const scatter = await run<{ id: string }>("add_scatter_chart", {
      dashboardId,
      title: "Service relationship",
      datasetId: "northstar-distribution-centers",
      period: "latest",
      categoryField: "Cases shipped",
      valueField: "OTIF",
      labelField: "Distribution center",
      seriesField: "Region",
    });
    await run("style_scatter_point", {
      dashboardId,
      blockId: scatter.id,
      pointLabel: "Allentown",
      color: "#456789",
      size: 7,
    });
    const treemap = await run<{ id: string }>("add_treemap_chart", {
      dashboardId,
      title: "Risk treemap",
      datasetId: "northstar-suppliers",
      period: "latest",
      categoryField: "Category",
      valueField: "At-risk spend",
    });
    await run("style_treemap_tile", {
      dashboardId,
      blockId: treemap.id,
      category: "Produce",
      color: "#456789",
      textColor: "#ffffff",
    });
    const heatmap = await run<{ id: string }>("add_heatmap_chart", {
      dashboardId,
      title: "Service heatmap",
      datasetId: "northstar-distribution-centers",
      period: "latest",
      categoryField: "Distribution center",
      valueFields: ["Fill rate", "OTIF"],
    });
    await run("style_heatmap_cell", {
      dashboardId,
      blockId: heatmap.id,
      rowLabel: "Allentown",
      column: "OTIF",
      color: "#456789",
    });
    const sankey = await run<{ id: string }>("add_sankey_chart", {
      dashboardId,
      title: "Network flow",
      datasetId: "northstar-flow-network",
      period: "latest",
      categoryField: "Source",
      targetField: "Target",
      valueField: "Cases routed",
    });
    await run("style_sankey_element", {
      dashboardId,
      blockId: sankey.id,
      element: "link",
      source: "Green Valley Farms",
      target: "Warehouse A",
      color: "#456789",
      opacity: 0.7,
    });
    await run("style_bar", {
      dashboardId,
      blockId: bar.id,
      category: "Allentown",
      color: "#456789",
    });
    await run("style_table_column", {
      dashboardId,
      blockId: table.id,
      column: "OTIF",
      label: "OTIF rate",
      width: 120,
    });
    await run("style_table_cell", {
      dashboardId,
      blockId: table.id,
      column: "OTIF",
      rowIndex: 1,
      backgroundColor: "#eef4ff",
    });
    await run("set_table_sort", {
      dashboardId,
      blockId: table.id,
      rules: [{ column: "OTIF", direction: "descending" }],
    });
    await run("style_table_group", {
      dashboardId,
      blockId: table.id,
      column: "Region",
      value: "Southeast",
      backgroundColor: "#f2f6fb",
      textColor: "#234567",
    });

    const duplicate = await run<{ id: string }>("duplicate_block", {
      dashboardId,
      blockId: textBlock.id,
    });
    await run("move_block", {
      dashboardId,
      blockId: duplicate.id,
      index: 0,
    });
    await run("set_dashboard_layout", {
      dashboardId,
      placements: [{ blockId: textBlock.id, width: 6, minHeight: 190 }],
    });
    await run("remove_block", {
      dashboardId,
      blockId: duplicate.id,
    });

    // Warehouse: a new dataset goes from upload to an approved-ready draft,
    // and an existing dataset is built into a dashboard with a monthly edition.
    const dataset = await run<{ id: string }>("create_dataset", {
      name: "Performance dataset",
      description: "One row per site per month",
    });
    const sheetRows = [
      ["Site", "Cases"],
      ["A", 10],
      ["B", 20],
    ];
    await run("save_dataset_month_upload", {
      datasetId: dataset.id,
      period: "2026-10",
      sourceName: "perf.csv",
      original: { columns: ["Site", "Cases"], rows: sheetRows.slice(1) },
      workbook: {
        fileName: "perf.csv",
        sheets: [
          {
            name: "Sheet1",
            rowCount: 3,
            columnCount: 2,
            rows: sheetRows,
            regions: [],
          },
        ],
      },
    });
    await run("start_dataset_month_processing", {
      datasetId: dataset.id,
      period: "2026-10",
    });
    await run("inspect_dataset_month_source", {
      datasetId: dataset.id,
      period: "2026-10",
    });
    await run("propose_dataset_month_outline", {
      datasetId: dataset.id,
      period: "2026-10",
      regions: [
        {
          sheet: "Sheet1",
          name: "Performance table",
          kind: "table",
          confidence: 1,
          canonicalName: "Performance dataset",
          range: { startRow: 1, startColumn: 1, endRow: 3, endColumn: 2 },
        },
      ],
      variableMappings: [
        { source: "Site", canonical: "Site", confidence: 1 },
        { source: "Cases", canonical: "Cases", confidence: 1 },
      ],
    });
    await run("create_dataset_month_cleaning_draft", {
      datasetId: dataset.id,
      period: "2026-10",
    });
    await run("update_cleaned_table", {
      datasetId: dataset.id,
      period: "2026-10",
      table: {
        columns: ["Site", "Cases"],
        rows: [
          ["A", 11],
          ["B", 20],
        ],
      },
    });
    await run("analyze_table", {
      table: { columns: ["Site", "Cases"], rows: [["A", 11]] },
    });
    await run("analyze_dataset", { datasetId: "northstar-network-monthly" });
    await run("get_monthly_refresh_status", { period: "2026-10" });
    await run("update_dataset_recipe", {
      datasetId: dataset.id,
      name: "Performance recipe",
      headerMap: { Site: "Site", Cases: "Cases" },
      notes: ["Benchmark recipe"],
    });
    await run("clean_dataset_month", {
      datasetId: "northstar-distribution-centers",
      period: "2026-09",
      useRecipe: true,
    });
    const built = await run<{ id: string }>("build_dashboard_from_dataset", {
      datasetId: "northstar-network-monthly",
      name: "Performance executive brief",
    });
    await run("create_monthly_dashboard_edition", {
      sourceDashboardId: built.id,
      period: "2026-08",
    });

    return {
      createdProjectId: createdProject.id,
      dashboardId,
      persistedBlockId: textBlock.id,
      registeredNames: Object.keys(tools).sort(),
      measurements,
      totalMs: Number(
        measurements
          .reduce((sum, measurement) => sum + measurement.ms, 0)
          .toFixed(2),
      ),
    };
  });

  expect(benchmark.registeredNames).toHaveLength(64);
  expect(benchmark.measurements).toHaveLength(64);
  expect(benchmark.measurements.map(({ name }) => name).sort()).toEqual(
    benchmark.registeredNames,
  );
  const slowest = benchmark.measurements.reduce((a, b) =>
    a.ms > b.ms ? a : b,
  );
  expect(slowest.ms).toBeLessThan(10_000);
  expect(benchmark.totalMs).toBeLessThan(15_000);

  const envelope = (await (await page.request.get("/api/state")).json()) as {
    revision: number;
    state: {
      projects: Array<{
        id: string;
        dashboards: Array<{
          id: string;
          blocks: Array<{ id: string }>;
        }>;
      }>;
    };
  };
  const persisted = envelope.state.projects
    .find((project) => project.id === "northstar-supply-chain")
    ?.dashboards.find((dashboard) => dashboard.id === benchmark.dashboardId)
    ?.blocks.some((block) => block.id === benchmark.persistedBlockId);
  expect(persisted).toBe(true);
  console.log(
    `WEBMCP_PERF_RESULT ${JSON.stringify({
      count: benchmark.measurements.length,
      totalMs: benchmark.totalMs,
      slowest,
      revision: envelope.revision,
    })}`,
  );
});
