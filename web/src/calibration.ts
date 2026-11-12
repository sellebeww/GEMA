// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
// Logika kalibrasi tanpa React: hitung offset, status terkalibrasi, dan peringatan akurasi perangkat.
import type { ProcessingIssue } from "./audio/useMicrophone";

/** Offset dBFS -> dBA bila belum dikalibrasi. Hanya perkiraan kasar untuk mikrofon ponsel/laptop. */
export const NOMINAL_OFFSET_DB = 100;
/** Detik mengukur acuan; cukup untuk nada kalibrator atau meter rujukan yang stabil. */
export const CAL_SECONDS = 10;
/** Rentang dBA acuan yang masuk akal; di luar ini hampir pasti salah ketik. */
export const REF_DBA_RANGE = [30, 130] as const;
/** Offset di luar rentang ini berarti mikrofon tidak mendengar acuan (terlalu jauh, atau terlalu pelan). */
const OFFSET_RANGE = [60, 150] as const;
/**
 * Di bawah ini, level yang terbaca kemungkinan derau mikrofon sendiri, bukan ruangan.
 * shortcut: satu angka tetap untuk kelas mikrofon ponsel (derau sendiri sekitar 28 sampai 32 dBA), bukan hasil ukur
 * per perangkat; ganti dengan pengukuran lantai derau di kalibrasi bila perlu.
 */
export const MIC_FLOOR_DBA = 30;

/** Disimpan per perangkat. `deviceId` dari MediaTrackSettings; browser bisa mengacaknya, lalu pengguna kalibrasi ulang. */
export interface CalibrationProfile {
  deviceId: string;
  label: string;
  offsetDb: number;
  refDba: number;
  at: number;
}

/** Salinan offset yang dipakai saat hasil diukur, supaya hasil lama tidak berubah bila kalibrasi diganti. */
export interface CalStamp {
  offsetDb: number;
  at: number;
}

/** Offset = dBA acuan dikurangi LAeq terukur (dBFS). `null` bila masukan atau hasilnya tidak masuk akal. */
export function computeOffset(refDba: number, measuredDbfs: number): number | null {
  if (!Number.isFinite(refDba) || !Number.isFinite(measuredDbfs)) return null;
  if (refDba < REF_DBA_RANGE[0] || refDba > REF_DBA_RANGE[1]) return null;
  const offset = refDba - measuredDbfs;
  return offset < OFFSET_RANGE[0] || offset > OFFSET_RANGE[1] ? null : offset;
}

/** Menerima koma desimal ("94,0") dan titik. */
export const parseDba = (s: string): number | null => {
  const n = Number(s.trim().replace(",", "."));
  return s.trim() !== "" && Number.isFinite(n) ? n : null;
};

export const toDba = (dbfs: number, offsetDb: number = NOMINAL_OFFSET_DB): number => dbfs + offsetDb;

/** dBA satu desimal untuk hasil tersimpan, memakai offset saat hasil itu diukur. */
export const resultDba = (r: { leq_db: number; cal?: CalStamp }): number => Math.round(toDba(r.leq_db, r.cal?.offsetDb) * 10) / 10;

/** Profil hanya berlaku bila mikrofon yang dipakai sama dengan yang dikalibrasi. */
export const profileFor = (p: CalibrationProfile | null, deviceId: string | undefined): CalibrationProfile | null =>
  p && p.deviceId === deviceId ? p : null;

export const stampOf = (p: CalibrationProfile | null): CalStamp | undefined => (p ? { offsetDb: p.offsetDb, at: p.at } : undefined);

/** Terkalibrasi hanya bila SEMUA hasil yang ada dikalibrasi; selisih antar hasil campuran tidak bermakna. */
export function calStatus(results: ReadonlyArray<{ cal?: CalStamp } | undefined>): CalStamp | null {
  const present = results.filter((r): r is { cal?: CalStamp } => r !== undefined);
  const first = present[0]?.cal;
  return first && present.every((r) => r.cal) ? first : null;
}

export type AccuracyCode = "processing" | "mic-floor";

/**
 * Peringatan akurasi perangkat. Clipping dan rentang dinamis RT60 sudah dinilai di `assessNoise` dan `assessReverb`
 * (status "perlu diulang"), jadi tidak diulang di sini.
 */
export function accuracyWarnings(i: { issues: readonly ProcessingIssue[]; dba?: number }): AccuracyCode[] {
  const out: AccuracyCode[] = [];
  if (i.issues.length > 0) out.push("processing");
  if (i.dba !== undefined && i.dba < MIC_FLOOR_DBA) out.push("mic-floor");
  return out;
}
