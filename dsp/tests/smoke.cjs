// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
// Uji asap API wasm: node tests/smoke.cjs <direktori pkg hasil `wasm-pack build --target nodejs`>
const assert = require("node:assert/strict");
const path = require("node:path");
const dsp = require(path.resolve(process.argv[2] ?? "pkg-node"));

const fs = 48000;
let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 31) - 1; // LCG di [-1, 1)

// 1) Tingkat bunyi: nada 1 kHz amplitudo 0,1 = -23,01 dBFS RMS.
const tone = Float32Array.from({ length: fs * 5 }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / fs));
const lv = dsp.level_stats(tone, fs, 0.125);
assert.ok(Math.abs(lv.leq_db + 23.01) < 0.05, `leq ${lv.leq_db}`);
assert.ok(Math.abs(lv.lmax_db + 23.01) < 0.1, `lmax ${lv.lmax_db}`);
assert.ok(Math.abs(lv.l90_db + 23.01) < 0.1, `l90 ${lv.l90_db}`);
assert.equal(lv.blocks, 40);
assert.throws(() => dsp.level_stats(new Float32Array(0), fs, 0.125), /./);

// 2) RT60: peluruhan derau T = 0,6 s, lantai -70 dB.
const t60 = 0.6;
const room = Float32Array.from({ length: Math.round(fs * (0.2 + 2.0)) }, (_, i) => {
  const t = i / fs - 0.2;
  return (t >= 0 ? rnd() * Math.exp((-6.91 * t) / t60) : 0) + 3e-4 * rnd();
});
const rep = dsp.rt60_bands(room, fs);
assert.equal(rep.bands.length, 6);
assert.deepEqual(rep.bands.map((b) => b.band_hz), [125, 250, 500, 1000, 2000, 4000]);
const b1k = rep.bands[3];
assert.equal(typeof b1k.reliable, "boolean");
assert.ok(Math.abs(b1k.rt60 - t60) / t60 < 0.1, `rt60 1k ${b1k.rt60}`);
assert.ok(b1k.t30.r > 0.99 && b1k.t20.r > 0.99);
assert.ok(Math.abs(rep.mean_500_1k_2k - t60) / t60 < 0.1, `mean ${rep.mean_500_1k_2k}`);
assert.equal(rep.mean_reliable, true);
assert.throws(() => dsp.rt60_bands(new Float32Array(100), fs), /pendek/);

// 3) Sweep: rekaman = sweep dengan satu pantulan, dekonvolusi harus memulihkan keduanya.
const sw = dsp.sweep_signal(fs, 50, 20000, 2);
assert.ok(sw instanceof Float32Array && sw.length === fs * 2);
const rec = new Float32Array(sw.length + 2400);
for (let i = 0; i < sw.length; i++) {
  rec[i] += sw[i];
  rec[i + 2400] += 0.5 * sw[i];
}
const ir = dsp.sweep_deconvolve(rec, fs, 50, 20000, 2);
assert.ok(ir instanceof Float32Array);
assert.ok(Math.abs(ir[0] - 1) < 0.03 && Math.abs(ir[2400] - 0.5) < 0.03, `ir ${ir[0]} ${ir[2400]}`);
assert.throws(() => dsp.sweep_signal(fs, 100, 100, 1), /sweep/);

console.log("smoke OK");
