// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
//! RT60 dari rekaman bunyi impuls: integrasi mundur Schroeder (ISO 3382-2),
//! dengan pengurangan lantai derau dan pemotongan di titik temu derau.

use std::fmt;

use crate::filter::octave_bandpass;
use crate::level::power_db;

/// Pita oktaf yang dinilai ANSI S12.60.
pub const BANDS_HZ: [f64; 3] = [500.0, 1000.0, 2000.0];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Method {
    /// Kemiringan -5 s.d. -25 dB, dikali 3.
    T20,
    /// Kemiringan -5 s.d. -35 dB, dikali 2.
    T30,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rt60 {
    pub seconds: f64,
    pub method: Method,
    /// Selisih puncak (rata-rata 10 ms) terhadap lantai derau.
    pub dynamic_range_db: f64,
    /// Koefisien determinasi regresi, 1.0 = peluruhan linear sempurna.
    pub r2: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Rt60Error {
    /// Rekaman lebih pendek dari 0,5 s setelah puncak.
    TooShort,
    /// Rekaman hening atau tidak ada peluruhan.
    NoDecay,
    /// Bunyi impuls terlalu lemah dibanding derau latar (perlu >= 35 dB).
    InsufficientDynamicRange { dynamic_range_db: f64 },
}

impl fmt::Display for Rt60Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooShort => write!(f, "rekaman terlalu pendek"),
            Self::NoDecay => write!(f, "tidak ada peluruhan bunyi"),
            Self::InsufficientDynamicRange { dynamic_range_db } => write!(
                f,
                "bunyi impuls hanya {dynamic_range_db:.0} dB di atas derau latar, perlu minimal 35 dB"
            ),
        }
    }
}

impl std::error::Error for Rt60Error {}

