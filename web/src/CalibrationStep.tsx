// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from "react";
import type { Measurer } from "./audio/useMeasurer";
import { CAL_SECONDS, computeOffset, parseDba, REF_DBA_RANGE } from "./calibration";
import { T } from "./copy";
import { assessNoise, fmt1, fmtDb } from "./measure";
import type { CalibrationApi } from "./store";
import { fmtDate, MicNotices, Notice } from "./ui";

interface Props {
  m: Measurer;
  api: CalibrationApi;
  onBack(): void;
}

/** Ukur acuan eksternal CAL_SECONDS detik (LAeq berbobot A, dBFS), lalu hitung offset dari angka dBA alat acuan. */
export function CalibrationStep({ m, api, onBack }: Props) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [measured, setMeasured] = useState<number | null>(null);
  const [unusable, setUnusable] = useState(false);
  const [ref, setRef] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const pending = useRef(false);
  const finishing = useRef(false);
  const measuring = m.run === "level";
  const { abort, finishLevel } = m;

  useEffect(() => () => void abort(), [abort]);

  useEffect(() => {
    if (!measuring) return;
    setStartedAt((s) => s ?? Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [measuring]);

  const elapsed = measuring && startedAt ? (now - startedAt) / 1000 : 0;
  useEffect(() => {
    if (measuring && elapsed >= CAL_SECONDS && !finishing.current) {
      finishing.current = true;
      void finishLevel();
    }
  }, [measuring, elapsed, finishLevel]);

  useEffect(() => {
    const f = m.levelFinal;
    if (!f || !pending.current) return;
    pending.current = false;
    // Terpotong, terlalu singkat, atau pengolah suara aktif membuat acuan tidak bisa dipercaya.
    const q = assessNoise({ seconds: f.seconds, peak_db: f.peak_db, lmax_db: 0, l90_db: 0 }, "occupied");
    const bad = q.status === "ulang" || m.mic.issues.length > 0;
    setUnusable(bad);
    setMeasured(bad ? null : f.stats.leq_db);
    setSavedAt(null);
  }, [m.levelFinal, m.mic.issues]);

  const start = async () => {
    pending.current = true;
    finishing.current = false;
    setStartedAt(null);
    setMeasured(null);
    setUnusable(false);
    await m.startLevel();
  };

  const refDba = parseDba(ref);
  const offset = measured !== null && refDba !== null ? computeOffset(refDba, measured) : null;
  const refBad = refDba === null || refDba < REF_DBA_RANGE[0] || refDba > REF_DBA_RANGE[1];
  const device = m.mic.device;
  const left = Math.max(0, Math.ceil(CAL_SECONDS - elapsed));

  const save = () => {
    if (offset === null || refDba === null || !device) return;
    const at = Date.now();
    api.save({ deviceId: device.id, label: device.label, offsetDb: offset, refDba, at });
    setSavedAt(at);
  };

  return (
    <>
      <section className="hero">
        <h1 tabIndex={-1}>{T.calib.title}</h1>
        <p className="lead">{T.calib.lead}</p>
      </section>

      {api.profile && (
        <section className="card" aria-labelledby="cal-cur">
          <h2 id="cal-cur">{T.cal.badgeOk}</h2>
          <p>{T.calib.current(fmtDate(api.profile.at), fmt1(api.profile.refDba), fmt1(api.profile.offsetDb))}</p>
          <p className="muted small">{T.calib.note}</p>
          <button type="button" className="btn btn-small" onClick={api.clear}>{T.calib.remove}</button>
        </section>
      )}

      <MicNotices m={m} />
      {unusable && <Notice>{T.calib.unusable}</Notice>}

      <section className="card" aria-labelledby="cal-how">
        <h2 id="cal-how">Cara mengkalibrasi</h2>
        <ol className="steps">{T.calib.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        {measuring ? (
          <>
            <p className="measuring" role="status">{T.calib.measuring} {T.noise.seconds(left)}</p>
            <button type="button" className="btn" onClick={() => void abort()}>{T.calib.cancel}</button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!m.ready} onClick={() => void start()}>{T.calib.start}</button>
        )}
      </section>

      {measured !== null && !measuring && (
        <section className="card" aria-labelledby="cal-ref">
          <h2 id="cal-ref">{T.calib.refLabel}</h2>
          <p className="muted">{T.calib.measured(fmtDb(measured))}</p>
          <label htmlFor="cal-ref-in">{T.calib.refLabel}</label>
          <input id="cal-ref-in" inputMode="decimal" value={ref} onChange={(e) => setRef(e.target.value)} aria-invalid={ref !== "" && offset === null} aria-describedby="cal-ref-msg" />
          <p id="cal-ref-msg" className={ref !== "" && offset === null ? "reasons" : "muted"} role={ref !== "" && offset === null ? "alert" : undefined}>
            {ref === "" ? "" : refBad ? T.calib.refInvalid : offset === null ? T.calib.offsetInvalid : T.calib.offset(fmt1(offset))}
          </p>
          <button type="button" className="btn btn-primary" disabled={offset === null || !device} onClick={save}>{T.calib.save}</button>
          {!device && <p className="muted small">{T.calib.noDevice}</p>}
          {savedAt !== null && <p role="status">{T.calib.saved(fmtDate(savedAt))}</p>}
        </section>
      )}

      <div className="actions">
        <button type="button" className="btn" onClick={onBack}>{T.calib.back}</button>
      </div>
    </>
  );
}
