// InfWave Analytic Carrier & Cross-Tool Bridge ("The Infinite Compassion")
// Pure-JS, Zero-DOM ES Module — runs identically in browser and Node (`node --test`).
//
// Bridges InfWave spectral PCM <-> The Ramanujan Chime hollow-sphere seed P(t) = V(t)e^{iθ(t)}
//                              <-> BitWave 2D hex registers (8..256b, 0x8 midpoint, schema-5 JSON).
//
// Grounded DSP Architecture:
//  - Discrete Marple Analytic Signal (FFT-Hilbert): z[n] = x[n] + i·H{x}[n] = A[n]·e^{iθ[n]}
//  - Tier A (1-Carrier Macro Hull): Smooth envelope A(t) -> Vessel volume/radius,
//            energy-weighted spectral centroid ω̄(t) -> instantaneous carrier velocity θ̇(t),
//            spectral flatness -> cavity ratio η = r/R, plus honest 1-carrier reconstruction SNR.
//  - Tier B (K-Send Dyadic Safe-Zone Bus across 500Hz–8kHz = exact 4.0 octaves):
//            K=4 (1 oct), K=8 (1/2 oct = BitWave 8 lanes / Chime 8 octal tiers),
//            K=16 (1/4 oct = BitWave F1..F16 Free Frames).
//            Partition-of-unity raised-cosine spectral windows guarantee exact in-band reconstruction
//            B(t) = Σ Re(z_j(t)) = Σ A_j(t)cos(θ_j(t)) matching VESSEL-CALCULUS.md §5.4!
//  - BitWave 0x8-centered Codec + Fritsch-Carlson Cyclic Monotone-Cubic Spline + Twin Algebra
//            (P, ~P NOT, −P antipodal/two's-comp, P̄ conjugate palindrome, ROTR(M/4) 90° quadrature)
//            + BitWave Schema-5 `.bitwave.json` exporter.

import {
  SAFE_ZONE_LO_HZ,
  SAFE_ZONE_HI_HZ,
  fftInPlace,
  nextPow2,
} from "./spectral_dsp.js";

const TWO_PI = 2 * Math.PI;
const F32_PI = Math.fround(Math.PI);

// ---------------------------------------------------------------------------
// 1. Signal Quality & Fidelity Metrics (Honest DSP Grounding)
// ---------------------------------------------------------------------------
export function computeSnrDb(reference, estimate) {
  const n = Math.min(reference.length, estimate.length);
  if (n === 0) return { snrDb: 0, correlation: 0, rmsRef: 0, rmsErr: 0 };
  let sigPow = 0;
  let errPow = 0;
  let estPow = 0;
  let dot = 0;
  for (let i = 0; i < n; i++) {
    const r = reference[i];
    const e = estimate[i];
    const d = r - e;
    sigPow += r * r;
    errPow += d * d;
    estPow += e * e;
    dot += r * e;
  }
  const rmsRef = Math.sqrt(sigPow / n);
  const rmsErr = Math.sqrt(errPow / n);
  const snrDb =
    errPow <= 1e-24
      ? 160.0
      : Number((10 * Math.log10(Math.max(sigPow, 1e-24) / errPow)).toFixed(2));
  const denom = Math.sqrt(sigPow * estPow);
  const correlation = denom > 1e-18 ? Number((dot / denom).toFixed(6)) : 0;
  return { snrDb, correlation, rmsRef, rmsErr };
}

// ---------------------------------------------------------------------------
// 2. Exact Discrete Hilbert / Analytic Signal (Marple FFT Method)
// ---------------------------------------------------------------------------
/**
 * Compute discrete analytic signal z[n] = x[n] + i·H{x}[n] = A[n]·e^{iθ[n]}.
 * For monocomponent signals, A[n] and instFreqHz[n] are exact; for broadband multicomponent
 * signals, nullCrossings reports destructive-interference sentinels where A[n] -> 0.
 */
