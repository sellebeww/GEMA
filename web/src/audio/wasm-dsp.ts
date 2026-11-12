// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import init, { level_stats, rt60_bands, schroeder_curves, sweep_deconvolve, sweep_signal } from "../wasm-pkg/dsp_wasm";
import type { BandCurve, Dsp, LevelStats, Rt60Report } from "./protocol";

/** Mengikat fungsi WASM (modul harus sudah diinisialisasi; Node memakai `initSync`). */
export const bindDsp = (): Dsp => ({
  level_stats: (s, fs, b) => level_stats(s, fs, b) as LevelStats,
  rt60_bands: (ir, fs) => rt60_bands(ir, fs) as Rt60Report,
  schroeder_curves: (ir, fs) => schroeder_curves(ir, fs) as BandCurve[],
  sweep_signal,
  sweep_deconvolve,
});

export const loadDsp = async (): Promise<Dsp> => {
  await init();
  return bindDsp();
};
