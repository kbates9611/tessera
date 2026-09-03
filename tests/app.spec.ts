import { expect, test, type Locator, type Page } from "@playwright/test";

const dashboardNames = ["Executive Summary", "Supplier Risk", "Inventory"];
const dashboardBlockCounts = {
  "Executive Summary": 16,
  "Supplier Risk": 15,
  Inventory: 18,
} as const;
const datasets = [
  {
    name: "Network Summary",
    months: ["August 2026", "September 2026"],
  },
  {
    name: "Distribution Centers",
    months: ["August 2026", "September 2026"],
  },
  {
    name: "Supplier Scorecard",
    months: ["August 2026", "September 2026"],
  },
  {
    name: "Northstar Flow Network",
    months: ["August 2026", "September 2026"],
  },
  {
    name: "Produce Quality Inspections",
    months: ["August 2026", "September 2026"],
  },
] as const;

async function expectWhiteDashboardBlocks(page: Page, expectedCount: number) {
  const visibleBlocks = page.locator(".canvas-block:visible");
  await expect(visibleBlocks).toHaveCount(expectedCount);
  await expect
    .poll(() =>
      visibleBlocks.evaluateAll((blocks) =>
        blocks.map((block) => getComputedStyle(block).backgroundColor),
      ),
    )
    .toEqual(Array(expectedCount).fill("rgb(255, 255, 255)"));
}

type RenderedPaint = {
  blockId: string;
  color: string;
  property: "fill" | "stroke" | "stop-color" | "background-color";
};

