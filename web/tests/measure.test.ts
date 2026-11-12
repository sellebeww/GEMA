// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { BandRt60 } from "../src/audio/protocol";
import { assessNoise, assessReverb, fmt1, fmtDb, parseMeters, roomVolume, rt60Target, toDba } from "../src/measure";

const band = (band_hz: number, over: Partial<BandRt60> = {}): BandRt60 => ({
  band_hz,
  t20: null,
  t30: null,
  method: "T20",
  rt60: 0.6,
  dynamic_range_db: 50,
  headroom_db: 10,
  reliable: true,
  ...over,
});
const report = (bands: BandRt60[]) => ({ bands, mean_500_1k_2k: 0.6, mean_reliable: bands.every((b) => b.reliable) });
const good = [band(500), band(1000), band(2000)];

describe("assessNoise", () => {
  const ok = { seconds: 30, peak_db: -30, lmax_db: -50, l90_db: -65 };
  it("andal bila penuh 30 detik, tidak terpotong, tanpa lonjakan", () => {
    expect(assessNoise(ok, "empty")).toEqual({ status: "andal", reasons: [] });
  });
  it("perlu diulang bila berhenti lebih awal", () => {
    const q = assessNoise({ ...ok, seconds: 12 }, "empty");
    expect(q.status).toBe("ulang");
    expect(q.reasons[0]).toMatch(/30 detik/);
  });
  it("toleran 1 detik untuk blok audio terakhir", () => {
    expect(assessNoise({ ...ok, seconds: 29.2 }, "empty").status).toBe("andal");
  });
  it("perlu diulang bila terpotong (clipping)", () => {
    expect(assessNoise({ ...ok, peak_db: -0.1 }, "occupied").status).toBe("ulang");
  });
  it("lonjakan sesaat hanya mengganggu ruang kosong, bukan ruang ramai", () => {
    const spiky = { ...ok, lmax_db: -30, l90_db: -65 };
    expect(assessNoise(spiky, "empty").status).toBe("ulang");
    expect(assessNoise(spiky, "occupied").status).toBe("andal");
  });
});

describe("assessReverb", () => {
  const base = { peak_db: -6, clipped: false };
  it("andal bila ketiga pita rata-rata andal", () => {
    expect(assessReverb({ ...base, report: report(good) }).status).toBe("andal");
  });
  it("pita di luar 500/1k/2k tidak menggagalkan hasil", () => {
    expect(assessReverb({ ...base, report: report([...good, band(125, { reliable: false, headroom_db: -8 })]) }).status).toBe("andal");
  });
  it("terlalu bising: cadangan negatif dan bunyi uji cukup keras", () => {
    const q = assessReverb({ ...base, report: report([band(500), band(1000, { reliable: false, headroom_db: -6 }), band(2000)]) });
    expect(q.status).toBe("ulang");
    expect(q.reasons.join(" ")).toMatch(/terlalu bising/i);
  });
  it("bunyi uji terlalu pelan dibedakan dari ruang bising", () => {
    const q = assessReverb({ ...base, peak_db: -45, report: report([band(500, { reliable: false, headroom_db: -6 }), band(1000), band(2000)]) });
    expect(q.reasons.join(" ")).toMatch(/terlalu pelan/i);
  });
  it("peluruhan tidak mulus: cadangan cukup tetapi korelasi rendah", () => {
    const q = assessReverb({ ...base, report: report([band(500), band(1000, { reliable: false, headroom_db: 4 }), band(2000)]) });
    expect(q.reasons.join(" ")).toMatch(/tidak mulus/i);
  });
  it("terpotong selalu perlu diulang", () => {
    expect(assessReverb({ ...base, clipped: true, report: report(good) }).status).toBe("ulang");
  });
});

describe("target dan ruang", () => {
  it("RT60 menurut volume ANSI/ASA S12.60 (batas termasuk)", () => {
    expect(rt60Target(100)).toBe(0.6);
    expect(rt60Target(283)).toBe(0.6);
    expect(rt60Target(283.1)).toBe(0.7);
    expect(rt60Target(566)).toBe(0.7);
    expect(rt60Target(566.1)).toBeNull();
  });
  it("menerima koma desimal dan menolak nol, negatif, teks", () => {
    expect(parseMeters("7,5")).toBe(7.5);
    expect(parseMeters(" 3 ")).toBe(3);
    for (const bad of ["", "0", "-2", "abc", "1e999"]) expect(parseMeters(bad)).toBeNull();
  });
  it("volume null bila ada sisi kosong atau salah", () => {
    expect(roomVolume({ name: "", length: "8", width: "7", height: "3" })).toBe(168);
    expect(roomVolume({ name: "", length: "8", width: "", height: "3" })).toBeNull();
  });
});

describe("format Indonesia", () => {
  it("koma desimal dan minus sungguhan", () => {
    expect(fmt1(35.04)).toBe("35,0");
    expect(fmtDb(-24.06)).toBe("−24,1");
    expect(toDba(-62.1)).toBeCloseTo(37.9, 5);
  });
});