export function computeAnalyticSignal(samples, sr = 48000) {
  const n = samples.length;
  if (n === 0) {
    return {
      re: new Float64Array(0),
      im: new Float64Array(0),
      amplitude: new Float64Array(0),
      phase: new Float64Array(0),
      instFreqHz: new Float64Array(0),
      nullCrossings: 0,
      fftSize: 0,
    };
  }

  const N = nextPow2(n);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < n; i++) re[i] = samples[i];

  fftInPlace(re, im, false);

  // Marple discrete analytic multiplier: DC & Nyquist x1, positive freqs x2, negative freqs x0
  const half = N >> 1;
  for (let k = 1; k < half; k++) {
    re[k] *= 2;
    im[k] *= 2;
  }
  for (let k = half + 1; k < N; k++) {
    re[k] = 0;
    im[k] = 0;
  }

  fftInPlace(re, im, true);

  const outRe = re.subarray(0, n);
  const outIm = im.subarray(0, n);
  const amplitude = new Float64Array(n);
  const phase = new Float64Array(n);
  const instFreqHz = new Float64Array(n);

  let maxAmp = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.hypot(outRe[i], outIm[i]);
    amplitude[i] = a;
    if (a > maxAmp) maxAmp = a;
  }

  const nullThresh = Math.max(1e-9, maxAmp * 1e-3);
  let nullCrossings = 0;
  let prevWrap = Math.atan2(outIm[0], outRe[0]);
  let unwrapped = prevWrap;
  phase[0] = unwrapped;

  for (let i = 1; i < n; i++) {
    const w = Math.atan2(outIm[i], outRe[i]);
    let d = w - prevWrap;
    while (d > Math.PI) d -= TWO_PI;
    while (d < -Math.PI) d += TWO_PI;
    unwrapped += d;
    phase[i] = unwrapped;
    prevWrap = w;

    if (amplitude[i] < nullThresh) {
      nullCrossings++;
      instFreqHz[i] = instFreqHz[i - 1];
    } else {
      const f = (d * sr) / TWO_PI;
      instFreqHz[i] = Math.max(0, Math.min(sr * 0.5, f));
    }
  }
  if (n > 1) instFreqHz[0] = instFreqHz[1];

  return {
    re: outRe,
    im: outIm,
    amplitude,
    phase,
    instFreqHz,
    nullCrossings,
    fftSize: N,
  };
}

// ---------------------------------------------------------------------------
// 3. Tier A — 1-Carrier Macro Hull -> The Ramanujan Chime Hollow-Sphere Seed
// ---------------------------------------------------------------------------
/**
 * Analyze PCM into a time-varying Chime hollow-sphere seed trajectory P(t) = V(t)·e^{iθ(t)}:
 *  - A_env(t)  -> outer carrier radius R(t) and breathing rate d(ln V)/dt
 *  - centroid  -> Gabor mean instantaneous frequency f̄(t) = θ̇(t) / 2π
 *  - flatness  -> cavity radius ratio η(t) = r(t) / R(t) (narrowband tone -> small η; dense bed -> wide η)
 *  - Also resynthesizes single-carrier s_1c(t) = A_env(t)·sin(∫ 2π f̄(t) dt) and reports honest SNR.
 */
