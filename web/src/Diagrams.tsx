// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
// Denah kelas dari atas, digambar dengan SVG ringan. Warna lewat variabel tema, jadi ikut mode gelap.
import { T } from "./copy";

const Room = () => (
  <>
    <rect x="8" y="8" width="304" height="164" rx="6" className="d-room" />
    <rect x="130" y="6" width="60" height="4" className="d-board" />
    <text x="160" y="26" textAnchor="middle" className="d-label">Papan tulis</text>
    {[0, 1, 2].flatMap((r) => [0, 1, 2, 3].map((c) => <rect key={`${r}${c}`} x={52 + c * 62} y={92 + r * 24} width="20" height="14" rx="2" className="d-desk" />))}
  </>
);

const Phone = () => (
  <g>
    <rect x="148" y="104" width="12" height="20" rx="3" className="d-phone" />
    <circle cx="154" cy="114" r="14" className="d-ring" />
    <circle cx="154" cy="114" r="22" className="d-ring d-ring2" />
    <text x="154" y="146" textAnchor="middle" className="d-label">Ponsel (merekam)</text>
  </g>
);

export function ImpulseDiagram() {
  return (
    <svg viewBox="0 0 320 180" className="diagram" role="img" aria-label={T.reverb.diagramImpulse}>
      <Room />
      <Phone />
      <circle cx="154" cy="48" r="7" className="d-person" />
      <path d="M140 38l6 4M168 38l-6 4" className="d-burst" />
      <text x="154" y="68" textAnchor="middle" className="d-label">Tepuk atau balon</text>
      <path d="M154 74v18" className="d-arrow" markerEnd="url(#head)" />
      <defs>
        <marker id="head" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0l6 3-6 3z" className="d-head" />
        </marker>
      </defs>
    </svg>
  );
}

export function SweepDiagram() {
  return (
    <svg viewBox="0 0 320 180" className="diagram" role="img" aria-label={T.reverb.diagramSweep}>
      <Room />
      <Phone />
      <rect x="140" y="32" width="28" height="22" rx="3" className="d-speaker" />
      <circle cx="154" cy="43" r="6" className="d-cone" />
      <path d="M176 36q8 7 0 14M184 32q12 11 0 22" className="d-burst" />
      <text x="154" y="68" textAnchor="middle" className="d-label">Speaker memutar nada</text>
      <path d="M154 74v18" className="d-arrow" markerEnd="url(#head2)" />
      <defs>
        <marker id="head2" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0l6 3-6 3z" className="d-head" />
        </marker>
      </defs>
    </svg>
  );
}
