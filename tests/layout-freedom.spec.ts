import { expect, test, type Locator, type Page } from "@playwright/test";
import { resetBackend, waitForSaved } from "./helpers";

// A tall viewport keeps the floating selection toolbar, which sits at the
// bottom of the canvas, away from the handles the tests grab.
test.use({ viewport: { width: 1400, height: 1000 } });

test.beforeEach(async ({ page }) => {
  await resetBackend(page);
  await page.goto("/");
  await waitForSaved(page);
  await page
    .locator(".loading-screen")
    .waitFor({ state: "detached", timeout: 8000 });
});

/** The next successful save round-trip. */
function nextSave(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/state") &&
      response.request().method() === "PUT" &&
      response.ok(),
  );
}

/** Drags a card's grip onto a target element at a client point, HTML5-style. */
async function dropCard(
  page: Page,
  movingId: string,
  target: Locator,
  at: (rect: DOMRect) => { x: number; y: number },
) {
  const handle = page.locator(
    `[data-block-id="${movingId}"] .canvas-block__drag`,
  );
  const targetHandle = await target.elementHandle();
  const saved = nextSave(page);
  await handle.evaluate(
    (grip, { id, node, pick }) => {
      const point = new Function("rect", `return (${pick})(rect);`) as (
        rect: DOMRect,
      ) => { x: number; y: number };
      const transfer = new DataTransfer();
      transfer.setData("text/plain", `move:${id}`);
      grip.dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }),
      );
      const rect = (node as HTMLElement).getBoundingClientRect();
      const { x, y } = point(rect);
      const options = {
        bubbles: true,
        dataTransfer: transfer,
        clientX: x,
        clientY: y,
      };
      (node as HTMLElement).dispatchEvent(new DragEvent("dragover", options));
      (node as HTMLElement).dispatchEvent(new DragEvent("drop", options));
      grip.dispatchEvent(
        new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }),
      );
    },
    { id: movingId, node: targetHandle, pick: at.toString() },
  );
  await saved;
}

async function layoutOf(page: Page, blockId: string) {
  const envelope = (await (await page.request.get("/api/state")).json()) as {
    state: {
      projects: Array<{
        dashboards: Array<{
          id: string;
          blocks: Array<{
            id: string;
            layout: { width: number; minHeight: number; stackId?: string };
          }>;
        }>;
      }>;
    };
  };
  const block = envelope.state.projects
    .flatMap((project) => project.dashboards)
    .flatMap((dashboard) => dashboard.blocks)
    .find((candidate) => candidate.id === blockId);
  if (!block) throw new Error(`Block ${blockId} is missing from the state.`);
  return block.layout;
}

async function columnPitch(page: Page) {
  return page.locator(".dashboard-grid").evaluate((grid) => {
    const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
    return (grid.clientWidth - 11 * gap) / 12 + gap;
  });
}