function cssColorProfile(color: string) {
  const values = color.match(/[\d.]+/g)?.map(Number);
  if (!values || values.length < 3) return undefined;
  const [red, green, blue, alpha = 1] = values;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const chroma = max - min;
  let hue = 0;
  if (chroma) {
    if (max === red) hue = ((green - blue) / chroma) % 6;
    else if (max === green) hue = (blue - red) / chroma + 2;
    else hue = (red - green) / chroma + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return { alpha, chroma, hue };
}

function isApprovedBlueOrNeutral(color: string) {
  const profile = cssColorProfile(color);
  if (!profile || profile.alpha === 0) return true;
  return profile.chroma <= 24 || (profile.hue >= 195 && profile.hue <= 230);
}

async function renderedChartPaints(root: Locator): Promise<RenderedPaint[]> {
  return root.locator("[data-chart-type] svg").evaluateAll((charts) => {
    const paints: RenderedPaint[] = [];
    for (const chart of charts) {
      const blockId =
        chart.closest<HTMLElement>(".canvas-block")?.dataset.blockId ??
        "unknown";
      for (const mark of chart.querySelectorAll(
        "path, rect, circle, line, polyline, polygon",
      )) {
        const style = getComputedStyle(mark);
        for (const [property, color] of [
          ["fill", style.fill],
          ["stroke", style.stroke],
        ] as const) {
          if (/^rgba?\(/.test(color)) {
            paints.push({ blockId, color, property });
          }
        }
      }
      for (const stop of chart.querySelectorAll("stop")) {
        const color = getComputedStyle(stop).stopColor;
        if (/^rgba?\(/.test(color)) {
          paints.push({ blockId, color, property: "stop-color" });
        }
      }
    }
    return paints.filter(
      (paint, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.blockId === paint.blockId &&
            candidate.property === paint.property &&
            candidate.color === paint.color,
        ) === index,
    );
  });
}

async function renderedTableHeatmapPaints(
  root: Locator,
): Promise<RenderedPaint[]> {
  return root
    .locator('.canvas-block[data-block-type="table"] td[style]')
    .evaluateAll((cells) =>
      cells.map((cell) => ({
        blockId:
          cell.closest<HTMLElement>(".canvas-block")?.dataset.blockId ??
          "unknown",
        color: getComputedStyle(cell).backgroundColor,
        property: "background-color" as const,
      })),
    );
}

async function expectApprovedDashboardPaints(
  page: Page,
  dashboardName: string,
  expectsHeatmapCells: boolean,
  colorfulBlockIds: string[] = [],
) {
  const dashboard = page.locator(".dashboard-grid");
  await expect(
    dashboard.locator("[data-chart-type] svg").first(),
  ).toBeVisible();
  const chartPaints = await renderedChartPaints(dashboard);
  expect(chartPaints.length).toBeGreaterThan(0);
  const restrictedChartPaints = chartPaints.filter(
    (paint) => !colorfulBlockIds.includes(paint.blockId),
  );
  expect(
    restrictedChartPaints.filter(
      (paint) => !isApprovedBlueOrNeutral(paint.color),
    ),
    `${dashboardName} non-flow chart marks must use only blue or neutral paints`,
  ).toEqual([]);

  const heatmapPaints = await renderedTableHeatmapPaints(dashboard);
  if (expectsHeatmapCells) expect(heatmapPaints.length).toBeGreaterThan(0);
  expect(
    heatmapPaints.filter((paint) => !isApprovedBlueOrNeutral(paint.color)),
    `${dashboardName} table heatmaps must use only blue or neutral paints`,
  ).toEqual([]);
}

test("primary app sections share a square inner seam", async ({ page }) => {
  const reset = await page.request.post("/api/test/reset");
  expect(reset.ok()).toBe(true);
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "Project sections" });
  const dashboards = nav.getByRole("button", {
    name: "Dashboards",
    exact: true,
  });
  const warehouse = nav.getByRole("button", {
    name: "Data Warehouse",
    exact: true,
  });
  await expect(nav).toHaveCSS("gap", "0px");
  await expect(dashboards).toHaveCSS("border-top-left-radius", "7px");
  await expect(dashboards).toHaveCSS("border-top-right-radius", "0px");
  await expect(dashboards).toHaveCSS("border-bottom-right-radius", "0px");
  await expect(dashboards).toHaveCSS("border-bottom-left-radius", "7px");
  await expect(warehouse).toHaveCSS("border-top-left-radius", "0px");
  await expect(warehouse).toHaveCSS("border-top-right-radius", "7px");
  await expect(warehouse).toHaveCSS("border-bottom-right-radius", "7px");
  await expect(warehouse).toHaveCSS("border-bottom-left-radius", "0px");
});

test("header project menu stays compact while settings use the polished picker", async ({
  page,
}) => {
  const reset = await page.request.post("/api/test/reset");
  expect(reset.ok()).toBe(true);
  await page.goto("/");

  const projectTrigger = page.getByRole("button", {
    name: "Dashboard group",
    exact: true,
  });
  await expect(projectTrigger).toBeVisible();
  await expect(projectTrigger).toContainText("Northstar Supply Chain");
  await expect(projectTrigger.locator("svg")).toHaveCount(1);
  expect(
    (await page.locator(".project-picker").boundingBox())?.width,
  ).toBeLessThanOrEqual(340);
  await projectTrigger.click();
  const projectMenu = page.getByRole("listbox", { name: "Dashboard groups" });
  await expect(projectMenu).toBeVisible();
  await expect(projectMenu).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(projectMenu).toHaveCSS("border-top-left-radius", "0px");
  await expect(projectMenu).toHaveCSS("border-top-right-radius", "0px");
  await expect(projectMenu).toHaveCSS("border-bottom-right-radius", "8px");
  const selectedProject = projectMenu.getByRole("option", {
    name: "Northstar Supply Chain",
  });
  await expect(selectedProject).toHaveAttribute("aria-selected", "true");
  expect((await selectedProject.boundingBox())?.height).toBeLessThanOrEqual(30);
  const pickerBox = await page.locator(".project-picker").boundingBox();
  const menuBox = await projectMenu.boundingBox();
  expect(
    Math.abs(
      (pickerBox?.y ?? 0) + (pickerBox?.height ?? 0) - (menuBox?.y ?? 0),
    ),
  ).toBeLessThanOrEqual(2);
  await page.keyboard.press("Escape");
  await expect(projectMenu).toBeHidden();

  await page.locator('[data-block-type="kpi"]').first().click();
  const settingsSelect = page
    .locator(".inspector select:not(.sr-only)")
    .first();
  await expect(settingsSelect).toBeVisible();
  await expect(settingsSelect).toHaveCSS("appearance", "base-select");
  await expect(settingsSelect).toHaveCSS("border-radius", "8px");
  await expect(settingsSelect).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(settingsSelect).toHaveCSS("padding-right", "10px");
  expect(
    Number.parseFloat(
      await settingsSelect.evaluate(
        (select) => getComputedStyle(select, "::picker-icon").marginLeft,
      ),
    ),
  ).toBeGreaterThan(80);
  expect(
    await settingsSelect.evaluate(
      (select) => getComputedStyle(select, "::picker-icon").translate,
    ),
  ).toBe("0px -1px");
  const numberFormat = page.getByLabel("Number format").first();
  await expect(numberFormat.locator('option[value="compact"]')).toHaveText(
    "Compact",
  );
  expect(
    await numberFormat.evaluate(
      (select) => select.scrollHeight <= select.clientHeight,
    ),
  ).toBe(true);
});

test("block settings stay compact, grouped, and complete across chart types", async ({
  page,
}) => {
  const reset = await page.request.post("/api/test/reset");
  expect(reset.ok()).toBe(true);
  await page.goto("/");

  for (const type of [
    "Bar",
    "Horizontal bar",
    "Grouped bar",
    "Line",
    "Donut",
    "Sankey",
    "Gauge",
    "Scatter",
    "Treemap",
    "Heatmap",
  ]) {
    await expect(
      page.getByRole("button", { name: `Add ${type}` }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("button", { name: "Add Tree", exact: true }),
  ).toHaveCount(0);

  await page.locator('[data-block-type="table"]').first().click();
  const tableInspector = page.locator('.inspector[data-settings-type="table"]');
  await expect(tableInspector).toBeVisible();
  const workspaceTabsBox = await tableInspector
    .locator(".inspector-workspace-tabs")
    .boundingBox();
  const settingsHeaderBox = await tableInspector
    .locator(".inspector__header")
    .boundingBox();
  expect(
    Math.abs(
      (workspaceTabsBox?.y ?? 0) +
        (workspaceTabsBox?.height ?? 0) -
        (settingsHeaderBox?.y ?? 0),
    ),
  ).toBeLessThanOrEqual(1);
  for (const group of [
    "Table structure",
    "Reader tools",
    "Summary rows",
    "Numeric emphasis",
  ]) {
    await expect(
      tableInspector.getByText(group, { exact: true }),
    ).toBeVisible();
  }
  expect(
    (await tableInspector.locator(".settings-group").first().boundingBox())
      ?.height,
  ).toBeLessThanOrEqual(155);

  await page.locator('[data-block-type="donut"]').first().click();
  const donutInspector = page.locator('.inspector[data-settings-type="donut"]');
  await expect(donutInspector).toBeVisible();
  await donutInspector
    .locator('.inspector-section[data-section="Color & emphasis"] > summary')
    .click();
  const paletteRows = donutInspector.locator(".palette-field");
  await expect(paletteRows.first()).toBeVisible();
  expect((await paletteRows.first().boundingBox())?.height).toBeLessThanOrEqual(
    40,
  );
  const exactSlice = donutInspector.locator("details.inspector-subgroup");
  await expect(
    exactSlice.getByText("Style one slice", { exact: true }),
  ).toBeVisible();
  await expect(exactSlice).not.toHaveAttribute("open", "");
});

test("WebMCP bar tools expose a precise contract and can recolor one bar", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const tools: Record<string, unknown> = {};
    Object.defineProperty(window, "__tesseraWebMCPTools", {
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

  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(
          (
            window as unknown as {
              __tesseraWebMCPTools: Record<string, unknown>;
            }
          ).__tesseraWebMCPTools,
        ),
      ),
    )
    .toContain("style_bar");

  const contract = await page.evaluate(() => {
    const tools = (
      window as unknown as {
        __tesseraWebMCPTools: Record<
          string,
          {
            description: string;
            annotations: Record<string, boolean>;
            inputSchema: {
              required: string[];
              properties: Record<string, { description?: string }>;
            };
          }
        >;
      }
    ).__tesseraWebMCPTools;
    return {
      add: tools.add_bar_chart,
      style: tools.style_bar,
    };
  });
  expect(contract.add.inputSchema.required).toEqual([
    "title",
    "datasetId",
    "categoryField",
    "valueField",
  ]);
  expect(
    contract.add.inputSchema.properties.barColorOverrides.description,
  ).toContain("one exact category label");
  expect(contract.style.description).toContain("without replacing");
  expect(contract.style.inputSchema.properties.category.description).toContain(
    "case-sensitively",
  );

  await page
    .getByLabel("Current dashboard")
    .selectOption({ label: "Inventory" });
  await expect(
    page.locator('[data-block-id="inventory-facility-chart"]'),
  ).toBeVisible();

  await page.evaluate(async () => {
    const tool = (
      window as unknown as {
        __tesseraWebMCPTools: Record<
          string,
          { execute: (args: Record<string, unknown>) => Promise<unknown> }
        >;
      }
    ).__tesseraWebMCPTools.style_bar;
    await tool.execute({
      blockId: "inventory-facility-chart",
      category: "Atlanta",
      color: "#d83b9d",
    });
  });

  const chart = page.locator('[data-block-id="inventory-facility-chart"]');
  await expect(chart.locator('rect[data-category="Atlanta"]')).toHaveCSS(
    "fill",
    "rgb(216, 59, 157)",
  );
  await expect(chart.locator('rect[data-category="Orlando"]')).not.toHaveCSS(
    "fill",
    "rgb(216, 59, 157)",
  );

  await page
    .getByLabel("Current dashboard")
    .selectOption({ label: "Supplier Risk" });
  const serviceChart = page.locator('[data-block-id="supplier-service-chart"]');
  const referenceLabel = serviceChart.locator(".chart-reference-label");
  await expect(referenceLabel).toHaveText(/Service threshold.*95%/);
  await expect(serviceChart.locator(".chart-reference-label-bg")).toHaveCount(
    1,
  );
  const referenceGeometry = await serviceChart.evaluate((root) => {
    const label = root.querySelector(".chart-reference-label");
    const background = root.querySelector(".chart-reference-label-bg");
    const guide = root.querySelector(".chart-reference");
    if (!label || !background || !guide)
      return { distance: Number.POSITIVE_INFINITY, labelBacked: false };
    const labelY = Number(label.getAttribute("y"));
    const surfaceY = Number(background.getAttribute("y"));
    const surfaceHeight = Number(background.getAttribute("height"));
    const lineY = Number(guide.getAttribute("y1"));
    return {
      distance: Math.min(
        Math.abs(surfaceY + surfaceHeight - lineY),
        Math.abs(surfaceY - lineY),
      ),
      labelBacked: labelY >= surfaceY && labelY <= surfaceY + surfaceHeight,
    };
  });
  expect(referenceGeometry.labelBacked).toBe(true);
  expect(referenceGeometry.distance).toBeLessThanOrEqual(4);
});

test("WebMCP gauge tools expose named elements and recolor only the target", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const tools: Record<string, unknown> = {};
    Object.defineProperty(window, "__tesseraWebMCPTools", {
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
  await page
    .getByLabel("Current dashboard")
    .selectOption({ label: "Inventory" });

  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(
          (
            window as unknown as {
              __tesseraWebMCPTools: Record<string, unknown>;
            }
          ).__tesseraWebMCPTools,
        ),
      ),
    )
    .toContain("style_gauge_element");

  const contract = await page.evaluate(() => {
    const tools = (
      window as unknown as {
        __tesseraWebMCPTools: Record<
          string,
          {
            description: string;
            annotations: Record<string, boolean>;
            inputSchema: {
              required: string[];
              properties: Record<string, { description?: string }>;
            };
          }
        >;
      }
    ).__tesseraWebMCPTools;
    return { add: tools.add_gauge_chart, style: tools.style_gauge_element };
  });
  expect(contract.add.inputSchema.required).toEqual([
    "title",
    "datasetId",
    "valueField",
  ]);
  expect(contract.add.inputSchema.properties.ranges.description).toContain(
    "stable id",
  );
  expect(contract.style.description).toContain("exactly one");
  expect(contract.style.annotations).toEqual({
    readOnlyHint: false,
    untrustedContentHint: true,
  });
  expect(contract.style.inputSchema.properties.element.description).toContain(
    "recolor",
  );

  const blockId = await page.evaluate(async () => {
    const tools = (
      window as unknown as {
        __tesseraWebMCPTools: Record<
          string,
          { execute: (args: Record<string, unknown>) => Promise<unknown> }
        >;
      }
    ).__tesseraWebMCPTools;
    const created = (await tools.add_gauge_chart.execute({
      title: "Inventory cover against plan",
      datasetId: "northstar-distribution-centers",
      valueField: "Inventory days",
      aggregation: "average",
      display: "dial",
      minY: 0,
      maxY: 35,
      targetValue: 21.5,
      trackColor: "#dbe6f3",
      valueColor: "#355f9d",
      targetColor: "#1c2b4a",
      needleColor: "#4d76b3",
      ranges: [
        { id: "healthy", label: "Healthy", from: 0, to: 22, color: "#7897c4" },
        { id: "high", label: "High", from: 22, to: 35, color: "#b7c9e2" },
      ],
    })) as { id: string };
    await tools.style_gauge_element.execute({
      blockId: created.id,
      element: "target",
      color: "#d83b9d",
    });
    return created.id;
  });

  const gauge = page.locator(`[data-block-id="${blockId}"] .gauge-chart`);
  await expect(gauge).toBeVisible();
  await expect(gauge.locator('[data-gauge-element="target"]')).toHaveCSS(
    "stroke",
    "rgb(216, 59, 157)",
  );
  await expect(gauge.locator('[data-gauge-element="track"]')).toHaveCSS(
    "stroke",
    "rgb(219, 230, 243)",
  );
  await expect(gauge.locator('[data-gauge-element="needle"] line')).toHaveCSS(
    "stroke",
    "rgb(77, 118, 179)",
  );
  await expect(gauge.locator('[data-gauge-element="range"]')).toHaveCount(2);
});

test("scatter labels stay readable and WebMCP can style exactly one point", async ({
  page,
}) => {
  const reset = await page.request.post("/api/test/reset");
  expect(reset.ok()).toBe(true);
  await page.addInitScript(() => {
    const tools: Record<string, unknown> = {};
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: { name: string }) {
          tools[tool.name] = tool;
        },
      },
    });
    (
      window as unknown as { __tesseraTools: Record<string, unknown> }
    ).__tesseraTools = tools;
  });
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Current dashboard" })
    .selectOption({ label: "Supplier Risk" });

  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(
          (window as unknown as { __tesseraTools: Record<string, unknown> })
            .__tesseraTools,
        ),
      ),
    )
    .toContain("style_scatter_point");

  const propertyDescription = await page.evaluate(() => {
    const tool = (
      window as unknown as {
        __tesseraTools: Record<
          string,
          {
            inputSchema: {
              properties: Record<string, { description?: string }>;
            };
          }
        >;
      }
    ).__tesseraTools.style_scatter_point;
    return tool.inputSchema.properties.pointLabel.description;
  });
  expect(propertyDescription).toContain("Exact point label");

  const point = page.locator(
    '[data-block-id="supplier-leadtime-chart"] .scatter-point[data-point-label="Green Valley Farms"]',
  );
  await expect(point).toBeVisible();
  const labelBoxes = await page
    .locator(
      '[data-block-id="supplier-leadtime-chart"] .scatter-point .chart-value',
    )
    .evaluateAll((labels) =>
      labels.map((label) => {
        const box = label.getBoundingClientRect();
        return {
          label: label.textContent,
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        };
      }),
    );
  expect(labelBoxes.length).toBeGreaterThan(3);
  for (let left = 0; left < labelBoxes.length; left += 1) {
    for (let right = left + 1; right < labelBoxes.length; right += 1) {
      const a = labelBoxes[left];
      const b = labelBoxes[right];
      const overlap =
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      expect(overlap, `${a.label} should not overlap ${b.label}`).toBe(0);
    }
  }
  const originalFill = await point.locator("circle").getAttribute("fill");

  await page.evaluate(async () => {
    const tool = (
      window as unknown as {
        __tesseraTools: Record<
          string,
          { execute: (args: Record<string, unknown>) => Promise<unknown> }
        >;
      }
    ).__tesseraTools.style_scatter_point;
    await tool.execute({
      blockId: "supplier-leadtime-chart",
      pointLabel: "Green Valley Farms",
      color: "#d94646",
    });
  });
  await expect(point.locator("circle")).toHaveAttribute("fill", "#d94646");
  await expect(
    page
      .locator(
        '[data-block-id="supplier-leadtime-chart"] .scatter-point:not([data-point-label="Green Valley Farms"]) circle',
      )
      .first(),
  ).toHaveAttribute("fill", originalFill!);

  await page.evaluate(async () => {
    const tool = (
      window as unknown as {
        __tesseraTools: Record<
          string,
          { execute: (args: Record<string, unknown>) => Promise<unknown> }
        >;
      }
    ).__tesseraTools.style_scatter_point;
    await tool.execute({
      blockId: "supplier-leadtime-chart",
      pointLabel: "Green Valley Farms",
      reset: true,
    });
  });
  await expect(point.locator("circle")).toHaveAttribute("fill", originalFill!);
});