export function extractChimeSeedTrajectory(
  samples,
  sr = 48000,
  { frames = 64, winSize = 1024, fLo = SAFE_ZONE_LO_HZ, fHi = SAFE_ZONE_HI_HZ } = {}
) {
  const n = samples.length;
  const F = Math.max(4, Math.min(512, Math.round(frames)));
  const W = nextPow2(Math.max(128, Math.min(4096, winSize)));
  const half = W >> 1;
  const binHz = sr / W;
  const kLo = Math.max(1, Math.floor(fLo / binHz));
  const kHi = Math.min(half - 1, Math.ceil(fHi / binHz));

  const hann = new Float64Array(W);
  for (let i = 0; i < W; i++) hann[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / W);

  const re = new Float64Array(W);
  const im = new Float64Array(W);
  const trajectory = [];

  let peakRms = 1e-9;
  const rawFrames = [];

  for (let f = 0; f < F; f++) {
    const center = F > 1 ? Math.floor((f / (F - 1)) * Math.max(0, n - 1)) : 0;
    const start = center - half;
    let ss = 0;
    for (let i = 0; i < W; i++) {
      const idx = start + i;
      const v = idx >= 0 && idx < n ? samples[idx] : 0;
      ss += v * v;
      re[i] = v * hann[i];
      im[i] = 0;
    }
    const rms = Math.sqrt(ss / W);
    if (rms > peakRms) peakRms = rms;

    fftInPlace(re, im, false);

    let powSum = 0;
    let freqPowSum = 0;
    let logPowSum = 0;
    let binCount = 0;

    for (let k = kLo; k <= kHi; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      const hz = k * binHz;
      powSum += p;
      freqPowSum += p * hz;
      logPowSum += Math.log(p + 1e-18);
      binCount++;
    }

    const centroidHz = powSum > 1e-18 ? freqPowSum / powSum : Math.sqrt(fLo * fHi);
    const geomMean = binCount > 0 ? Math.exp(logPowSum / binCount) : 0;
    const arithMean = binCount > 0 ? powSum / binCount : 1e-18;
    const flatness = Math.min(1, Math.max(0, arithMean > 1e-18 ? geomMean / arithMean : 0));

    // Spectral spread (bandwidth normalized to band span)
    let spreadSum = 0;
    for (let k = kLo; k <= kHi; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      const df = k * binHz - centroidHz;
      spreadSum += p * df * df;
    }
    const spreadHz = powSum > 1e-18 ? Math.sqrt(spreadSum / powSum) : 0;

    rawFrames.push({
      tSec: center / sr,
      rms,
      centroidHz,
      flatness,
      spreadHz,
    });
  }

  const dtFrame = F > 1 ? Math.max(1e-6, (n / sr) / (F - 1)) : 1.0;

  for (let f = 0; f < F; f++) {
    const cur = rawFrames[f];
    const ampNorm = Math.min(1, cur.rms / peakRms);
    // Map normalized amplitude -> outer radius R in [0.25, 1.0] (float32 matching Chime engine)
    const R = Math.fround(0.25 + 0.75 * ampNorm);
    // Map spectral flatness + normalized spread -> cavity ratio eta = r/R in [0.10, 0.88]
    const normSpread = Math.min(1, cur.spreadHz / Math.max(1, 0.35 * (fHi - fLo)));
    const eta = Math.fround(0.1 + 0.78 * Math.min(1, 0.55 * cur.flatness + 0.45 * normSpread));
    const r = Math.fround(R * eta);
    const volShell = Math.fround((4 / 3) * F32_PI * (R * R * R - r * r * r));
    const alpha = r > 1e-6 ? Number((R / r).toFixed(4)) : 10.0;

    const prevV = f > 0 ? trajectory[f - 1].volShell : volShell;
    const dLnVdt = Number(((Math.log(Math.max(volShell, 1e-6)) - Math.log(Math.max(prevV, 1e-6))) / dtFrame).toFixed(4));

    trajectory.push({
      index: f,
      tSec: Number(cur.tSec.toFixed(5)),
      ampNorm: Number(ampNorm.toFixed(5)),
      centroidHz: Number(cur.centroidHz.toFixed(2)),
      flatness: Number(cur.flatness.toFixed(5)),
      spreadHz: Number(cur.spreadHz.toFixed(2)),
      R: Number(R.toFixed(5)),
      r: Number(r.toFixed(5)),
      eta: Number(eta.toFixed(5)),
      alpha,
      volShell: Number(volShell.toFixed(6)),
      dLnVdt,
      omegaRadS: Number((TWO_PI * cur.centroidHz).toFixed(2)),
    });
  }

  // Synthesize single-carrier hull s(t) = A(t) · sin(θ(t)) with linear frame interpolation
  const hullAudio = new Float64Array(n);
  let phi = 0;
  for (let i = 0; i < n; i++) {
    const pos = n > 1 ? (i / (n - 1)) * (F - 1) : 0;
    const i0 = Math.floor(pos);
    const i1 = Math.min(F - 1, i0 + 1);
    const frac = pos - i0;
    const a = (rawFrames[i0].rms * (1 - frac) + rawFrames[i1].rms * frac) * Math.SQRT2;
    const hz = rawFrames[i0].centroidHz * (1 - frac) + rawFrames[i1].centroidHz * frac;
    hullAudio[i] = a * Math.sin(phi);
    phi += (TWO_PI * hz) / sr;
  }

  const fidelity = computeSnrDb(samples, hullAudio);

  return {
    sampleRate: sr,
    durationSec: n / sr,
    frames: trajectory,
    hullAudio,
    fidelity,
  };
}

