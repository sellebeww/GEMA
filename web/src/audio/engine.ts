// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import { type Dsp, type FromWorker, type ImpulseState, type Mode, SWEEP, type ToWorker } from "./protocol";
import { ImpulseRecorder } from "./recorder";
import { Ring } from "./ring";

const LIVE_WINDOW_S = 1;
const BLOCK_S = 0.125; // Fast
/** Batas rekaman mode level agar memori terjaga (detik). */
const MAX_LEVEL_S = 600;
const WARMUP_BLOCKS = 10;
/** Pesan lantai derau dikirim tiap n blok (~170 ms) supaya UI tidak dibanjiri. */
const FLOOR_EVERY = 4;
/** Rekaman sweep dimulai sedikit sebelum sinyal diputar agar bunyi langsung tidak terpotong. */
const SWEEP_LEAD_S = 0.5;

const concat = (parts: Float32Array[], n: number): Float32Array => {
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const peakOf = (b: Float32Array): number => {
  let p = 0;
  for (const v of b) p = Math.max(p, Math.abs(v));
  return p;
};

const db = (amp: number): number => 20 * Math.log10(Math.max(amp, 1e-12));

interface SweepRun {
  seen: number;
  floor: number;
  playing: boolean;
  parts: Float32Array[];
  len: number;
}

/**
 * Inti pemrosesan tanpa API Worker: worker.ts dan tes sama-sama memanggil `handle`
 * dengan pesan yang sama, jadi jalur sintetis identik dengan jalur mikrofon.
 */
export class Engine {
  private mode: Mode | null = null;
  private fs = 0;
  private live = new Ring(1);
  private parts: Float32Array[] = [];
  private total = 0;
  private peak = 0;
  private tick = 0;
  private recorder: ImpulseRecorder | null = null;
  private sweep: SweepRun | null = null;
  private lastState: ImpulseState | null = null;

  constructor(
    private readonly dsp: Dsp,
    private readonly emit: (m: FromWorker) => void,
  ) {}

  handle(m: ToWorker): void {
    try {
      if (m.type === "start") this.start(m.mode, m.fs);
      else if (m.type === "block") this.block(m.samples);
      else if (m.type === "stop") this.stop();
    } catch (e) {
      this.mode = null;
      this.emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  private start(mode: Mode, fs: number): void {
    if (!(fs >= 8000 && fs <= 192000)) throw new Error(`sample rate tidak valid: ${fs}`);
    this.mode = mode;
    this.fs = fs;
    this.live = new Ring(Math.round(fs * LIVE_WINDOW_S));
    this.parts = [];
    this.total = 0;
    this.peak = 0;
    this.tick = 0;
    this.recorder = mode === "impulse" ? new ImpulseRecorder(fs) : null;
    this.sweep = mode === "sweep" ? { seen: 0, floor: 0, playing: false, parts: [], len: 0 } : null;
    this.lastState = null;
  }

  private block(samples: Float32Array): void {
    if (this.mode === "level") this.levelBlock(samples);
    else if (this.mode === "impulse" && this.recorder) this.impulseBlock(this.recorder, samples);
    else if (this.mode === "sweep" && this.sweep) this.sweepBlock(this.sweep, samples);
  }

  private levelBlock(samples: Float32Array): void {
    this.live.push(samples);
    this.parts.push(samples);
    this.total += samples.length;
    this.peak = Math.max(this.peak, peakOf(samples));
    if (this.total > MAX_LEVEL_S * this.fs) throw new Error(`rekaman melebihi ${MAX_LEVEL_S} detik`);
    if (this.live.size >= BLOCK_S * this.fs) {
      const s = this.dsp.level_stats(this.live.last(this.live.size), this.fs, BLOCK_S);
      this.emit({ type: "level", leq_db: s.leq_db });
    }
  }

  private setState(state: ImpulseState): void {
    if (state === this.lastState) return;
    this.lastState = state;
    this.emit({ type: "impulse-state", state });
  }

  private impulseBlock(rec: ImpulseRecorder, samples: Float32Array): void {
    const capture = rec.push(samples);
    this.setState(rec.state);
    if (rec.state === "warmup" || rec.state === "armed") {
      if (this.tick++ % FLOOR_EVERY === 0) this.emit({ type: "impulse-floor", floor_db: rec.floorDbfs });
    }
    if (capture) this.finishImpulse(capture, capture);
  }

  private sweepBlock(run: SweepRun, samples: Float32Array): void {
    if (!run.playing) {
      run.floor = (run.floor * run.seen + peakOf(samples)) / (run.seen + 1);
      run.seen++;
      this.setState("warmup");
      this.emit({ type: "impulse-floor", floor_db: db(run.floor) });
      if (run.seen < WARMUP_BLOCKS) return;
      run.playing = true;
      this.setState("recording");
      this.emit({ type: "sweep-signal", samples: this.dsp.sweep_signal(this.fs, SWEEP.f1, SWEEP.f2, SWEEP.secs) });
      return;
    }
    run.parts.push(samples.slice());
    run.len += samples.length;
    if (run.len < (SWEEP_LEAD_S + SWEEP.secs + SWEEP.tailS) * this.fs) return;
    const recording = concat(run.parts, run.len);
    this.sweep = null;
    this.finishImpulse(this.dsp.sweep_deconvolve(recording, this.fs, SWEEP.f1, SWEEP.f2, SWEEP.secs), recording);
  }

  /** `ir`: respons impuls yang dianalisis; `raw`: rekaman mentah untuk puncak dan clipping. */
  private finishImpulse(ir: Float32Array, raw: Float32Array): void {
    this.setState("done");
    this.mode = null;
    const peak = peakOf(raw);
    try {
      this.emit({
        type: "impulse-result",
        fs: this.fs,
        report: this.dsp.rt60_bands(ir, this.fs),
        curves: this.dsp.schroeder_curves(ir, this.fs),
        peak_db: db(peak),
        clipped: peak >= 0.999,
      });
    } catch (e) {
      this.emit({ type: "impulse-failed", message: e instanceof Error ? e.message : String(e) });
    }
  }

  private stop(): void {
    if (this.mode === "level" && this.total >= BLOCK_S * this.fs) {
      const stats = this.dsp.level_stats(concat(this.parts, this.total), this.fs, BLOCK_S);
      this.emit({ type: "level-final", stats, seconds: this.total / this.fs, peak_db: db(this.peak) });
    }
    this.mode = null;
    this.parts = [];
    this.sweep = null;
  }
}
