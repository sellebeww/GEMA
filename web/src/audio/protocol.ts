// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
// Kontrak pesan antara UI, AudioWorklet dan Worker, plus tipe hasil WASM (cermin struct serde di dsp/).

/** Panjang blok yang dikirim worklet (16 kuantum render 128 sampel). */
export const BLOCK_FRAMES = 2048;

export interface LevelStats {
  leq_db: number;
  lmax_db: number;
  l90_db: number;
  blocks: number;
}

export interface Fit {
  seconds: number;
  r: number;
}

export interface BandRt60 {
  band_hz: number;
  t20: Fit | null;
  t30: Fit | null;
  method: string;
  rt60: number | null;
  dynamic_range_db: number;
  headroom_db: number;
  reliable: boolean;
}

/** Kurva peluruhan Schroeder satu pita oktaf, titik ke-i di i * step_s detik. */
export interface BandCurve {
  band_hz: number;
  step_s: number;
  db: number[];
}

/** Parameter sweep: harus sama antara pemutaran dan dekonvolusi. */
export const SWEEP = { f1: 100, f2: 8000, secs: 5, tailS: 2.5 } as const;

export interface Rt60Report {
  bands: BandRt60[];
  mean_500_1k_2k: number | null;
  mean_reliable: boolean;
}

/** Permukaan WASM yang dipakai Engine; diinjeksi agar bisa diuji di Node. */
export interface Dsp {
  level_stats(samples: Float32Array, fs: number, blockS: number): LevelStats;
  rt60_bands(ir: Float32Array, fs: number): Rt60Report;
  schroeder_curves(ir: Float32Array, fs: number): BandCurve[];
  sweep_signal(fs: number, f1: number, f2: number, secs: number): Float32Array;
  sweep_deconvolve(recording: Float32Array, fs: number, f1: number, f2: number, secs: number): Float32Array;
}

export type Mode = "level" | "impulse" | "sweep";

export type ImpulseState = "warmup" | "armed" | "recording" | "done";

export type ToWorker =
  | { type: "init" }
  | { type: "attach-port"; port: MessagePort }
  | { type: "start"; mode: Mode; fs: number }
  | { type: "block"; samples: Float32Array }
  | { type: "stop" };

export type FromWorker =
  | { type: "ready" }
  /** Level live (LAeq jendela 1 s) dalam dBFS, belum ditambah offset kalibrasi. */
  | { type: "level"; leq_db: number }
  /** Hasil akhir mode level saat berhenti, dari seluruh rekaman. */
  | { type: "level-final"; stats: LevelStats; seconds: number; peak_db: number }
  | { type: "impulse-state"; state: ImpulseState }
  /** Lantai derau latar (puncak blok, dBFS) selama warmup dan menunggu pemicu. */
  | { type: "impulse-floor"; floor_db: number }
  | { type: "impulse-result"; fs: number; report: Rt60Report; curves: BandCurve[]; peak_db: number; clipped: boolean }
  /** Rekaman sudah ada tetapi tidak menghasilkan peluruhan yang bisa dibaca (pemicu salah, terlalu pelan, terlalu pendek). */
  | { type: "impulse-failed"; message: string }
  /** Sinyal sweep yang harus diputar UI tepat setelah pesan ini. */
  | { type: "sweep-signal"; samples: Float32Array }
  | { type: "error"; message: string };
