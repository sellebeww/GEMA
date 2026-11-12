// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
//! RT60 per pita oktaf dari rekaman impuls: regresi linear T20 dan T30 pada kurva
//! Schroeder (ISO 3382-2), lengkap dengan metrik kualitas.

use serde::Serialize;

use crate::octave_bank::{band_filter, CENTERS_HZ};
use crate::schroeder::{decay_curve, onset, DecayCurve, DecayError};

/// Pita yang dirata-ratakan untuk nilai tunggal ANSI S12.60.
pub const MEAN_BANDS_HZ: [f64; 3] = [500.0, 1000.0, 2000.0];
/// Korelasi minimum supaya peluruhan dianggap cukup lurus.
pub const MIN_R: f64 = 0.99;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Method {
    /// -5 s.d. -25 dB, dikali 3. Perlu rentang dinamis >= 35 dB.
    T20,
    /// -5 s.d. -35 dB, dikali 2. Perlu rentang dinamis >= 45 dB.
    T30,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Fit {
    pub seconds: f64,
    /// Besar koefisien korelasi Pearson, 1.0 = peluruhan lurus sempurna.
    pub r: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct BandRt60 {
    pub band_hz: f64,
    pub t20: Option<Fit>,
    pub t30: Option<Fit>,
    /// T30 bila rentang dinamis cukup, selain itu T20.
    pub method: Method,
    /// Nilai dari `method`; `None` bila regresi gagal.
    pub rt60: Option<f64>,
    pub dynamic_range_db: f64,
    /// Rentang dinamis dikurangi syarat `method` (35 atau 45 dB). Negatif = tidak andal.
    pub headroom_db: f64,
    pub reliable: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Rt60Report {
    /// 125 Hz sampai 4 kHz.
    pub bands: Vec<BandRt60>,
    /// Rata-rata RT60 pita 500, 1k, 2k Hz; `None` bila salah satunya gagal.
    pub mean_500_1k_2k: Option<f64>,
    /// Benar hanya bila ketiga pita andal.
    pub mean_reliable: bool,
}

/// Regresi linear dB terhadap waktu di rentang -5 dB sampai `lo_db`.
fn fit(db: &[f64], fs: f64, lo_db: f64) -> Option<Fit> {
    if !db.last().is_some_and(|&d| d < lo_db) {
        return None;
    }
    let pts: Vec<(f64, f64)> = db
        .iter()
        .enumerate()
        .filter(|&(_, &d)| (lo_db..=-5.0).contains(&d))
        .map(|(i, &d)| (i as f64 / fs, d))
        .collect();
    if pts.len() < 10 {
        return None;
    }
    let n = pts.len() as f64;
    let (mt, my) = pts
        .iter()
        .fold((0.0, 0.0), |(a, b), &(t, y)| (a + t / n, b + y / n));
    let (stt, sty, syy) = pts.iter().fold((0.0, 0.0, 0.0), |(a, b, c), &(t, y)| {
        let (dt, dy) = (t - mt, y - my);
        (a + dt * dt, b + dt * dy, c + dy * dy)
    });
    let slope = sty / stt;
    (slope < 0.0).then(|| Fit {
        seconds: -60.0 / slope,
        r: sty.abs() / (stt * syy).sqrt(),
    })
}

fn band_curve(
    samples: &[f32],
    start: usize,
    fs: f64,
    band_hz: f64,
) -> Result<DecayCurve, DecayError> {
    let mut bp = band_filter(band_hz, fs).ok_or(DecayError::BadParams)?;
    // Filter berjalan dari sampel pertama supaya statusnya sudah tenang di awal impuls.
    let energy: Vec<f64> = samples
        .iter()
        .map(|&v| bp.process(f64::from(v)).powi(2))
        .skip(start)
        .collect();
    decay_curve(&energy, fs)
}

fn band_rt60(samples: &[f32], start: usize, fs: f64, band_hz: f64) -> Result<BandRt60, DecayError> {
    let curve = band_curve(samples, start, fs, band_hz)?;
    let (t20, t30) = (fit(&curve.db, fs, -25.0), fit(&curve.db, fs, -35.0));
    let (method, needed) = if curve.dynamic_range_db >= 45.0 {
        (Method::T30, 45.0)
    } else {
        (Method::T20, 35.0)
    };
    let chosen = if method == Method::T30 { t30 } else { t20 };
    let headroom_db = curve.dynamic_range_db - needed;
    Ok(BandRt60 {
        band_hz,
        t20,
        t30,
        method,
        rt60: chosen.map(|f| f.seconds),
        dynamic_range_db: curve.dynamic_range_db,
        headroom_db,
        reliable: headroom_db >= 0.0 && chosen.is_some_and(|f| f.r >= MIN_R),
    })
}

/// Kurva peluruhan Schroeder satu pita oktaf, diciutkan untuk digambar.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct BandCurve {
    pub band_hz: f64,
    /// Selang waktu antar titik (detik); titik ke-i berada di i * step_s.
    pub step_s: f64,
    /// EDC dalam dB, db[0] = 0.
    pub db: Vec<f32>,
}

/// Kurva Schroeder tiap pita oktaf, maksimum `max_points` titik per pita (diambil tiap n sampel).
pub fn decay_curves(
    samples: &[f32],
    fs: f64,
    max_points: usize,
) -> Result<Vec<BandCurve>, DecayError> {
    let start = onset(samples);
    CENTERS_HZ
        .iter()
        .map(|&band_hz| {
            let c = band_curve(samples, start, fs, band_hz)?;
            let stride = c.db.len().div_ceil(max_points.max(2)).max(1);
            Ok(BandCurve {
                band_hz,
                step_s: stride as f64 / fs,
                db: c.db.iter().step_by(stride).map(|&d| d as f32).collect(),
            })
        })
        .collect()
}

/// RT60 di setiap pita oktaf 125 Hz sampai 4 kHz dari rekaman bunyi impuls
/// (balon, tepuk, atau hasil dekonvolusi sweep).
pub fn rt60_report(samples: &[f32], fs: f64) -> Result<Rt60Report, DecayError> {
    let start = onset(samples);
    let bands = CENTERS_HZ
        .iter()
        .map(|&f| band_rt60(samples, start, fs, f))
        .collect::<Result<Vec<_>, _>>()?;
    let mean_bands: Vec<&BandRt60> = bands
        .iter()
        .filter(|b| MEAN_BANDS_HZ.contains(&b.band_hz))
        .collect();
    let times: Option<Vec<f64>> = mean_bands.iter().map(|b| b.rt60).collect();
    Ok(Rt60Report {
        mean_500_1k_2k: times.map(|t| t.iter().sum::<f64>() / t.len() as f64),
        mean_reliable: mean_bands.iter().all(|b| b.reliable),
        bands,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::octave_bank::CENTERS_HZ;
    use crate::testsig::{decay, Rng};

    const FS: f64 = 48000.0;

    fn rel_err(got: f64, want: f64) -> f64 {
        (got - want).abs() / want
    }

    fn band(rep: &Rt60Report, f: f64) -> &BandRt60 {
        rep.bands
            .iter()
            .find(|b| b.band_hz == f)
            .expect("band present")
    }

    #[test]
    fn t20_and_t30_per_band_match_known_rt60() {
        // Sinyal uji acak: galat satu realisasi berisi sebaran statistik, galat sistematik
        // (bias) algoritma diukur dari rata-rata bertanda atas banyak realisasi.
        const SEEDS: usize = 16;
        println!("fs    T(s)  band | T20 bias/std/worst % | T30 bias/std/worst %");
        for fs in [48000.0, 44100.0] {
            for t in [0.4, 0.6, 1.0, 1.5] {
                // errs[band][0=T20,1=T30] = galat relatif bertanda tiap seed
                let mut errs = vec![[Vec::new(), Vec::new()]; CENTERS_HZ.len()];
                for seed in 0..SEEDS {
                    let x = decay(fs, t, 0.2, -70.0, 100 + seed as u64);
                    let rep = rt60_report(&x, fs).expect("report");
                    assert_eq!(rep.bands.len(), CENTERS_HZ.len());
                    for (i, b) in rep.bands.iter().enumerate() {
                        for (k, f) in [b.t20, b.t30].into_iter().enumerate() {
                            errs[i][k].push((f.expect("fit").seconds - t) / t);
                        }
                    }
                }
                for (i, e) in errs.iter().enumerate() {
                    let stat = |v: &Vec<f64>| {
                        let m = v.iter().sum::<f64>() / v.len() as f64;
                        let sd = (v.iter().map(|x| (x - m).powi(2)).sum::<f64>() / v.len() as f64)
                            .sqrt();
                        let worst = v.iter().fold(0.0f64, |w, x| w.max(x.abs()));
                        (m * 100.0, sd * 100.0, worst * 100.0)
                    };
                    let (a, b) = (stat(&e[0]), stat(&e[1]));
                    println!(
                        "{fs:<5} {t:<4} {:<4} | {:6.2} {:5.2} {:6.2} | {:6.2} {:5.2} {:6.2}",
                        CENTERS_HZ[i], a.0, a.1, a.2, b.0, b.1, b.2
                    );
                    for (k, s) in [a, b].into_iter().enumerate() {
                        assert!(
                            s.0.abs() < 5.0,
                            "fs={fs} T={t} band={} k={k}: bias {:.2}%",
                            CENTERS_HZ[i],
                            s.0
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn clean_decay_is_reliable_with_high_correlation() {
        let rep = rt60_report(&decay(FS, 0.6, 0.2, -70.0, 1), FS).expect("report");
        let b = band(&rep, 1000.0);
        assert_eq!(b.method, Method::T30);
        assert!(b.reliable);
        assert!(b.headroom_db > 15.0, "{:.1}", b.headroom_db);
        assert!(b.t20.expect("t20").r >= MIN_R && b.t30.expect("t30").r >= MIN_R);
        assert_eq!(b.rt60, b.t30.map(|f| f.seconds));
    }

    #[test]
    fn moderate_noise_uses_t20_and_stays_accurate() {
        let rep = rt60_report(&decay(FS, 0.6, 0.2, -40.0, 7), FS).expect("report");
        let b = band(&rep, 1000.0);
        assert_eq!(b.method, Method::T20);
        assert!(
            b.headroom_db >= 0.0 && b.headroom_db < 10.0,
            "{:.1}",
            b.headroom_db
        );
        assert!(b.reliable);
        assert!(rel_err(b.rt60.expect("rt60"), 0.6) < 0.10);
    }

    #[test]
    fn weak_impulse_is_flagged_unreliable() {
        let rep = rt60_report(&decay(FS, 0.6, 0.2, -20.0, 3), FS).expect("report");
        for f in MEAN_BANDS_HZ {
            let b = band(&rep, f);
            assert!(b.headroom_db < 0.0, "{f}: {:.1}", b.headroom_db);
            assert!(!b.reliable, "{f}");
        }
        assert!(!rep.mean_reliable);
    }

    #[test]
    fn double_slope_decay_has_low_correlation_and_is_flagged() {
        // Peluruhan cepat 0,15 s lalu ekor panjang 1,2 s (patah di sekitar -26 dB).
        let mut rng = Rng::new(11);
        let n = (FS * 3.2) as usize;
        let x: Vec<f32> = (0..n)
            .map(|i| {
                let t = i as f64 / FS;
                let env = (-6.91 * t / 0.15).exp() + 0.05 * (-6.91 * t / 1.2).exp();
                (rng.next() * env + 1e-4 * rng.next()) as f32
            })
            .collect();
        let b = band(&rt60_report(&x, FS).expect("report"), 1000.0).clone();
        let r = b.t30.expect("t30").r;
        assert!(r < MIN_R, "r={r:.4}");
        assert!(!b.reliable);
    }

    #[test]
    fn mean_is_average_of_500_1k_2k() {
        let rep = rt60_report(&decay(FS, 1.0, 0.2, -70.0, 5), FS).expect("report");
        let want = MEAN_BANDS_HZ
            .iter()
            .map(|&f| band(&rep, f).rt60.expect("rt60"))
            .sum::<f64>()
            / 3.0;
        let got = rep.mean_500_1k_2k.expect("mean");
        assert!((got - want).abs() < 1e-12);
        assert!(rel_err(got, 1.0) < 0.05, "{got:.3}");
        assert!(rep.mean_reliable);
    }

    #[test]
    fn bad_inputs_are_rejected() {
        assert_eq!(rt60_report(&[0.5; 100], FS), Err(DecayError::TooShort));
        assert_eq!(rt60_report(&vec![0.0; 48000], FS), Err(DecayError::NoDecay));
        assert_eq!(
            rt60_report(&decay(8000.0, 0.6, 0.1, -70.0, 1), 8000.0),
            Err(DecayError::BadParams)
        );
    }

    #[test]
    fn deterministic() {
        let x = decay(FS, 0.8, 0.1, -55.0, 5);
        assert_eq!(rt60_report(&x, FS), rt60_report(&x, FS));
    }

    #[test]
    fn curves_are_decimated_monotone_and_slope_matches_rt60() {
        let x = decay(FS, 0.6, 0.2, -70.0, 5);
        let curves = decay_curves(&x, FS, 300).expect("curves");
        assert_eq!(curves.len(), CENTERS_HZ.len());
        for c in &curves {
            assert!(
                c.db.len() <= 300 && c.db.len() > 50,
                "band {}: {}",
                c.band_hz,
                c.db.len()
            );
            assert!(c.db[0].abs() < 1e-3);
            assert!(
                c.db.windows(2).all(|w| w[1] <= w[0] + 1e-3),
                "band {} not monotone",
                c.band_hz
            );
        }
        // 1 kHz: -30 dB (dua kali T30 dari -5 s.d. -35) harus tercapai sekitar 0,6 * 30/60 + awal.
        let c = curves.iter().find(|c| c.band_hz == 1000.0).expect("1k");
        let i =
            c.db.iter()
                .position(|&d| d <= -30.0)
                .expect("reaches -30 dB");
        let t = i as f64 * c.step_s;
        assert!((t - 0.3).abs() < 0.06, "t(-30 dB) = {t}");
    }
}