test("cards can sit side by side under another card inside a stack", async ({
  page,
}) => {
  const chart = page.locator('[data-block-id="exec-volume-trend"]');
  await chart.evaluate((node) => node.scrollIntoView({ block: "center" }));
  // Stack the driver readout under the eight-wide chart.
  await dropCard(
    page,
    "exec-driver-readout",
    chart.locator(".canvas-block__drop-stack--below"),
    (rect) => ({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }),
  );
  const stack = page.locator(".canvas-stack").filter({ has: chart });
  await expect(stack).toHaveCount(1);
  await expect(stack).toHaveAttribute("data-layout-width", "8");

  // Drop the leadership call beside the readout: the two share the sub-row.
  const readout = page.locator('[data-block-id="exec-driver-readout"]');
  await dropCard(page, "exec-decisions", readout, (rect) => ({
    x: rect.left + rect.width * 0.8,
    y: rect.top + rect.height / 2,
  }));
  const decisions = page.locator('[data-block-id="exec-decisions"]');
  await expect(stack.locator(".canvas-block")).toHaveCount(3);
  await expect(readout).toHaveAttribute("data-layout-width", "4");
  await expect(decisions).toHaveAttribute("data-layout-width", "4");
  const readoutStack = await readout.getAttribute("data-stack-id");
  await expect(decisions).toHaveAttribute("data-stack-id", readoutStack!);
  await expect(chart).toHaveAttribute("data-layout-width", "8");
  const readoutBox = (await readout.boundingBox())!;
  const decisionsBox = (await decisions.boundingBox())!;
  expect(Math.abs(readoutBox.y - decisionsBox.y)).toBeLessThan(2);
  expect(decisionsBox.x).toBeGreaterThan(readoutBox.x + readoutBox.width - 1);

  // The pair trades width through the divider between them.
  await readout.locator(".canvas-block__drag").click();
  const divider = readout.getByRole("separator", {
    name: "Resize block width",
  });
  const dividerBox = (await divider.boundingBox())!;
  const pitch = await columnPitch(page);
  await page.mouse.move(dividerBox.x + 4, dividerBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(dividerBox.x + 4 + pitch, dividerBox.y + 8, {
    steps: 4,
  });
  const saved = nextSave(page);
  await page.mouse.up();
  await saved;
  await expect(readout).toHaveAttribute("data-layout-width", "5");
  await expect(decisions).toHaveAttribute("data-layout-width", "3");
});

test("dragging one card's edge shares the remaining width across the row", async ({
  page,
}) => {
  const illustration = page.locator('[data-block-id="exec-illustration"]');
  const otifStack = page.locator(
    '.canvas-stack[data-stack-id="stack:exec-otif:exec-cost"]',
  );
  const fillStack = page.locator(
    '.canvas-stack[data-stack-id="stack:exec-fill:exec-cases"]',
  );
  await expect(illustration).toHaveAttribute("data-layout-width", "4");
  await expect(otifStack).toHaveAttribute("data-layout-width", "4");
  await expect(fillStack).toHaveAttribute("data-layout-width", "4");

  await illustration.evaluate((node) =>
    node.scrollIntoView({ block: "center" }),
  );
  await illustration.locator(".canvas-block__drag").click();
  const divider = illustration.getByRole("separator", {
    name: "Resize block width",
  });
  const dividerBox = (await divider.boundingBox())!;
  const pitch = await columnPitch(page);
  await page.mouse.move(dividerBox.x + 4, dividerBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(dividerBox.x + 4 + pitch * 2, dividerBox.y + 8, {
    steps: 6,
  });
  const saved = nextSave(page);
  await page.mouse.up();
  await saved;
  await expect(illustration).toHaveAttribute("data-layout-width", "6");
  await expect(otifStack).toHaveAttribute("data-layout-width", "3");
  await expect(fillStack).toHaveAttribute("data-layout-width", "3");
  for (const id of ["exec-otif", "exec-cost", "exec-fill", "exec-cases"])
    expect((await layoutOf(page, id)).width).toBe(3);
});

test("shrinking a card brings the whole row back down", async ({ page }) => {
  const otif = page.locator('[data-block-id="exec-otif"]');
  const illustration = page.locator('[data-block-id="exec-illustration"]');
  const dragHeight = async (card: Locator, delta: number) => {
    await card.evaluate((node) => node.scrollIntoView({ block: "center" }));
    await card.locator(".canvas-block__drag").click();
    const handle = card.getByRole("separator", { name: "Resize block height" });
    const box = (await handle.boundingBox())!;
    // Grab the part of the handle inside the card, clear of the floating
    // selection toolbar centred over the edge.
    await page.mouse.move(box.x + 14, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + 14, box.y + 4 + delta, { steps: 6 });
    const saved = nextSave(page);
    await page.mouse.up();
    await saved;
  };

  // Growing a stacked KPI makes its column, and so the row, taller.
  await dragHeight(otif, 160);
  const grown = (await layoutOf(page, "exec-otif")).minHeight;
  expect(grown).toBeGreaterThanOrEqual(240);
  const stretchedIllustration = (await illustration.boundingBox())!.height;
  expect(stretchedIllustration).toBeGreaterThan(300);

  // Shrinking the illustration brings the KPI column down with it.
  await dragHeight(illustration, -(stretchedIllustration - 216));
  expect(
    (await layoutOf(page, "exec-illustration")).minHeight,
  ).toBeLessThanOrEqual(232);
  expect((await layoutOf(page, "exec-otif")).minHeight).toBeLessThan(grown);
  await expect
    .poll(async () => (await illustration.boundingBox())!.height)
    .toBeLessThan(260);
});

test("undo history survives another client re-saving the same content", async ({
  page,
}) => {
  await page.locator(".block-library").getByLabel("Add KPI").click();
  await expect(page.locator(".canvas-block")).toHaveCount(17);
  await waitForSaved(page);
  const undo = page.getByRole("button", { name: "Undo last action" });
  await expect(undo).toBeEnabled();

  // Another client saves the identical state under a new revision.
  const current = (await (await page.request.get("/api/state")).json()) as {
    revision: number;
    state: unknown;
  };
  const resave = await page.request.put("/api/state", {
    headers: { "x-tessera-client-id": "another-window" },
    data: { expectedRevision: current.revision, state: current.state },
  });
  expect(resave.ok()).toBe(true);
  await page.waitForTimeout(600);

  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(page.locator(".canvas-block")).toHaveCount(16);
});
