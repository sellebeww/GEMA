// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { Engine } from "../src/audio/engine";
import type { Dsp } from "../src/audio/protocol";
import { ImpulseRecorder } from "../src/audio/recorder";
import { Ring } from "../src/audio/ring";
import { checkProcessing } from "../src/audio/useMicrophone";
import { initSync } from "../src/wasm-pkg/dsp_wasm";
import { bindDsp } from "../src/audio/wasm-dsp";
import { collect, decay, feed, rng, tone } from "./synthetic";

let dsp: Dsp;
beforeAll(() => {
  initSync({ module: readFileSync(new URL("../src/wasm-pkg/dsp_wasm_bg.wasm", import.meta.url)) });
  dsp = bindDsp();
});

describe("Ring", () => {
  it("menyimpan sampel terakhir melewati batas lingkaran", () => {
    const r = new Ring(5);
    r.push(Float32Array.of(1, 2, 3));
    r.push(Float32Array.of(4, 5, 6, 7));
    expect([...r.last(5)]).toEqual([3, 4, 5, 6, 7]);
    expect([...r.last(2)]).toEqual([6, 7]);
    r.push(Float32Array.of(8, 9, 10, 11, 12, 13)); // lebih besar dari kapasitas
    expect([...r.last(99)]).toEqual([9, 10, 11, 12, 13]);
  });
});

describe("checkProcessing", () => {
  it("patuh bila ketiganya false", () => {
    expect(checkProcessing({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })).toEqual([]);
  });
  it("memperingatkan fitur yang aktif atau tidak dilaporkan (iOS Safari)", () => {
    expect(checkProcessing({ echoCancellation: true, noiseSuppression: false })).toEqual([
      { feature: "echoCancellation", state: "aktif" },
      { feature: "autoGainControl", state: "tidak-diketahui" },
    ]);
  });
});

describe("ImpulseRecorder", () => {
  const fs = 48000;
  it("memicu pada lonjakan, menyertakan pra-pemicu, dan panjang tepat", () => {
    const rec = new ImpulseRecorder(fs, { recordS: 3 });
    const sig = decay(fs, 6, 1.0, 0.6);
    let capture: Float32Array | null = null;
    for (let i = 0; i + 2048 <= sig.length && !capture; i += 2048) capture = rec.push(sig.slice(i, i + 2048));
    expect(capture).not.toBeNull();
    expect(capture?.length).toBe(Math.round(0.25 * fs) + 3 * fs);
    const onset = capture?.findIndex((v) => Math.abs(v) > 0.02) ?? -1;
    expect(onset).toBeGreaterThanOrEqual(Math.round(0.25 * fs)); // pra-pemicu 0,25 s terisi hening
    expect(onset).toBeLessThan(Math.round(0.25 * fs) + 2048);
  });
  it("tidak memicu pada derau latar stabil", () => {
    const rec = new ImpulseRecorder(fs);
    const r = rng(3);
    for (let b = 0; b < 200; b++) rec.push(Float32Array.from({ length: 2048 }, () => 3e-3 * r()));
    expect(rec.state).toBe("armed");
  });
  it("menjepit durasi rekam ke 2..4 detik", () => {
    const rec = new ImpulseRecorder(fs, { recordS: 30, preS: 0 });
    const sig = decay(fs, 8, 1.0, 0.6);
    let capture: Float32Array | null = null;
    for (let i = 0; i + 2048 <= sig.length && !capture; i += 2048) capture = rec.push(sig.slice(i, i + 2048));
    expect(capture?.length).toBe(4 * fs);
  });
});

describe("Engine lewat jalur sintetis (tanpa mikrofon)", () => {
  it("level live dan akhir: nada 1 kHz amplitudo 0,1 = -23,01 dBFS", () => {
    const { out, emit } = collect();
    const e = new Engine(dsp, emit);
    e.handle({ type: "start", mode: "level", fs: 48000 });
    feed(e, tone(48000, 5, 0.1));
    e.handle({ type: "stop" });
    const levels = out.flatMap((m) => (m.type === "level" ? [m.leq_db] : []));
    expect(levels.length).toBeGreaterThan(40);
    expect(Math.abs((levels.at(-1) ?? 0) + 23.01)).toBeLessThan(0.3);
    const fin = out.find((m) => m.type === "level-final");
    expect(fin?.type === "level-final" && Math.abs(fin.stats.leq_db + 23.01) < 0.1).toBe(true);
  });

  it.each([48000, 44100])("RT60 0,6 s terukur dalam 10%% pada fs=%i", (fs) => {
    const { out, emit } = collect();
    const e = new Engine(dsp, emit);
    e.handle({ type: "start", mode: "impulse", fs });
    feed(e, decay(fs, 6, 1.0, 0.6));
    const states = out.flatMap((m) => (m.type === "impulse-state" ? [m.state] : []));
    expect(states).toEqual(["warmup", "armed", "recording", "done"]);
    const res = out.find((m) => m.type === "impulse-result");
    expect(res?.type).toBe("impulse-result");
    if (res?.type !== "impulse-result") return;
    expect(res.clipped).toBe(false);
    expect(Math.abs((res.report.mean_500_1k_2k ?? 0) - 0.6)).toBeLessThan(0.06);
  });

  it("melaporkan error (bukan melempar) untuk sample rate tidak valid", () => {
    const { out, emit } = collect();
    new Engine(dsp, emit).handle({ type: "start", mode: "level", fs: 0 });
    expect(out[0]?.type).toBe("error");
  });
});