/// RT60 broadband (`band_hz = None`) atau dalam satu pita oktaf.
pub fn rt60(samples: &[f32], fs: f64, band_hz: Option<f64>) -> Result<Rt60, Rt60Error> {
    let energy: Vec<f64> = match band_hz {
        Some(f) => {
            let mut bp = octave_bandpass(f, fs);
            samples
                .iter()
                .map(|&v| bp.process(f64::from(v)).powi(2))
                .collect()
        }
        None => samples.iter().map(|&v| f64::from(v).powi(2)).collect(),
    };

    // Analisis dimulai dari puncak impuls.
    let peak = energy
        .iter()
        .enumerate()
        .fold(
            (0, 0.0),
            |best, (i, &v)| if v > best.1 { (i, v) } else { best },
        )
        .0;
    let tail = &energy[peak..];
    if tail.len() < (fs * 0.5) as usize {
        return Err(Rt60Error::TooShort);
    }

    // Selubung rata-rata 10 ms; lantai derau dari 10% terakhir rekaman.
    let win = ((fs * 0.01) as usize).max(1);
    let smooth: Vec<f64> = tail
        .chunks(win)
        .map(|c| c.iter().sum::<f64>() / c.len() as f64)
        .collect();
    let noise_n = tail.len() / 10;
    let noise = tail[tail.len() - noise_n..].iter().sum::<f64>() / noise_n as f64;
    let peak_level = smooth.iter().copied().fold(0.0, f64::max);
    if peak_level <= 0.0 {
        return Err(Rt60Error::NoDecay);
    }

    // ISO 3382-2: rentang dinamis minimal 10 dB di bawah batas bawah evaluasi.
    let dynamic_range_db = power_db(peak_level) - power_db(noise);
    let (method, lo_db) = if dynamic_range_db >= 45.0 {
        (Method::T30, -35.0)
    } else if dynamic_range_db >= 35.0 {
        (Method::T20, -25.0)
    } else {
        return Err(Rt60Error::InsufficientDynamicRange { dynamic_range_db });
    };

    // Potong saat selubung masuk 3 dB dari lantai derau, lalu integrasi mundur energi minus derau.
    let cut = smooth
        .iter()
        .position(|&v| v <= 2.0 * noise)
        .map_or(tail.len(), |w| (w * win).min(tail.len()));
    let mut edc = vec![0.0; cut];
    let mut acc = 0.0;
    for i in (0..cut).rev() {
        acc += (tail[i] - noise).max(0.0);
        edc[i] = acc;
    }
    let total = edc.first().copied().unwrap_or(0.0);
    if total <= 0.0 {
        return Err(Rt60Error::NoDecay);
    }

    // Regresi linear dB terhadap waktu di rentang evaluasi (EDC monoton turun).
    let pts: Vec<(f64, f64)> = edc
        .iter()
        .enumerate()
        .map(|(i, &v)| (i as f64 / fs, power_db(v / total)))
        .filter(|&(_, db)| db <= -5.0 && db >= lo_db)
        .collect();
    let reached = edc.last().is_some_and(|&v| power_db(v / total) < lo_db);
    if !reached || pts.len() < 10 {
        return Err(Rt60Error::InsufficientDynamicRange { dynamic_range_db });
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
    if slope.is_nan() || slope >= 0.0 {
        return Err(Rt60Error::NoDecay);
    }
    Ok(Rt60 {
        seconds: -60.0 / slope,
        method,
        dynamic_range_db,
        r2: sty * sty / (stt * syy),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testsig::decay;

    const FS: f64 = 48000.0;

    fn rel_err(got: f64, want: f64) -> f64 {
        (got - want).abs() / want
    }

    #[test]
    fn broadband_t30_within_5_percent() {
        for (i, t) in [0.3, 0.6, 1.2].into_iter().enumerate() {
            let x = decay(FS, t, 0.3, -60.0, 42 + i as u64);
            let r = rt60(&x, FS, None).unwrap_or_else(|e| panic!("T={t}: {e}"));
            assert_eq!(r.method, Method::T30, "T={t}");
            assert!(rel_err(r.seconds, t) < 0.05, "T={t}: got {:.3}", r.seconds);
            assert!(r.r2 > 0.99, "r2={}", r.r2);
        }
    }

    #[test]
    fn moderate_noise_falls_back_to_t20_within_10_percent() {
        let x = decay(FS, 0.6, 0.2, -40.0, 7);
        let r = rt60(&x, FS, None).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(r.method, Method::T20);
        assert!(rel_err(r.seconds, 0.6) < 0.10, "got {:.3}", r.seconds);
    }

    #[test]
    fn octave_bands_within_10_percent() {
        let x = decay(FS, 0.6, 0.2, -60.0, 99);
        for f in BANDS_HZ {
            let r = rt60(&x, FS, Some(f)).unwrap_or_else(|e| panic!("{f} Hz: {e}"));
            assert!(
                rel_err(r.seconds, 0.6) < 0.10,
                "{f} Hz: got {:.3}",
                r.seconds
            );
        }
    }

    #[test]
    fn weak_impulse_is_rejected() {
        let x = decay(FS, 0.6, 0.2, -20.0, 3);
        match rt60(&x, FS, None) {
            Err(Rt60Error::InsufficientDynamicRange { dynamic_range_db }) => {
                assert!(dynamic_range_db < 35.0)
            }
            other => panic!("expected InsufficientDynamicRange, got {other:?}"),
        }
    }

    #[test]
    fn short_and_silent_input_rejected() {
        assert_eq!(rt60(&[0.5; 100], FS, None), Err(Rt60Error::TooShort));
        assert_eq!(rt60(&vec![0.0; 48000], FS, None), Err(Rt60Error::NoDecay));
    }

    #[test]
    fn deterministic() {
        let x = decay(FS, 0.8, 0.1, -55.0, 5);
        let a = rt60(&x, FS, Some(1000.0));
        let b = rt60(&x, FS, Some(1000.0));
        assert_eq!(a, b);
    }
}
