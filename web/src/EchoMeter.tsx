// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import { T } from "./copy";
import { fmt1 } from "./measure";

const C = 130;
const R = 118;
const CIRC = 2 * Math.PI * R;
/** Rentang dBA yang menggerakkan cincin; di luar ini cincin diam di ujung. */
const LO = 25;
const HI = 85;

interface Props {
  dba: number | null;
  /** 0..1 */
  progress: number;
  secondsLeft: number;
  /** Riwayat dBA untuk grafik mini di bawah meter. */
  series: number[];
}

/** Meter level live: cincin gema yang mengembang mengikuti bunyi, busur hitung mundur di tepi. */
export function EchoMeter({ dba, progress, secondsLeft, series }: Props) {
  const level = dba === null ? 0 : Math.min(1, Math.max(0, (dba - LO) / (HI - LO)));
  return (
    <figure className="meter" aria-label={T.noise.live}>
      <svg viewBox="0 0 260 260" className="meter-svg" aria-hidden="true">
        {[0.42, 0.62, 0.82].map((base, i) => (
          <circle
            key={base}
            cx={C}
            cy={C}
            r={R}
            className="meter-ring"
            style={{ transform: `scale(${base + level * (0.16 - i * 0.03)})`, transformOrigin: `${C}px ${C}px`, opacity: 0.85 - i * 0.22 }}
          />
        ))}
        <circle cx={C} cy={C} r={R} className="meter-track" />
        <circle
          cx={C}
          cy={C}
          r={R}
          className="meter-arc"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - progress)}
          transform={`rotate(-90 ${C} ${C})`}
        />
      </svg>
      <div className="meter-center">
        <span className="meter-value" data-testid="live-dba">{dba === null ? "…" : fmt1(dba)}</span>
        <span className="meter-unit">{T.noise.unit}</span>
        <span className="meter-left">{T.noise.seconds(secondsLeft)}</span>
      </div>
      <span className="sr-only" aria-live="polite">{secondsLeft % 10 === 0 ? T.noise.seconds(secondsLeft) : ""}</span>
      <Sparkline series={series} />
    </figure>
  );
}

function Sparkline({ series }: { series: number[] }) {
  if (series.length < 2) return <div className="spark spark-empty" aria-hidden="true" />;
  const lo = Math.min(...series, LO);
  const hi = Math.max(...series, lo + 20);
  const pts = series.map((v, i) => `${((i / (series.length - 1)) * 300).toFixed(1)},${(38 - ((v - lo) / (hi - lo)) * 34).toFixed(1)}`);
  return (
    <svg viewBox="0 0 300 42" className="spark" aria-hidden="true" preserveAspectRatio="none">
      <polyline points={pts.join(" ")} fill="none" className="spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
