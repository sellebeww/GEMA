// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
// Mikrofon palsu = derau latar stabil pelan (kelas kosong). Satu uji penuh memakai hitung mundur 30 detik sungguhan.
import { expect, test } from "@playwright/test";

test("beranda: info ruang menghitung volume dan batas, lalu hasil Langkah 1 andal dan bertahan setelah muat ulang", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("cukup tenang");
  await page.screenshot({ path: "screenshots/01-beranda-ponsel.png", fullPage: true });

  await page.getByLabel("Nama ruang (opsional)").fill("Kelas 7A");
  await page.getByLabel("Panjang (m)").fill("8");
  await page.getByLabel("Lebar (m)").fill("7,5");
  await page.getByLabel("Tinggi (m)").fill("3");
  await expect(page.getByText("Volume ruang: 180,0 m³")).toBeVisible();
  await expect(page.getByText("Batas waktu dengung: 0,60 detik")).toBeVisible();
  await page.getByLabel("Lebar (m)").fill("abc");
  await expect(page.getByText("Isi dengan angka lebih dari 0")).toBeVisible();
  await page.getByLabel("Lebar (m)").fill("7,5");

  await page.getByRole("button", { name: "Mulai langkah 1" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Langkah 1: Kebisingan latar");
  const start = page.getByRole("button", { name: "Mulai ukur 30 detik" });
  await expect(start).toBeEnabled({ timeout: 20_000 }); // WASM termuat di worker
  await start.click();

  await expect(page.getByTestId("live-dba")).toHaveText(/^\d+,\d$/, { timeout: 15_000 });
  await expect(page.getByText("Belum terkalibrasi").first()).toBeVisible();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "screenshots/02-langkah1-mengukur-ponsel.png" });

  await expect(page.getByTestId("noise-result")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("noise-dba")).toHaveText(/^\d+,\d$/);
  await expect(page.getByTestId("noise-result").getByText("Andal")).toBeVisible();
  await expect(page.getByTestId("noise-result").getByText("Belum terkalibrasi")).toBeVisible();
  const shown = await page.getByTestId("noise-dba").innerText();
  await page.screenshot({ path: "screenshots/03-langkah1-hasil-ponsel.png", fullPage: true });

  // Muat ulang: hasil dan info ruang kembali dari IndexedDB.
  await page.reload();
  await expect(page.getByTestId("noise-dba")).toHaveText(shown);
  await page.getByRole("button", { name: /Beranda/ }).click();
  await expect(page.getByLabel("Nama ruang (opsional)")).toHaveValue("Kelas 7A");

  // Tidak ada gulir horizontal di ponsel.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("tema gelap: tombol mengganti tema dan pilihan bertahan setelah muat ulang", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.getByRole("button", { name: "Ganti ke tema gelap" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "screenshots/04-beranda-gelap.png", fullPage: true });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Ganti ke tema terang" })).toBeVisible();
});

test("mengabaikan data tersimpan yang rusak", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise<void>((res, rej) => {
        const o = indexedDB.open("gema", 1);
        o.onsuccess = () => {
          const t = o.result.transaction("kv", "readwrite");
          t.objectStore("kv").put({ v: 99, screen: "nowhere" }, "session");
          t.oncomplete = () => res();
          t.onerror = () => rej(t.error);
        };
      }),
  );
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("cukup tenang");
});
