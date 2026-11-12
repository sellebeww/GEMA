// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
//! DSP akustik kelas untuk Gema. Semua fungsi murni dan deterministik.
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

pub mod filter;
pub mod level;
pub mod rt60;

#[cfg(test)]
pub(crate) mod testsig {
    /// PRNG xorshift64, supaya sinyal uji identik di setiap run.
    pub struct Rng(u64);
    impl Rng {
        pub fn new(seed: u64) -> Self {
            Self(seed.max(1))
        }
        /// Seragam di [-1, 1).
        pub fn next(&mut self) -> f64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 >> 11) as f64 / (1u64 << 52) as f64 - 1.0
        }
    }

    pub fn sine(fs: f64, f: f64, amp: f64, secs: f64) -> Vec<f32> {
        let n = (fs * secs) as usize;
        (0..n)
            .map(|i| (amp * (2.0 * std::f64::consts::PI * f * i as f64 / fs).sin()) as f32)
            .collect()
    }

    /// Derau putih dikali exp(-6.91 t / T) (turun 60 dB tepat di t = T),
    /// didahului `pre_s` detik hening, ditambah lantai derau `floor_db` relatif awal peluruhan.
    pub fn decay(fs: f64, t60: f64, pre_s: f64, floor_db: f64, seed: u64) -> Vec<f32> {
        let mut rng = Rng::new(seed);
        let mut floor_rng = Rng::new(seed ^ 0x9E37_79B9_7F4A_7C15);
        let floor = 10f64.powf(floor_db / 20.0);
        let pre = (fs * pre_s) as usize;
        let n = pre + (fs * (2.5 * t60 + 0.5)) as usize;
        (0..n)
            .map(|i| {
                let s = if i >= pre {
                    let t = (i - pre) as f64 / fs;
                    rng.next() * (-6.91 * t / t60).exp()
                } else {
                    0.0
                };
                (s + floor * floor_rng.next()) as f32
            })
            .collect()
    }
}
