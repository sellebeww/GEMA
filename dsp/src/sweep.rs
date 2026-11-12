// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
//! Log sweep (Farina), filter invers, dan dekonvolusi untuk memperoleh impulse response.

use std::f64::consts::PI;
use std::fmt;

/// Durasi sweep maksimum; FFT 2^22 titik kompleks sudah puluhan MB.
const MAX_SECS: f64 = 30.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SweepError {
    /// Syarat: 0 < f1 < f2 < fs/2, fs > 0, durasi > 0.
    InvalidParams,
}

impl fmt::Display for SweepError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "parameter sweep tidak valid")
    }
}

impl std::error::Error for SweepError {}

pub struct Sweep {
    /// Sinyal yang diputar, amplitudo puncak <= 1.
    pub signal: Vec<f32>,
    /// Filter invers, dinormalisasi supaya `signal` dikonvolusi `inverse` berpuncak 1.
    pub inverse: Vec<f32>,
}

/// Konvolusi linier via FFT; panjang keluaran a.len() + b.len() - 1.
pub(crate) fn fft_convolve(a: &[f64], b: &[f64]) -> Vec<f64> {
    if a.is_empty() || b.is_empty() {
        return Vec::new();
    }
    let out_len = a.len() + b.len() - 1;
    let n = out_len.next_power_of_two();
    let load = |x: &[f64]| -> Vec<Cx> {
        let mut v: Vec<Cx> = x.iter().map(|&r| (r, 0.0)).collect();
        v.resize(n, (0.0, 0.0));
        v
    };
    let (mut fa, mut fb) = (load(a), load(b));
    fft(&mut fa, false);
    fft(&mut fb, false);
    for (x, y) in fa.iter_mut().zip(&fb) {
        *x = (x.0 * y.0 - x.1 * y.1, x.0 * y.1 + x.1 * y.0);
    }
    fft(&mut fa, true);
    fa.iter().take(out_len).map(|c| c.0).collect()
}

type Cx = (f64, f64);

/// FFT radix-2 di tempat; `buf.len()` harus pangkat dua. Arah balik sudah dibagi n.
fn fft(buf: &mut [Cx], inverse: bool) {
    let n = buf.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            buf.swap(i, j);
        }
    }
    let sign = if inverse { 1.0 } else { -1.0 };
    let mut len = 2;
    while len <= n {
        let ang = sign * 2.0 * PI / len as f64;
        let step = (ang.cos(), ang.sin());
        let half = len / 2;
        for chunk in buf.chunks_mut(len) {
            let mut w = (1.0, 0.0);
            for k in 0..half {
                let (u, x) = (chunk[k], chunk[k + half]);
                let v = (x.0 * w.0 - x.1 * w.1, x.0 * w.1 + x.1 * w.0);
                chunk[k] = (u.0 + v.0, u.1 + v.1);
                chunk[k + half] = (u.0 - v.0, u.1 - v.1);
                w = (w.0 * step.0 - w.1 * step.1, w.0 * step.1 + w.1 * step.0);
            }
        }
        len <<= 1;
    }
    if inverse {
        buf.iter_mut()
            .for_each(|c| *c = (c.0 / n as f64, c.1 / n as f64));
    }
}

/// Log sweep dari `f1` ke `f2` Hz selama `secs` detik, dengan fade 10 ms di kedua ujung.
pub fn generate(fs: f64, f1: f64, f2: f64, secs: f64) -> Result<Sweep, SweepError> {
    // Perbandingan dengan NaN selalu salah, jadi NaN ikut ditolak. Batas 30 s menjaga memori FFT.
    if !(fs > 0.0 && f1 > 0.0 && f1 < f2 && f2 < fs / 2.0 && secs > 0.0 && secs <= MAX_SECS) {
        return Err(SweepError::InvalidParams);
    }
    let n = (fs * secs).round() as usize;
    if n < 2 {
        return Err(SweepError::InvalidParams);
    }
    let l = n as f64 / fs / (f2 / f1).ln();
    let fade = ((0.01 * fs) as usize).min(n / 2).max(1);
    let window = |i: usize| {
        let edge = i.min(n - 1 - i);
        if edge >= fade {
            1.0
        } else {
            0.5 * (1.0 - (PI * edge as f64 / fade as f64).cos())
        }
    };
    let x: Vec<f64> = (0..n)
        .map(|i| {
            let t = i as f64 / fs;
            window(i) * (2.0 * PI * f1 * l * ((t / l).exp() - 1.0)).sin()
        })
        .collect();
    // Invers: sweep dibalik, amplitudo turun 6 dB/oktaf supaya spektrum hasil konvolusi rata.
    let inv: Vec<f64> = (0..n)
        .map(|i| x[n - 1 - i] * (-(i as f64) / fs / l).exp())
        .collect();
    let peak = fft_convolve(&x, &inv)
        .iter()
        .fold(0.0f64, |m, v| m.max(v.abs()));
    Ok(Sweep {
        signal: x.iter().map(|&v| v as f32).collect(),
        inverse: inv.iter().map(|&v| (v / peak) as f32).collect(),
    })
}

