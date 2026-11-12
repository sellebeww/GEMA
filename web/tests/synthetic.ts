// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
// Sumber audio sintetis: mengirim blok lewat Engine.handle, pesan yang sama dengan yang dikirim worklet.
import { Engine } from "../src/audio/engine";
import { BLOCK_FRAMES, type FromWorker } from "../src/audio/protocol";

export const rng = (seed = 1) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 31) - 1;

export const tone = (fs: number, secs: number, amp: number, hz = 1000): Float32Array =>
  Float32Array.from({ length: Math.round(fs * secs) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / fs));

/** Hening berderau, lalu derau meluruh exp(-6,91 t/T) mulai di `at` detik. */
export function decay(fs: number, total: number, at: number, t60: number, floor = 3e-4): Float32Array {
  const r = rng(7);
  return Float32Array.from({ length: Math.round(fs * total) }, (_, i) => {
    const t = i / fs - at;
    return (t >= 0 ? 0.5 * r() * Math.exp((-6.91 * t) / t60) : 0) + floor * r();
  });
}

export function feed(engine: Engine, samples: Float32Array, blockSize = BLOCK_FRAMES): void {
  for (let i = 0; i + blockSize <= samples.length; i += blockSize) {
    engine.handle({ type: "block", samples: samples.slice(i, i + blockSize) });
  }
}

export const collect = (): { out: FromWorker[]; emit: (m: FromWorker) => void } => {
  const out: FromWorker[] = [];
  return { out, emit: (m) => out.push(m) };
};