// ---------------------------------------------------------------------------
// 4. Tier B — Dyadic 500Hz–8kHz Safe-Zone Parallel Subband Bus (K = 4, 8, 16)
// ---------------------------------------------------------------------------
/**
 * Build K dyadic subband descriptors spanning [fLo, fHi] (default 500–8000 Hz = exact 4 octaves).
 *  - K = 4  -> 1 octave/band
 *  - K = 8  -> 1/2 octave/band (matches BitWave 8 lanes & Chime 8 octal bloom tiers)
 *  - K = 16 -> 1/4 octave/band (matches BitWave F1..F16 Free Frames)
 */
export function buildDyadicSafeZoneBands(K = 8, fLo = SAFE_ZONE_LO_HZ, fHi = SAFE_ZONE_HI_HZ) {
  const count = Math.max(2, Math.min(32, Math.round(K)));
  const ratio = fHi / fLo;
  const bands = [];
  for (let j = 0; j < count; j++) {
    const lo = fLo * Math.pow(ratio, j / count);
    const hi = fLo * Math.pow(ratio, (j + 1) / count);
    const center = Math.sqrt(lo * hi);
    bands.push({
      index: j,
      fLo: Number(lo.toFixed(2)),
      fHi: Number(hi.toFixed(2)),
      fCenter: Number(center.toFixed(2)),
      label: `${Math.round(center)}Hz`,
    });
  }
  return bands;
}

/**
 * Decompose PCM into K narrowband analytic subbands across [fLo, fHi] using a strict
 * partition-of-unity frequency filterbank (`Σ W_j(f) === 1` across [fLo, fHi]).
 *
 * Returns per-band analytic carriers `(amplitude, phase, realPart)`, downsampled envelopes,
 * exact summed reconstruction `reconstructed`, in-band reference `inBandReference`,
 * and honest SNR metrics (both vs. in-band reference and vs. full raw PCM).
 */