test("WebMCP heatmap tools expose a heat-only contract and can style one cell", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const tools: Record<string, unknown> = {};
    Object.defineProperty(window, "__tesseraWebMCPTools", {
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

  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(
          (
            window as unknown as {
              __tesseraWebMCPTools: Record<string, unknown>;
            }
          ).__tesseraWebMCPTools,
        ),
      ),
    )
    .toContain("style_heatmap_cell");

  const contract = await page.evaluate(() => {
    const tools = (
      window as unknown as {
        __tesseraWebMCPTools: Record<
          string,
          {
            description: string;
            inputSchema: {
              required: string[];
              properties: Record<string, { description?: string }>;
            };
          }
        >;
      }
    ).__tesseraWebMCPTools;
    return {
      add: tools.add_heatmap_chart,
      style: tools.style_heatmap_cell,
    };
  });
  expect(contract.add.inputSchema.required).toEqual([
    "title",
    "datasetId",
    "categoryField",
    "valueFields",
  ]);
  expect(contract.add.inputSchema.properties.scaleScope.description).toContain(
    "global compares every cell",
  );
  expect(contract.add.inputSchema.properties.lineWidth).toBeUndefined();
  expect(contract.add.inputSchema.properties.donutHole).toBeUndefined();
  expect(contract.style.description).toContain("exactly one heatmap cell");

  await page.evaluate(async () => {
    const tool = (
      window as unknown as {
        __tesseraWebMCPTools: Record<
          string,
          { execute: (args: Record<string, unknown>) => Promise<unknown> }
        >;
      }
    ).__tesseraWebMCPTools.style_heatmap_cell;
    await tool.execute({
      blockId: "exec-facility-otif",
      rowLabel: "Atlanta",
      column: "OTIF",
      color: "#d83b9d",
    });
  });

  const heatmap = page.locator('[data-block-id="exec-facility-otif"]');
  await expect(
    heatmap.locator(
      '[data-heatmap-row="Atlanta"][data-heatmap-column="OTIF"] rect',
    ),
  ).toHaveCSS("fill", "rgb(216, 59, 157)");
  await expect(
    heatmap.locator(
      '[data-heatmap-row="Atlanta"][data-heatmap-column="Fill rate"] rect',
    ),
  ).not.toHaveCSS("fill", "rgb(216, 59, 157)");
});

