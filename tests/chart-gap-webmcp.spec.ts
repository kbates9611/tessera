import { expect, test } from "@playwright/test";

test("donut and treemap contracts support exact element edits", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const tools: Record<string, unknown> = {};
    Object.defineProperty(window, "__tesseraGapTools", {
      configurable: true,
      value: tools,
    });
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: { name: string }) {
          tools[tool.name] = tool;
        },
      },
    });
  });
  const reset = await page.request.post("/api/test/reset");
  expect(reset.ok()).toBe(true);
  await page.goto("/");

  const contracts = await page.evaluate(() => {
    const tools = (
      window as unknown as {
        __tesseraGapTools: Record<
          string,
          {
            inputSchema: {
              required: string[];
              properties: Record<string, unknown>;
            };
            annotations: Record<string, boolean>;
          }
        >;
      }
    ).__tesseraGapTools;
    return {
      donut: tools.add_donut_chart,
      donutStyle: tools.style_donut_slice,
      treemap: tools.add_treemap_chart,
      treemapStyle: tools.style_treemap_tile,
      hasRouteAddTool: "add_route_map_chart" in tools,
      hasRouteStyleTool: "style_route_map_element" in tools,
      sankeyStyle: tools.style_sankey_element,
      tableStyle: tools.style_table_cell,
    };
  });
  expect(contracts.donut.inputSchema.required).toEqual([
    "title",
    "datasetId",
    "categoryField",
    "valueField",
  ]);
  expect(contracts.treemap.inputSchema.required).toEqual([
    "title",
    "datasetId",
    "categoryField",
    "valueField",
  ]);
  expect(contracts.hasRouteAddTool).toBe(false);
  expect(contracts.hasRouteStyleTool).toBe(false);
  expect(contracts.donut.inputSchema.properties).not.toHaveProperty(
    "showXAxis",
  );
  expect(contracts.treemap.inputSchema.properties).not.toHaveProperty(
    "lineWidth",
  );
  [
    contracts.donutStyle,
    contracts.treemapStyle,
    contracts.sankeyStyle,
    contracts.tableStyle,
  ].forEach((tool) =>
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      untrustedContentHint: true,
    }),
  );

  await page.evaluate(async () => {
    const tools = (
      window as unknown as {
        __tesseraGapTools: Record<
          string,
          { execute: (args: Record<string, unknown>) => Promise<unknown> }
        >;
      }
    ).__tesseraGapTools;
    await tools.style_donut_slice.execute({
      blockId: "exec-risk-mix",
      category: "Produce",
      color: "#d83b9d",
    });
  });
  await expect(
    page.locator(
      '[data-block-id="exec-risk-mix"] circle[data-category="Produce"]',
    ),
  ).toHaveAttribute("stroke", "#d83b9d");

  await page
    .getByLabel("Current dashboard")
    .selectOption({ label: "Supplier Risk" });
  await page.evaluate(async () => {
    const tools = (
      window as unknown as {
        __tesseraGapTools: Record<
          string,
          { execute: (args: Record<string, unknown>) => Promise<unknown> }
        >;
      }
    ).__tesseraGapTools;
    await tools.style_treemap_tile.execute({
      blockId: "supplier-category-chart",
      category: "Produce",
      color: "#43a657",
      textColor: "#ffffff",
    });
  });
  await expect(
    page.locator(
      '[data-block-id="supplier-category-chart"] rect[data-category="Produce"]',
    ),
  ).toHaveAttribute("fill", "#43a657");

  await expect(
    page.locator(".block-library").getByText("Route map", { exact: true }),
  ).toHaveCount(0);
});
