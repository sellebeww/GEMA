// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
// Mikrofon palsu = letusan derau meluruh T=0,6 s setiap 6 detik: alur impuls penuh sampai kurva dan ringkasan.
import { expect, test } from "@playwright/test";

const seed = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () =>
      new Promise<void>((res, rej) => {
        const q = (l: number, p: number) => ({ leq_db: l, lmax_db: l + 8, l90_db: l - 2, peak_db: -30, seconds: 30, at: Date.now(), quality: { status: "andal", reasons: [] } });
        const o = indexedDB.open("gema", 1);
        o.onupgradeneeded = () => o.result.createObjectStore("kv");
        o.onsuccess = () => {
          const t = o.result.transaction("kv", "readwrite");
          t.objectStore("kv").put(
            { v: 1, screen: "reverb", room: { name: "Kelas 7A", length: "8", width: "7,5", height: "3" }, noiseEmpty: q(-66, 0), noiseOccupied: q(-44, 0) },
            "session",
          );
          t.oncomplete = () => res();
          t.onerror = () => rej(t.error);
        };
      }),
  );

test("impuls: rekam, hasil andal, kurva interaktif per pita, ringkasan, dan data bertahan setelah muat ulang", async ({ page }) => {
  await page.goto("/");
  await seed(page);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Langkah 2: Waktu dengung");
  await page.screenshot({ path: "screenshots/06-langkah2-instruksi.png", fullPage: true });

  const start = page.getByRole("button", { name: "Mulai merekam" });
  await expect(start).toBeEnabled({ timeout: 20_000 });
  await start.click();
  await expect(page.getByTestId("reverb-result")).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId("rt60-mean")).toHaveText(/^0,\d\d$/);

  const mean = Number((await page.getByTestId("rt60-mean").innerText()).replace(",", "."));
  expect(Math.abs(mean - 0.6) / 0.6).toBeLessThan(0.15); // fixture: T = 0,6 s
  await expect(page.getByTestId("reverb-result").getByText("Andal").first()).toBeVisible();
  // Vonis harus konsisten dengan angka yang ditampilkan (angka dibulatkan 2 desimal, batas 0,60 s).
  const rounded = Math.round(mean * 100) / 100;
  await expect(page.getByTestId("reverb-result").getByText(rounded <= 0.6 ? /Memenuhi batas 0,60 detik/ : /Di atas batas 0,60 detik/)).toBeVisible();

  // Enam tab pita; pita terpilih menampilkan kurva dan bisa dibaca dengan papan tombol.
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(6);
  await expect(page.getByRole("tab", { selected: true })).toContainText("1 kHz");
  await tabs.nth(3).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { selected: true })).toContainText("500 Hz");

  const chart = page.getByRole("img", { name: /Kurva peluruhan bunyi, 500 Hz/ });
  await chart.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("readout")).toHaveText(/^Pada \d,\d\d detik: −?\d+,\d dB$/);
  const box = await chart.boundingBox();
  if (!box) throw new Error("grafik tidak terlihat");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(page.getByTestId("readout")).toHaveText(/^Pada \d,\d\d detik/);
  await page.screenshot({ path: "screenshots/07-langkah2-hasil-kurva.png", fullPage: true });

  // Tema gelap dan ponsel.
  await page.getByRole("button", { name: "Ganti ke tema gelap" }).click();
  await page.screenshot({ path: "screenshots/08-langkah2-hasil-gelap.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "screenshots/09-langkah2-hasil-gelap-ponsel.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Bertahan setelah muat ulang.
  await page.reload();
  await expect(page.getByTestId("rt60-mean")).toHaveText(/^0,\d\d$/);

  await page.getByRole("button", { name: "Lanjut ke saat ramai" }).click();
  await page.getByRole("button", { name: "Lihat ringkasan" }).click().catch(() => undefined);
  await page.getByRole("button", { name: /Ringkasan/ }).click();
  await expect(page.getByTestId("sum-empty")).toHaveText("34,0");
  await expect(page.getByTestId("sum-occupied")).toHaveText("56,0");
  await expect(page.getByTestId("sum-rt60")).toHaveText(/^0,\d\d$/);
  await expect(page.getByText("Saat ramai 22,0 dBA lebih bising dari ruang kosong.")).toBeVisible();
  await expect(page.getByText("Belum terkalibrasi")).toBeVisible();
  await page.screenshot({ path: "screenshots/10-ringkasan-gelap-ponsel.png", fullPage: true });

  await page.getByRole("button", { name: "Mulai dari awal" }).click();
  await page.getByRole("button", { name: "Ya, hapus semua" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("cukup tenang");
});

test("sweep: speaker tidak terdengar mikrofon palsu, hasilnya tetap umpan balik yang jelas (tidak macet)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Waktu dengung/ }).click();
  await page.getByText("Nada sweep dari speaker").click();
  await expect(page.getByRole("img", { name: /speaker/i })).toBeVisible();
  const start = page.getByRole("button", { name: "Mulai merekam" });
  await expect(start).toBeEnabled({ timeout: 20_000 });
  await start.click();
  await expect(page.getByTestId("impulse-state")).toContainText(/Memutar nada|Diam sebentar/, { timeout: 10_000 });
  // Sweep 5 s + ekor: berakhir dengan hasil (mungkin "Perlu diulang") atau pesan gagal, bukan macet.
  await expect(page.getByTestId("reverb-result").or(page.getByText("gemanya tidak terbaca"))).toBeVisible({ timeout: 40_000 });
  await page.screenshot({ path: "screenshots/11-langkah2-sweep.png", fullPage: true });
});
