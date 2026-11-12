// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import { fmt1, type Status } from "./measure";
import type { AccuracyCode, CalibrationProfile, CalStamp } from "./calibration";
import { T } from "./copy";
import type { Measurer } from "./audio/useMeasurer";
import type { ProcessingIssue } from "./audio/useMicrophone";

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" className="chip-icon">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ICONS = {
  andal: "M3 8.5l3.2 3.2L13 4.8", // centang
  ulang: "M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3", // panah ulang
  none: "M4 8h8", // strip
};

/** Status kualitas: ikon + kata, jadi tidak bergantung pada warna saja. */
export function StatusChip({ status }: { status: Status | "none" }) {
  return (
    <span className={`chip chip-${status}`}>
      <Icon d={ICONS[status]} />
      {T.status[status]}
    </span>
  );
}

const dateId = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" });
export const fmtDate = (ms: number): string => dateId.format(ms);

/** Wajib mendampingi setiap angka dBA: status kalibrasi dari hasil itu sendiri. */
export function CalNote({ cal }: { cal?: CalStamp | null }) {
  return cal ? (
    <p className="cal">
      <span className="badge badge-ok">{T.cal.badgeOk}</span> {T.cal.noteOk(fmtDate(cal.at), fmt1(cal.offsetDb))}
    </p>
  ) : (
    <p className="cal">
      <span className="badge">{T.cal.badge}</span> {T.cal.note}
    </p>
  );
}

/** Banner permanen di atas semua layar: tidak bisa ditutup selama perangkat belum dikalibrasi. */
export function CalBanner({ profile, onCalibrate }: { profile: CalibrationProfile | null; onCalibrate(): void }) {
  return (
    <div className={`notice ${profile ? "notice-info" : "notice-warn"}`} role="status">
      {!profile && <strong>{T.cal.bannerTitle}</strong>}
      <p>{profile ? T.cal.bannerOk(fmtDate(profile.at)) : T.cal.banner}</p>
      <button type="button" className="btn btn-small" onClick={onCalibrate}>{profile ? T.cal.recalibrate : T.cal.calibrate}</button>
    </div>
  );
}

/** Teks "skrining, bukan pengukuran bersertifikat"; teks yang sama dipakai laporan PDF. */
export const Screening = () => <p className="screening">{T.screening}</p>;

export function Accuracy({ codes }: { codes?: AccuracyCode[] }) {
  return <Reasons items={(codes ?? []).map((c) => T.accuracy[c])} />;
}

export function Reasons({ items }: { items: string[] }) {
  return items.length ? (
    <ul className="reasons">
      {items.map((r) => (
        <li key={r}>{r}</li>
      ))}
    </ul>
  ) : null;
}

export function Notice({ title, children, tone = "warn" }: { title?: string; children: ReactNode; tone?: "warn" | "info" }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "warn" ? "alert" : "status"}>
      {title && <strong>{title}</strong>}
      <p>{children}</p>
    </div>
  );
}

/** Masalah mikrofon, dan peringatan fitur pengolah suara yang tidak terbukti mati. */
export function MicNotices({ m }: { m: Measurer }) {
  const key = m.mic.status as keyof typeof T.mic;
  const problem = T.mic[key];
  const issues: ProcessingIssue[] = m.mic.issues;
  return (
    <>
      {problem && <Notice title={problem.t}>{problem.d}</Notice>}
      {m.mic.status === "requesting" && <Notice tone="info">{T.micRequesting}</Notice>}
      {m.error && <Notice>{m.error}</Notice>}
      {issues.length > 0 && m.run && (
        <Notice>{T.deviceWarn(issues.map((i) => `${T.feature[i.feature]} (${i.state})`).join(", "))}</Notice>
      )}
    </>
  );
}
