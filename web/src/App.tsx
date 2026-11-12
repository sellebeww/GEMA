// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import { useCallback, useEffect, useRef, useState } from "react";
import { useMeasurer } from "./audio/useMeasurer";
import { T } from "./copy";
import { Home } from "./Home";
import { NoiseStep } from "./NoiseStep";
import { ReverbStep } from "./ReverbStep";
import { CalibrationStep } from "./CalibrationStep";
import { Summary } from "./Summary";
import { roomVolume, rt60Target, type NoiseResult, type ReverbResult, type Room } from "./measure";
import { kvGet, kvSet, SCREENS, useCalibration, useSession, type Screen } from "./store";
import { CalBanner, Notice, StatusChip } from "./ui";

type Theme = "light" | "dark";

/** Pilihan tema disimpan di IndexedDB; tanpa pilihan, CSS mengikuti pengaturan sistem. */
function useTheme(): [Theme, () => void] {
  const sysDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
  const [theme, setTheme] = useState<Theme>(() => (sysDark() ? "dark" : "light"));
  const [explicit, setExplicit] = useState(false);
  useEffect(() => {
    kvGet<Theme>("theme").then(
      (t) => {
        if (t === "light" || t === "dark") {
          setTheme(t);
          setExplicit(true);
        }
      },
      () => undefined,
    );
  }, []);
  useEffect(() => {
    if (explicit) document.documentElement.dataset.theme = theme;
  }, [theme, explicit]);
  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setExplicit(true);
    kvSet("theme", next).catch(() => undefined);
  }, [theme]);
  return [theme, toggle];
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" className="logo">
      <circle cx="16" cy="16" r="3.5" fill="currentColor" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.75" />
      <circle cx="16" cy="16" r="13.5" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4" />
    </svg>
  );
}

export function App() {
  const api = useSession();
  const m = useMeasurer();
  const cal = useCalibration(m.mic.device?.id ?? null);
  const [theme, toggleTheme] = useTheme();
  const first = useRef(true);
  const screen = api?.session.screen;

  // Pindah layar: kembali ke atas dan fokus ke judul supaya pengguna pembaca layar tahu konteksnya.
  useEffect(() => {
    if (!screen) return;
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>("main h1")?.focus();
  }, [screen]);

  const update = api?.update;
  const go = useCallback((s: Screen) => update?.({ screen: s }), [update]);
  const setRoom = useCallback((room: Room) => update?.({ room }), [update]);
  const onEmpty = useCallback((r: NoiseResult) => update?.({ noiseEmpty: r }), [update]);
  const onOccupied = useCallback((r: NoiseResult) => update?.({ noiseOccupied: r }), [update]);
  const onReverb = useCallback((r: ReverbResult) => update?.({ reverb: r }), [update]);

  if (!api || !screen) return <p className="loading" role="status">{T.loading}</p>;
  const { session, persisted } = api;
  const volume = roomVolume(session.room);
  const target = volume === null ? null : rt60Target(volume);
  const results: Record<Screen, "andal" | "ulang" | "none"> = {
    home: "none",
    "noise-empty": session.noiseEmpty?.quality.status ?? "none",
    reverb: session.reverb?.quality.status ?? "none",
    "noise-occupied": session.noiseOccupied?.quality.status ?? "none",
    summary: "none",
    calibration: "none",
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <Logo />
          <div>
            <span className="brand-name">{T.app}</span>
            <span className="brand-tag">{T.tagline}</span>
          </div>
        </div>
        <button type="button" className="btn btn-small theme" onClick={toggleTheme} aria-label={theme === "dark" ? T.theme.toLight : T.theme.toDark}>
          <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span> {theme === "dark" ? T.theme.light : T.theme.dark}
        </button>
      </header>

      <nav aria-label="Langkah pengukuran" className="stepper">
        <ol>
          {SCREENS.map((s) => (
            <li key={s}>
              <button type="button" className="step" aria-current={s === screen ? "step" : undefined} onClick={() => go(s)}>
                <span className="step-n" aria-hidden="true">{s === "home" ? "⌂" : s === "summary" ? "≡" : T.navShort[s]}</span>
                <span className="step-t">{T.nav[s]}</span>
                {s !== "home" && s !== "summary" && <StatusChip status={results[s]} />}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <CalBanner profile={cal.profile} onCalibrate={() => go("calibration")} />

      <main>
        {!persisted && <Notice tone="info">{T.persist}</Notice>}
        {screen === "home" && <Home room={session.room} onRoom={setRoom} onStart={() => go("noise-empty")} />}
        {screen === "noise-empty" && (
          <NoiseStep key="e" kind="empty" m={m} cal={cal.profile} result={session.noiseEmpty} onResult={onEmpty} onNext={() => go("reverb")} onBack={() => go("home")} />
        )}
        {screen === "reverb" && (
          <ReverbStep m={m} result={session.reverb} target={target} onResult={onReverb} onNext={() => go("noise-occupied")} onBack={() => go("noise-empty")} />
        )}
        {screen === "noise-occupied" && (
          <NoiseStep key="o" kind="occupied" m={m} cal={cal.profile} result={session.noiseOccupied} emptyResult={session.noiseEmpty} onResult={onOccupied} onNext={() => go("summary")} onBack={() => go("reverb")} />
        )}
        {screen === "calibration" && <CalibrationStep m={m} api={cal} onBack={() => go("home")} />}
        {screen === "summary" && <Summary session={session} go={go} onReset={api.reset} />}
      </main>

      <footer className="foot">{T.footer}</footer>
    </div>
  );
}