export function decomposeSafeZoneBands(
  samples,
  sr = 48000,
  { K = 8, fLo = SAFE_ZONE_LO_HZ, fHi = SAFE_ZONE_HI_HZ, envPoints = 32, transitionFrac = 0.18 } = {}
) {
  const n = samples.length;
  const bandDefs = buildDyadicSafeZoneBands(K, fLo, fHi);
  const N = nextPow2(Math.max(16, n));
  const half = N >> 1;
  const binHz = sr / N;

  // Forward FFT of input once
  const specRe = new Float64Array(N);
  const specIm = new Float64Array(N);
  for (let i = 0; i < n; i++) specRe[i] = samples[i];
  fftInPlace(specRe, specIm, false);

  // Build strict partition-of-unity smooth weights W_j[k] on positive bins k in [0..half]
  // Using log-frequency coordinate u(f) = log2(f / fLo) / log2(fHi / fLo) in [0, 1]
  const logSpan = Math.log2(fHi / fLo);
  const weights = bandDefs.map(() => new Float64Array(half + 1));
  const totalMask = new Float64Array(half + 1);
  const trans = Math.max(0.01, Math.min(0.45, transitionFrac));

  const smoothstep = (x) => {
    const t = Math.max(0, Math.min(1, x));
    return 0.5 - 0.5 * Math.cos(Math.PI * t);
  };

  for (let k = 1; k < half; k++) {
    const hz = k * binHz;
    if (hz <= fLo * 0.92 || hz >= fHi * 1.08) continue;
    const u = Math.log2(hz / fLo) / logSpan; // 0 at fLo, 1 at fHi
    const edgeIn = smoothstep((u + 0.03) / 0.06);
    const edgeOut = 1.0 - smoothstep((u - 0.97) / 0.06);
    const globalGate = edgeIn * edgeOut;
    if (globalGate <= 1e-9) continue;

    // Raw raised-cosine partition over u in [0, 1]
    const pos = u * bandDefs.length;
    let wSum = 0;
    const rawW = new Float64Array(bandDefs.length);
    for (let j = 0; j < bandDefs.length; j++) {
      // Smooth raised-cosine transitions of half-width `trans` around integer boundaries j and j+1
      const rise = j === 0 ? 1.0 : smoothstep((pos - (j - trans)) / (2 * trans));
      const fall = j === bandDefs.length - 1 ? 1.0 : 1.0 - smoothstep((pos - (j + 1 - trans)) / (2 * trans));
      const w = rise * fall;
      rawW[j] = w;
      wSum += w;
    }
    if (wSum > 1e-12) {
      for (let j = 0; j < bandDefs.length; j++) {
        weights[j][k] = (rawW[j] / wSum) * globalGate;
      }
      totalMask[k] = globalGate;
    }
  }

  // Exact in-band reference signal (single inverse FFT of totalMask)
  const refRe = new Float64Array(N);
  const refIm = new Float64Array(N);
  for (let k = 1; k < half; k++) {
    const m = totalMask[k] * 2.0; // analytic positive-freq multiplier
    refRe[k] = specRe[k] * m;
    refIm[k] = specIm[k] * m;
  }
  fftInPlace(refRe, refIm, true);
  const inBandReference = new Float64Array(n);
  for (let i = 0; i < n; i++) inBandReference[i] = refRe[i];

  // Per-band analytic signals z_j[n] = A_j[n] * e^{i θ_j[n]}
  const reconstructed = new Float64Array(n);
  const bands = [];
  let totalEnergy = 0;

  const tmpRe = new Float64Array(N);
  const tmpIm = new Float64Array(N);

  for (let j = 0; j < bandDefs.length; j++) {
    tmpRe.fill(0);
    tmpIm.fill(0);
    const wArr = weights[j];
    for (let k = 1; k < half; k++) {
      const m = wArr[k] * 2.0;
      if (m <= 0) continue;
      tmpRe[k] = specRe[k] * m;
      tmpIm[k] = specIm[k] * m;
    }
    fftInPlace(tmpRe, tmpIm, true);

    const realPart = new Float64Array(n);
    const imagPart = new Float64Array(n);
    const amplitude = new Float64Array(n);
    const phase = new Float64Array(n);
    let bandSqSum = 0;
    let peakAmp = 0;

    for (let i = 0; i < n; i++) {
      const r = tmpRe[i];
      const imv = tmpIm[i];
      realPart[i] = r;
      imagPart[i] = imv;
      reconstructed[i] += r;
      const a = Math.hypot(r, imv);
      amplitude[i] = a;
      phase[i] = Math.atan2(imv, r);
      bandSqSum += r * r;
      if (a > peakAmp) peakAmp = a;
    }

    const rms = Math.sqrt(bandSqSum / Math.max(1, n));
    totalEnergy += bandSqSum;

    // Downsample envelope and quadrature pair to `envPoints` for compact UI & BitWave registers
    const pts = Math.max(2, Math.round(envPoints));
    const envelopeCurve = new Float64Array(pts);
    const inPhaseCurve = new Float64Array(pts);
    const quadCurve = new Float64Array(pts);
    const segLen = n / pts;
    for (let m = 0; m < pts; m++) {
      const s0 = Math.floor(m * segLen);
      const s1 = Math.max(s0 + 1, Math.min(n, Math.floor((m + 1) * segLen)));
      let eAcc = 0;
      let iAcc = 0;
      let qAcc = 0;
      for (let s = s0; s < s1; s++) {
        eAcc += amplitude[s];
        iAcc += realPart[s];
        qAcc += imagPart[s];
      }
      const inv = 1.0 / (s1 - s0);
      envelopeCurve[m] = eAcc * inv;
      inPhaseCurve[m] = iAcc * inv;
      quadCurve[m] = qAcc * inv;
    }

    bands.push({
      ...bandDefs[j],
      rms: Number(rms.toFixed(6)),
      peakAmp: Number(peakAmp.toFixed(6)),
      energyShare: 0, // populated below
      realPart,
      imagPart,
      amplitude,
      phase,
      envelopeCurve,
      inPhaseCurve,
      quadCurve,
    });
  }

  for (const b of bands) {
    const bandE = b.rms * b.rms * n;
    b.energyShare = totalEnergy > 1e-24 ? Number((bandE / totalEnergy).toFixed(5)) : 0;
  }

  return {
    K: bandDefs.length,
    fLo,
    fHi,
    sampleRate: sr,
    bands,
    reconstructed,
    inBandReference,
    inBandFidelity: computeSnrDb(inBandReference, reconstructed),
    fullBandFidelity: computeSnrDb(samples, reconstructed),
  };
}

