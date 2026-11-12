# Gema

Pemeriksa akustik kelas berbasis web. Gema memandu tiga pengukuran:

1. Kebisingan latar kelas kosong (LAeq).
2. Waktu dengung RT60 dari bunyi impuls (tepuk tangan atau balon).
3. Kebisingan saat kelas ramai (LAeq).

Hasilnya berupa laporan dan saran perbaikan (karpet, tirai, panel peredam).

**Gema adalah alat skrining, bukan pengukuran bersertifikat.** Mikrofon ponsel dan laptop tidak terkalibrasi seperti sound level meter kelas 1 atau 2. Setiap angka dBA selalu ditampilkan bersama status kalibrasinya.

## Privasi

Semua pemrosesan sinyal berjalan di perangkat. Audio tidak pernah diunggah.

## Standar acuan

ANSI/ASA S12.60-2010 Part 1 (R2020), Tabel 1, untuk ruang belajar inti dalam kondisi kosong dan berperabot:

| Volume ruang | Kebisingan latar maks. | RT60 maks. (pita oktaf 500, 1000, 2000 Hz) |
|---|---|---|
| ≤ 283 m³ | 35 dBA (rata-rata satu jam) | 0,6 s |
| > 283 m³ dan ≤ 566 m³ | 35 dBA (rata-rata satu jam) | 0,7 s |

## Struktur repo

- `dsp/`: pustaka DSP Rust (pembobotan A, LAeq, RT60 metode integrasi Schroeder). Dikompilasi ke WebAssembly.

## Pengembangan

```bash
cd dsp
cargo test
cargo clippy --all-targets -- -D warnings
```

## Author & License

Created by Vassel Goleyu. Copyright (c) 2026 Vassel Goleyu. Dirilis di bawah lisensi MIT, lihat [LICENSE](LICENSE).
