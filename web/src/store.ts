// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
// Penyimpanan IndexedDB: satu object store key-value. Hanya hasil ukur yang disimpan, tidak pernah audio.
import { useCallback, useEffect, useRef, useState } from "react";
import type { CalibrationProfile } from "./calibration";
import type { NoiseResult, ReverbResult, Room } from "./measure";

const DB = "gema";
const STORE = "kv";

const open = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const kvGet = <T,>(key: string): Promise<T | undefined> => tx("readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
export const kvSet = (key: string, value: unknown): Promise<IDBValidKey> => tx("readwrite", (s) => s.put(value, key));
export const kvDel = (key: string): Promise<undefined> => tx("readwrite", (s) => s.delete(key));

export type Screen = "home" | "noise-empty" | "reverb" | "noise-occupied" | "summary" | "calibration";
/** Langkah di stepper; layar kalibrasi dibuka dari banner dan tidak ikut stepper. */
export type StepScreen = Exclude<Screen, "calibration">;
export const SCREENS: StepScreen[] = ["home", "noise-empty", "reverb", "noise-occupied", "summary"];

export interface Session {
  v: 1;
  screen: Screen;
  room: Room;
  noiseEmpty?: NoiseResult;
  reverb?: ReverbResult;
  noiseOccupied?: NoiseResult;
}

export const EMPTY_SESSION: Session = { v: 1, screen: "home", room: { name: "", length: "", width: "", height: "" } };

/** Data lama atau rusak (versi lain, layar tak dikenal) dibuang, bukan dipaksa dibaca. */
const valid = (s: unknown): s is Session =>
  typeof s === "object" && s !== null && (s as Session).v === 1 && ((s as Session).screen === "calibration" || SCREENS.includes((s as Session).screen as StepScreen)) && typeof (s as Session).room === "object";

export interface SessionApi {
  session: Session;
  /** `false` bila browser menolak IndexedDB (mode privat, penyimpanan penuh): data hanya hidup sampai tab ditutup. */
  persisted: boolean;
  update(patch: Partial<Session>): void;
  reset(): void;
}

/** `null` selama data awal masih dibaca, supaya layar tidak berkedip dari kosong ke terisi. */
export function useSession(): SessionApi | null {
  const [session, setSession] = useState<Session | null>(null);
  const [persisted, setPersisted] = useState(true);
  const loaded = useRef(false);

  useEffect(() => {
    kvGet<Session>("session").then(
      (s) => setSession(valid(s) ? s : EMPTY_SESSION),
      () => {
        setPersisted(false);
        setSession(EMPTY_SESSION);
      },
    );
  }, []);

  useEffect(() => {
    if (!session) return;
    if (!loaded.current) {
      loaded.current = true;
      return; // jangan menimpa data yang baru dibaca dengan salinannya sendiri
    }
    kvSet("session", session).catch(() => setPersisted(false));
  }, [session]);

  const update = useCallback((patch: Partial<Session>) => setSession((s) => (s ? { ...s, ...patch } : s)), []);
  const reset = useCallback(() => setSession(EMPTY_SESSION), []);
  return session ? { session, persisted, update, reset } : null;
}

export interface CalibrationApi {
  /** Profil perangkat yang sedang dipakai; sebelum mikrofon pernah dibuka, profil perangkat terakhir. */
  profile: CalibrationProfile | null;
  save(p: CalibrationProfile): void;
  clear(): void;
}

/** Satu profil per perangkat di kunci `cal:<deviceId>`; `cal:last` mengingat perangkat terakhir untuk tampilan awal. */
export function useCalibration(deviceId: string | null): CalibrationApi {
  const [profile, setProfile] = useState<CalibrationProfile | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const id = deviceId ?? (await kvGet<string>("cal:last"));
      const p = id ? await kvGet<CalibrationProfile>(`cal:${id}`) : undefined;
      if (live) setProfile(p ?? null);
    };
    load().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [deviceId]);

  const save = useCallback((p: CalibrationProfile) => {
    setProfile(p);
    Promise.all([kvSet(`cal:${p.deviceId}`, p), kvSet("cal:last", p.deviceId)]).catch(() => undefined);
  }, []);
  const clear = useCallback(() => {
    setProfile((p) => {
      if (p) kvDel(`cal:${p.deviceId}`).catch(() => undefined);
      return null;
    });
  }, []);
  return { profile, save, clear };
}
