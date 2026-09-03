import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __tesseraTools: Record<
      string,
      {
        execute: (args: Record<string, unknown>) => Promise<unknown>;
        inputSchema: Record<string, unknown>;
      }
    >;
  }
}

test("WebMCP can make narrow table column and exact-cell edits", async ({
  page,
}) => {
  const reset = await page.request.post("/api/test/reset");
  expect(reset.ok()).toBe(true);
  await page.addInitScript(() => {
    window.__tesseraTools = {};
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: {
          name: string;
          execute: (args: Record<string, unknown>) => Promise<unknown>;
          inputSchema: Record<string, unknown>;
        }) {
          window.__tesseraTools[tool.name] = tool;
        },
      },
    });
  });
  await page.goto("/");
  await page
    .getByLabel("Current dashboard")
    .selectOption({ label: "Supplier Risk" });

  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          window.__tesseraTools.style_table_column &&
          window.__tesseraTools.style_table_cell,
        ),
      ),
    )
    .toBe(true);

  const contracts = await page.evaluate(() => ({
    addTable: Object.keys(
      (window.__tesseraTools.add_table.inputSchema.properties ?? {}) as Record<
        string,
        unknown
      >,
    ),
    styleColumn: Object.keys(
      (window.__tesseraTools.style_table_column.inputSchema.properties ??
        {}) as Record<string, unknown>,
    ),
    styleCell: Object.keys(
      (window.__tesseraTools.style_table_cell.inputSchema.properties ??
        {}) as Record<string, unknown>,
    ),
  }));
  expect(contracts.addTable).toEqual(
    expect.arrayContaining([
      "sortColumn",
      "sortDirection",
      "totalColumns",
      "decimalPlaces",
      "freezeFirstColumn",
      "columnStyles",
      "cellStyles",
    ]),
  );
  expect(contracts.styleColumn).toEqual(
    expect.arrayContaining([
      "column",
      "label",
      "width",
      "numberFormat",
      "headerBackgroundColor",
    ]),
  );
  expect(contracts.styleCell).toEqual(
    expect.arrayContaining([
      "column",
      "rowIndex",
      "matchColumn",
      "matchValue",
      "backgroundColor",
      "textColor",
    ]),
  );

  await page.evaluate(async () => {
    await window.__tesseraTools.style_table_column.execute({
      blockId: "supplier-table",
      column: "At-risk spend",
      label: "Spend at risk",
      width: 180,
    });
    await window.__tesseraTools.style_table_column.execute({
      blockId: "supplier-table",
      column: "At-risk spend",
      headerBackgroundColor: "#b7c9e2",
    });
    await window.__tesseraTools.style_table_cell.execute({
      blockId: "supplier-table",
      column: "At-risk spend",
      matchColumn: "Supplier",
      matchValue: "Green Valley Farms",
      backgroundColor: "#fff2cc",
    });
    await window.__tesseraTools.style_table_cell.execute({
      blockId: "supplier-table",
      column: "At-risk spend",
      matchColumn: "Supplier",
      matchValue: "Green Valley Farms",
      textColor: "#7f6000",
      fontWeight: "bold",
    });
  });

  const table = page.locator('[data-block-id="supplier-table"]');
  const header = table.locator('th[data-column="At-risk spend"]');
  await expect(header).toHaveText("Spend at risk");
  await expect(header).toHaveCSS("width", "180px");
  await expect(header).toHaveCSS("background-color", "rgb(183, 201, 226)");

  const targetCell = table.locator(
    'td[data-column="At-risk spend"][data-source-row-index="1"]',
  );
  await expect(targetCell).toHaveCSS("background-color", "rgb(255, 242, 204)");
  await expect(targetCell).toHaveCSS("color", "rgb(127, 96, 0)");
  await expect(targetCell).toHaveCSS("font-weight", "700");

  const config = await page.evaluate(async () => {
    const dashboard = (await window.__tesseraTools.inspect_dashboard.execute(
      {},
    )) as {
      blocks: Array<{
        id: string;
        table: {
          columnStyles: Array<Record<string, unknown>>;
          cellStyles: Array<Record<string, unknown>>;
        };
      }>;
    };
    return dashboard.blocks.find((block) => block.id === "supplier-table")!
      .table;
  });
  expect(config.columnStyles).toEqual([
    expect.objectContaining({
      column: "At-risk spend",
      label: "Spend at risk",
      width: 180,
      headerBackgroundColor: "#b7c9e2",
    }),
  ]);
  expect(config.cellStyles).toEqual([
    expect.objectContaining({
      column: "At-risk spend",
      matchColumn: "Supplier",
      matchValue: "Green Valley Farms",
      backgroundColor: "#fff2cc",
      textColor: "#7f6000",
      fontWeight: "bold",
    }),
  ]);
});

