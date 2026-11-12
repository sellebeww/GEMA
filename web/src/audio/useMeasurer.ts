// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import { useCallback, useEffect, useRef, useState } from "react";
import { startCapture, type Capture } from "./capture";
import type { BandCurve, FromWorker, ImpulseState, LevelStats, Rt60Report, ToWorker } from "./protocol";
import { useMicrophone, type Microphone } from "./useMicrophone";

export interface LevelFinal {
  stats: LevelStats;
  seconds: number;
  peak_db: number;
}

export interface ImpulseOutcome {
  fs: number;
  report: Rt60Report;
  curves: BandCurve[];
  peak_db: number;
  clipped: boolean;
}

export type Run = "level" | "impulse" | "sweep";

export interface Measurer {
  ready: boolean;
  mic: Microphone;
  /** Pengukuran yang sedang berjalan; `null` saat diam. */
  run: Run | null;
  error: string | null;
  /** LAeq jendela 1 s dalam dBFS (belum diberi offset), dan riwayatnya untuk grafik mini. */
  liveDb: number | null;
  liveSeries: number[];
  levelFinal: LevelFinal | null;
  impulseState: ImpulseState | null;
  /** Lantai derau latar (dBFS) selama warmup dan menunggu pemicu. */
  floorDb: number | null;
  /** Waktu (ms epoch) mulai menunggu pemicu; untuk petunjuk bila lama tak ada bunyi. */
  armedAt: number | null;
  impulse: ImpulseOutcome | null;
  /** Pesan dari DSP saat rekaman tidak menghasilkan peluruhan yang bisa dibaca. */
  failed: string | null;
  startLevel(): Promise<void>;
  /** Selesai menghitung mundur: hentikan dan minta hasil akhir. */
  finishLevel(): Promise<void>;
  startImpulse(method: "impulse" | "sweep"): Promise<void>;
  /** Batalkan tanpa hasil dan lepaskan mikrofon. */
  abort(): Promise<void>;
}

const MAX_SERIES = 900;

export function useMeasurer(): Measurer {
  const mic = useMicrophone();
  const worker = useRef<Worker | null>(null);
  const capture = useRef<Capture | null>(null);
  /** Pesan hasil dari pengukuran yang sudah dibatalkan atau berganti diabaikan. */
  const expect = useRef<Run | null>(null);
  const awaitingFinal = useRef(false);
  const [ready, setReady] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveDb, setLiveDb] = useState<number | null>(null);
  const [liveSeries, setSeries] = useState<number[]>([]);
  const [levelFinal, setFinal] = useState<LevelFinal | null>(null);
  const [impulseState, setImpulseState] = useState<ImpulseState | null>(null);
  const [floorDb, setFloor] = useState<number | null>(null);
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const [impulse, setImpulse] = useState<ImpulseOutcome | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // `mic` berganti identitas tiap render; callback di bawah dibaca lewat ref supaya identitasnya stabil
  // (NoiseStep/ReverbStep memanggil `abort` dari cleanup efek dan tidak boleh terpicu tiap render).
  const micRef = useRef(mic);
  micRef.current = mic;

  const release = useCallback(async () => {
    const c = capture.current;
    capture.current = null;
    await c?.stop().catch(() => undefined);
    micRef.current.stop();
    setRun(null);
  }, []);
  const releaseRef = useRef(release);
  releaseRef.current = release;

  useEffect(() => {
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      const impulseRun = expect.current !== null && expect.current !== "level";
      if (m.type === "ready") setReady(true);
      else if (m.type === "error") {
        setError(m.message);
        void releaseRef.current();
      } else if (m.type === "level" && expect.current === "level") {
        setLiveDb(m.leq_db);
        setSeries((s) => (s.length >= MAX_SERIES ? [...s.slice(1), m.leq_db] : [...s, m.leq_db]));
      } else if (m.type === "level-final" && awaitingFinal.current) {
        awaitingFinal.current = false;
        setFinal({ stats: m.stats, seconds: m.seconds, peak_db: m.peak_db });
      } else if (m.type === "impulse-state" && impulseRun) {
        setImpulseState(m.state);
        if (m.state === "armed") setArmedAt(Date.now());
      } else if (m.type === "impulse-floor" && impulseRun) {
        setFloor(m.floor_db);
      } else if (m.type === "sweep-signal" && expect.current === "sweep") {
        capture.current?.play(m.samples);
      } else if (m.type === "impulse-result" && impulseRun) {
        expect.current = null;
        setImpulse({ fs: m.fs, report: m.report, curves: m.curves, peak_db: m.peak_db, clipped: m.clipped });
        void releaseRef.current();
      } else if (m.type === "impulse-failed" && impulseRun) {
        expect.current = null;
        setFailed(m.message);
        void releaseRef.current();
      }
    };
    w.postMessage({ type: "init" } satisfies ToWorker);
    worker.current = w;
    return () => {
      void capture.current?.stop();
      w.terminate();
    };
  }, []);

  const send = useCallback((m: ToWorker) => worker.current?.postMessage(m), []);

  const begin = useCallback(
    async (next: Run): Promise<void> => {
      setError(null);
      setFinal(null);
      setImpulse(null);
      setFailed(null);
      setLiveDb(null);
      setSeries([]);
      setImpulseState(null);
      setFloor(null);
      setArmedAt(null);
      if (!capture.current) {
        const stream = await micRef.current.start();
        if (!stream || !worker.current) return;
        try {
          capture.current = await startCapture(stream, worker.current, () => {
            expect.current = null;
            awaitingFinal.current = false;
            setError("Pengukuran terputus (layar terkunci, telepon masuk, atau pindah tab). Ulangi dan jangan tinggalkan halaman ini.");
            void releaseRef.current();
          });
        } catch (e) {
          setError(`Gagal memulai perekaman: ${e instanceof Error ? e.message : String(e)}`);
          micRef.current.stop();
          return;
        }
      }
      expect.current = next;
      setRun(next);
      send({ type: "start", mode: next, fs: capture.current.fs });
    },
    [send],
  );

  const finishLevel = useCallback(async () => {
    awaitingFinal.current = true;
    expect.current = null;
    send({ type: "stop" });
    await release();
  }, [release, send]);

  const abort = useCallback(async () => {
    awaitingFinal.current = false;
    expect.current = null;
    send({ type: "stop" });
    await release();
  }, [release, send]);

  return {
    ready,
    mic,
    run,
    error,
    liveDb,
    liveSeries,
    levelFinal,
    impulseState,
    floorDb,
    armedAt,
    impulse,
    failed,
    startLevel: () => begin("level"),
    finishLevel,
    startImpulse: (method) => begin(method),
    abort,
  };
}
