<!-- Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT -->
# Lapisan audio

```
getUserMedia (useMicrophone) -> AudioContext -> AudioWorklet (processor.ts)
   -- MessagePort, blok 2048 sampel ditransfer, tanpa lewat thread UI -->
Worker (worker.ts) -> Engine (engine.ts) -> WASM (level_stats, rt60_bands)
   -> pesan FromWorker bertipe (protocol.ts) -> UI
```

- `Engine.handle(ToWorker)` tidak bergantung pada API Worker. Tes mengirim blok sintetis lewat pesan `block` yang sama dengan worklet, jadi jalur sintetis identik dengan jalur mikrofon.
- Sample rate: selalu `AudioContext.sampleRate` (dikirim di pesan `start`), tidak pernah diasumsikan 44100/48000. `trackSampleRate` dari `getSettings()` hanya informasi.
- Mode `level`: LAeq jendela 1 s (ring buffer) tiap blok, dan statistik penuh saat berhenti (maksimum 600 s direkam).
- Mode `impulse`: lantai derau diukur 10 blok pertama, pemicu = puncak blok 20 dB di atas lantai (minimum -50 dBFS), merekam 0,25 s pra-pemicu + 3 s (dijepit 2..4 s), lalu `rt60_bands`.

## Perintah

```
pnpm build:wasm   # wajib sebelum dev/test: membangun dsp/ ke src/wasm-pkg (butuh wasm-pack)
pnpm test         # unit + jalur sintetis (Node)
pnpm test:e2e     # Playwright, Chromium dengan fake audio device (butuh `pnpm exec playwright install chromium`)
```

## Batasan platform

**HTTPS wajib.** `getUserMedia` hanya ada di secure context: HTTPS atau `localhost`. Lewat HTTP biasa (misalnya IP LAN untuk menguji dari ponsel) `navigator.mediaDevices` tidak ada, dan hook melaporkan status `insecure`. Untuk uji di ponsel gunakan tunnel HTTPS atau sertifikat lokal. Jangan memasang header `Permissions-Policy: microphone=()`; iframe memerlukan `allow="microphone"`.

**iOS Safari** (semua browser di iOS memakai WebKit). Belum diuji pada perangkat; hal berikut dari perilaku platform yang diketahui, jadi verifikasi sebelum diandalkan:
- Constraint `echoCancellation`, `noiseSuppression`, `autoGainControl: false` bisa diabaikan atau tidak dilaporkan di `getSettings()`. Hook memperingatkan setiap fitur yang tidak terbukti mati (`aktif` atau `tidak-diketahui`), dan UI wajib menampilkan peringatan itu di samping angka dBA/RT60.
- `AudioContext` hanya berjalan setelah gestur pengguna: `startCapture` harus dipanggil dari handler klik (sudah begitu di `App.tsx`). Konteks dapat `suspended` lagi saat telepon masuk, layar terkunci, atau pindah tab.
- Sample rate mengikuti perangkat keras dan rute audio (bisa berubah saat memasang headset/Bluetooth); rekaman yang sedang berjalan sebaiknya dibatalkan bila `AudioContext.state` berubah.
- Izin mikrofon bisa ditanyakan ulang pada tiap sesi halaman.
- Mikrofon bawaan iPhone/iPad tidak terkalibrasi dan prosesor perangkat keras tidak selalu bisa dimatikan dari web: angka tetap "belum terkalibrasi" dan hanya indikatif.
- AudioWorklet butuh Safari 14.1+, module worker butuh Safari 15+.

**Batasan lain.** Level live memakai jendela 1 detik tanpa melanjutkan state filter pembobotan A antar-jendela, sehingga ada transien awal kecil; nilai akhir saat berhenti dihitung dari seluruh rekaman dan tidak terpengaruh.
