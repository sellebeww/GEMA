// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from "react";
import type { Measurer } from "./audio/useMeasurer";
import { T } from "./copy";
import { EchoMeter } from "./EchoMeter";
import {
  assessNoise,
  fmt1,
  NOISE_LIMIT_DBA,
  NOISE_SECONDS,
  type NoiseKind,
  type NoiseResult,
} from "./measure";
import { accuracyWarnings, profileFor, resultDba, stampOf, toDba, type CalibrationProfile } from "./calibration";
import { Accuracy, CalNote, MicNotices, Reasons, Screening, StatusChip } from "./ui";

interface Props {
  kind: NoiseKind;
  m: Measurer;
  /** Profil kalibrasi tersimpan; dipakai hanya bila cocok dengan mikrofon yang sedang aktif. */
  cal: CalibrationProfile | null;
  result?: NoiseResult;
  /** Hasil ruang kosong, untuk selisih pada langkah 3. */
  emptyResult?: NoiseResult;
  onResult(r: NoiseResult): void;
  onNext(): void;
  onBack(): void;
}

export function NoiseStep({ kind, m, cal, result, emptyResult, onResult, onNext, onBack }: Props) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pending = useRef(false);
  const finishing = useRef(false);
  const measuring = m.run === "level";
  const { abort, finishLevel } = m;

  // Lepaskan mikrofon bila pengguna meninggalkan layar ini di tengah pengukuran.
  useEffect(() => () => void abort(), [abort]);

  useEffect(() => {
    if (!measuring) return;
    setStartedAt((s) => s ?? Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [measuring]);

  const elapsed = measuring && startedAt ? (now - startedAt) / 1000 : 0;
  useEffect(() => {
    if (measuring && elapsed >= NOISE_SECONDS && !finishing.current) {
      finishing.current = true;
      void finishLevel();
    }
  }, [measuring, elapsed, finishLevel]);

  useEffect(() => {
    const f = m.levelFinal;
    if (!f || !pending.current) return;
    pending.current = false;
    const base = { leq_db: f.stats.leq_db, lmax_db: f.stats.lmax_db, l90_db: f.stats.l90_db, peak_db: f.peak_db, seconds: f.seconds };
    const used = stampOf(profileFor(cal, m.mic.device?.id));
    const dba = resultDba({ leq_db: base.leq_db, cal: used });
    onResult({ ...base, at: Date.now(), quality: assessNoise(base, kind), cal: used, warnings: accuracyWarnings({ issues: m.mic.issues, dba }) });
  }, [m.levelFinal, m.mic.device, m.mic.issues, cal, kind, onResult]); // `pending` mencegah hasil lama terkirim ulang

  const start = async () => {
    pending.current = true;
    finishing.current = false;
    setStartedAt(null);
    await m.startLevel();
  };

  const liveOffset = profileFor(cal, m.mic.device?.id)?.offsetDb;
  const dba = result ? resultDba(result) : null;
  const left = Math.max(0, Math.ceil(NOISE_SECONDS - elapsed));
  const unavailable = !m.ready;

  return (
    <>
      <section className="hero">
        <h1 tabIndex={-1}>{T.noise.title[kind]}</h1>
        <p className="lead">{T.noise.lead[kind]}</p>
      </section>

      <MicNotices m={m} />

      {measuring ? (
        <section className="card center" aria-live="off">
          <p className="measuring">{T.noise.measuring[kind]}</p>
          <EchoMeter
            dba={m.liveDb === null ? null : toDba(m.liveDb, liveOffset)}
            progress={Math.min(1, elapsed / NOISE_SECONDS)}
            secondsLeft={left}
            series={m.liveSeries.map((v) => toDba(v, liveOffset))}
          />
          <CalNote cal={stampOf(profileFor(cal, m.mic.device?.id))} />
          <button type="button" className="btn" onClick={() => void abort()}>{T.noise.cancel}</button>
        </section>
      ) : (
        <>
          {result && dba !== null && (
            <section className="card result" aria-labelledby="res-h" data-testid="noise-result">
              <div className="result-head">
                <h2 id="res-h">{T.noise.resultTitle}</h2>
                <StatusChip status={result.quality.status} />
              </div>
              <p className="big">
                <span data-testid="noise-dba">{fmt1(dba)}</span> <span className="unit">{result.cal ? T.noise.unit : T.cal.unitRel}</span>
              </p>
              <p className="muted">{T.noise.avg}. {T.noise.unitHelp}</p>
              {kind === "empty" ? (
                <p className={`verdict ${dba <= NOISE_LIMIT_DBA ? "verdict-ok" : "verdict-bad"}`}>
                  {dba <= NOISE_LIMIT_DBA ? T.noise.verdictOk(NOISE_LIMIT_DBA) : T.noise.verdictOver(NOISE_LIMIT_DBA, fmt1(dba - NOISE_LIMIT_DBA))}
                </p>
              ) : (
                <p className="muted">
                  {emptyResult && T.summary.delta(fmt1(dba - resultDba(emptyResult)))} {T.noise.occupiedNote}
                </p>
              )}
              <Reasons items={result.quality.reasons} />
              <Accuracy codes={result.warnings} />
              <CalNote cal={result.cal} />
              <Screening />
            </section>
          )}

          <section className="card" aria-labelledby="prep-h">
            <h2 id="prep-h">Cara mengukur</h2>
            <ol className="steps">
              {T.noise.prep[kind].map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </section>
        </>
      )}

      {!measuring && (
        <div className="actions">
          <button type="button" className="btn" onClick={onBack}>{T.noise.back}</button>
          <button type="button" className={`btn ${result ? "" : "btn-primary"}`} disabled={unavailable} onClick={() => void start()}>
            {result ? T.noise.retry : T.noise.start}
          </button>
          {result && (
            <button type="button" className="btn btn-primary" onClick={onNext}>{T.noise.next[kind]}</button>
          )}
        </div>
      )}
      {!m.ready && <p className="muted small" role="status">{T.loading}</p>}
    </>
  );
}
