// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { BandCurve, BandRt60, Rt60Report } from "./audio/protocol";
import { T } from "./copy";
import { fmt2, fmtDb } from "./measure";

const W = 400;
const H = 250;
const M = { l: 42, r: 12, t: 14, b: 34 };
const IW = W - M.l - M.r;
const IH = H - M.t - M.b;

const tickStep = (tMax: number): number => (tMax <= 1.2 ? 0.2 : tMax <= 3 ? 0.5 : 1);

interface ChartProps {
  curve: BandCurve;
  band: BandRt60 | undefined;
}

/** Kurva Schroeder satu pita: sumbu dB terhadap detik, rentang hitung T20/T30, dan garis kecocokan. */
export function DecayChart({ curve, band }: ChartProps) {
  const [idx, setIdx] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const n = curve.db.length;
  const last = n - 1;
  const tMax = Math.max(last * curve.step_s, 0.1);
  const minDb = Math.min(...curve.db);
  const yMin = Math.max(-80, Math.min(-40, Math.floor(minDb / 10) * 10));
  const x = (t: number) => M.l + (t / tMax) * IW;
  const y = (d: number) => M.t + (d / yMin) * IH;

  const path = curve.db.map((d, i) => `${i ? "L" : "M"}${x(i * curve.step_s).toFixed(1)} ${y(d).toFixed(1)}`).join("");
  const dbTicks: number[] = [];
  for (let d = 0; d >= yMin; d -= yMin <= -60 ? 20 : 10) dbTicks.push(d);
  const tStep = tickStep(tMax);
  const tTicks: number[] = [];
  for (let t = 0; t <= tMax + 1e-9; t += tStep) tTicks.push(Number(t.toFixed(2)));

  // Rentang hitung: -5 dB sampai -25 (T20) atau -35 dB (T30).
  const lo = band?.method === "T30" ? 35 : 25;
  const rt = band?.rt60 ?? null;
  const t5Idx = curve.db.findIndex((d) => d <= -5);
  // shortcut: garis kecocokan diangkur di titik kurva -5 dB dengan kemiringan -60/RT60; regresi sebenarnya
  // sedikit bergeser, tetapi kemiringannya (yang menentukan angka RT60) sama.
  const fit =
    rt && t5Idx >= 0
      ? (() => {
          const t0 = t5Idx * curve.step_s;
          const t1 = Math.min(tMax, t0 + ((-yMin - 5) * rt) / 60);
          return { x1: x(t0), y1: y(-5), x2: x(t1), y2: y(-5 - (60 * (t1 - t0)) / rt) };
        })()
      : null;

  const move = (i: number) => setIdx(Math.min(last, Math.max(0, i)));
  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const t = (((e.clientX - r.left) / r.width) * W - M.l) / IW * tMax;
    move(Math.round(t / curve.step_s));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = e.shiftKey ? 10 : 1;
    const cur = idx ?? 0;
    const next = e.key === "ArrowRight" ? cur + step : e.key === "ArrowLeft" ? cur - step : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    move(next);
  };

  const readout = idx === null ? null : T.reverb.readout(fmt2(idx * curve.step_s), fmtDb(curve.db[idx] ?? 0));
  return (
    <div className="chart">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="chart-svg"
        role="img"
        tabIndex={0}
        aria-label={`${T.reverb.chartTitle}, ${T.reverb.bandName(curve.band_hz)}. ${T.reverb.chartHelp}`}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={(e) => e.pointerType === "mouse" && document.activeElement !== svg.current && setIdx(null)}
        onKeyDown={onKey}
        onFocus={() => idx === null && move(Math.round(last * 0.1))}
      >
        <rect x={M.l} y={y(-5)} width={IW} height={y(-lo) - y(-5)} className="c-range" />
        {dbTicks.map((d) => (
          <g key={d}>
            <line x1={M.l} x2={W - M.r} y1={y(d)} y2={y(d)} className="c-grid" />
            <text x={M.l - 6} y={y(d) + 3.5} textAnchor="end" className="c-tick">{fmtDb(d).replace(",0", "")}</text>
          </g>
        ))}
        {tTicks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={M.t} y2={M.t + IH} className="c-grid c-grid-v" />
            <text x={x(t)} y={H - 16} textAnchor="middle" className="c-tick">{fmt2(t).replace(/,?0+$/, "") || "0"}</text>
          </g>
        ))}
        <text x={M.l + IW / 2} y={H - 3} textAnchor="middle" className="c-axis">detik</text>
        <text x={12} y={M.t + IH / 2} textAnchor="middle" className="c-axis" transform={`rotate(-90 12 ${M.t + IH / 2})`}>dB</text>
        <text x={W - M.r - 4} y={y(-5) + 12} textAnchor="end" className="c-note">{T.reverb.rangeLabel}</text>
        <path d={path} className="c-curve" fill="none" />
        {fit && <line {...fit} className="c-fit" />}
        {idx !== null && (
          <g className="c-cursor">
            <line x1={x(idx * curve.step_s)} x2={x(idx * curve.step_s)} y1={M.t} y2={M.t + IH} />
            <circle cx={x(idx * curve.step_s)} cy={y(curve.db[idx] ?? 0)} r="4.5" />
          </g>
        )}
      </svg>
      <p className="chart-legend" aria-hidden="true">
        <span className="lg lg-curve" /> {T.reverb.chartTitle}
        <span className="lg lg-fit" /> {T.reverb.fitLabel}
        <span className="lg lg-range" /> {T.reverb.rangeLabel}
      </p>
      <p className="readout" role="status" aria-live="polite" data-testid="readout">{readout ?? T.reverb.chartHelp}</p>
    </div>
  );
}

