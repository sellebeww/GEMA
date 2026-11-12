// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
// WAV sintetis untuk fake audio device Chromium, 6 detik, diulang terus oleh Chromium:
//  - room : 1 s hening berderau, lalu letusan derau meluruh (T=0,6 s). Cocok untuk alur impuls.
//  - quiet: derau latar stabil pelan, seperti kelas kosong. Cocok untuk Langkah 1 dan 3 (hasil andal).
//  - loud : derau stabil keras. Memicu umpan balik "terlalu bising".
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type FixtureKind = "room" | "quiet" | "loud";

export function writeFixture(path: string, fs = 48000, kind: FixtureKind = "room"): void {
  const n = fs * 6;
  let seed = 7;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 31) - 1;
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + n * 2, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20); // PCM
  pcm.writeUInt16LE(1, 22); // mono
  pcm.writeUInt32LE(fs, 24);
  pcm.writeUInt32LE(fs * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / fs - 1;
    const v =
      kind === "quiet" ? 1.5e-3 * r() : kind === "loud" ? 0.2 * r() : (t >= 0 ? 0.5 * r() * Math.exp((-6.91 * t) / 0.6) : 0) + 3e-4 * r();
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, pcm);
}