// ---------------------------------------------------------------------------
// 5. BitWave 0x8-Centered Hex Codec, Monotone-Cubic Spline & Twin Algebra
// ---------------------------------------------------------------------------
export const BITWAVE_WIDTHS = [8, 16, 32, 64, 128, 256];

export function clampNibble(v) {
  const n = Math.round(Number(v) || 0);
  return n < 0 ? 0 : n > 15 ? 15 : n;
}

export function nibblesFromHex(hexStr) {
  const clean = String(hexStr || "")
    .trim()
    .replace(/^0[xX]/, "")
    .replace(/[\s_-]+/g, "")
    .toUpperCase();
  if (!clean || !/^[0-9A-F]+$/.test(clean)) return [];
  const out = new Array(clean.length);
  for (let i = 0; i < clean.length; i++) out[i] = parseInt(clean.charAt(i), 16);
  return out;
}

export function hexFromNibbles(nibbles) {
  let s = "";
  for (let i = 0; i < nibbles.length; i++) {
    s += clampNibble(nibbles[i]).toString(16).toUpperCase();
  }
  return s;
}

/**
 * Quantize a real waveform/envelope array onto an N-bit BitWave hex register (M = N/4 nibbles).
 *  - `mode === "bipolar"` (default): 0.0 -> nibble 0x8 (1000_2), -1.0 -> 0x0, +0.875..+1.0 -> 0xF
 *    (exact inverse of Chime's `sampleMonotone = (nibble - 8) / 8`).
 *  - `mode === "unipolar"`: [0, 1] -> [0x0, 0xF] (useful for pure magnitude envelopes).
 */
export function quantizeSignalToHex(values, widthBits = 64, { mode = "bipolar", normalize = true } = {}) {
  const validW = BITWAVE_WIDTHS.includes(widthBits) ? widthBits : 64;
  const M = validW / 4;
  const nibbles = new Array(M).fill(mode === "bipolar" ? 8 : 0);
  if (!values || values.length === 0) {
    return { hex: hexFromNibbles(nibbles), nibbles, widthBits: validW, scale: 1 };
  }

  let peak = 0;
  for (let i = 0; i < values.length; i++) {
    const a = Math.abs(values[i]);
    if (a > peak) peak = a;
  }
  const scale = normalize && peak > 1e-12 ? peak : 1.0;

  for (let m = 0; m < M; m++) {
    // Average samples inside slot m for anti-aliased decimation
    const s0 = Math.floor((m / M) * values.length);
    const s1 = Math.max(s0 + 1, Math.min(values.length, Math.floor(((m + 1) / M) * values.length)));
    let acc = 0;
    for (let s = s0; s < s1; s++) acc += values[s];
    const v = (acc / (s1 - s0)) / scale;
    if (mode === "unipolar") {
      nibbles[m] = clampNibble(Math.max(0, Math.min(1, v)) * 15);
    } else {
      nibbles[m] = clampNibble(v * 8 + 8);
    }
  }

  return { hex: hexFromNibbles(nibbles), nibbles, widthBits: validW, scale };
}

