// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
// Logika domain tanpa React: tipe hasil, status kualitas, target ANSI/ASA S12.60, dan format angka.
import type { BandCurve, Rt60Report } from "./audio/protocol";
import type { AccuracyCode, CalStamp } from "./calibration";

export { NOMINAL_OFFSET_DB, toDba } from "./calibration";

/** Batas kebisingan latar ruang kosong (rata-rata 1 jam), ANSI/ASA S12.60-2010 Part 1 Tabel 1. */
export const NOISE_LIMIT_DBA = 35;
export const NOISE_SECONDS = 30;
/** Toleransi kecil: blok audio terakhir bisa belum penuh saat hitung mundur berakhir. */
const NOISE_MIN_SECONDS = NOISE_SECONDS - 1;
/** Puncak melewati ini dianggap terpotong (clipping). */
export const CLIP_DBFS = -0.5;
/** Selisih LAmax dan LA90 yang menandakan ada bunyi sesaat keras saat mengukur ruang kosong. */
const SPIKE_DB = 25;
/** Lantai derau (puncak blok, dBFS) di atas ini membuat peluruhan 35 dB sulit didapat. Heuristik awal. */
export const TOO_NOISY_FLOOR_DBFS = -35;
/** Bunyi uji dengan puncak di bawah ini terlalu pelan untuk menembus derau. */
const WEAK_PEAK_DBFS = -30;

export type Status = "andal" | "ulang";
export interface Quality {
  status: Status;
  reasons: string[];
}

export interface NoiseResult {
  /** dBFS A-weighted; tambahkan offset lewat `toDba` saat ditampilkan. */
  leq_db: number;
  lmax_db: number;
  l90_db: number;
  peak_db: number;
  seconds: number;
  at: number;
  quality: Quality;
  /** Offset kalibrasi saat diukur; tanpa ini angka dBA hanya perkiraan relatif. */
  cal?: CalStamp;
  warnings?: AccuracyCode[];
}

export interface ReverbResult {
  method: "impulse" | "sweep";
  fs: number;
  report: Rt60Report;
  curves: BandCurve[];
  peak_db: number;
  clipped: boolean;
  at: number;
  quality: Quality;
  warnings?: AccuracyCode[];
}

export interface Room {
  name: string;
  length: string;
  width: string;
  height: string;
}

export type NoiseKind = "empty" | "occupied";

const quality = (reasons: string[]): Quality => ({ status: reasons.length ? "ulang" : "andal", reasons });

export function assessNoise(
  r: Pick<NoiseResult, "seconds" | "peak_db" | "lmax_db" | "l90_db">,
  kind: NoiseKind,
): Quality {
  const reasons: string[] = [];
  if (r.seconds < NOISE_MIN_SECONDS) reasons.push("Pengukuran berhenti sebelum 30 detik. Ulangi sampai hitung mundur selesai.");
  if (r.peak_db >= CLIP_DBFS) reasons.push("Suara terlalu keras sampai terpotong. Jauhkan ponsel dari sumber bunyi.");
  if (kind === "empty" && r.lmax_db - r.l90_db > SPIKE_DB) {
    reasons.push("Ada bunyi sesaat yang keras (pintu, langkah, suara). Ulangi saat ruang benar-benar tenang.");
  }
  return quality(reasons);
}

/** Pita ANSI S12.60 yang dirata-ratakan. */
const MEAN_BANDS = [500, 1000, 2000];

export function assessReverb(r: Pick<ReverbResult, "report" | "peak_db" | "clipped">): Quality {
  const reasons: string[] = [];
  if (r.clipped) reasons.push("Bunyi terlalu keras sampai terpotong. Bunyikan sedikit lebih pelan atau jauhkan ponsel.");
  const bad = r.report.bands.filter((b) => MEAN_BANDS.includes(b.band_hz) && !b.reliable);
  if (bad.length) {
    if (bad.some((b) => b.headroom_db < 0)) {
      reasons.push(
        r.peak_db < WEAK_PEAK_DBFS
          ? "Bunyi uji terlalu pelan dibanding bunyi latar. Bunyikan lebih keras atau dekatkan ke ponsel."
          : "Ruang terlalu bising saat merekam, jadi peluruhan bunyi tidak terbaca utuh. Tunggu sampai tenang, lalu ulangi.",
      );
    } else {
      reasons.push("Peluruhan bunyi tidak mulus (ada suara lain atau gerakan). Ulangi dan tahan diam selama merekam.");
    }
  }
  return quality(reasons);
}

/** Batas RT60 (detik) menurut volume ruang, ANSI/ASA S12.60 Tabel 1; `null` bila di luar cakupan. */
export function rt60Target(volumeM3: number): number | null {
  if (volumeM3 <= 283) return 0.6;
  if (volumeM3 <= 566) return 0.7;
  return null;
}

/** Menerima koma desimal ("7,5") dan titik; hasil harus positif. */
export function parseMeters(s: string): number | null {
  const n = Number(s.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function roomVolume(r: Room): number | null {
  const [l, w, h] = [parseMeters(r.length), parseMeters(r.width), parseMeters(r.height)];
  return l && w && h ? l * w * h : null;
}

const nf = (digits: number) => new Intl.NumberFormat("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const f1 = nf(1);
const f2 = nf(2);
export const fmt1 = (n: number): string => f1.format(n);
export const fmt2 = (n: number): string => f2.format(n);
/** Tanda minus sungguhan (U+2212) supaya angka negatif terbaca jelas di grafik. */
export const fmtDb = (n: number): string => f1.format(n).replace("-", "−");
