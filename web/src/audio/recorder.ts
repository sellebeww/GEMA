// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import type { ImpulseState } from "./protocol";
import { Ring } from "./ring";

export interface RecorderOptions {
  /** Pra-pemicu yang ikut direkam (detik). */
  preS?: number;
  /** Durasi rekaman setelah pemicu (detik), dijepit ke 2..4. */
  recordS?: number;
  /** Lonjakan puncak di atas lantai derau yang memicu (dB). */
  thresholdDb?: number;
  /** Puncak minimum mutlak agar derau sunyi tidak memicu (dBFS). */
  minPeakDbfs?: number;
  /** Jumlah blok awal untuk memperkirakan lantai derau. */
  warmupBlocks?: number;
}

const peakOf = (b: Float32Array): number => {
  let p = 0;
  for (const v of b) p = Math.max(p, Math.abs(v));
  return p;
};

/**
 * Pemicu otomatis: lantai derau = rata-rata puncak blok saat warmup, lalu EMA lambat selama
 * menunggu. Blok yang melonjak `thresholdDb` di atas lantai memicu rekaman.
 * shortcut: satu pemicu per instance dan deteksi per blok (~43 ms); buat instance baru untuk rekaman berikutnya.
 */
export class ImpulseRecorder {
  state: ImpulseState = "warmup";
  private floor = 0;
  private seen = 0;
  private parts: Float32Array[] = [];
  private len = 0;
  private readonly ring: Ring;
  private readonly preN: number;
  private readonly targetN: number;
  private readonly ratio: number;
  private readonly minPeak: number;
  private readonly warmup: number;

  constructor(
    private readonly fs: number,
    o: RecorderOptions = {},
  ) {
    const preS = o.preS ?? 0.25;
    const recordS = Math.min(4, Math.max(2, o.recordS ?? 3));
    this.preN = Math.round(preS * fs);
    this.targetN = this.preN + Math.round(recordS * fs);
    this.ratio = 10 ** ((o.thresholdDb ?? 20) / 20);
    this.minPeak = 10 ** ((o.minPeakDbfs ?? -50) / 20);
    this.warmup = o.warmupBlocks ?? 10;
    this.ring = new Ring(this.preN + 8192);
  }

  /** Lantai derau latar (puncak blok) dalam dBFS. */
  get floorDbfs(): number {
    return 20 * Math.log10(Math.max(this.floor, 1e-12));
  }

  /** Mengembalikan rekaman lengkap (pra-pemicu + pasca) tepat sekali, saat selesai. */
  push(block: Float32Array): Float32Array | null {
    if (this.state === "done") return null;
    if (this.state === "recording") return this.append(block);

    this.ring.push(block);
    const peak = peakOf(block);
    if (this.state === "warmup") {
      this.floor = (this.floor * this.seen + peak) / (this.seen + 1);
      if (++this.seen >= this.warmup) this.state = "armed";
      return null;
    }
    if (peak > Math.max(this.floor * this.ratio, this.minPeak)) {
      this.state = "recording";
      const head = this.ring.last(this.preN + block.length);
      this.parts = [head];
      this.len = head.length;
      return this.len >= this.targetN ? this.finish() : null;
    }
    this.floor = 0.95 * this.floor + 0.05 * peak;
    return null;
  }

  private append(block: Float32Array): Float32Array | null {
    this.parts.push(block.slice());
    this.len += block.length;
    return this.len >= this.targetN ? this.finish() : null;
  }

  private finish(): Float32Array {
    const out = new Float32Array(this.targetN);
    let o = 0;
    for (const p of this.parts) {
      const take = Math.min(p.length, this.targetN - o);
      out.set(p.subarray(0, take), o);
      o += take;
    }
    this.parts = [];
    this.state = "done";
    return out;
  }
}