test("WebMCP line tools expose a line-only contract and can style one point", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const tools: Record<string, unknown> = {};
    Object.defineProperty(window, "__tesseraWebMCPTools", {
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

  const contract = await page.evaluate(() => {
    const tools = (
      window as unknown as {
        __tesseraWebMCPTools: Record<
          string,
          {
            description: string;
            inputSchema: {
              required: string[];
              properties: Record<string, { description?: string }>;
            };
          }
        >;
      }
    ).__tesseraWebMCPTools;
    return {
      add: tools.add_line_chart,
      style: tools.style_line_chart_element,
    };
  });
  expect(contract.add.inputSchema.required).toEqual([
    "title",
    "datasetId",
    "categoryField",
    "valueFields",
  ]);
  expect(contract.add.inputSchema.properties.barRadius).toBeUndefined();
  expect(contract.add.inputSchema.properties.donutHole).toBeUndefined();
  expect(
    contract.add.inputSchema.properties.connectNulls.description,
  ).toContain("honest gaps");
  expect(contract.style.description).toContain("one point");
  expect(contract.style.inputSchema.properties.category.description).toContain(
    "Exact",
  );

  await page.evaluate(async () => {
    const tool = (
      window as unknown as {
        __tesseraWebMCPTools: Record<
          string,
          { execute: (args: Record<string, unknown>) => Promise<unknown> }
        >;
      }
    ).__tesseraWebMCPTools.style_line_chart_element;
    await tool.execute({
      blockId: "exec-volume-trend",
      series: "Cases shipped",
      category: "2026-08-31",
      color: "#d83b9d",
      pointSize: 8,
      showLabel: true,
    });
  });

  const chart = page.locator('[data-block-id="exec-volume-trend"]');
  const highlighted = chart.locator(
    '[data-line-point="2026-08-31"][data-series="Cases shipped"] circle',
  );
  await expect(highlighted).toHaveCSS("stroke", "rgb(216, 59, 157)");
  await expect(highlighted).toHaveAttribute("r", "8");
  await expect(
    chart.locator(
      '[data-line-point="2026-07-31"][data-series="Cases shipped"] circle',
    ),
  ).not.toHaveCSS("stroke", "rgb(216, 59, 157)");
});

test("Tree is removed from both the chart library and WebMCP", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const tools: Record<string, unknown> = {};
    Object.defineProperty(window, "__tesseraWebMCPTools", {
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
  const names = await page.evaluate(() =>
    Object.keys(
      (
        window as unknown as {
          __tesseraWebMCPTools: Record<string, unknown>;
        }
      ).__tesseraWebMCPTools,
    ),
  );
  expect(names).not.toContain("add_tree_chart");
  expect(names).not.toContain("style_tree_node");
  await expect(
    page.locator(".block-library").getByText("Tree", { exact: true }),
  ).toHaveCount(0);
});

test("WebMCP Sankey tools expose a flow-specific contract and style one element", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const tools: Record<string, unknown> = {};
    Object.defineProperty(window, "__tesseraWebMCPTools", {
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
  await expect(page.locator(".topbar__save")).toContainText("Saved");
  await page
    .getByLabel("Current dashboard")
    .selectOption({ label: "Inventory" });
  await expect(
    page.locator('[data-block-id="inventory-flow-sankey"]'),
  ).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(
            (
              window as unknown as {
                __tesseraWebMCPTools: Record<string, unknown>;
              }
            ).__tesseraWebMCPTools,
          ).length,
      ),
    )
    .toBeGreaterThan(0);

  const contract = await page.evaluate(() => {
    const tools = (
      window as unknown as {
        __tesseraWebMCPTools: Record<
          string,
          {
            description: string;
            inputSchema: {
              required: string[];
              properties: Record<
                string,
                { description?: string; enum?: string[] }
              >;
            };
          }
        >;
      }
    ).__tesseraWebMCPTools;
    return {
      add: tools.add_sankey_chart,
      style: tools.style_sankey_element,
    };
  });
  expect(contract.add.inputSchema.required).toEqual([
    "title",
    "datasetId",
    "categoryField",
    "targetField",
    "valueField",
  ]);
  expect(contract.add.inputSchema.properties.valueField.description).toContain(
    "positive flow magnitude",
  );
  expect(contract.add.inputSchema.properties.linkColorMode.enum).toEqual([
    "gradient",
    "source",
    "target",
  ]);
  expect(contract.style.description).toContain("exactly one node");
  expect(contract.style.inputSchema.properties.color.description).toContain(
    "this element only",
  );

  await page.evaluate(async () => {
    const tool = (
      window as unknown as {
        __tesseraWebMCPTools: Record<
          string,
          { execute: (args: Record<string, unknown>) => Promise<unknown> }
        >;
      }
    ).__tesseraWebMCPTools.style_sankey_element;
    await tool.execute({
      dashboardId: "northstar-inventory",
      blockId: "inventory-flow-sankey",
      element: "node",
      node: "Warehouse C",
      color: "#d946ef",
      label: "Overflow hub",
    });
    await tool.execute({
      dashboardId: "northstar-inventory",
      blockId: "inventory-flow-sankey",
      element: "link",
      source: "Warehouse A",
      target: "Northstar Store 01",
      color: "#0f766e",
    });
  });

  const sankey = page.locator(
    '[data-block-id="inventory-flow-sankey"] [data-chart-type="sankey"]',
  );
  await expect(
    sankey.locator('.network-node[data-node="Warehouse C"] .sankey-node'),
  ).toHaveAttribute("data-color", "#d946ef");
  await expect(sankey.getByText("Overflow hub", { exact: true })).toBeVisible();
  await expect(
    sankey.locator('.sankey-link[data-link="Continental Foods→Warehouse C"]'),
  ).not.toHaveAttribute("data-end-color", "#d946ef");
  const link = sankey.locator(
    '.sankey-link[data-link="Warehouse A→Northstar Store 01"]',
  );
  await expect(link).toHaveAttribute("data-start-color", "#0f766e");
  await expect(link).toHaveAttribute("data-end-color", "#0f766e");
});

test("undo and redo restore grouped text, moves, adds, and deleted cards", async ({
  page,
}) => {
  const reset = await page.request.post("/api/test/reset");
  expect(reset.ok()).toBe(true);
  await page.goto("/");

  const undo = page.getByRole("button", { name: "Undo last action" });
  const redo = page.getByRole("button", { name: "Redo last action" });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  const card = page.locator('[data-block-id="exec-cases"]');
  await card.click();
  const title = page.getByLabel("Title", { exact: true });
  const originalTitle = await title.inputValue();
  await title.press("Control+A");
  await title.pressSequentially("A revised case outlook");
  await expect(title).toHaveValue("A revised case outlook");
  await expect(undo).toBeEnabled();

  await title.press("Control+z");
  await expect(title).toHaveValue(originalTitle);
  await expect(redo).toBeEnabled();

  await redo.click();
  await expect(title).toHaveValue("A revised case outlook");

  const blockOrder = () =>
    page
      .locator(".canvas-block")
      .evaluateAll((blocks) =>
        blocks.map((block) => (block as HTMLElement).dataset.blockId),
      );
  const originalOrder = await blockOrder();
  const originalIndex = originalOrder.indexOf("exec-cases");
  await page.getByLabel("Selected block actions").getByText("Later").click();
  await expect
    .poll(blockOrder)
    .toEqual([
      ...originalOrder.slice(0, originalIndex),
      originalOrder[originalIndex + 1],
      "exec-cases",
      ...originalOrder.slice(originalIndex + 2),
    ]);
  await undo.click();
  await expect.poll(blockOrder).toEqual(originalOrder);

  await card.getByLabel("Delete block").click();
  await expect(page.locator(".canvas-block")).toHaveCount(
    dashboardBlockCounts["Executive Summary"] - 1,
  );
  for (const id of ["exec-fill", "exec-otif", "exec-cost"])
    await expect(page.locator(`[data-block-id="${id}"]`)).toHaveAttribute(
      "data-layout-width",
      "4",
    );

  await undo.click();
  await expect(page.locator('[data-block-id="exec-cases"]')).toBeVisible();
  await expect(page.locator(".canvas-block")).toHaveCount(
    dashboardBlockCounts["Executive Summary"],
  );
  for (const id of ["exec-cases", "exec-fill", "exec-otif", "exec-cost"])
    await expect(page.locator(`[data-block-id="${id}"]`)).toHaveAttribute(
      "data-layout-width",
      "4",
    );
  await expect(page.locator('[data-block-id="exec-cases"]')).toHaveAttribute(
    "data-stack-id",
    "stack:exec-fill:exec-cases",
  );

  await redo.click();
  await expect(page.locator('[data-block-id="exec-cases"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Add Text" }).click();
  await expect(page.locator(".canvas-block")).toHaveCount(
    dashboardBlockCounts["Executive Summary"],
  );
  await undo.click();
  await expect(page.locator(".canvas-block")).toHaveCount(
    dashboardBlockCounts["Executive Summary"] - 1,
  );
});

test("commentary rail keeps its vertical layout on either side of a chart", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const tools: Record<string, unknown> = {};
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: { name: string }) {
          tools[tool.name] = tool;
        },
      },
    });
    (
      window as unknown as { __layoutTools: Record<string, unknown> }
    ).__layoutTools = tools;
  });
  const reset = await page.request.post("/api/test/reset");
  expect(reset.ok()).toBe(true);
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(
          (window as unknown as { __layoutTools: Record<string, unknown> })
            .__layoutTools,
        ),
      ),
    )
    .toContain("move_block");

  await page.evaluate(async () => {
    const tool = (
      window as unknown as {
        __layoutTools: Record<
          string,
          { execute: (args: Record<string, unknown>) => Promise<unknown> }
        >;
      }
    ).__layoutTools.move_block;
    // Move the commentary to the chart's own index so it sits to its left.
    await tool.execute({
      dashboardId: "northstar-executive",
      blockId: "exec-recovery-readout",
      index: 7,
    });
  });

  const commentary = page.locator('[data-block-id="exec-recovery-readout"]');
  const chart = page.locator('[data-block-id="exec-volume-trend"]');
  await expect(commentary).toHaveAttribute(
    "data-composition",
    "commentary-rail",
  );
  await expect(commentary).toHaveAttribute("data-band-position", "start");
  await expect(chart).toHaveAttribute("data-composition", "evidence-primary");
  await expect(chart).toHaveAttribute("data-band-position", "end");
  const bulletColumns = await commentary
    .locator(".text-block.is-commentary li")
    .evaluateAll((items) =>
      items.map((item) => Math.round(item.getBoundingClientRect().left)),
    );
  expect(new Set(bulletColumns).size).toBe(1);
});

