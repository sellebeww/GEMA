// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT

/** Ring buffer Float32 tetap; menyimpan `capacity` sampel terakhir. */
export class Ring {
  private readonly buf: Float32Array;
  private w = 0;
  size = 0;

  constructor(readonly capacity: number) {
    this.buf = new Float32Array(capacity);
  }

  push(x: Float32Array): void {
    const cap = this.capacity;
    const n = x.length;
    if (n >= cap) {
      this.buf.set(x.subarray(n - cap));
      this.w = 0;
      this.size = cap;
      return;
    }
    const first = Math.min(n, cap - this.w);
    this.buf.set(x.subarray(0, first), this.w);
    this.buf.set(x.subarray(first), 0);
    this.w = (this.w + n) % cap;
    this.size = Math.min(cap, this.size + n);
  }

  /** Salinan `n` sampel terbaru (lebih sedikit bila belum terisi). */
  last(n: number): Float32Array {
    const m = Math.min(n, this.size);
    const out = new Float32Array(m);
    const start = (this.w - m + this.capacity) % this.capacity;
    const first = Math.min(m, this.capacity - start);
    out.set(this.buf.subarray(start, start + first));
    out.set(this.buf.subarray(0, m - first), first);
    return out;
  }

  clear(): void {
    this.w = 0;
    this.size = 0;
  }
}
