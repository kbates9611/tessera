import { expect, test } from "@playwright/test";
import { installModelContextStub, resetBackend, waitForSaved } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetBackend(page);
});

test("the agent panel explains the WebMCP surface and offers requests to copy", async ({
  page,
}) => {
  await page.goto("/");
  await waitForSaved(page);
  const trigger = page.getByRole("button", { name: "Open the agent panel" });
  await expect(trigger).toContainText("Agent ready");
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Work with your agent" });
  await expect(dialog).toContainText("64 operations");
  await expect(dialog).toContainText("Waiting for an agent");
  const warehouse = dialog
    .locator("details")
    .filter({ hasText: "Data warehouse" });
  await expect(warehouse).toContainText("update_dataset_recipe");
  await expect(warehouse).toContainText("propose_dataset_month_outline");
  await expect(
    dialog.getByRole("button", { name: /^Copy request:/ }).first(),
  ).toBeVisible();
  await expect(dialog).toContainText("you can also do by hand");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("a connected agent is reported in the top bar and the panel", async ({
  page,
}) => {
  await installModelContextStub(page, { native: true });
  await page.goto("/");
  await waitForSaved(page);
  const trigger = page.getByRole("button", { name: "Open the agent panel" });
  await expect(trigger).toContainText("Agent connected");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Work with your agent" });
  await expect(dialog).toContainText("7 registered in this browser");
});
