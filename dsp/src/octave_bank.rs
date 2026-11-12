// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
//! Bank filter oktaf 125 Hz sampai 4 kHz: band-pass Butterworth orde 4 dalam bentuk SOS.

use std::f64::consts::{FRAC_PI_2, PI, SQRT_2};

use crate::filter::{Biquad, Cascade};

/// Frekuensi tengah pita oktaf yang diukur.
pub const CENTERS_HZ: [f64; 6] = [125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0];

type C = (f64, f64);

fn mul(a: C, b: C) -> C {
    (a.0 * b.0 - a.1 * b.1, a.0 * b.1 + a.1 * b.0)
}

fn div(a: C, b: C) -> C {
    let d = b.0 * b.0 + b.1 * b.1;
    ((a.0 * b.0 + a.1 * b.1) / d, (a.1 * b.0 - a.0 * b.1) / d)
}

fn sqrt(z: C) -> C {
    let m = z.0.hypot(z.1);
    (
        (((m + z.0) / 2.0).sqrt()),
        z.1.signum() * ((m - z.0) / 2.0).sqrt(),
    )
}

/// Band-pass oktaf di `f0` (tepi f0/sqrt2 dan f0*sqrt2, 0 dB di f0).
/// `None` bila tepi atas mencapai Nyquist.
pub fn band_filter(f0: f64, fs: f64) -> Option<Cascade> {
    let (lo, hi) = (f0 / SQRT_2, f0 * SQRT_2);
    if !(f0 > 0.0 && hi < fs / 2.0) {
        return None;
    }
    // Tepi analog diberi pra-lengkung supaya tepi digital tepat di lo dan hi.
    let warp = |f: f64| 2.0 * fs * (PI * f / fs).tan();
    let (wl, wh) = (warp(lo), warp(hi));
    let (w0sq, bw) = (wl * wh, wh - wl);

    let mut sections = Vec::with_capacity(4);
    // Kutub prototipe low-pass Butterworth orde 4 di setengah bidang atas: sudut 112,5 dan 157,5 derajat.
    for k in 0..2 {
        let theta = FRAC_PI_2 + PI * f64::from(2 * k + 1) / 8.0;
        let a = (theta.cos() * bw, theta.sin() * bw);
        let root = sqrt({
            let a2 = mul(a, a);
            (a2.0 - 4.0 * w0sq, a2.1)
        });
        // Transformasi low-pass ke band-pass memecah tiap kutub menjadi dua.
        for sign in [1.0, -1.0] {
            let s = ((a.0 + sign * root.0) / 2.0, (a.1 + sign * root.1) / 2.0);
            let z = div((2.0 * fs + s.0, s.1), (2.0 * fs - s.0, -s.1));
            // Pasangan kompleks sekawan; nol di z=1 dan z=-1.
            sections.push(Biquad::new(
                [1.0, 0.0, -1.0],
                [1.0, -2.0 * z.0, z.0 * z.0 + z.1 * z.1],
            ));
        }
    }
    Some(Cascade::normalized(sections, f0, fs))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db(x: f64) -> f64 {
        20.0 * x.log10()
    }

    const RATES: [f64; 2] = [44100.0, 48000.0];

    #[test]
    fn center_is_0_db_and_edges_are_3_db_down() {
        for fs in RATES {
            for f0 in CENTERS_HZ {
                let b = band_filter(f0, fs).expect("band valid");
                assert!(db(b.magnitude(f0, fs)).abs() < 0.05, "fs={fs} f0={f0}");
                for edge in [f0 / 2f64.sqrt(), f0 * 2f64.sqrt()] {
                    let g = db(b.magnitude(edge, fs));
                    assert!(
                        (g + 3.01).abs() < 0.15,
                        "fs={fs} f0={f0} edge={edge:.0}: {g:.2}"
                    );
                }
            }
        }
    }

    #[test]
    fn skirts_are_steep_one_octave_away() {
        // Butterworth orde 4 (band-pass orde 8): teori -26 dB pada f0/2 dan 2*f0.
        for fs in RATES {
            for f0 in CENTERS_HZ {
                let b = band_filter(f0, fs).expect("band valid");
                assert!(db(b.magnitude(2.0 * f0, fs)) < -24.0, "fs={fs} f0={f0} up");
                assert!(
                    db(b.magnitude(f0 / 2.0, fs)) < -24.0,
                    "fs={fs} f0={f0} down"
                );
            }
        }
    }

    #[test]
    fn impulse_response_is_finite_and_decays() {
        for fs in RATES {
            for f0 in CENTERS_HZ {
                let mut b = band_filter(f0, fs).expect("band valid");
                let n = fs as usize * 2;
                let y: Vec<f64> = (0..n)
                    .map(|i| b.process(if i == 0 { 1.0 } else { 0.0 }))
                    .collect();
                assert!(y.iter().all(|v| v.is_finite()), "fs={fs} f0={f0}");
                let total: f64 = y.iter().map(|v| v * v).sum();
                let tail: f64 = y[n * 9 / 10..].iter().map(|v| v * v).sum();
                assert!(
                    tail < 1e-12 * total,
                    "fs={fs} f0={f0}: tail {tail:e} total {total:e}"
                );
            }
        }
    }

    #[test]
    fn band_above_nyquist_is_rejected() {
        assert!(band_filter(4000.0, 8000.0).is_none());
        assert!(band_filter(0.0, 48000.0).is_none());
    }
}