test("Inventory Sankey uses colorful proportional ribbons", async ({
  page,
}) => {
  const reset = await page.request.post("/api/test/reset");
  expect(reset.ok()).toBe(true);
  await page.goto("/");
  await page
    .getByLabel("Current dashboard")
    .selectOption({ label: "Inventory" });

  const sankeyBlock = page.locator('[data-block-id="inventory-flow-sankey"]');
  const sankey = sankeyBlock.locator('[data-chart-type="sankey"]');
  await expect(sankey).toBeVisible();
  await expect(sankey.locator(".sankey-link[data-link]")).toHaveCount(23);
  await expect(sankey.locator(".sankey-node")).toHaveCount(22);
  await expect(sankey.locator(".sankey-label-bg")).toHaveCount(0);
  await expect(
    sankey.locator('.network-node[data-node="Warehouse C"] .sankey-node'),
  ).toHaveCSS("stroke", "none");

  const nodeColors = await sankey
    .locator(".sankey-node")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-color")),
    );
  expect(new Set(nodeColors).size).toBeGreaterThanOrEqual(4);

  const thickFlow = Number(
    await sankey
      .locator('.sankey-link[data-link="Green Valley Farms→Warehouse A"]')
      .getAttribute("data-thickness"),
  );
  const standardFlow = Number(
    await sankey
      .locator('.sankey-link[data-link="Warehouse A→Northstar Store 01"]')
      .getAttribute("data-thickness"),
  );
  expect(thickFlow / standardFlow).toBeCloseTo(3, 1);
  await expect(
    sankey.locator(
      '.network-node[data-node="Warehouse A"] .sankey-label-value',
    ),
  ).toHaveText(/1\.6M\s*·\s*53%/);

  await sankeyBlock.click();
  await expect(page.getByLabel("Source field")).toHaveValue("Source");
  await expect(page.getByLabel("Target field")).toHaveValue("Target");
  await expect(page.getByLabel("Flow value")).toHaveValue("Cases routed");
  await expect(page.getByLabel("Stage headers")).toBeChecked();
  await expect(page.getByLabel("Node values")).toBeChecked();
  await expect(page.getByLabel("Share percentages")).toBeChecked();
  await expect(page.getByLabel("Stage labels")).toHaveValue(
    "Vendors, Warehouses, Stores",
  );
  await expect(page.getByLabel("Number format")).toHaveValue("compact");
  await expect(page.getByLabel("Decimals")).toHaveValue("1");
  await expect(page.getByLabel(/^Grid width/)).toHaveValue("12");
  await expect(page.getByLabel("Minimum height")).toHaveValue("560");

  await page
    .locator('.inspector-section[data-section="Color & emphasis"] > summary')
    .click();
  await expect(
    page
      .locator('.inspector-section[data-section="Color & emphasis"]')
      .getByRole("radiogroup", { name: "Origins" }),
  ).toBeVisible();
  await expect(page.getByLabel("Highlighted nodes")).toHaveValue("Warehouse A");

  await page.getByLabel("Node style target").selectOption("Warehouse C");
  await page.getByLabel("Selected node color").fill("#d946ef");
  await page.getByLabel("Selected node color").press("Tab");
  await expect(
    sankey.locator('.network-node[data-node="Warehouse C"] .sankey-node'),
  ).toHaveAttribute("data-color", "#d946ef");

  await page
    .getByLabel("Link style target")
    .selectOption({ label: "Warehouse A → Northstar Store 01" });
  await page.getByLabel("Selected link color").fill("#0f766e");
  await page.getByLabel("Selected link color").press("Tab");
  await expect(
    sankey.locator('.sankey-link[data-link="Warehouse A→Northstar Store 01"]'),
  ).toHaveAttribute("data-start-color", "#0f766e");
  await expect(
    sankey.locator('.sankey-link[data-link="Warehouse A→Northstar Store 01"]'),
  ).toHaveAttribute("data-end-color", "#0f766e");

  await page.getByLabel("Stage labels").fill("Origins, Hubs, Locations");
  await expect(sankey.getByText("4 ORIGINS", { exact: true })).toBeVisible();
  await expect(sankey.getByText("3 HUBS", { exact: true })).toBeVisible();
  await expect(sankey.getByText("15 LOCATIONS", { exact: true })).toBeVisible();
  await page.getByText("Share percentages", { exact: true }).click();
  await expect(page.getByLabel("Share percentages")).not.toBeChecked();
  await expect(
    sankey.locator(
      '.network-node[data-node="Warehouse A"] .sankey-label-value',
    ),
  ).toHaveText("1.6M");

  await page
    .locator('.inspector-section[data-section="Chart geometry"] > summary')
    .click();
  await expect(page.getByLabel(/^Node width/)).toBeVisible();
  await expect(page.getByLabel(/^Node gap/)).toBeVisible();
  await expect(page.getByLabel(/^Flow density/)).toBeVisible();
  await expect(page.getByLabel(/^Link opacity/)).toBeVisible();
});

