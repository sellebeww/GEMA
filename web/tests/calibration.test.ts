// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  accuracyWarnings,
  calStatus,
  computeOffset,
  MIC_FLOOR_DBA,
  NOMINAL_OFFSET_DB,
  parseDba,
  profileFor,
  resultDba,
  stampOf,
  toDba,
  type CalibrationProfile,
} from "../src/calibration";

const profile: CalibrationProfile = { deviceId: "mic-A", label: "Mic A", offsetDb: 108.2, refDba: 94, at: 1_700_000_000_000 };

describe("computeOffset", () => {
  it("offset = dBA acuan dikurangi level terukur dBFS", () => {
    expect(computeOffset(94, -14.2)).toBeCloseTo(108.2, 9);
    expect(computeOffset(62.5, -37.5)).toBeCloseTo(100, 9);
  });
  it("menolak masukan bukan angka", () => {
    expect(computeOffset(NaN, -20)).toBeNull();
    expect(computeOffset(94, -Infinity)).toBeNull();
  });
  it("menolak acuan di luar 30 sampai 130 dBA (salah ketik)", () => {
    expect(computeOffset(29.9, -60)).toBeNull();
    expect(computeOffset(130.1, -20)).toBeNull();
    expect(computeOffset(30, -60)).toBe(90);
  });
  it("menolak offset yang tidak masuk akal (mikrofon tidak mendengar acuan)", () => {
    expect(computeOffset(94, -90)).toBeNull(); // offset 184
    expect(computeOffset(40, -5)).toBeNull(); // offset 45
  });
});

describe("parseDba", () => {
  it("menerima koma dan titik, menolak kosong dan teks", () => {
    expect(parseDba("94,5")).toBe(94.5);
    expect(parseDba(" 62.5 ")).toBe(62.5);
    expect(parseDba("")).toBeNull();
    expect(parseDba("abc")).toBeNull();
  });
});

describe("toDba dan resultDba", () => {
  it("tanpa kalibrasi memakai offset nominal", () => {
    expect(toDba(-62.1)).toBeCloseTo(37.9, 9);
    expect(resultDba({ leq_db: -62.1 })).toBe(37.9);
    expect(NOMINAL_OFFSET_DB).toBe(100);
  });
  it("memakai offset yang tersimpan di hasil, bukan profil sekarang", () => {
    expect(resultDba({ leq_db: -62.1, cal: { offsetDb: 105, at: 1 } })).toBe(42.9);
  });
});

describe("status kalibrasi", () => {
  const cal = stampOf(profile);
  it("profil hanya berlaku untuk perangkat yang sama", () => {
    expect(profileFor(profile, "mic-A")).toBe(profile);
    expect(profileFor(profile, "mic-B")).toBeNull();
    expect(profileFor(profile, undefined)).toBeNull();
    expect(profileFor(null, "mic-A")).toBeNull();
  });
  it("terkalibrasi hanya bila semua hasil yang ada dikalibrasi", () => {
    expect(calStatus([{ cal }, { cal }])).toEqual(cal);
    expect(calStatus([{ cal }, undefined])).toEqual(cal); // hasil yang belum ada diabaikan
  });
  it("campuran atau kosong dianggap belum terkalibrasi", () => {
    expect(calStatus([{ cal }, {}])).toBeNull();
    expect(calStatus([{}, { cal }])).toBeNull();
    expect(calStatus([undefined, undefined])).toBeNull();
  });
});

describe("accuracyWarnings", () => {
  it("tanpa masalah: tidak ada peringatan", () => {
    expect(accuracyWarnings({ issues: [], dba: 45 })).toEqual([]);
  });
  it("pengolah suara aktif atau tak terbukti mati", () => {
    expect(accuracyWarnings({ issues: [{ feature: "autoGainControl", state: "aktif" }] })).toEqual(["processing"]);
    expect(accuracyWarnings({ issues: [{ feature: "noiseSuppression", state: "tidak-diketahui" }] })).toEqual(["processing"]);
  });
  it("di bawah batas bawah mikrofon ponsel", () => {
    expect(accuracyWarnings({ issues: [], dba: MIC_FLOOR_DBA - 0.1 })).toEqual(["mic-floor"]);
    expect(accuracyWarnings({ issues: [], dba: MIC_FLOOR_DBA })).toEqual([]);
  });
  it("keduanya sekaligus", () => {
    expect(accuracyWarnings({ issues: [{ feature: "echoCancellation", state: "aktif" }], dba: 20 })).toEqual(["processing", "mic-floor"]);
  });
});
