// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
// Jalur sintetis untuk fitur yang dibutuhkan UI: kurva Schroeder, lantai derau, kegagalan pemicu, sweep.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { Engine } from "../src/audio/engine";
import { BLOCK_FRAMES, SWEEP, type Dsp, type FromWorker } from "../src/audio/protocol";
import { bindDsp } from "../src/audio/wasm-dsp";
import { TOO_NOISY_FLOOR_DBFS } from "../src/measure";
import { initSync } from "../src/wasm-pkg/dsp_wasm";
import { collect, decay, feed, rng, tone } from "./synthetic";

let dsp: Dsp;
beforeAll(() => {
  initSync({ module: readFileSync(new URL("../src/wasm-pkg/dsp_wasm_bg.wasm", import.meta.url)) });
  dsp = bindDsp();
});

const of = <T extends FromWorker["type"]>(out: FromWorker[], type: T) =>
  out.filter((m): m is Extract<FromWorker, { type: T }> => m.type === type);

describe("impuls: umpan balik dan kurva", () => {
  const fs = 48000;
  it("hasil menyertakan 6 kurva Schroeder yang turun, <= 400 titik, mencapai -30 dB sekitar 0,3 s di 1 kHz", () => {
    const { out, emit } = collect();
    const e = new Engine(dsp, emit);
    e.handle({ type: "start", mode: "impulse", fs });
    feed(e, decay(fs, 6, 1.0, 0.6));
    const res = of(out, "impulse-result")[0];
    expect(res).toBeDefined();
    expect(res?.curves.map((c) => c.band_hz)).toEqual([125, 250, 500, 1000, 2000, 4000]);
    for (const c of res?.curves ?? []) {
      expect(c.db.length).toBeLessThanOrEqual(400);
      expect(c.db[0]).toBeCloseTo(0, 1);
      expect(c.db.every((v, i, a) => i === 0 || v <= (a[i - 1] ?? 0) + 1e-3)).toBe(true);
    }
    const k = res?.curves.find((c) => c.band_hz === 1000);
    const i = k?.db.findIndex((v) => v <= -30) ?? -1;
    expect(i).toBeGreaterThan(0);
    expect(Math.abs(i * (k?.step_s ?? 0) - 0.3)).toBeLessThan(0.08);
  });

  it("melaporkan lantai derau saat warmup dan siaga; bising tinggi melewati ambang 'terlalu bising'", () => {
    const quiet = collect();
    const q = new Engine(dsp, quiet.emit);
    q.handle({ type: "start", mode: "impulse", fs });
    feed(q, decay(fs, 1, 9, 0.6)); // hanya derau latar 3e-4
    const qf = of(quiet.out, "impulse-floor");
    expect(qf.length).toBeGreaterThan(3);
    expect(qf.every((m) => m.floor_db < TOO_NOISY_FLOOR_DBFS)).toBe(true);

    const loud = collect();
    const l = new Engine(dsp, loud.emit);
    l.handle({ type: "start", mode: "impulse", fs });
    const r = rng(11);
    for (let b = 0; b < 40; b++) l.handle({ type: "block", samples: Float32Array.from({ length: BLOCK_FRAMES }, () => 0.2 * r()) });
    const lf = of(loud.out, "impulse-floor");
    expect(lf.at(-1)?.floor_db).toBeGreaterThan(TOO_NOISY_FLOOR_DBFS);
    expect(of(loud.out, "impulse-state").map((m) => m.state)).toEqual(["warmup", "armed"]); // bising stabil tidak memicu
  });

  it("DSP yang gagal menjadi pesan impulse-failed, bukan error umum, dan mesin siap mengulang", () => {
    const { out, emit } = collect();
    const broken: Dsp = {
      ...dsp,
      rt60_bands: () => {
        throw new Error("tidak ada peluruhan bunyi");
      },
    };
    const e = new Engine(broken, emit);
    e.handle({ type: "start", mode: "impulse", fs });
    feed(e, decay(fs, 6, 1.0, 0.6));
    expect(of(out, "impulse-failed")[0]?.message).toBe("tidak ada peluruhan bunyi");
    expect(of(out, "error")).toHaveLength(0);
    expect(of(out, "impulse-result")).toHaveLength(0);

    out.length = 0;
    e.handle({ type: "start", mode: "impulse", fs }); // ulangi tanpa membuat Engine baru
    expect(() => feed(e, decay(fs, 1, 9, 0.6))).not.toThrow();
    expect(of(out, "impulse-state")[0]?.state).toBe("warmup");
  });
});