/**
 * Exact dequantization of nibbles back to normalized bipolar [-1, +0.875] centered on 0x8.
 */
export function dequantizeNibblesBipolar(nibbles) {
  const out = new Float64Array(nibbles.length);
  for (let i = 0; i < nibbles.length; i++) out[i] = (clampNibble(nibbles[i]) - 8) / 8;
  return out;
}

/**
 * Cyclic Fritsch-Carlson monotone-cubic spline matching `Ramanujan Sphere/js/bitwave-feed.js`.
 */
export function computeCyclicSlopes(y) {
  const n = y.length;
  const m = new Float64Array(n);
  if (n < 2) return m;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = y[(i + 1) % n] - y[i];
  for (let j = 0; j < n; j++) {
    const dPrev = d[(j - 1 + n) % n];
    const dNext = d[j];
    m[j] = dPrev * dNext <= 0 ? 0 : (2 * dPrev * dNext) / (dPrev + dNext);
  }
  return m;
}

export function sampleMonotoneBipolar(nibbles, u, cachedSlopes = null) {
  if (!nibbles || nibbles.length === 0) return 0;
  const n = nibbles.length;
  if (n === 1) return (clampNibble(nibbles[0]) - 8) / 8;
  const uu = ((u % 1) + 1) % 1;
  const pos = uu * n;
  const i0 = Math.floor(pos) % n;
  const i1 = (i0 + 1) % n;
  const t = pos - Math.floor(pos);
  let raw;
  if (t <= 1e-9) {
    raw = nibbles[i0];
  } else {
    const slopes = cachedSlopes || computeCyclicSlopes(nibbles);
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    raw = Math.max(0, Math.min(15, h00 * nibbles[i0] + h10 * slopes[i0] + h01 * nibbles[i1] + h11 * slopes[i1]));
  }
  return (raw - 8) / 8;
}

/**
 * Synthesize continuous PCM audio by cycling a BitWave hex register as a modulated-sine carrier
 * at `carrierHz` (inside the 500Hz–8kHz safe zone) with optional amplitude envelope!
 */
export function synthesizeHexCarrierPcm(
  hexStr,
  { sr = 48000, durationSec = 0.5, carrierHz = 1000, ampEnvelope = null } = {}
) {
  const nibbles = nibblesFromHex(hexStr);
  const n = Math.max(1, Math.round(sr * durationSec));
  const out = new Float64Array(n);
  if (nibbles.length === 0) return out;
  const slopes = computeCyclicSlopes(nibbles);
  const phaseInc = carrierHz / sr;
  let u = 0;
  for (let i = 0; i < n; i++) {
    let gain = 1.0;
    if (ampEnvelope && ampEnvelope.length > 0) {
      const p = (i / Math.max(1, n - 1)) * (ampEnvelope.length - 1);
      const a0 = Math.floor(p);
      const a1 = Math.min(ampEnvelope.length - 1, a0 + 1);
      gain = ampEnvelope[a0] * (1 - (p - a0)) + ampEnvelope[a1] * (p - a0);
    }
    out[i] = gain * sampleMonotoneBipolar(nibbles, u, slopes);
    u += phaseInc;
  }
  return out;
}

/**
 * Apply the Rosetta Stone polarity & symmetry operators to a BitWave hex register:
 *  - `P`          : identity
 *  - `not` (~P)   : bitwise NOT (`H ^ FF...`) = InfWave `+ / −` breathing complement
 *  - `twos` (−P)  : exact two's-complement `((~H) + 1) mod 2^N`
 *  - `mirror`     : bipolar reflection around `0x8` (`clamp(16 - h, 0, 15)`)
 *  - `conj` (P̄)   : nibble palindrome / time-reversal mirror
 *  - `quad` (90°) : lossless cyclic quarter-register rotation `ROTR(H, M/4)`
 */