test("Northstar preserves its dashboard-group hierarchy and polished decision flow", async ({
  page,
}) => {
  const reset = await page.request.post("/api/test/reset");
  expect(reset.ok()).toBe(true);
  await page.goto("/");

  await expect
    .poll(async () => {
      const response = await page.request.get("/api/state");
      const envelope = await response.json();
      return envelope.state?.projects?.length ?? 0;
    })
    .toBe(1);
  const stateResponse = await page.request.get("/api/state");
  expect(stateResponse.ok()).toBe(true);
  const seededEnvelope = await stateResponse.json();
  const seededProject = seededEnvelope.state.projects[0];
  expect(seededProject.warehouse).toHaveLength(5);
  for (const asset of seededProject.warehouse) {
    const september = asset.months.find(
      (item: { period: string }) => item.period === "2026-09",
    );
    expect(september?.status).toBe("pending");
    expect(september?.cleaned).toEqual({ columns: [], rows: [] });
    expect(september?.cleaningSummary).toEqual([]);
  }
  const produce = seededProject.warehouse.find(
    (asset: { name: string }) => asset.name === "Produce Quality Inspections",
  );
  expect(
    produce.months.find((item: { period: string }) => item.period === "2026-08")
      .cleaned.rows,
  ).toHaveLength(18);
  expect(
    produce.months.find((item: { period: string }) => item.period === "2026-09")
      .original.rows,
  ).toHaveLength(6);

  const dashboardGroup = page.getByRole("button", {
    name: "Dashboard group",
    exact: true,
  });
  await expect(dashboardGroup).toHaveText("Northstar Supply Chain");
  await dashboardGroup.click();
  await expect(
    page.getByRole("listbox", { name: "Dashboard groups" }).getByRole("option"),
  ).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(
    page.getByLabel("Current dashboard").locator("option"),
  ).toHaveText(dashboardNames);

  const toolStatus = page.locator(".webmcp-status");
  if (await toolStatus.isVisible()) {
    await expect(toolStatus).toContainText(/Agent (?:ready|connected)/);
  }

  for (const name of dashboardNames) {
    await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
  }
  await expect(
    page.locator(".block-library").getByText("Route map", { exact: true }),
  ).toHaveCount(0);

  await page
    .getByLabel("Current dashboard")
    .selectOption({ label: "Executive Summary" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Executive Summary",
  );
  await expect(page.locator(".canvas-block")).toHaveCount(
    dashboardBlockCounts["Executive Summary"],
  );
  await expectWhiteDashboardBlocks(
    page,
    dashboardBlockCounts["Executive Summary"],
  );
  await expect(page.locator('[data-block-type="kpi"]')).toHaveCount(4);
  await expect(page.locator('[data-block-type="table"]')).toHaveCount(1);
  await expect(
    page.getByText("Leadership call", { exact: true }),
  ).toBeVisible();
  await expectApprovedDashboardPaints(page, "Executive Summary", false);

  const casesCard = page.locator('[data-block-id="exec-cases"]');
  await casesCard.click();
  await expect(casesCard).toHaveClass(/is-selected/);
  await expect(
    page.getByRole("separator", { name: "Resize block height" }),
  ).toBeVisible();
  await expect(page.getByLabel("Selected block actions")).toContainText(
    "Duplicate",
  );
  await expect(page.locator(".inspector-workspace-tabs")).toContainText(
    "AgentDataBlockKit",
  );

  const resizeLeft = page.locator('[data-block-id="exec-volume-trend"]');
  const resizeRight = page.locator('[data-block-id="exec-recovery-readout"]');
  await resizeLeft.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  await resizeLeft.click();
  const widthHandle = page.getByRole("separator", {
    name: "Resize block width",
  });
  await expect(widthHandle).toHaveAttribute("aria-valuetext", /other card/);
  const originalLeftStyle = (await resizeLeft.getAttribute("style")) ?? "";
  const originalRightStyle = (await resizeRight.getAttribute("style")) ?? "";
  const originalLeftWidth = Number(
    originalLeftStyle.match(/grid-column:\s*span\s*(\d+)/)?.[1] ?? 8,
  );
  const originalRightWidth = Number(
    originalRightStyle.match(/grid-column:\s*span\s*(\d+)/)?.[1] ?? 4,
  );
  const widthBox = await widthHandle.boundingBox();
  expect(widthBox).not.toBeNull();
  await page.mouse.move(widthBox!.x + widthBox!.width / 2, widthBox!.y + 8);
  await page.mouse.down();
  await page.mouse.move(
    widthBox!.x + (originalLeftWidth > 3 ? -90 : 90),
    widthBox!.y + 8,
    { steps: 4 },
  );
  const widthSave = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/state") &&
      response.request().method() === "PUT" &&
      response.ok(),
  );
  await page.mouse.up();
  await widthSave;
  await expect
    .poll(async () => {
      const leftStyle = (await resizeLeft.getAttribute("style")) ?? "";
      const rightStyle = (await resizeRight.getAttribute("style")) ?? "";
      return [
        Number(leftStyle.match(/grid-column:\s*span\s*(\d+)/)?.[1] ?? 0),
        Number(rightStyle.match(/grid-column:\s*span\s*(\d+)/)?.[1] ?? 0),
      ];
    })
    .not.toEqual([originalLeftWidth, originalRightWidth]);
  const resizedLeftStyle = (await resizeLeft.getAttribute("style")) ?? "";
  const resizedRightStyle = (await resizeRight.getAttribute("style")) ?? "";
  const resizedLeftWidth = Number(
    resizedLeftStyle.match(/grid-column:\s*span\s*(\d+)/)?.[1] ?? 0,
  );
  const resizedRightWidth = Number(
    resizedRightStyle.match(/grid-column:\s*span\s*(\d+)/)?.[1] ?? 0,
  );
  expect(resizedLeftWidth + resizedRightWidth).toBe(
    originalLeftWidth + originalRightWidth,
  );
  expect(resizedLeftWidth - originalLeftWidth).toBe(
    -(resizedRightWidth - originalRightWidth),
  );

  const resizedStyle = (await casesCard.getAttribute("style")) ?? "";
  const originalHeight = Number(
    resizedStyle.match(/min-height:\s*(\d+)px/)?.[1] ?? 138,
  );
  await casesCard.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  await casesCard.click();
  const heightHandle = page.getByRole("separator", {
    name: "Resize block height",
  });
  const heightBox = await heightHandle.boundingBox();
  expect(heightBox).not.toBeNull();
  // Stay clear of the floating selection toolbar centered over the lower edge.
  const heightHandleX = heightBox!.x + 14;
  const heightHandleY = heightBox!.y + heightBox!.height / 2;
  const heightDelta = originalHeight < 840 ? 48 : -48;
  await page.mouse.move(heightHandleX, heightHandleY);
  await page.mouse.down();
  await page.mouse.move(heightHandleX, heightHandleY + heightDelta, {
    steps: 4,
  });
  const heightSave = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/state") &&
      response.request().method() === "PUT" &&
      response.ok(),
  );
  await page.mouse.up();
  await heightSave;
  await expect
    .poll(async () => {
      const style = (await casesCard.getAttribute("style")) ?? "";
      return Number(style.match(/min-height:\s*(\d+)px/)?.[1] ?? 0);
    })
    .not.toBe(originalHeight);

  const fillRateCard = page.locator('[data-block-id="exec-fill"]');
  await casesCard.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  const orderBeforeDrag = await page
    .locator(".canvas-block")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-block-id")),
    );
  const casesWasBeforeFill =
    orderBeforeDrag.indexOf("exec-cases") <
    orderBeforeDrag.indexOf("exec-fill");
  const fillRateBox = await fillRateCard.boundingBox();
  expect(fillRateBox).not.toBeNull();
  await casesCard.locator(".canvas-block__drag").dragTo(fillRateCard, {
    targetPosition: {
      x: casesWasBeforeFill ? fillRateBox!.width - 18 : 18,
      y: fillRateBox!.height / 2,
    },
  });
  await expect
    .poll(async () => {
      const cards = await page
        .locator(".canvas-block")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-block-id")),
        );
      return (
        cards.indexOf("exec-cases") > cards.indexOf("exec-fill") ===
        casesWasBeforeFill
      );
    })
    .toBe(true);
  for (const id of ["exec-cases", "exec-fill", "exec-otif", "exec-cost"]) {
    await expect(page.locator(`[data-block-id="${id}"]`)).toHaveAttribute(
      "data-layout-width",
      "3",
    );
  }

  const riskMixCard = page.locator('[data-block-id="exec-risk-mix"]');
  const decisionsCard = page.locator('[data-block-id="exec-decisions"]');
  await riskMixCard.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  const addText = page.getByRole("button", { name: "Add Text", exact: true });
  const addTextBox = await addText.boundingBox();
  expect(addTextBox).not.toBeNull();
  await page.mouse.move(
    addTextBox!.x + addTextBox!.width / 2,
    addTextBox!.y + addTextBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    addTextBox!.x + addTextBox!.width / 2 + 12,
    addTextBox!.y + addTextBox!.height / 2 + 4,
  );
  await expect(page.locator(".canvas-scroll")).toHaveClass(/is-dragging/);
  const aboveRiskMixBox = await riskMixCard.evaluate((card) => {
    const zone = card.querySelector<HTMLElement>(
      ".canvas-block__drop-stack--above",
    );
    if (!zone) throw new Error("Top stack drop zone is missing.");
    const rect = zone.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.mouse.move(
    aboveRiskMixBox!.x + aboveRiskMixBox!.width / 2,
    aboveRiskMixBox!.y + aboveRiskMixBox!.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();

  const verticalStack = page
    .locator(".canvas-stack")
    .filter({ has: riskMixCard });
  await expect(verticalStack).toHaveCount(1);
  await expect(verticalStack.locator(".canvas-block")).toHaveCount(2);
  const stackedText = verticalStack.locator('[data-block-type="text"]');
  await expect(stackedText).toHaveCount(1);
  await expect(stackedText).toHaveAttribute("data-stack-id", /stack:/);
  await expect(verticalStack.locator(".canvas-block").nth(1)).toHaveAttribute(
    "data-block-id",
    "exec-risk-mix",
  );
  await expect(stackedText).toHaveAttribute("data-layout-width", "5");
  await expect(riskMixCard).toHaveAttribute("data-layout-width", "5");
  await expect(decisionsCard).toHaveAttribute("data-layout-width", "7");

  const stackedTextHandle = stackedText.locator(".canvas-block__drag");
  const stackedTextId = await stackedText.getAttribute("data-block-id");
  expect(stackedTextId).toBeTruthy();
  await stackedTextHandle.evaluate((handle, movingId) => {
    const target = document.querySelector<HTMLElement>(
      '[data-block-id="exec-risk-mix"]',
    );
    if (!target) throw new Error("Risk mix card is missing.");
    const transfer = new DataTransfer();
    transfer.setData("text/plain", `move:${movingId}`);
    handle.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }),
    );
    const rect = target.getBoundingClientRect();
    const eventOptions = {
      bubbles: true,
      dataTransfer: transfer,
      clientX: rect.left + 16,
      clientY: rect.bottom - 10,
    };
    target.dispatchEvent(new DragEvent("dragover", eventOptions));
    target.dispatchEvent(new DragEvent("drop", eventOptions));
    handle.dispatchEvent(
      new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }),
    );
  });
  await expect(verticalStack.locator(".canvas-block").nth(0)).toHaveAttribute(
    "data-block-id",
    "exec-risk-mix",
  );
  await expect(verticalStack.locator(".canvas-block").nth(1)).toHaveAttribute(
    "data-block-type",
    "text",
  );

  await stackedTextHandle.click();
  // Centre the stack so the floating selection toolbar at the bottom of the
  // canvas cannot sit over the divider.
  await verticalStack.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  const stackWidthHandle = page.getByRole("separator", {
    name: "Resize block width",
  });
  const stackHandleBox = await stackWidthHandle.boundingBox();
  expect(stackHandleBox).not.toBeNull();
  const stackGrabX = stackHandleBox!.x + 4;
  const stackGrabY = stackHandleBox!.y + stackHandleBox!.height / 2;
  await page.mouse.move(stackGrabX, stackGrabY);
  await page.mouse.down();
  await page.mouse.move(stackGrabX + 90, stackGrabY, { steps: 4 });
  const stackWidthSave = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/state") &&
      response.request().method() === "PUT" &&
      response.ok(),
  );
  await page.mouse.up();
  await stackWidthSave;
  await expect(stackedText).toHaveAttribute("data-layout-width", "6");
  await expect(riskMixCard).toHaveAttribute("data-layout-width", "6");
  await expect(decisionsCard).toHaveAttribute("data-layout-width", "6");

  await page
    .getByRole("button", { name: "Data Warehouse", exact: true })
    .click();

  await expect(page.locator(".warehouse-commandbar__identity")).toContainText(
    "Northstar Supply Chain",
  );
  const warehouseDatasets = page.getByRole("tablist", {
    name: "Warehouse datasets",
  });
  await expect(warehouseDatasets.getByRole("tab")).toHaveCount(datasets.length);

  for (const dataset of datasets) {
    await warehouseDatasets
      .getByRole("tab", { name: new RegExp(`^${dataset.name}\\b`) })
      .click();
    await expect(
      page.getByRole("heading", { name: dataset.name, level: 2 }),
    ).toBeVisible();

    const monthTabs = page.getByRole("tablist", { name: "Dataset months" });
    const versionTabs = page.getByRole("tablist", { name: "Data version" });
    for (const month of dataset.months) {
      const monthTab = monthTabs.getByRole("tab", {
        name: new RegExp(`^${month}`),
      });
      await expect(monthTab).toBeVisible();
      await monthTab.click();
      await expect(
        versionTabs.getByRole("tab", { name: /^Original\b/ }),
      ).toBeVisible();
      const cleanTab = versionTabs.getByRole("tab", { name: /^Cleaned\b/ });
      await expect(cleanTab).toBeVisible();
      if (month === "September 2026") {
        await expect(cleanTab).toBeDisabled();
        await expect(cleanTab).toContainText("Not cleaned yet");
        await expect(page.locator(".worksheet-region-outline")).toHaveCount(0);
      } else {
        await expect(cleanTab).toBeEnabled();
      }
    }
  }

  await warehouseDatasets
    .getByRole("tab", { name: /^Network Summary\b/ })
    .click();
  await expect(
    page.getByText("Original source", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("original-worksheet")).toBeVisible();

  const dataVersions = page.getByRole("tablist", { name: "Data version" });
  const cleanedVersion = dataVersions.getByRole("tab", {
    name: /^Cleaned\b/,
  });
  await expect(cleanedVersion).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Monthly workflow" }),
  ).toBeVisible();
  await page
    .getByRole("tablist", { name: "Dataset months" })
    .getByRole("tab", { name: "August 2026", exact: true })
    .click();
  await cleanedVersion.click();
  await expect(cleanedVersion).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Clean table", { exact: true })).toBeVisible();
  await expect(page.locator(".data-grid")).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "#", exact: true }),
  ).toHaveCSS("width", "34px");

  const warehouseActions = page.locator(".warehouse-commandbar__actions");
  await warehouseActions
    .getByRole("button", { name: "Recipes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Clean next month the same way as this month",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit recipe" })).toHaveCount(
    datasets.length,
  );
  await warehouseActions
    .getByRole("button", { name: "Back to tables", exact: true })
    .click();

  await warehouseActions
    .getByRole("button", { name: "Monthly refresh", exact: true })
    .click();
  const refreshBack = warehouseActions.getByRole("button", {
    name: "Back to tables",
    exact: true,
  });
  await expect(refreshBack).toHaveClass(/is-active/);
  await expect(
    page.getByRole("heading", {
      name: "Bring in the next month without rebuilding anything",
    }),
  ).toBeVisible();
  await expect(page.locator(".refresh-row")).toHaveCount(datasets.length);

  await refreshBack.click();
  const originalVersion = page
    .getByRole("tablist", { name: "Data version" })
    .getByRole("tab", { name: /^Original\b/ });
  await originalVersion.click();
  await expect(originalVersion).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("Original source", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("original-worksheet")).toBeVisible();
  await expect(
    page.getByTestId("original-worksheet").getByText("Cases Shipped (000s)"),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("original-worksheet")
      .locator(".worksheet-row-number")
      .first(),
  ).toHaveCSS("width", "28px");
  await expect(page.getByRole("button", { name: "Edit table" })).toHaveCount(0);

  await page.getByRole("button", { name: "Dashboards", exact: true }).click();

  await page
    .getByLabel("Current dashboard")
    .selectOption({ label: "Supplier Risk" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Supplier Risk",
  );
  await expect(page.locator(".canvas-block")).toHaveCount(
    dashboardBlockCounts["Supplier Risk"],
  );
  await expect(page.locator('[data-block-type="kpi"]')).toHaveCount(4);
  await expect(
    page.locator('[data-block-id="supplier-risk-chart"]'),
  ).toBeVisible();
  await expect(page.locator('[data-block-id="supplier-table"]')).toBeVisible();
  await expectApprovedDashboardPaints(page, "Supplier Risk", true);

  await page
    .getByLabel("Current dashboard")
    .selectOption({ label: "Inventory" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Inventory",
  );
  await expect(page.locator(".canvas-block")).toHaveCount(
    dashboardBlockCounts.Inventory,
  );
  await expectWhiteDashboardBlocks(page, dashboardBlockCounts.Inventory);
  await expect(page.locator('[data-block-type="kpi"]')).toHaveCount(4);
  await expect(
    page.locator('[data-block-id="inventory-facility-chart"]'),
  ).toBeVisible();
  await expect(page.locator('[data-block-id="inventory-table"]')).toBeVisible();
  await expectApprovedDashboardPaints(page, "Inventory", true, [
    "inventory-flow-sankey",
  ]);
  const sankeyBlock = page.locator('[data-block-id="inventory-flow-sankey"]');
  const sankey = sankeyBlock.locator('[data-chart-type="sankey"]');
  await expect(sankey).toBeVisible();
  await expect(sankey.locator('.network-node[data-layer="0"]')).toHaveCount(4);
  await expect(sankey.locator('.network-node[data-layer="1"]')).toHaveCount(3);
  await expect(sankey.locator('.network-node[data-layer="2"]')).toHaveCount(15);
  await expect(sankey.locator(".sankey-link[data-link]")).toHaveCount(23);
  const sankeyPaints = await renderedChartPaints(sankeyBlock);
  const saturatedSankeyPaints = sankeyPaints.filter((paint) => {
    const profile = cssColorProfile(paint.color);
    return profile && profile.alpha > 0 && profile.chroma >= 60;
  });
  // Branches stay in the house blues and greys; emphasis comes from weight
  // and a darker blue, never from a rainbow of categorical colors.
  expect(
    new Set(saturatedSankeyPaints.map((paint) => paint.color)).size,
    "Inventory Sankey should still tell its warehouse branches apart",
  ).toBeGreaterThanOrEqual(2);
  expect(
    sankeyPaints.filter((paint) => !isApprovedBlueOrNeutral(paint.color)),
    "Inventory Sankey should stay in the house blues and greys",
  ).toEqual([]);
  await expect(sankey.locator(".sankey-link-underlay")).toHaveCount(0);

  const highlightedFlow = sankey.locator(
    '.sankey-link[data-link="Green Valley Farms→Warehouse A"]',
  );
  await expect(highlightedFlow).toHaveCount(1);
  await expect(highlightedFlow).toHaveAttribute("data-highlighted", "true");
  const thickFlow = Number(
    await highlightedFlow.getAttribute("data-thickness"),
  );
  const standardFlow = Number(
    await sankey
      .locator('.sankey-link[data-link="Warehouse A→Northstar Store 01"]')
      .getAttribute("data-thickness"),
  );
  expect(
    thickFlow / standardFlow,
    "Ribbon thickness should remain proportional to routed cases",
  ).toBeCloseTo(3, 1);

  await expect(sankey.getByText(/4 vendors/i, { exact: true })).toBeVisible();
  await expect(
    sankey.getByText(/3 warehouses/i, { exact: true }),
  ).toBeVisible();
  await expect(sankey.getByText(/15 stores/i, { exact: true })).toBeVisible();
  await expect(
    page.locator('[data-block-id="inventory-flow-radar"]'),
  ).toHaveCount(0);

  for (const [warehouse, code, storeCount] of [
    ["Warehouse A", "A", 8],
    ["Warehouse B", "B", 3],
    ["Warehouse C", "C", 4],
  ] as const) {
    await expect(
      sankey.locator(`.network-node[data-node="${warehouse}"] .sankey-label`),
    ).toContainText(new RegExp(`${code}\\s*·\\s*${storeCount}\\s+stores`));
  }
  await expect(
    sankey.locator(
      '.network-node[data-node="Warehouse A"] .sankey-label-value',
    ),
  ).toHaveText(/1\.6M\s*·\s*53%/);

  await sankeyBlock.click();
  await page
    .locator('.inspector-section[data-section="Chart geometry"] > summary')
    .click();
  await expect(page.getByLabel(/^Flow density/)).toBeVisible();

  const clickAddSave = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/state") &&
      response.request().method() === "PUT" &&
      response.ok(),
  );
  await page.getByRole("button", { name: "Add Text", exact: true }).click();
  await clickAddSave;
  await expect(page.locator(".canvas-block")).toHaveCount(
    dashboardBlockCounts.Inventory + 1,
  );
  const clickedBlock = page.locator(".canvas-block").last();
  await expect(clickedBlock).toHaveAttribute("data-block-type", "text");
  await expect(clickedBlock).toHaveAttribute("data-layout-width", "12");
});
