// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import { useState, type ReactNode } from "react";
import { T } from "./copy";
import { calStatus, resultDba } from "./calibration";
import { fmt1, fmt2, NOISE_LIMIT_DBA, rt60Target, roomVolume } from "./measure";
import type { Screen, Session } from "./store";
import { Accuracy, CalNote, Reasons, Screening, StatusChip } from "./ui";

interface Props {
  session: Session;
  go(s: Screen): void;
  onReset(): void;
}

function Row({ title, status, children, action }: { title: string; status: "andal" | "ulang" | "none"; children: ReactNode; action: ReactNode }) {
  return (
    <li className="sum-row">
      <div className="sum-head">
        <h3>{title}</h3>
        <StatusChip status={status} />
      </div>
      {children}
      <div className="sum-action">{action}</div>
    </li>
  );
}

export function Summary({ session, go, onReset }: Props) {
  const [confirming, setConfirming] = useState(false);
  const { noiseEmpty: e, reverb: r, noiseOccupied: o, room } = session;
  const volume = roomVolume(room);
  const target = volume === null ? null : rt60Target(volume);
  const emptyDba = e ? resultDba(e) : null;
  const occDba = o ? resultDba(o) : null;
  const rtMean = r?.report.mean_500_1k_2k;
  const rt = rtMean == null ? null : Math.round(rtMean * 100) / 100;

  const noiseHigh = emptyDba !== null && emptyDba > NOISE_LIMIT_DBA;
  const reverbHigh = rt !== null && target !== null && rt > target;
  const needsRepeat = [e, r, o].some((x) => x?.quality.status === "ulang");
  const advice = [noiseHigh && T.summary.adviceNoise, reverbHigh && T.summary.adviceReverb, needsRepeat && T.summary.adviceRepeat, rt !== null && volume === null && T.summary.adviceNoRoom].filter(
    (x): x is string => typeof x === "string",
  );
  const measured = [e, r, o].some(Boolean);

  const act = (screen: Screen, done: boolean) => (
    <button type="button" className="btn btn-small" onClick={() => go(screen)}>{done ? "Ulangi" : T.summary.goMeasure}</button>
  );

  return (
    <>
      <section className="hero">
        <h1 tabIndex={-1}>{T.summary.title}{room.name.trim() ? `: ${room.name.trim()}` : ""}</h1>
        <p className="lead">{T.summary.lead}</p>
        {volume !== null && <p className="muted">{T.home.volume(fmt1(volume))}</p>}
      </section>

      <ul className="sum" aria-label="Hasil per pengukuran">
        <Row title={T.summary.rows.empty} status={e ? e.quality.status : "none"} action={act("noise-empty", !!e)}>
          {e && emptyDba !== null ? (
            <>
              <p className="big"><span data-testid="sum-empty">{fmt1(emptyDba)}</span> <span className="unit">{e?.cal ? "dBA" : T.cal.unitRel}</span></p>
              <p className={`verdict ${noiseHigh ? "verdict-bad" : "verdict-ok"}`}>
                {noiseHigh ? T.noise.verdictOver(NOISE_LIMIT_DBA, fmt1(emptyDba - NOISE_LIMIT_DBA)) : T.noise.verdictOk(NOISE_LIMIT_DBA)}
              </p>
              <Reasons items={e.quality.reasons} />
              <Accuracy codes={e.warnings} />
            </>
          ) : <p className="muted">{T.summary.notMeasured}</p>}
        </Row>

        <Row title={T.summary.rows.reverb} status={r ? r.quality.status : "none"} action={act("reverb", !!r)}>
          {r && rt !== null ? (
            <>
              <p className="big"><span data-testid="sum-rt60">{fmt2(rt)}</span> <span className="unit">{T.reverb.unit}</span></p>
              {target !== null && (
                <p className={`verdict ${reverbHigh ? "verdict-bad" : "verdict-ok"}`}>
                  {reverbHigh ? T.reverb.verdictOver(fmt2(target)) : T.reverb.verdictOk(fmt2(target))}
                </p>
              )}
              <Reasons items={r.quality.reasons} />
              <Accuracy codes={r.warnings} />
            </>
          ) : r ? <p className="verdict verdict-bad">{T.reverb.noMean}</p> : <p className="muted">{T.summary.notMeasured}</p>}
        </Row>

        <Row title={T.summary.rows.occupied} status={o ? o.quality.status : "none"} action={act("noise-occupied", !!o)}>
          {o && occDba !== null ? (
            <>
              <p className="big"><span data-testid="sum-occupied">{fmt1(occDba)}</span> <span className="unit">{o?.cal ? "dBA" : T.cal.unitRel}</span></p>
              {emptyDba !== null && <p className="muted">{T.summary.delta(fmt1(occDba - emptyDba))}</p>}
              <Reasons items={o.quality.reasons} />
              <Accuracy codes={o.warnings} />
            </>
          ) : <p className="muted">{T.summary.notMeasured}</p>}
        </Row>
      </ul>

      {(e || o) && <CalNote cal={calStatus([e, o])} />}
      <Screening />

      {measured && (
        <section className="card" aria-labelledby="find-h">
          <h2 id="find-h">{T.summary.findingsTitle}</h2>
          {advice.length ? (
            <ul className="advice">{advice.map((a) => <li key={a}>{a}</li>)}</ul>
          ) : (
            <p>{T.summary.allGood}</p>
          )}
        </section>
      )}

      <p className="muted small">{T.summary.pdfLater}</p>

      <div className="actions">
        {confirming ? (
          <div role="group" aria-label={T.summary.restartAsk} className="confirm">
            <p>{T.summary.restartAsk}</p>
            <button type="button" className="btn btn-danger" onClick={onReset}>{T.summary.restartYes}</button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>{T.summary.restartNo}</button>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirming(true)}>{T.summary.restart}</button>
        )}
      </div>
    </>
  );
}
