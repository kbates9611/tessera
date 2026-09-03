import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __tesseraLiveTools: Record<
      string,
      {
        execute: (args: Record<string, unknown>) => Promise<unknown>;
      }
    >;
    __tesseraPageMarker?: string;
  }
}

test.beforeEach(async ({ page }) => {
  const reset = await page.request.post("/api/test/reset");
  expect(reset.ok()).toBe(true);
});

test("WebMCP card creation and movement stream into another open tab", async ({
  context,
  page,
}) => {
  await context.addInitScript(() => {
    window.__tesseraLiveTools = {};
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        codexGetTools() {},
        registerTool(tool: {
          name: string;
          execute: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          window.__tesseraLiveTools[tool.name] = tool;
        },
      },
    });
  });

  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(window.__tesseraLiveTools.run_tessera_tool)),
    )
    .toBe(true);
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/state");
      const envelope = (await response.json()) as { revision: number };
      return envelope.revision;
    })
    .toBeGreaterThan(0);

  const other = await context.newPage();
  await other.goto("/");
  await other.evaluate(() => {
    window.__tesseraPageMarker = "same-page";
  });

  const created = await page.evaluate(async () => {
    const response = (await window.__tesseraLiveTools.run_tessera_tool.execute({
      toolName: "add_tile_placeholder",
      arguments: {
        dashboardId: "northstar-executive",
        type: "text",
        intent: "Live MCP demonstration card",
      },
    })) as { result: { id: string } };
    return response.result.id;
  });

  await expect(other.locator(`[data-block-id="${created}"]`)).toBeVisible();
  await expect
    .poll(() => other.evaluate(() => window.__tesseraPageMarker))
    .toBe("same-page");

  await page.evaluate(async (blockId) => {
    await window.__tesseraLiveTools.run_tessera_tool.execute({
      toolName: "move_block",
      arguments: {
        dashboardId: "northstar-executive",
        blockId,
        index: 0,
      },
    });
  }, created);

  await expect
    .poll(() =>
      other.locator(".canvas-block").first().getAttribute("data-block-id"),
    )
    .toBe(created);
  await expect
    .poll(() => other.evaluate(() => window.__tesseraPageMarker))
    .toBe("same-page");
});

test("the first durable backend load carries forward existing hosted browser state", async ({
  page,
}) => {
  await page.goto("/");
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/state");
      const envelope = (await response.json()) as { revision: number };
      return envelope.revision;
    })
    .toBeGreaterThan(0);

  const saved = (await (await page.request.get("/api/state")).json()) as {
    state: {
      projects: Array<{ name: string }>;
    };
  };
  saved.state.projects[0].name = "Migrated browser project";
  const reset = await page.request.post("/api/test/reset");
  expect(reset.ok()).toBe(true);
  await page.evaluate((state) => {
    localStorage.setItem("tessera-state-v1", JSON.stringify(state));
  }, saved.state);

  await page.reload();
  await expect(
    page.getByLabel("Dashboard group", { exact: true }),
  ).toContainText("Migrated browser project");
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/state");
      const envelope = (await response.json()) as {
        state: { projects: Array<{ name: string }> } | null;
      };
      return envelope.state?.projects[0]?.name;
    })
    .toBe("Migrated browser project");
});