describe("level: puncak untuk deteksi clipping", () => {
  it("level-final menyertakan puncak (nada 0,1 = -20 dBFS)", () => {
    const { out, emit } = collect();
    const e = new Engine(dsp, emit);
    e.handle({ type: "start", mode: "level", fs: 48000 });
    feed(e, tone(48000, 3, 0.1));
    e.handle({ type: "stop" });
    const fin = of(out, "level-final")[0];
    expect(Math.abs((fin?.peak_db ?? 0) + 20)).toBeLessThan(0.2);
  });
});

describe("sweep (tanpa speaker: ruang disimulasikan dengan konvolusi)", () => {
  const fs = 48000;
  /** Respons impuls jarang (600 tap) dengan peluruhan eksponensial T60 = 0,6 s. */
  function room(signal: Float32Array, t60: number): Float32Array {
    const r = rng(5);
    const taps = Array.from({ length: 600 }, () => {
      const t = Math.abs(r()) * 1.2;
      return { n: Math.round(t * fs), g: r() * Math.exp((-6.91 * t) / t60) };
    });
    taps.push({ n: 0, g: 1 });
    const out = new Float32Array(signal.length + Math.round(1.2 * fs) + 1);
    for (const { n, g } of taps) for (let i = 0; i < signal.length; i++) out[i + n] = (out[i + n] ?? 0) + g * (signal[i] ?? 0);
    const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    return out.map((v) => (0.5 * v) / peak);
  }

  it("warmup, lalu meminta pemutaran sweep, merekam, dan mengukur RT60 0,6 s dalam 15%", () => {
    const { out, emit } = collect();
    const e = new Engine(dsp, emit);
    e.handle({ type: "start", mode: "sweep", fs });
    const r = rng(2);
    // warmup: derau latar kecil
    for (let b = 0; b < 12 && of(out, "sweep-signal").length === 0; b++) {
      e.handle({ type: "block", samples: Float32Array.from({ length: BLOCK_FRAMES }, () => 3e-4 * r()) });
    }
    const played = of(out, "sweep-signal")[0];
    expect(played?.samples.length).toBe(Math.round(SWEEP.secs * fs));
    expect(of(out, "impulse-state").map((m) => m.state)).toEqual(["warmup", "recording"]);

    // rekaman: jeda 0,1 s, lalu sweep yang melewati "ruang", lalu derau latar sampai durasi target tercapai
    const heard = room(played?.samples ?? new Float32Array(), 0.6);
    const total = Math.round((0.5 + SWEEP.secs + SWEEP.tailS + 0.5) * fs);
    const rec = Float32Array.from({ length: total }, (_, i) => (heard[i - Math.round(0.1 * fs)] ?? 0) + 3e-4 * r());
    feed(e, rec);

    expect(of(out, "impulse-state").map((m) => m.state).at(-1)).toBe("done");
    expect(of(out, "impulse-failed")).toHaveLength(0);
    const res = of(out, "impulse-result")[0];
    expect(res).toBeDefined();
    expect(res?.clipped).toBe(false);
    const mean = res?.report.mean_500_1k_2k ?? 0;
    expect(Math.abs(mean - 0.6) / 0.6).toBeLessThan(0.15);
    expect(res?.curves).toHaveLength(6);
  });
});
