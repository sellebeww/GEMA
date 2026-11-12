// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import { type FixtureKind, writeFixture } from "./e2e/fixture";

/** Satu proyek per sumber mikrofon palsu: Chromium hanya menerima satu berkas per peluncuran. */
const project = (name: string, kind: FixtureKind, testMatch: string) => {
  const wav = resolve(import.meta.dirname, `e2e/.tmp/${kind}.wav`);
  writeFixture(wav, 48000, kind);
  return {
    name,
    testMatch,
    use: {
      browserName: "chromium" as const,
      baseURL: "http://localhost:5173", // localhost = secure context, jadi getUserMedia boleh tanpa HTTPS
      permissions: ["microphone"],
      launchOptions: {
        args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`],
      },
    },
  };
};

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  workers: 1,
  projects: [project("kelas-kosong", "quiet", "noise.spec.ts"), project("impuls", "room", "reverb.spec.ts"), project("bising", "loud", "noisy.spec.ts")],
  webServer: { command: "npx vite --port 5173 --strictPort", url: "http://localhost:5173", reuseExistingServer: true },
});
