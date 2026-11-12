// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
//! Tingkat bunyi ekuivalen berbobot A (LAeq) dalam dBFS.
//! Konversi ke dB SPL dilakukan pemanggil dengan offset kalibrasi.

use crate::filter::{a_weighting, Cascade};

/// Pengukur LAeq streaming. Status filter dibawa antar blok.
pub struct LevelMeter {
    filter: Cascade,
    sum_sq: f64,
    n: u64,
}

impl LevelMeter {
    pub fn new(fs: f64) -> Self {
        Self {
            filter: a_weighting(fs),
            sum_sq: 0.0,
            n: 0,
        }
    }

    /// Proses satu blok, kembalikan LA blok itu (dBFS RMS), atau None bila blok kosong.
    pub fn push(&mut self, block: &[f32]) -> Option<f64> {
        if block.is_empty() {
            return None;
        }
        let sum: f64 = block
            .iter()
            .map(|&x| self.filter.process(f64::from(x)).powi(2))
            .sum();
        self.sum_sq += sum;
        self.n += block.len() as u64;
        Some(power_db(sum / block.len() as f64))
    }

    /// LAeq sejak awal atau sejak `reset` terakhir.
    pub fn leq(&self) -> Option<f64> {
        (self.n > 0).then(|| power_db(self.sum_sq / self.n as f64))
    }

    /// Mulai integrasi baru tanpa membuang status filter.
    pub fn reset(&mut self) {
        self.sum_sq = 0.0;
        self.n = 0;
    }
}

/// Daya rata-rata ke dB, dibatasi -200 dB supaya hening tidak menjadi -inf.
pub fn power_db(p: f64) -> f64 {
    10.0 * p.max(1e-20).log10()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testsig::sine;

    fn leq_of(fs: f64, f: f64, amp: f64) -> f64 {
        let mut m = LevelMeter::new(fs);
        let x = sine(fs, f, amp, 2.0);
        let (settle, rest) = x.split_at(x.len() / 4);
        m.push(settle);
        m.reset();
        for block in rest.chunks(128) {
            m.push(block);
        }
        m.leq().unwrap_or(f64::NAN)
    }

    #[test]
    fn full_scale_1k_sine_is_minus_3_dbfs() {
        let got = leq_of(48000.0, 1000.0, 1.0);
        assert!((got - -3.01).abs() < 0.05, "{got:.3}");
    }

    #[test]
    fn level_tracks_amplitude_and_weighting() {
        let fs = 48000.0;
        let got = leq_of(fs, 1000.0, 0.01);
        assert!((got - -43.01).abs() < 0.05, "{got:.3}");
        let got = leq_of(fs, 125.0, 1.0);
        assert!((got - (-3.01 - 16.1)).abs() < 0.3, "{got:.3}");
    }

    #[test]
    fn empty_and_silent_input() {
        let mut m = LevelMeter::new(48000.0);
        assert_eq!(m.push(&[]), None);
        assert_eq!(m.leq(), None);
        let silent = m.push(&[0.0; 256]).unwrap_or(0.0);
        assert!(silent.is_finite() && silent < -150.0);
    }
}
