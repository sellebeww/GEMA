// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
//! Pembungkus wasm-bindgen: masukan `Float32Array`, keluaran objek JS atau `Float32Array`.
//! Semua logika ada di modul lain dan diuji native; berkas ini hanya menjembatani tipe.

use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::{level, rt60, sweep};

/// Titik maksimum per kurva yang dikirim ke UI; cukup untuk SVG layar penuh.
const CURVE_POINTS: usize = 400;

fn to_js<T: Serialize>(v: &T) -> Result<JsValue, JsError> {
    // `None` menjadi null (bukan undefined) supaya cocok dengan tipe `number | null` di TypeScript.
    v.serialize(&serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true))
        .map_err(|e| JsError::new(&e.to_string()))
}

/// LAeq, LAmax, LA90 dalam dBFS dari blok sampel mono. Tambahkan offset kalibrasi di pemanggil.
#[wasm_bindgen]
pub fn level_stats(samples: &[f32], fs: f64, block_s: f64) -> Result<JsValue, JsError> {
    let s = level::level_stats(samples, fs, block_s)
        .ok_or_else(|| JsError::new("masukan level tidak valid"))?;
    to_js(&s)
}

/// RT60 (T20 dan T30) per pita oktaf 125 Hz sampai 4 kHz dari impulse response.
#[wasm_bindgen]
pub fn rt60_bands(ir: &[f32], fs: f64) -> Result<JsValue, JsError> {
    let report = rt60::rt60_report(ir, fs).map_err(|e| JsError::new(&e.to_string()))?;
    to_js(&report)
}

/// Sinyal log sweep untuk diputar.
#[wasm_bindgen]
pub fn sweep_signal(fs: f64, f1: f64, f2: f64, secs: f64) -> Result<Vec<f32>, JsError> {
    sweep::generate(fs, f1, f2, secs)
        .map(|s| s.signal)
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Impulse response dari rekaman sweep; parameter sweep harus sama dengan saat diputar.
#[wasm_bindgen]
pub fn sweep_deconvolve(
    recording: &[f32],
    fs: f64,
    f1: f64,
    f2: f64,
    secs: f64,
) -> Result<Vec<f32>, JsError> {
    let s = sweep::generate(fs, f1, f2, secs).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(sweep::deconvolve(recording, &s.inverse))
}

/// Kurva peluruhan Schroeder per pita oktaf (<= 400 titik per pita) dari impulse response.
#[wasm_bindgen]
pub fn schroeder_curves(ir: &[f32], fs: f64) -> Result<JsValue, JsError> {
    let c = rt60::decay_curves(ir, fs, CURVE_POINTS).map_err(|e| JsError::new(&e.to_string()))?;
    to_js(&c)
}
