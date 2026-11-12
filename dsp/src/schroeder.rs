// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
//! Kurva peluruhan Schroeder (ISO 3382-2): integrasi balik energi, deteksi awal impuls,
//! dan pembuangan ekor derau.

use std::fmt;

use crate::level::power_db;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DecayError {
    /// Rekaman lebih pendek dari 0,5 s setelah awal impuls.
    TooShort,
    /// Rekaman hening atau tidak ada peluruhan.
    NoDecay,
    /// Laju sampel terlalu rendah untuk pita oktaf yang diminta.
    BadParams,
}

impl fmt::Display for DecayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooShort => write!(f, "rekaman terlalu pendek"),
            Self::NoDecay => write!(f, "tidak ada peluruhan bunyi"),
            Self::BadParams => write!(f, "laju sampel tidak didukung"),
        }
    }
}

impl std::error::Error for DecayError {}

#[derive(Clone, Debug, PartialEq)]
pub struct DecayCurve {
    /// EDC dalam dB, db[0] = 0, satu nilai per sampel sampai titik potong derau.
    pub db: Vec<f64>,
    /// Puncak selubung (rata-rata 10 ms) terhadap lantai derau.
    pub dynamic_range_db: f64,
}

/// Indeks sampel pertama yang mencapai -20 dB dari puncak amplitudo.
pub fn onset(samples: &[f32]) -> usize {
    let peak = samples.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    samples
        .iter()
        .position(|v| v.abs() >= 0.1 * peak)
        .unwrap_or(0)
}

/// Kurva peluruhan dari energi sesaat yang dimulai di awal impuls.
/// Lantai derau diambil dari 10% terakhir rekaman; ekor dipotong saat selubung
/// masuk 3 dB dari lantai, lalu energi minus derau diintegrasi mundur.
pub fn decay_curve(energy: &[f64], fs: f64) -> Result<DecayCurve, DecayError> {
    if energy.len() < (fs * 0.5) as usize {
        return Err(DecayError::TooShort);
    }
    let win = ((fs * 0.01) as usize).max(1);
    let smooth: Vec<f64> = energy
        .chunks(win)
        .map(|c| c.iter().sum::<f64>() / c.len() as f64)
        .collect();
    let noise_n = energy.len() / 10;
    let noise = energy[energy.len() - noise_n..].iter().sum::<f64>() / noise_n as f64;
    let peak_level = smooth.iter().copied().fold(0.0, f64::max);
    if peak_level <= 0.0 {
        return Err(DecayError::NoDecay);
    }

    // Cari titik potong setelah jendela puncak: pita sempit naik pelan dan jendela awalnya bisa rendah.
    let peak_win = smooth.iter().position(|&v| v == peak_level).unwrap_or(0);
    let cut = smooth[peak_win..]
        .iter()
        .position(|&v| v <= 2.0 * noise)
        .map_or(energy.len(), |w| ((peak_win + w) * win).min(energy.len()));
    let mut edc = vec![0.0; cut];
    let mut acc = 0.0;
    for i in (0..cut).rev() {
        acc += (energy[i] - noise).max(0.0);
        edc[i] = acc;
    }
    let total = edc.first().copied().unwrap_or(0.0);
    if total <= 0.0 {
        return Err(DecayError::NoDecay);
    }
    Ok(DecayCurve {
        db: edc.iter().map(|&v| power_db(v / total)).collect(),
        dynamic_range_db: power_db(peak_level) - power_db(noise),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testsig::decay;

    const FS: f64 = 48000.0;

    fn energy(x: &[f32]) -> Vec<f64> {
        x.iter().map(|&v| f64::from(v).powi(2)).collect()
    }

    #[test]
    fn exact_exponential_gives_straight_line_in_db() {
        let t60 = 0.5;
        let k = 6.0 * std::f64::consts::LN_10 / t60;
        let e: Vec<f64> = (0..(2.0 * t60 * FS) as usize)
            .map(|i| (-k * i as f64 / FS).exp() + 1e-7)
            .collect();
        let c = decay_curve(&e, FS).expect("curve");
        assert!(c.db[0].abs() < 1e-9);
        for (i, &d) in c.db.iter().enumerate() {
            let want = -60.0 * i as f64 / FS / t60;
            if want > -40.0 {
                assert!((d - want).abs() < 0.1, "i={i}: {d:.3} vs {want:.3}");
            }
        }
    }

    #[test]
    fn curve_never_rises() {
        let c = decay_curve(&energy(&decay(FS, 0.5, 0.0, -70.0, 1)), FS).expect("curve");
        assert!(c.db.windows(2).all(|w| w[1] <= w[0] + 1e-9));
    }

    #[test]
    fn noise_tail_is_truncated_where_decay_meets_floor() {
        // Selubung (daya) menyamai 2x lantai di t = 0,95 T = 0,38 s.
        let c = decay_curve(&energy(&decay(FS, 0.4, 0.0, -60.0, 2)), FS).expect("curve");
        let cut_s = c.db.len() as f64 / FS;
        assert!((cut_s - 0.38).abs() < 0.03, "cut at {cut_s:.3} s");
    }

    #[test]
    fn dynamic_range_matches_floor_level() {
        let c = decay_curve(&energy(&decay(FS, 0.5, 0.0, -60.0, 3)), FS).expect("curve");
        assert!(
            (c.dynamic_range_db - 60.0).abs() < 1.5,
            "{:.1}",
            c.dynamic_range_db
        );
    }

    #[test]
    fn slow_rise_before_peak_does_not_cut_the_curve() {
        // Pita sempit yang baru naik: 10 ms pertama masih di lantai derau, lalu peluruhan 0,5 s.
        let k = 6.0 * std::f64::consts::LN_10 / 0.5;
        let e: Vec<f64> = (0..FS as usize)
            .map(|i| {
                if i < 480 {
                    1e-4
                } else {
                    (-k * i as f64 / FS).exp() + 1e-4
                }
            })
            .collect();
        let c = decay_curve(&e, FS).expect("curve");
        let cut_s = c.db.len() as f64 / FS;
        assert!((0.25..0.4).contains(&cut_s), "cut at {cut_s:.3} s");
    }

    #[test]
    fn short_and_silent_input_rejected() {
        assert_eq!(decay_curve(&[1.0; 100], FS), Err(DecayError::TooShort));
        assert_eq!(decay_curve(&vec![0.0; 48000], FS), Err(DecayError::NoDecay));
    }

    #[test]
    fn onset_finds_burst_and_ignores_weak_precursor() {
        let mut x = vec![0.0f32; 48000];
        x[3000] = 0.01; // -40 dB, di bawah ambang
        x[14400] = 1.0;
        x[14401] = -0.7;
        assert_eq!(onset(&x), 14400);
    }

    #[test]
    fn onset_of_silence_is_zero() {
        assert_eq!(onset(&[0.0; 1000]), 0);
        assert_eq!(onset(&[]), 0);
    }
}
