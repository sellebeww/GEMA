// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
// Dimuat sebagai modul AudioWorklet (lihat capture.ts). Kanal 0 dikumpulkan menjadi blok BLOCK_FRAMES
// lalu dikirim (transfer, tanpa salinan) lewat MessagePort yang diteruskan ke Worker.
import { BLOCK_FRAMES } from "./protocol";

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

class CaptureProcessor extends AudioWorkletProcessor {
  private out: MessagePort | null = null;
  private buf = new Float32Array(BLOCK_FRAMES);
  private n = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ port: MessagePort | null }>) => {
      this.out = e.data.port;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch || !this.out) return true;
    for (const v of ch) {
      this.buf[this.n++] = v;
      if (this.n === BLOCK_FRAMES) {
        this.out.postMessage({ type: "block", samples: this.buf }, [this.buf.buffer]);
        this.buf = new Float32Array(BLOCK_FRAMES);
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor("gema-capture", CaptureProcessor);
