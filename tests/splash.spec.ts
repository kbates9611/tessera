import { expect, test } from "@playwright/test";
import { resetBackend, waitForSaved } from "./helpers";

test("the splash shows the mark and wordmark, then fades out after the shell paints", async ({
  page,
}) => {
  await resetBackend(page);
  // Hold the state response so the splash is observable before the app is ready.
  await page.route("**/api/state", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  await page.goto("/");
  const splash = page.locator(".loading-screen");
  await expect(splash).toBeVisible();
  await expect(splash.locator(".tessera-mark")).toBeVisible();
  await expect(splash.locator("strong")).toHaveText("Tessera");
  await expect(page.locator(".app-shell")).toHaveCount(0);

  // The shell is painted under the splash before the splash fades.
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(splash).toHaveClass(/is-fading/, { timeout: 3000 });
  await expect(splash).toHaveCount(0, { timeout: 3000 });
  await waitForSaved(page);
});
