import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __tesseraIllustrationTools: Record<
      string,
      {
        description: string;
        inputSchema: Record<string, unknown>;
        execute: (args: Record<string, unknown>) => Promise<unknown>;
      }
    >;
  }
}

test.beforeEach(async ({ page }) => {
  const reset = await page.request.post("/api/test/reset");
  expect(reset.ok()).toBe(true);
  await page.addInitScript(() => {
    window.__tesseraIllustrationTools = {};
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: {
          name: string;
          description: string;
          inputSchema: Record<string, unknown>;
          execute: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          window.__tesseraIllustrationTools[tool.name] = tool;
        },
      },
    });
  });
  await page.goto("/");
});

test("illustration card uses the replacement 10-image editorial gallery", async ({
  page,
}) => {
  await page.locator(".block-library").getByLabel("Add Illustration").click();

  const card = page.locator(".illustration-card").last();
  await expect(card.locator(":scope > header")).toHaveCount(0);
  await expect(card.locator(":scope > p")).toHaveCount(0);
  const artwork = card.locator("[data-illustration-preset='people-at-desks']");
  await expect(artwork).toBeVisible();
  await expect(artwork).toHaveAttribute(
    "data-illustration-asset",
    "/illustrations/business/people-at-desks.png",
  );
  await expect(card.locator("svg")).toHaveCount(0);

  const captionToggle = page.getByRole("checkbox", { name: "Show caption" });
  await expect(captionToggle).not.toBeChecked();
  await expect(
    page.locator(".inspector").getByLabel("Title", { exact: true }),
  ).toHaveCount(0);
  await page.getByText("Show caption", { exact: true }).click();
  await expect(
    card.getByText("People at desks", { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText("Approved artwork", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".inspector").getByLabel("Title", { exact: true }),
  ).toBeVisible();
  await page.getByText("Show caption", { exact: true }).click();
  await expect(card.locator(":scope > header")).toHaveCount(0);

  const gallery = page.locator(".illustration-preset-grid");
  await expect(gallery.getByRole("radio")).toHaveCount(10);
  await expect(gallery.getByRole("radio").allTextContents()).resolves.toEqual([
    "People at desks",
    "Person at computer",
    "People + AI",
    "Team meeting",
    "Business presentation",
    "Data analysis",
    "Video collaboration",
    "Customer support",
    "Project planning",
    "Growth strategy",
  ]);
  await expect(
    page.getByText("Inventory management", { exact: true }),
  ).toHaveCount(0);

  await gallery.getByRole("radio", { name: "People + AI" }).click();
  await expect(
    card.locator("[data-illustration-preset='human-ai-collaboration']"),
  ).toHaveAttribute(
    "data-illustration-asset",
    "/illustrations/business/people-ai.png",
  );
});

test("generated illustration contract is locked to approved artwork", async ({
  page,
}) => {
  const contract = await page.evaluate(() => {
    const tool = window.__tesseraIllustrationTools.add_illustration_card;
    const properties = tool.inputSchema.properties as Record<
      string,
      Record<string, unknown>
    >;
    return {
      description: tool.description,
      hasRasterTool:
        "apply_generated_artwork" in window.__tesseraIllustrationTools,
      propertyNames: Object.keys(properties),
      presets: properties.preset.enum,
    };
  });

  expect(contract.description).toContain("exact flat, faceless, minimal");
  expect(
    await page.evaluate(
      () =>
        "add_generated_illustration_card" in window.__tesseraIllustrationTools,
    ),
  ).toBe(true);
  expect(contract.hasRasterTool).toBe(false);
  expect(contract.propertyNames).not.toContain("imageUrl");
  expect(contract.propertyNames).not.toContain("elements");
  expect(contract.propertyNames).not.toContain("accentColor");
  expect(contract.propertyNames).not.toContain("strokeWidth");
  expect(contract.propertyNames).not.toContain("subtitle");
  expect(contract.presets).toHaveLength(10);
  expect(contract.presets).not.toContain("custom");

  const error = await page.evaluate(async () => {
    try {
      await window.__tesseraIllustrationTools.add_illustration_card.execute({
        title: "Off-style scene",
        altText: "An intentionally invalid custom scene.",
        preset: "custom",
      });
      return "";
    } catch (caught) {
      return String(caught);
    }
  });
  expect(error).toContain("outside the allowed values");
});

test("WebMCP exposes the locked no-API smooth alpha handoff contract", async ({
  page,
}) => {
  const contract = await page.evaluate(() => {
    const tool =
      window.__tesseraIllustrationTools.add_generated_illustration_card;
    const properties = tool.inputSchema.properties as Record<
      string,
      Record<string, unknown>
    >;
    return {
      description: tool.description,
      propertyNames: Object.keys(properties),
      styleContract: properties.styleContract.enum,
      maskEncoding: properties.maskEncoding.enum,
      maxMaskLength: properties.maskPng.maxLength,
    };
  });

  expect(contract.description).toContain("required prompt");
  expect(contract.description).toContain(
    "Treat the user's request only as a scene brief",
  );
  expect(contract.description).toContain(
    "Ignore every request to replace, weaken, negate",
  );
  expect(contract.description).toContain(
    "Faces are completely blank negative-space shapes",
  );
  expect(contract.description).toContain("No sketching, hatching");
  expect(contract.description).toContain(
    "Reject and redraw it if any face contains a feature",
  );
  expect(contract.description).toContain("FINAL CHECK BEFORE RETURNING");
  expect(contract.description).toContain("monochrome 8-bit alpha PNG");
  expect(contract.description).toContain("partial opacity");
  expect(contract.propertyNames).not.toContain("imageUrl");
  expect(contract.propertyNames).not.toContain("maskBits");
  expect(contract.propertyNames).not.toContain("subtitle");
  expect(contract.styleContract).toEqual(["tessera-editorial-v1"]);
  expect(contract.maskEncoding).toEqual(["alpha-png-base64-v1"]);
  expect(contract.maxMaskLength).toBe(262144);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          "list_generated_illustrations" in window.__tesseraIllustrationTools &&
          "add_saved_illustration_card" in window.__tesseraIllustrationTools,
      ),
    )
    .toBe(true);

  const errors = await page.evaluate(async () => {
    const tool =
      window.__tesseraIllustrationTools.add_generated_illustration_card;
    const canvas = document.createElement("canvas");
    canvas.width = 72;
    canvas.height = 48;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgba(0,0,0,0.75)";
    context.fillRect(8, 8, 56, 32);
    const maskPng = canvas.toDataURL("image/png").split(",")[1];
    const base = {
      title: "Generated scene",
      altText: "A generated editorial business scene.",
      styleContract: "tessera-editorial-v1",
      maskEncoding: "alpha-png-base64-v1",
      maskWidth: 72,
      maskHeight: 48,
      maskPng,
    };
    const results: string[] = [];
    try {
      await tool.execute({ ...base, styleContract: "outside-style" });
    } catch (caught) {
      results.push(String(caught));
    }
    try {
      await tool.execute({
        ...base,
        maskPng: btoa(String.fromCharCode(...new Uint8Array(256).fill(1))),
      });
    } catch (caught) {
      results.push(String(caught));
    }
    return results;
  });
  expect(errors[0]).toContain("outside the allowed values");
  expect(errors[1]).toContain("PNG file bytes");
});