interface ExplorerProps {
  curves: BandCurve[];
  report: Rt60Report;
}

/** Pilih pita oktaf (tab) lalu lihat kurva peluruhannya. */
export function DecayExplorer({ curves, report }: ExplorerProps) {
  const [active, setActive] = useState(Math.max(0, curves.findIndex((c) => c.band_hz === 1000)));
  const base = useId();
  const curve = curves[active];
  const band = report.bands.find((b) => b.band_hz === curve?.band_hz);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (active + d + curves.length) % curves.length;
    setActive(next);
    document.getElementById(`${base}-tab-${next}`)?.focus();
  };

  if (!curve) return null;
  return (
    <section className="explorer" aria-labelledby={`${base}-h`}>
      <h3 id={`${base}-h`}>{T.reverb.chartTitle}</h3>
      <div role="tablist" aria-label={T.reverb.bandsLabel} className="tabs" onKeyDown={onKey}>
        {curves.map((c, i) => {
          const b = report.bands.find((x) => x.band_hz === c.band_hz);
          const ok = b?.reliable ?? false;
          return (
            <button
              key={c.band_hz}
              id={`${base}-tab-${i}`}
              role="tab"
              type="button"
              aria-selected={i === active}
              aria-controls={`${base}-panel`}
              tabIndex={i === active ? 0 : -1}
              className={`tab ${ok ? "tab-ok" : "tab-bad"}`}
              onClick={() => setActive(i)}
            >
              <span className="tab-hz">{T.reverb.bandName(c.band_hz)}</span>
              <span className="tab-val">{b?.rt60 != null ? `${fmt2(b.rt60)} s` : T.reverb.bandNone}</span>
              <span className="tab-state">{ok ? "✓" : "!"}<span className="sr-only"> {ok ? T.reverb.bandOk : T.reverb.bandBad}</span></span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${active}`}>
        <p className="band-line">
          <strong>{T.reverb.bandName(curve.band_hz)}</strong>:{" "}
          {band?.rt60 != null ? `${fmt2(band.rt60)} ${T.reverb.unit}` : T.reverb.bandNone}, {band?.reliable ? T.reverb.bandOk.toLowerCase() : T.reverb.bandBad.toLowerCase()}
        </p>
        <DecayChart key={curve.band_hz} curve={curve} band={band} />
        {band && (
          <details className="tech">
            <summary>{T.reverb.tech}</summary>
            <dl>
              <dt>Metode</dt><dd>{band.method}</dd>
              <dt>T20</dt><dd>{band.t20 ? `${fmt2(band.t20.seconds)} s (r = ${fmt2(band.t20.r)})` : "-"}</dd>
              <dt>T30</dt><dd>{band.t30 ? `${fmt2(band.t30.seconds)} s (r = ${fmt2(band.t30.r)})` : "-"}</dd>
              <dt>Rentang dinamis</dt><dd>{fmtDb(band.dynamic_range_db)} dB (cadangan {fmtDb(band.headroom_db)} dB)</dd>
            </dl>
          </details>
        )}
      </div>
    </section>
  );
}
