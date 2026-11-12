// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
//! Tingkat bunyi ekuivalen berbobot A (LAeq) dalam dBFS.
//! Konversi ke dB SPL dilakukan pemanggil dengan offset kalibrasi.

use serde::Serialize;

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

/// Statistik tingkat bunyi berbobot A dalam dBFS; pemanggil menambah offset kalibrasi.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct LevelStats {
    pub leq_db: f64,
    /// Tingkat blok tertinggi (Fast bila blok 0,125 s).
    pub lmax_db: f64,
    /// Tingkat yang dilampaui 90% blok (persentil ke-10).
    pub l90_db: f64,
    pub blocks: usize,
}

/// LAeq, LAmax dan LA90 dari `samples`, dipotong menjadi blok `block_s` detik.
/// Sisa di akhir yang lebih pendek dari satu blok diabaikan (kecuali input hanya selebar itu).
/// `None` bila input kosong atau blok lebih pendek dari satu sampel.
pub fn level_stats(samples: &[f32], fs: f64, block_s: f64) -> Option<LevelStats> {
    let block = (fs * block_s) as usize; // NaN dan negatif menjadi 0
    if block == 0 || samples.is_empty() {
        return None;
    }
    let mut meter = LevelMeter::new(fs);
    // Sisa di akhir yang lebih pendek dari satu blok dibuang: tingkatnya tidak bermakna.
    let mut blocks: Vec<&[f32]> = samples.chunks_exact(block).collect();
    if blocks.is_empty() {
        blocks.push(samples);
    }
    let mut levels: Vec<f64> = blocks.into_iter().filter_map(|b| meter.push(b)).collect();
    levels.sort_by(f64::total_cmp);
    let p10 = ((levels.len() - 1) as f64 * 0.1).round() as usize;
    Some(LevelStats {
        leq_db: meter.leq()?,
        lmax_db: *levels.last()?,
        l90_db: *levels.get(p10)?,
        blocks: levels.len(),
    })
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

    fn tone(fs: f64, amp: f64, secs: f64) -> Vec<f32> {
        sine(fs, 1000.0, amp, secs)
    }

    #[test]
    fn stats_of_steady_1k_tone() {
        for fs in [44100.0, 48000.0] {
            let s = level_stats(&tone(fs, 0.1, 5.0), fs, 0.125).expect("stats");
            // 0,1 amplitudo = -20 dBFS puncak, RMS -23,01 dBFS, bobot A 0 dB di 1 kHz.
            assert!(
                (s.leq_db - -23.01).abs() < 0.05,
                "fs={fs} leq {:.3}",
                s.leq_db
            );
            assert!(
                (s.lmax_db - -23.01).abs() < 0.1,
                "fs={fs} lmax {:.3}",
                s.lmax_db
            );
            assert!(
                (s.l90_db - -23.01).abs() < 0.1,
                "fs={fs} l90 {:.3}",
                s.l90_db
            );
            assert_eq!(s.blocks, 40);
        }
    }

    #[test]
    fn stats_of_step_signal_separate_lmax_l90_and_leq() {
        // 8 s di -43,01 dB lalu 2 s di -23,01 dB: L90 = tingkat rendah, Lmax = tingkat tinggi,
        // Leq = 10 log(0,8 * 5e-5 + 0,2 * 5e-3) = -29,83 dB.
        let fs = 48000.0;
        let mut x = tone(fs, 0.01, 8.0);
        x.extend(tone(fs, 0.1, 2.0));
        let s = level_stats(&x, fs, 0.125).expect("stats");
        assert!((s.lmax_db - -23.01).abs() < 0.1, "lmax {:.3}", s.lmax_db);
        assert!((s.l90_db - -43.01).abs() < 0.1, "l90 {:.3}", s.l90_db);
        assert!((s.leq_db - -29.83).abs() < 0.1, "leq {:.3}", s.leq_db);
    }

    #[test]
    fn stats_reject_degenerate_input() {
        assert_eq!(level_stats(&[], 48000.0, 0.125), None);
        assert_eq!(level_stats(&[0.1; 100], 0.0, 0.125), None);
        assert_eq!(level_stats(&[0.1; 100], 48000.0, 0.0), None);
        assert_eq!(level_stats(&[0.1; 100], f64::NAN, 0.125), None);
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