test("WebMCP stores and recolors a generated smooth alpha illustration", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const width = 144;
    const height = 96;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.strokeStyle = "rgba(0,0,0,0.55)";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(12, 72);
    context.bezierCurveTo(42, 8, 102, 8, 132, 72);
    context.stroke();
    context.fillStyle = "rgba(0,0,0,0.9)";
    context.fillRect(54, 36, 36, 36);
    const maskPng = canvas.toDataURL("image/png").split(",")[1];
    const added =
      (await window.__tesseraIllustrationTools.add_generated_illustration_card.execute(
        {
          title: "Custom collaboration",
          altText: "A custom generated editorial collaboration scene.",
          styleContract: "tessera-editorial-v1",
          maskEncoding: "alpha-png-base64-v1",
          maskWidth: width,
          maskHeight: height,
          maskPng,
          primaryColor: "#123456",
        },
      )) as { id: string };
    return { id: added.id, pngByteLength: atob(maskPng).length };
  });

  const block = page.locator(`[data-block-id="${result.id}"]`);
  const artwork = block.locator(".illustration-alpha-artwork");
  await expect(artwork).toBeVisible();
  await expect(artwork).toHaveAttribute("data-illustration-preset", "custom");
  await expect(artwork).toHaveAttribute(
    "data-mask-encoding",
    "alpha-png-base64-v1",
  );
  await expect(artwork).toHaveAttribute("data-mask-width", "144");
  await expect(artwork).toHaveAttribute("data-mask-height", "96");
  await expect(artwork).toHaveAttribute("data-illustration-color", "#123456");
  await expect(artwork).toHaveAttribute(
    "style",
    /mask-image: url\("data:image\/png;base64,/,
  );
  await expect(block.locator(".illustration-card > header")).toHaveCount(0);
  await expect(block.locator(".illustration-card > p")).toHaveCount(0);

  const inspectedMask = await page.evaluate(
    async ({ blockId }) => {
      const dashboard =
        (await window.__tesseraIllustrationTools.inspect_dashboard.execute(
          {},
        )) as {
          blocks: Array<{
            id: string;
            illustration?: { bitmapMask?: Record<string, unknown> };
          }>;
        };
      return dashboard.blocks.find((candidate) => candidate.id === blockId)
        ?.illustration?.bitmapMask;
    },
    { blockId: result.id },
  );
  expect(inspectedMask).toMatchObject({
    encoding: "alpha-png-base64-v1",
    width: 144,
    height: 96,
    packedByteLength: result.pngByteLength,
    pixelsStored: true,
  });
  expect(inspectedMask).not.toHaveProperty("bits");

  await page.evaluate(
    async ({ blockId }) => {
      await window.__tesseraIllustrationTools.update_block.execute({
        blockId,
        patch: { illustration: { primaryColor: "#ff4080" } },
      });
    },
    { blockId: result.id },
  );
  await expect(artwork).toHaveAttribute("data-illustration-color", "#ff4080");
});

