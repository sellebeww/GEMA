// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
//! Filter IIR biquad: pembobotan A (IEC 61672) dan band-pass oktaf.

use std::f64::consts::PI;

/// Satu seksi biquad, direct form II transposed.
#[derive(Clone, Copy, Debug)]
pub struct Biquad {
    b: [f64; 3],
    a: [f64; 2],
    z: [f64; 2],
}

impl Biquad {
    /// Koefisien dinormalisasi terhadap a0.
    fn new(b: [f64; 3], a: [f64; 3]) -> Self {
        Self {
            b: b.map(|v| v / a[0]),
            a: [a[1] / a[0], a[2] / a[0]],
            z: [0.0; 2],
        }
    }

    /// Dari dua nol dan dua kutub real di bidang z.
    fn from_roots(z1: f64, z2: f64, p1: f64, p2: f64) -> Self {
        Self::new([1.0, -(z1 + z2), z1 * z2], [1.0, -(p1 + p2), p1 * p2])
    }

    pub fn process(&mut self, x: f64) -> f64 {
        let y = self.b[0] * x + self.z[0];
        self.z[0] = self.b[1] * x - self.a[0] * y + self.z[1];
        self.z[1] = self.b[2] * x - self.a[1] * y;
        y
    }

    /// |H(e^jw)|, w dalam rad/sampel.
    fn magnitude(&self, w: f64) -> f64 {
        let (c1, s1, c2, s2) = (w.cos(), w.sin(), (2.0 * w).cos(), (2.0 * w).sin());
        let num =
            (self.b[0] + self.b[1] * c1 + self.b[2] * c2).hypot(self.b[1] * s1 + self.b[2] * s2);
        let den = (1.0 + self.a[0] * c1 + self.a[1] * c2).hypot(self.a[0] * s1 + self.a[1] * s2);
        num / den
    }
}

/// Rangkaian biquad seri dengan penguatan total.
#[derive(Clone, Debug)]
pub struct Cascade {
    sections: Vec<Biquad>,
    gain: f64,
}

impl Cascade {
    pub fn process(&mut self, x: f64) -> f64 {
        self.sections
            .iter_mut()
            .fold(x * self.gain, |v, s| s.process(v))
    }

    /// Magnitudo respons pada frekuensi `f` Hz.
    pub fn magnitude(&self, f: f64, fs: f64) -> f64 {
        let w = 2.0 * PI * f / fs;
        self.gain
            * self
                .sections
                .iter()
                .map(|s| s.magnitude(w))
                .product::<f64>()
    }
}

/// Pembobotan A: H(s) = k s^4 / ((s+w1)^2 (s+w2) (s+w3) (s+w4)^2), transformasi bilinear,
/// dinormalisasi 0 dB di 1 kHz.
pub fn a_weighting(fs: f64) -> Cascade {
    // Frekuensi kutub IEC 61672-1, Lampiran E.
    let pole = |f: f64| {
        let s = -2.0 * PI * f / (2.0 * fs);
        (1.0 + s) / (1.0 - s)
    };
    let [p1, p2, p3, p4] = [20.598_997, 107.652_65, 737.862_23, 12_194.217].map(pole);
    // Empat nol di s=0 menjadi z=1; selisih orde (6-4) menjadi dua nol di z=-1.
    let mut c = Cascade {
        sections: vec![
            Biquad::from_roots(1.0, 1.0, p1, p1),
            Biquad::from_roots(1.0, 1.0, p4, p4),
            Biquad::from_roots(-1.0, -1.0, p2, p3),
        ],
        gain: 1.0,
    };
    c.gain = 1.0 / c.magnitude(1000.0, fs);
    c
}

/// Band-pass satu oktaf berpusat di `f0` (RBJ cookbook, puncak 0 dB).
pub fn octave_bandpass(f0: f64, fs: f64) -> Cascade {
    let w0 = 2.0 * PI * f0 / fs;
    let alpha = w0.sin() * (std::f64::consts::LN_2 / 2.0 * w0 / w0.sin()).sinh();
    Cascade {
        sections: vec![Biquad::new(
            [alpha, 0.0, -alpha],
            [1.0 + alpha, -2.0 * w0.cos(), 1.0 - alpha],
        )],
        gain: 1.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db(x: f64) -> f64 {
        20.0 * x.log10()
    }

    // Nilai nominal pembobotan A dari IEC 61672-1, Tabel 3.
    const A_TABLE: [(f64, f64); 9] = [
        (31.5, -39.4),
        (63.0, -26.2),
        (125.0, -16.1),
        (250.0, -8.6),
        (500.0, -3.2),
        (1000.0, 0.0),
        (2000.0, 1.2),
        (4000.0, 1.0),
        (8000.0, -1.1),
    ];

    #[test]
    fn a_weighting_matches_iec_table() {
        for fs in [44100.0, 48000.0] {
            let a = a_weighting(fs);
            for (f, want) in A_TABLE {
                let got = db(a.magnitude(f, fs));
                // Transformasi bilinear menekan frekuensi tinggi: 8 kHz diberi toleransi kelas 2.
                let tol = if f >= 8000.0 { 1.5 } else { 0.3 };
                assert!(
                    (got - want).abs() <= tol,
                    "fs={fs} f={f}: {got:.2} vs {want}"
                );
            }
        }
    }

    #[test]
    fn a_weighting_processing_matches_magnitude() {
        let fs = 48000.0;
        let mut a = a_weighting(fs);
        let x = crate::testsig::sine(fs, 250.0, 1.0, 1.0);
        let y: Vec<f64> = x.iter().map(|&v| a.process(f64::from(v))).collect();
        let tail = &y[y.len() / 2..];
        let rms = (tail.iter().map(|v| v * v).sum::<f64>() / tail.len() as f64).sqrt();
        let gain_db = db(rms * 2f64.sqrt());
        assert!((gain_db - -8.6).abs() < 0.3, "{gain_db:.2}");
    }

    #[test]
    fn octave_bandpass_passes_center_rejects_far() {
        let fs = 48000.0;
        for f0 in [500.0, 1000.0, 2000.0] {
            let b = octave_bandpass(f0, fs);
            assert!(db(b.magnitude(f0, fs)).abs() < 0.1);
            assert!(db(b.magnitude(f0 * 4.0, fs)) < -10.0);
            assert!(db(b.magnitude(f0 / 4.0, fs)) < -10.0);
        }
    }
}