/// Impulse response dari rekaman sweep: indeks 0 = bunyi langsung (t = 0).
/// Distorsi harmonik yang jatuh sebelum t = 0 terbuang.
pub fn deconvolve(recording: &[f32], inverse: &[f32]) -> Vec<f32> {
    let f64s = |x: &[f32]| x.iter().map(|&v| f64::from(v)).collect::<Vec<_>>();
    fft_convolve(&f64s(recording), &f64s(inverse))
        .iter()
        .skip(inverse.len().saturating_sub(1))
        .map(|&v| v as f32)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rt60::rt60_report;
    use crate::testsig::Rng;

    const FS: f64 = 48000.0;
    const F1: f64 = 50.0;
    const F2: f64 = 20000.0;

    fn f64s(x: &[f32]) -> Vec<f64> {
        x.iter().map(|&v| f64::from(v)).collect()
    }

    fn direct_convolve(a: &[f64], b: &[f64]) -> Vec<f64> {
        let mut out = vec![0.0; a.len() + b.len() - 1];
        for (i, &x) in a.iter().enumerate() {
            for (j, &y) in b.iter().enumerate() {
                out[i + j] += x * y;
            }
        }
        out
    }

    #[test]
    fn fft_convolve_matches_direct_sum() {
        let mut rng = Rng::new(9);
        let a: Vec<f64> = (0..37).map(|_| rng.next()).collect();
        let b: Vec<f64> = (0..53).map(|_| rng.next()).collect();
        let (got, want) = (fft_convolve(&a, &b), direct_convolve(&a, &b));
        assert_eq!(got.len(), want.len());
        let err = got
            .iter()
            .zip(&want)
            .fold(0.0f64, |m, (g, w)| m.max((g - w).abs()));
        assert!(err < 1e-12, "max err {err:e}");
    }

    #[test]
    fn sweep_has_requested_length_and_log_frequency_law() {
        let s = generate(FS, 100.0, 10000.0, 2.0).expect("sweep");
        assert_eq!(s.signal.len(), 96000);
        assert_eq!(s.inverse.len(), 96000);
        assert!(s.signal.iter().all(|v| v.is_finite() && v.abs() <= 1.0));
        // Pertengahan sweep: f = sqrt(f1 * f2) = 1 kHz. Hitung lintasan nol dalam 20 ms.
        let mid = s.signal.len() / 2;
        let w = &s.signal[mid..mid + (FS * 0.02) as usize];
        let crossings = w
            .windows(2)
            .filter(|p| p[0].signum() != p[1].signum())
            .count();
        assert!(
            (crossings as i32 - 40).abs() <= 3,
            "{crossings} lintasan nol"
        );
    }

    #[test]
    fn sweep_convolved_with_inverse_is_unit_impulse() {
        let s = generate(FS, F1, F2, 2.0).expect("sweep");
        let ir = deconvolve(&s.signal, &s.inverse);
        let (k, peak) =
            ir.iter().enumerate().fold(
                (0, 0.0f32),
                |b, (i, &v)| if v.abs() > b.1.abs() { (i, v) } else { b },
            );
        assert_eq!(k, 0, "puncak di indeks {k}");
        assert!((peak - 1.0).abs() < 0.03, "puncak {peak:.4}");
        let side = ir[30..].iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!(side < 0.03, "sisi terbesar {side:.4}");
    }

    #[test]
    fn sparse_impulse_response_is_recovered() {
        let s = generate(FS, F1, F2, 2.0).expect("sweep");
        let taps = [(0usize, 1.0f64), (480, 0.5), (2400, -0.25), (9600, 0.1)];
        let x = f64s(&s.signal);
        let mut rec = vec![0.0f32; x.len() + 9600];
        for &(d, a) in &taps {
            for (i, &v) in x.iter().enumerate() {
                rec[i + d] += (a * v) as f32;
            }
        }
        let ir = deconvolve(&rec, &s.inverse);
        for &(d, a) in &taps {
            let err = (f64::from(ir[d]) - a).abs();
            println!("tap {d:>5}: want {a:+.3} got {:+.4} err {err:.4}", ir[d]);
            assert!(err < 0.03, "tap {d}");
        }
        let away = (0..ir.len())
            .filter(|i| taps.iter().all(|&(d, _)| i.abs_diff(d) > 30))
            .fold(0.0f32, |m, i| m.max(ir[i].abs()));
        assert!(away < 0.03, "residu {away:.4}");
    }

    #[test]
    fn synthetic_room_ir_recovers_known_rt60() {
        for fs in [48000.0, 44100.0] {
            let t60 = 0.8;
            let mut rng = Rng::new(21);
            let h: Vec<f64> = (0..(fs * 3.0) as usize)
                .map(|i| 0.5 * rng.next() * (-6.91 * i as f64 / fs / t60).exp())
                .collect();
            let s = generate(fs, F1, F2, 3.0).expect("sweep");
            let rec: Vec<f32> = fft_convolve(&f64s(&s.signal), &h)
                .iter()
                .map(|&v| v as f32)
                .collect();
            let ir = deconvolve(&rec, &s.inverse);
            let rep = rt60_report(&ir, fs).expect("report");
            let got = rep.mean_500_1k_2k.expect("mean");
            let err = (got - t60).abs() / t60;
            println!(
                "fs={fs}: RT60 pulih {got:.3} s vs {t60} s, galat {:.2}%",
                err * 100.0
            );
            assert!(err < 0.10, "fs={fs}: {got:.3}");
        }
    }

    #[test]
    fn invalid_params_are_rejected() {
        for (fs, f1, f2, secs) in [
            (FS, 100.0, 100.0, 1.0),
            (FS, 200.0, 100.0, 1.0),
            (FS, 0.0, 1000.0, 1.0),
            (FS, 50.0, 24000.0, 1.0),
            (FS, 50.0, 1000.0, 0.0),
            (FS, 50.0, 1000.0, 60.0),
            (0.0, 50.0, 1000.0, 1.0),
            (FS, f64::NAN, 1000.0, 1.0),
        ] {
            assert!(generate(fs, f1, f2, secs).is_err(), "{fs} {f1} {f2} {secs}");
        }
    }
}