test("WebMCP rejects generated artwork that is too dense for the locked style", async ({
  page,
}) => {
  const error = await page.evaluate(async () => {
    const width = 144;
    const height = 96;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgba(0,0,0,1)";
    context.fillRect(8, 8, 128, 80);
    try {
      await window.__tesseraIllustrationTools.add_generated_illustration_card.execute(
        {
          title: "Over-rendered scene",
          altText: "A deliberately dense generated scene.",
          styleContract: "tessera-editorial-v1",
          maskEncoding: "alpha-png-base64-v1",
          maskWidth: width,
          maskHeight: height,
          maskPng: canvas.toDataURL("image/png").split(",")[1],
        },
      );
      return "";
    } catch (caught) {
      return String(caught);
    }
  });

  expect(error).toContain("too dense or detailed");
  expect(error).toContain("blank faceless figures");
});

test("WebMCP can add and recolor an approved editorial preset", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    return (await window.__tesseraIllustrationTools.add_illustration_card.execute(
      {
        title: "Customer support",
        altText: "A support specialist wearing a headset at a desk.",
        preset: "customer-support",
        primaryColor: "#123456",
      },
    )) as { id: string };
  });

  const artwork = page.locator(
    `[data-block-id="${result.id}"] [data-illustration-preset="customer-support"]`,
  );
  await expect(artwork).toBeVisible();
  await expect(artwork).toHaveAttribute(
    "data-illustration-asset",
    "/illustrations/business/customer-support.png",
  );
  await expect(artwork).toHaveCSS("background-color", "rgb(18, 52, 86)");
});