test("tables support toggleable search, tiered sorting, and group colors", async ({
  page,
}) => {
  const reset = await page.request.post("/api/test/reset");
  expect(reset.ok()).toBe(true);
  await page.addInitScript(() => {
    window.__tesseraTools = {};
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: {
          name: string;
          execute: (args: Record<string, unknown>) => Promise<unknown>;
          inputSchema: Record<string, unknown>;
        }) {
          window.__tesseraTools[tool.name] = tool;
        },
      },
    });
  });
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          window.__tesseraTools.set_table_sort &&
          window.__tesseraTools.style_table_group,
        ),
      ),
    )
    .toBe(true);

  const contract = await page.evaluate(() => ({
    addTable: Object.keys(
      (window.__tesseraTools.add_table.inputSchema.properties ?? {}) as Record<
        string,
        unknown
      >,
    ),
    sort: Object.keys(
      (window.__tesseraTools.set_table_sort.inputSchema.properties ??
        {}) as Record<string, unknown>,
    ),
    group: Object.keys(
      (window.__tesseraTools.style_table_group.inputSchema.properties ??
        {}) as Record<string, unknown>,
    ),
  }));
  expect(contract.addTable).toEqual(
    expect.arrayContaining([
      "showSearch",
      "sortRules",
      "colorByColumn",
      "groupPalette",
      "groupColors",
    ]),
  );
  expect(contract.sort).toEqual(expect.arrayContaining(["blockId", "rules"]));
  expect(contract.group).toEqual(
    expect.arrayContaining([
      "blockId",
      "column",
      "value",
      "backgroundColor",
      "textColor",
    ]),
  );

  await page.evaluate(async () => {
    await window.__tesseraTools.set_table_sort.execute({
      blockId: "exec-facility-table",
      rules: [
        { column: "Region", direction: "ascending" },
        { column: "Inventory days", direction: "descending" },
      ],
    });
    await window.__tesseraTools.style_table_group.execute({
      blockId: "exec-facility-table",
      column: "Region",
      value: "Southeast",
      backgroundColor: "#fff2cc",
      textColor: "#7f6000",
    });
  });

  const table = page.locator('[data-block-id="exec-facility-table"]');
  await expect(
    table.locator('td[data-column="Distribution center"]'),
  ).toHaveText([
    "Chicago",
    "Denver",
    "Allentown",
    "Seattle",
    "Dallas",
    "Atlanta",
    "Orlando",
    "Phoenix",
    "Fresno",
  ]);
  const southeastRows = table.locator('tbody tr[data-group-value="Southeast"]');
  await expect(southeastRows).toHaveCount(2);
  for (const row of await southeastRows.all()) {
    await expect(row).toHaveCSS("background-color", "rgb(255, 242, 204)");
  }

  const searchInput = table.getByRole("searchbox");
  await expect(searchInput).toHaveCount(0);
  await table
    .getByRole("button", {
      name: "Open search for August distribution-center detail",
    })
    .click();
  await expect(searchInput).toBeVisible();
  await searchInput.fill("Atlanta");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await table
    .getByRole("button", {
      name: "Close search for August distribution-center detail",
    })
    .click();
  await expect(searchInput).toHaveCount(0);
  await expect(table.locator("tbody tr")).toHaveCount(9);

  await table.click();
  await expect(page.getByText("Sort priority", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Sort level 1 column")).toHaveValue("Region");
  await expect(page.getByLabel("Sort level 2 column")).toHaveValue(
    "Inventory days",
  );
  await expect(page.getByLabel("Color rows by group")).toHaveValue("Region");
  await expect(page.getByText("Enable search", { exact: true })).toBeVisible();
});
