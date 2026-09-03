import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const loader = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true },
});
const [{ CommandBus }, defaults, { agentCatalog }] = await Promise.all([
  loader.ssrLoadModule("/src/domain/commands.ts"),
  loader.ssrLoadModule("/src/domain/defaults.ts"),
  loader.ssrLoadModule("/src/webmcp/register.ts"),
]);

test.after(() => loader.close());

test("deleting a dashboard removes its full monthly series and keeps a valid active dashboard", async () => {
  const project = defaults.createProject("Test project");
  const august = project.dashboards[0];
  august.name = "Operations";
  august.reportingPeriod = "2026-08";
  august.blocks.push(defaults.createBlock("text"));
  const september = structuredClone(august);
  september.id = crypto.randomUUID();
  september.reportingPeriod = "2026-09";
  september.seriesId = august.id;
  september.edition = {
    period: "2026-09",
    sourceDashboardId: august.id,
    status: "draft",
    createdFromPeriod: "2026-08",
  };
  const remaining = defaults.createDashboard("Finance", "2026-08");
  project.dashboards.push(september, remaining);
  project.activeDashboardId = august.id;
  const harness = commandHarness(project);

  const result = await harness.bus.execute("delete_dashboard", {
    dashboardId: september.id,
  });

  assert.equal(result.removedEditionCount, 2);
  assert.equal(result.removedBlockCount, 2);
  assert.deepEqual(
    harness.project().dashboards.map((dashboard) => dashboard.id),
    [remaining.id],
  );
  assert.equal(harness.project().activeDashboardId, remaining.id);
  assert.equal(harness.history().at(-1)?.record, true);
  assert.match(harness.history().at(-1)?.label ?? "", /Deleted dashboard/);
});

test("deleting the final dashboard series creates a blank replacement", async () => {
  const project = defaults.createProject("Test project");
  const removedId = project.activeDashboardId;
  const harness = commandHarness(project);

  const result = await harness.bus.execute("delete_dashboard", {
    dashboardId: removedId,
  });

  assert.equal(result.replacementCreated, true);
  assert.equal(harness.project().dashboards.length, 1);
  assert.notEqual(harness.project().activeDashboardId, removedId);
  assert.equal(harness.project().dashboards[0].blocks.length, 0);
  assert.equal(harness.history().at(-1)?.record, true);
});

test("deleting a dataset clears every dependent dashboard binding", async () => {
  const project = defaults.createProject("Test project");
  const datasetId = crypto.randomUUID();
  project.warehouse.push({
    id: datasetId,
    name: "Orders",
    description: "One row per order",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    recipe: {
      id: crypto.randomUUID(),
      name: "Orders recipe",
      headerMap: {},
      notes: [],
      updatedAt: new Date().toISOString(),
    },
    months: [],
  });
  const block = defaults.createBlock("bar", {
    datasetId,
    period: "2026-08",
    categoryField: "Region",
    labelField: "Label",
    seriesField: "Series",
    targetField: "Target",
    valueField: "Revenue",
    valueFields: ["Revenue"],
  });
  block.table.visibleColumns = ["Region", "Revenue"];
  block.table.sortColumn = "Revenue";
  block.table.sortDirection = "descending";
  block.table.totalColumns = ["Revenue"];
  block.table.columnStyles = [{ column: "Revenue", label: "Sales" }];
  block.chart.barColorOverrides = [{ category: "Central", color: "#a3212d" }];
  block.chart.lineSeriesStyles = [{ series: "Revenue", color: "#a3212d" }];
  project.dashboards[0].blocks.push(block);
  const harness = commandHarness(project);

  const result = await harness.bus.execute("delete_dataset", { datasetId });
  const disconnected = harness.project().dashboards[0].blocks[0];

  assert.equal(result.disconnectedBlockCount, 1);
  assert.equal(harness.project().warehouse.length, 0);
  assert.equal(disconnected.datasetId, undefined);
  assert.equal(disconnected.categoryField, undefined);
  assert.equal(disconnected.labelField, undefined);
  assert.equal(disconnected.seriesField, undefined);
  assert.equal(disconnected.targetField, undefined);
  assert.equal(disconnected.valueField, undefined);
  assert.deepEqual(disconnected.valueFields, []);
  assert.equal(disconnected.period, "latest");
  assert.deepEqual(disconnected.table.visibleColumns, []);
  assert.equal(disconnected.table.sortColumn, "");
  assert.equal(disconnected.table.sortDirection, "none");
  assert.deepEqual(disconnected.table.totalColumns, []);
  assert.deepEqual(disconnected.table.columnStyles, []);
  assert.deepEqual(disconnected.chart.barColorOverrides, []);
  assert.deepEqual(disconnected.chart.lineSeriesStyles, []);
  assert.equal(harness.history().at(-1)?.record, true);
  assert.match(harness.history().at(-1)?.label ?? "", /Deleted dataset/);
});

test("agents cannot bypass the in-app deletion confirmation", async () => {
  const project = defaults.createProject("Test project");
  const harness = commandHarness(project);
  const available = new Set(agentCatalog(harness.bus).map((tool) => tool.name));

  assert.equal(available.has("delete_dashboard"), false);
  assert.equal(available.has("delete_dataset"), false);
  await assert.rejects(
    harness.bus.execute(
      "delete_dashboard",
      { dashboardId: project.activeDashboardId },
      "webmcp",
    ),
    /must be deleted by the user/,
  );
  const beforeDatasetAttempt = structuredClone(harness.project());
  await assert.rejects(
    harness.bus.execute(
      "delete_dataset",
      { datasetId: crypto.randomUUID() },
      "webmcp",
    ),
    /must be deleted by the user/,
  );
  assert.deepEqual(harness.project(), beforeDatasetAttempt);
});

function commandHarness(project) {
  const history = [];
  let state = {
    schemaVersion: 1,
    activeProjectId: project.id,
    projects: [project],
  };
  return {
    bus: new CommandBus({
      getState: () => state,
      setState: (update, options) => {
        state = update(state);
        if (options) history.push(options);
      },
    }),
    project: () => state.projects[0],
    history: () => history,
  };
}
