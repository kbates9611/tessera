import { expect, test } from "@playwright/test";
import { resetBackend, waitForSaved } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetBackend(page);
  await page.goto("/");
  await waitForSaved(page);
});

test("a Sankey built by hand binds step by step and finishes", async ({
  page,
}) => {
  await page.locator(".block-library").getByLabel("Add Sankey").click();
  const placeholder = page.locator(".tile-placeholder").last();
  await placeholder
    .getByRole("button", { name: "Manual", exact: true })
    .click();

  const inspector = page.getByRole("complementary", {
    name: "Sankey settings",
  });
  await inspector
    .getByLabel("Dataset")
    .selectOption({ label: "Northstar Flow Network" });
  await expect(inspector.getByLabel("Dataset")).toHaveValue(
    "northstar-flow-network",
  );
  await expect(inspector.getByLabel("Source field")).toHaveValue("Source");
  await expect(inspector.getByLabel("Target field")).toHaveValue("Target");
  await expect(inspector.getByLabel("Flow value")).toHaveValue("Cases routed");
  await expect(inspector.locator(".inspector-error")).toHaveCount(0);

  await page.getByRole("button", { name: "Finish manual setup" }).click();
  await expect(page.locator(".tile-placeholder")).toHaveCount(0);
  const block = page.locator("[data-block-id]").last();
  await expect(block.locator("svg").first()).toBeVisible();
});

test("changing a ready KPI's dataset by hand keeps it bound", async ({
  page,
}) => {
  await page.locator('[data-block-id="exec-cases"]').click();
  const inspector = page.getByRole("complementary", { name: "KPI settings" });
  await inspector
    .getByLabel("Dataset")
    .selectOption({ label: "Distribution Centers" });
  await expect(inspector.getByLabel("Dataset")).toHaveValue(/./);
  await expect(inspector.getByLabel("Value field")).not.toHaveValue("");
  await expect(inspector.locator(".inspector-error")).toHaveCount(0);
});
