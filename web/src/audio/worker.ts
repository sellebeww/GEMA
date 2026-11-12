// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import { Engine } from "./engine";
import type { FromWorker, ToWorker } from "./protocol";
import { loadDsp } from "./wasm-dsp";

const post = (m: FromWorker): void => self.postMessage(m);
let engine: Engine | null = null;

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === "init") {
    loadDsp().then(
      (dsp) => {
        engine = new Engine(dsp, post);
        post({ type: "ready" });
      },
      (err: unknown) => post({ type: "error", message: `gagal memuat WASM: ${String(err)}` }),
    );
  } else if (m.type === "attach-port") {
    // Blok mentah datang langsung dari AudioWorklet, tanpa lewat thread UI.
    m.port.onmessage = (pe: MessageEvent<ToWorker>) => engine?.handle(pe.data);
  } else if (engine) {
    engine.handle(m);
  } else {
    post({ type: "error", message: "worker belum siap" });
  }
};
