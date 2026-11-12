// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import { useCallback, useEffect, useRef, useState } from "react";

export type MicStatus = "idle" | "requesting" | "active" | "denied" | "no-device" | "insecure" | "unsupported" | "error";

export type Feature = "echoCancellation" | "noiseSuppression" | "autoGainControl";

export interface ProcessingIssue {
  feature: Feature;
  /** "aktif": browser melaporkan masih menyala. "tidak-diketahui": getSettings tidak melaporkannya. */
  state: "aktif" | "tidak-diketahui";
}

const FEATURES: Feature[] = ["echoCancellation", "noiseSuppression", "autoGainControl"];

/** Fitur pengolah suara yang tidak terbukti mati menurut `getSettings()`. Kosong = patuh. */
export function checkProcessing(s: MediaTrackSettings): ProcessingIssue[] {
  return FEATURES.flatMap((feature): ProcessingIssue[] => {
    const v = s[feature];
    if (v === false) return [];
    return [{ feature, state: v === true ? "aktif" : "tidak-diketahui" }];
  });
}

export interface Microphone {
  status: MicStatus;
  stream: MediaStream | null;
  issues: ProcessingIssue[];
  /** Sample rate yang dilaporkan track (bisa beda dari AudioContext; AudioContext yang menentukan analisis). */
  trackSampleRate: number | null;
  /** Perangkat mikrofon terakhir yang dibuka; tetap ada setelah `stop` supaya hasil bisa dikaitkan ke kalibrasinya. */
  device: { id: string; label: string } | null;
  start(): Promise<MediaStream | null>;
  stop(): void;
}

export function useMicrophone(): Microphone {
  const [status, setStatus] = useState<MicStatus>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [issues, setIssues] = useState<ProcessingIssue[]>([]);
  const [trackSampleRate, setRate] = useState<number | null>(null);
  const [device, setDevice] = useState<{ id: string; label: string } | null>(null);
  const ref = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    ref.current?.getTracks().forEach((t) => t.stop());
    ref.current = null;
    setStream(null);
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (!window.isSecureContext) return setStatus("insecure"), null;
    if (!navigator.mediaDevices?.getUserMedia) return setStatus("unsupported"), null;
    setStatus("requesting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      const settings = s.getAudioTracks()[0]?.getSettings() ?? {};
      ref.current = s;
      setStream(s);
      setIssues(checkProcessing(settings));
      setRate(settings.sampleRate ?? null);
      if (settings.deviceId) setDevice({ id: settings.deviceId, label: s.getAudioTracks()[0]?.label ?? "" });
      setStatus("active");
      return s;
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setStatus(name === "NotAllowedError" ? "denied" : name === "NotFoundError" ? "no-device" : "error");
      return null;
    }
  }, []);

  useEffect(() => () => ref.current?.getTracks().forEach((t) => t.stop()), []);

  return { status, stream, issues, trackSampleRate, device, start, stop };
}
