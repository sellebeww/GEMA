// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import processorUrl from "./processor.ts?worker&url";
import type { ToWorker } from "./protocol";

export interface Capture {
  /** Sample rate aktual AudioContext (yang dilihat worklet); selalu pakai ini, bukan 44100/48000 tetap. */
  fs: number;
  /** Memutar sinyal mono (misalnya sweep) lewat speaker pada AudioContext yang sama. */
  play(samples: Float32Array): void;
  stop(): Promise<void>;
}

/**
 * Menghubungkan MediaStream ke worklet, dan worklet ke Worker lewat MessageChannel.
 * Panggil dari handler klik: iOS Safari hanya mengizinkan AudioContext berjalan setelah gestur pengguna.
 */
export async function startCapture(stream: MediaStream, worker: Worker, onInterrupt?: () => void): Promise<Capture> {
  const ctx = new AudioContext({ latencyHint: "interactive" });
  try {
    await ctx.resume();
    await ctx.audioWorklet.addModule(processorUrl);
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "gema-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
    });
    const ch = new MessageChannel();
    node.port.postMessage({ port: ch.port1 }, [ch.port1]);
    const attach: ToWorker = { type: "attach-port", port: ch.port2 };
    worker.postMessage(attach, [ch.port2]);
    src.connect(node);
    // Telepon masuk, layar terkunci, atau pindah tab membuat konteks `suspended`/`interrupted`: rekaman tidak sah lagi.
    ctx.onstatechange = () => {
      if (ctx.state !== "running" && ctx.state !== "closed") onInterrupt?.();
    };
    return {
      fs: ctx.sampleRate,
      play: (samples) => {
        const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
        buf.getChannelData(0).set(samples);
        const player = ctx.createBufferSource();
        player.buffer = buf;
        player.connect(ctx.destination);
        player.start();
      },
      stop: async () => {
        ctx.onstatechange = null;
        src.disconnect();
        node.port.postMessage({ port: null });
        node.disconnect();
        await ctx.close();
      },
    };
  } catch (e) {
    await ctx.close();
    throw e;
  }
}
