// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from "react";
import type { Measurer } from "./audio/useMeasurer";
import { T } from "./copy";
import { DecayExplorer } from "./DecayChart";
import { ImpulseDiagram, SweepDiagram } from "./Diagrams";
import { assessReverb, fmt2, TOO_NOISY_FLOOR_DBFS, type ReverbResult } from "./measure";
import { accuracyWarnings } from "./calibration";
import { Accuracy, MicNotices, Notice, Reasons, Screening, StatusChip } from "./ui";

/** Detik menunggu tanpa pemicu sebelum Gema menyarankan bunyi lebih keras. */
const NO_TRIGGER_AFTER_S = 15;

type Method = "impulse" | "sweep";

interface Props {
  m: Measurer;
  result?: ReverbResult;
  /** Batas RT60 (detik) untuk ruang ini, atau `null` bila volume belum diisi / di luar cakupan. */
  target: number | null;
  onResult(r: ReverbResult): void;
  onNext(): void;
  onBack(): void;
}

/** Bar lantai derau: memetakan -90..-20 dBFS ke 0..100%. Teks dan ikon menyertai warna. */
function FloorMeter({ floorDb }: { floorDb: number | null }) {
  if (floorDb === null) return null;
  const noisy = floorDb > TOO_NOISY_FLOOR_DBFS;
  const pct = Math.round(Math.min(1, Math.max(0, (floorDb + 90) / 70)) * 100);
  return (
    <div className={`floor ${noisy ? "floor-bad" : "floor-ok"}`} data-testid="floor">
      <div className="floor-bar" role="presentation"><div style={{ width: `${pct}%` }} /></div>
      <p role={noisy ? "alert" : "status"}>
        <strong>{T.reverb.floor.label}: </strong>
        {noisy ? "! " : "✓ "}
        {noisy ? T.reverb.floor.noisy : T.reverb.floor.ok}
      </p>
    </div>
  );
}

export function ReverbStep({ m, result, target, onResult, onNext, onBack }: Props) {
  const [method, setMethod] = useState<Method>(result?.method ?? "impulse");
  const [now, setNow] = useState(() => Date.now());
  const pending = useRef<Method | null>(null);
  const running = m.run === "impulse" || m.run === "sweep";
  const { abort } = m;

  useEffect(() => () => void abort(), [abort]);

  useEffect(() => {
    if (m.impulseState !== "armed") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [m.impulseState]);

  useEffect(() => {
    const r = m.impulse;
    if (!r || !pending.current) return;
    const used = pending.current;
    pending.current = null;
    onResult({ method: used, ...r, at: Date.now(), quality: assessReverb(r), warnings: accuracyWarnings({ issues: m.mic.issues }) });
  }, [m.impulse, onResult]);

  useEffect(() => {
    if (m.failed) pending.current = null;
  }, [m.failed]);

  const start = async () => {
    pending.current = method;
    await m.startImpulse(method);
  };

  const waitedS = m.armedAt ? (now - m.armedAt) / 1000 : 0;
  const noTrigger = m.impulseState === "armed" && waitedS >= NO_TRIGGER_AFTER_S;
  const mean = result?.report.mean_500_1k_2k ?? null;
  const meanRounded = mean === null ? null : Math.round(mean * 100) / 100;
  const stateText = m.run === "sweep" && m.impulseState === "recording" ? T.reverb.sweepRecording : m.impulseState ? T.reverb.state[m.impulseState] : T.reverb.state.warmup;
  const steps = method === "impulse" ? T.reverb.impulseSteps : T.reverb.sweepSteps;

  const guide = (
    <>
      <fieldset className="choice">
        <legend>{T.reverb.choose}</legend>
        {(["impulse", "sweep"] as const).map((k) => (
          <label key={k} className={`choice-card ${method === k ? "is-on" : ""}`}>
            <input type="radio" name="method" checked={method === k} onChange={() => setMethod(k)} />
            <span>
              <strong>{T.reverb[k].t}</strong>
              <small>{T.reverb[k].d}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="guide">
        {method === "impulse" ? <ImpulseDiagram /> : <SweepDiagram />}
        <ol className="steps">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>
    </>
  );

  return (
    <>
      <section className="hero">
        <h1 tabIndex={-1}>{T.reverb.title}</h1>
        <p className="lead">{T.reverb.lead}</p>
      </section>

      <MicNotices m={m} />

      {running && (
        <section className="card live" aria-labelledby="live-h" data-testid="reverb-live">
          <h2 id="live-h" className="sr-only">Perekaman berjalan</h2>
          <p className="state" role="status" aria-live="polite" data-testid="impulse-state">{stateText}</p>
          {m.impulseState !== "recording" && <FloorMeter floorDb={m.floorDb} />}
          {noTrigger && <Notice>{T.reverb.noTrigger}</Notice>}
          <button type="button" className="btn" onClick={() => void abort()}>{T.reverb.cancel}</button>
        </section>
      )}

      {!running && m.failed && (
        <Notice title={T.reverb.failed.t}>{T.reverb.failed.d}</Notice>
      )}

      {!running && result && (
        <section className="card result" aria-labelledby="res-h" data-testid="reverb-result">
          <div className="result-head">
            <h2 id="res-h">{T.reverb.resultTitle}</h2>
            <StatusChip status={result.quality.status} />
          </div>
          {meanRounded !== null ? (
            <>
              <p className="big">
                <span data-testid="rt60-mean">{fmt2(meanRounded)}</span> <span className="unit">{T.reverb.unit}</span>
              </p>
              <p className="muted">{T.reverb.meanLabel}</p>
              {target !== null && (
                <p className={`verdict ${meanRounded <= target ? "verdict-ok" : "verdict-bad"}`}>
                  {meanRounded <= target ? T.reverb.verdictOk(fmt2(target)) : T.reverb.verdictOver(fmt2(target))}
                </p>
              )}
            </>
          ) : (
            <p className="verdict verdict-bad">{T.reverb.noMean}</p>
          )}
          <Reasons items={result.quality.reasons} />
          <Accuracy codes={result.warnings} />
          <Screening />
          <DecayExplorer curves={result.curves} report={result.report} />
        </section>
      )}

      {!running && (result ? (
        <details className="card guide-details">
          <summary>Cara mengukur</summary>
          {guide}
        </details>
      ) : (
        <section className="card" aria-label="Cara mengukur">{guide}</section>
      ))}

      {!running && (
        <div className="actions">
          <button type="button" className="btn" onClick={onBack}>Kembali</button>
          <button type="button" className={`btn ${result || m.failed ? "" : "btn-primary"}`} disabled={!m.ready} onClick={() => void start()}>
            {result || m.failed ? T.reverb.retry : T.reverb.start}
          </button>
          {result && <button type="button" className="btn btn-primary" onClick={onNext}>{T.reverb.next}</button>}
        </div>
      )}
    </>
  );
}
