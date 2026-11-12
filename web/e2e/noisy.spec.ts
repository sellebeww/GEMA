// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
// Mikrofon palsu = derau stabil keras: umpan balik langsung "terlalu bising" dan "pemicu tidak terdeteksi".
import { expect, test } from "@playwright/test";

test("langkah 2: bising memberi peringatan langsung, lalu petunjuk bila tak ada bunyi keras", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Waktu dengung/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Langkah 2: Waktu dengung");

  const start = page.getByRole("button", { name: "Mulai merekam" });
  await expect(start).toBeEnabled({ timeout: 20_000 });
  await start.click();

  const floor = page.getByTestId("floor");
  await expect(floor).toContainText("Terlalu bising", { timeout: 15_000 });
  await expect(page.getByTestId("impulse-state")).toContainText("Siap");
  await page.screenshot({ path: "screenshots/05-langkah2-terlalu-bising.png", fullPage: true });

  await expect(page.getByText("Belum ada bunyi keras yang terdeteksi")).toBeVisible({ timeout: 25_000 });

  await page.getByRole("button", { name: "Batalkan" }).click();
  await expect(page.getByTestId("reverb-live")).toHaveCount(0);
  await expect(start).toBeEnabled();
});