export function applyBitWaveTwinOp(hexStr, op = "P") {
  const nibs = nibblesFromHex(hexStr);
  const M = nibs.length;
  if (M === 0) return "";
  if (op === "P" || op === "identity") return hexFromNibbles(nibs);

  if (op === "not" || op === "~P") {
    return hexFromNibbles(nibs.map((h) => 15 - h));
  }
  if (op === "twos" || op === "-P") {
    const bits = BigInt(M * 4);
    const mask = (1n << bits) - 1n;
    const val = BigInt("0x" + hexFromNibbles(nibs));
    const neg = ((~val & mask) + 1n) & mask;
    return neg.toString(16).toUpperCase().padStart(M, "0");
  }
  if (op === "mirror") {
    return hexFromNibbles(nibs.map((h) => clampNibble(16 - h)));
  }
  if (op === "conj" || op === "Pbar") {
    return hexFromNibbles([...nibs].reverse());
  }
  if (op === "quad" || op === "rotr90") {
    const shift = Math.max(1, Math.floor(M / 4));
    const out = new Array(M);
    for (let i = 0; i < M; i++) out[(i + shift) % M] = nibs[i];
    return hexFromNibbles(out);
  }
  return hexFromNibbles(nibs);
}

/**
 * Export a valid BitWave Schema-5 `.bitwave.json` project document from an InfWave safe-zone
 * band decomposition (up to 8 lanes + optional up to 16 Free Frames `F1..F16`).
 * Strictly conforms to `BitWave/src/core/project.ts` (`PROJECT_SCHEMA = 5`, Z never stored).
 */
export function exportBitWaveSchema5Project(
  decomposition,
  {
    widthBits = 64,
    binop = "xor",
    includeFreeFrames = true,
    savedAt = "2026-11-27T00:00:00.000Z",
  } = {}
) {
  const N = BITWAVE_WIDTHS.includes(widthBits) ? widthBits : 64;
  const bands = decomposition?.bands || [];
  const laneCount = Math.max(1, Math.min(8, bands.length));
  const lanes = {};

  for (let i = 0; i < laneCount; i++) {
    const b = bands[i];
    // Operand A = quantized band envelope (or bipolar real carrier); Operand B = quadrature twin
    const qA = quantizeSignalToHex(b.inPhaseCurve, N, { mode: "bipolar", normalize: true });
    const qB = quantizeSignalToHex(b.quadCurve, N, { mode: "bipolar", normalize: true });
    lanes[String(i + 1)] = {
      a: qA.hex,
      b: qB.hex,
      showB: true,
      binop,
      edit: "a",
      seededB: true,
      lfoB: "0",
      colA: -1,
      colB: -1,
      focus: "z",
      frameVis: { a: true, b: true, z: true },
    };
  }

  const doc = {
    schema: 5,
    app: "bitwave",
    savedAt,
    N,
    view: {
      lane: "1",
      view3d: false,
      split3d: false,
      splitPair: ["1", laneCount >= 2 ? "2" : "1"],
      activePane: 0,
      lfoMode: "rotcw",
      lfoRate: 4,
    },
    lanes,
    routes: [],
    parked: {},
  };

  if (includeFreeFrames && bands.length > 0) {
    const frames = {};
    const freeCount = Math.min(16, bands.length);
    for (let i = 0; i < freeCount; i++) {
      const b = bands[i];
      const qEnv = quantizeSignalToHex(b.envelopeCurve, N, { mode: "unipolar", normalize: true });
      frames[String(i + 1)] = {
        hex: qEnv.hex,
        visible: i < 4,
        label: b.label,
        sourceNote: `infwave:${b.fLo}-${b.fHi}Hz`,
      };
    }
    doc.frames = frames;
  }

  return doc;
}