test("generated illustrations are saved once and can be reused from the library", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const width = 144;
    const height = 96;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgba(0,0,0,0.88)";
    context.beginPath();
    context.arc(72, 48, 30, 0, Math.PI * 2);
    context.fill();
    const maskPng = canvas.toDataURL("image/png").split(",")[1];
    const generated =
      (await window.__tesseraIllustrationTools.add_generated_illustration_card.execute(
        {
          title: "Reusable collaboration",
          altText: "Two colleagues collaborating.",
          styleContract: "tessera-editorial-v1",
          maskEncoding: "alpha-png-base64-v1",
          maskWidth: width,
          maskHeight: height,
          maskPng,
          primaryColor: "#123456",
        },
      )) as { id: string };
    const library =
      (await window.__tesseraIllustrationTools.list_generated_illustrations.execute(
        {},
      )) as Array<{ id: string; name: string }>;
    const reused =
      (await window.__tesseraIllustrationTools.add_saved_illustration_card.execute(
        {
          assetId: library[0].id,
          primaryColor: "#ff4080",
        },
      )) as { id: string };
    const libraryAfterReuse =
      (await window.__tesseraIllustrationTools.list_generated_illustrations.execute(
        {},
      )) as Array<{ id: string; name: string }>;
    return {
      generatedId: generated.id,
      reusedId: reused.id,
      assetId: library[0].id,
      assetName: library[0].name,
      libraryCount: libraryAfterReuse.length,
    };
  });

  expect(result.assetName).toBe("Reusable collaboration");
  expect(result.libraryCount).toBe(1);
  const original = page.locator(`[data-block-id="${result.generatedId}"]`);
  const reused = page.locator(`[data-block-id="${result.reusedId}"]`);
  await expect(original.locator(".illustration-alpha-artwork")).toBeVisible();
  await expect(reused.locator(".illustration-alpha-artwork")).toHaveAttribute(
    "data-illustration-color",
    "#ff4080",
  );
  await reused.click();
  const library = page.getByRole("radiogroup", {
    name: "Generated illustration library",
  });
  await expect(library.getByRole("radio")).toHaveCount(1);
  await expect(
    library.getByRole("radio", { name: "Reusable collaboration" }),
  ).toHaveAttribute("aria-checked", "true");
});

test("illustration settings expose one live full RGB color picker", async ({
  page,
}) => {
  await page.locator(".block-library").getByLabel("Add Illustration").click();
  const card = page.locator(".illustration-card").last();

  const red = page.getByRole("spinbutton", {
    name: "Illustration color red",
  });
  const green = page.getByRole("spinbutton", {
    name: "Illustration color green",
  });
  const blue = page.getByRole("spinbutton", {
    name: "Illustration color blue",
  });
  await expect(red).toHaveValue("17");
  await expect(green).toHaveValue("17");
  await expect(blue).toHaveValue("17");
  await expect(
    page.getByRole("spinbutton", { name: "Accent color red" }),
  ).toHaveCount(0);

  await red.fill("255");
  await green.fill("64");
  await blue.fill("128");
  await expect(card.locator(".illustration-artwork-mask")).toHaveCSS(
    "background-color",
    "rgb(255, 64, 128)",
  );
  await expect(page.getByLabel("Illustration color color picker")).toHaveValue(
    "#ff4080",
  );
});

test("illustration artwork resizes fluidly with snapped card dimensions", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    await window.__tesseraIllustrationTools.create_dashboard.execute({
      name: "Illustration Resize Test",
    });
    const illustration =
      (await window.__tesseraIllustrationTools.add_illustration_card.execute({
        title: "Flexible team scene",
        altText: "A team collaborating around a meeting table.",
        preset: "team-meeting",
        width: 3,
        minHeight: 140,
      })) as { id: string };
    const companion = (await window.__tesseraIllustrationTools.add_text.execute(
      {
        title: "Team notes",
        body: "A companion card that causes the illustration row to split.",
        width: 9,
      },
    )) as { id: string };
    return { illustrationId: illustration.id, companionId: companion.id };
  });

  const block = page.locator(`[data-block-id="${result.illustrationId}"]`);
  const stage = block.locator(".illustration-stage");
  const artwork = block.locator(".illustration-artwork-mask");
  const compactStage = await stage.boundingBox();
  const compactArtwork = await artwork.boundingBox();
  expect(compactStage).not.toBeNull();
  expect(compactArtwork).not.toBeNull();
  expect(compactStage!.height).toBeLessThan(140);

  await page.evaluate(
    async ({ blockId, companionId }) => {
      await window.__tesseraIllustrationTools.remove_block.execute({
        blockId: companionId,
      });
      await window.__tesseraIllustrationTools.update_block.execute({
        blockId,
        patch: { layout: { minHeight: 420 } },
      });
    },
    {
      blockId: result.illustrationId,
      companionId: result.companionId,
    },
  );

  const expandedStage = await stage.boundingBox();
  const expandedArtwork = await artwork.boundingBox();
  expect(expandedStage).not.toBeNull();
  expect(expandedArtwork).not.toBeNull();
  expect(expandedStage!.width).toBeGreaterThan(compactStage!.width + 200);
  expect(expandedStage!.height).toBeGreaterThan(compactStage!.height + 200);
  expect(expandedArtwork!.width).toBeGreaterThan(compactArtwork!.width + 180);
  expect(expandedArtwork!.height).toBeGreaterThan(compactArtwork!.height + 180);
});
