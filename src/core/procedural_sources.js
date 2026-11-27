// InfWave Procedural Visual & Parametric Seed Generators (Pure-JS, Zero-DOM)
// Deterministically renders RGBA frames directly from compact parametric recipes:
//  1. Polar-SDF Shape Morph (`Triangle -> Circle -> Triangle -> Square -> Loop`)
//  2. Hollow-Vessel Seed Sequence (`V = 4/3·π(R³ - r³)`, `λ`, `κ`) for Chime -> InfWave synthesis
//  3. BitWave Hex Register Stack -> Spectral Image Frame (BitWave -> InfWave synthesis)

import { nibblesFromHex, computeCyclicSlopes, sampleMonotoneBipolar } from "./analytic_carrier.js";

// ---------------------------------------------------------------------------
// 1. Polar-SDF Shape Morph (BPM-synced Endomorphic Litmus Test)
// ---------------------------------------------------------------------------
function polarRadius(shape, theta) {
  if (shape === "circle") return 0.78;
  if (shape === "triangle") {
    const sector = (2 * Math.PI) / 3;
    let a = (theta + Math.PI / 2) % sector;
    if (a < 0) a += sector;
    const d = a - sector / 2;
    return (Math.cos(Math.PI / 3) / Math.max(0.15, Math.cos(d))) * 1.12;
  }
  if (shape === "square") {
    const sector = Math.PI / 2;
    let a = (theta + Math.PI / 4) % sector;
    if (a < 0) a += sector;
    const d = a - sector / 2;
    return (Math.cos(Math.PI / 4) / Math.max(0.2, Math.cos(d))) * 0.96;
  }
  return 0.78;
}

export function renderShapeMorphFrameRGBA({
  shapeA = "triangle",
  shapeB = "circle",
  t = 0.0,
  style = "outline",
  width = 240,
  height = 180,
} = {}) {
  const s = Math.max(0, Math.min(1, Number(t) || 0));
  const ease = s * s * (3 - 2 * s);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;

  const cx = width * 0.5;
  const cy = height * 0.52;
  const baseR = Math.min(width, height) * 0.4;
  const strokeHalf = style === "outline" ? 0.085 : 0.0;

  for (let y = 0; y < height; y++) {
    const dy = (y - cy) / baseR;
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / baseR;
      const dist = Math.hypot(dx, dy);
      const theta = Math.atan2(dy, dx);
      const rTarget = (1 - ease) * polarRadius(shapeA, theta) + ease * polarRadius(shapeB, theta);

      let intensity = 0.0;
      if (style === "solid") {
        const edge = rTarget - dist;
        if (edge > 0.03) intensity = 1.0;
        else if (edge > -0.03) intensity = (edge + 0.03) / 0.06;
      } else {
        const dLine = Math.abs(dist - rTarget);
        if (dLine < strokeHalf) intensity = 1.0;
        else if (dLine < strokeHalf + 0.045) intensity = 1.0 - (dLine - strokeHalf) / 0.045;
        if (dist < 0.06) intensity = Math.max(intensity, 0.85);
      }

      if (intensity > 0.01) {
        const o = (rowOff + x) * 4;
        rgba[o] = Math.round(intensity * 115);
        rgba[o + 1] = Math.round(intensity * 255);
        rgba[o + 2] = Math.round(intensity * 105);
      }
    }
  }
  return { rgba, width, height };
}

export function buildShapeMorphSequence({
  bpm = 120,
  beatsPerFrame = 0.5,
  framesPerLeg = 3,
  style = "outline",
  breathing = true,
  width = 240,
  height = 180,
} = {}) {
  const bpmClamped = Math.max(40, Math.min(240, Number(bpm) || 120));
  const bpf = Math.max(0.25, Math.min(4.0, Number(beatsPerFrame) || 0.5));
  const fpl = Math.max(2, Math.min(8, Math.round(Number(framesPerLeg) || 3)));
  const slotDurationS = Number(((60.0 / bpmClamped) * bpf).toFixed(4));

  const legs = [
    ["triangle", "circle", "Tri->Cir"],
    ["circle", "triangle", "Cir->Tri"],
    ["triangle", "square", "Tri->Sq"],
    ["square", "triangle", "Sq->Tri"],
  ];

  const frames = [];
  let idx = 0;
  for (const [a, b, tag] of legs) {
    for (let step = 0; step < fpl; step++) {
      const t = step / fpl;
      const grid = renderShapeMorphFrameRGBA({ shapeA: a, shapeB: b, t, style, width, height });
      const polarity = breathing ? (idx % 2 === 0 ? "pos" : "neg") : "pos";
      frames.push({
        index: idx,
        title: `${tag} #${step + 1}`,
        polarity,
        ...grid,
      });
      idx++;
    }
  }
  return { bpm: bpmClamped, beatsPerFrame: bpf, slotDurationS, frames };
}

// ---------------------------------------------------------------------------
// 2. Parametric Chime Hollow-Vessel + Harmor Void Collapse Sequence
// ---------------------------------------------------------------------------
/**
 * Render a deterministic 2D spectrogram-ready frame from a Ramanujan Chime hollow-vessel seed:
 *  - Concentric annular ring between inner cavity r and outer carrier R (collapses smoothly via lambda in [0,1])
 *  - Overlaid quadrature carrier curve y(x) = A·sin(2π f x + phase)
 */
export function renderHollowVesselFrameRGBA({
  R = 0.9,
  r = 0.45,
  f = 2.0,
  phase = 0.0,
  lambda = 0.0,
  width = 240,
  height = 180,
} = {}) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;

  const lam = Math.max(0, Math.min(1, Number(lambda) || 0));
  const rOut = Math.max(0.15, Math.min(1.0, Number(R) || 0.9));
  const rIn = Math.max(0.0, Math.min(rOut - 0.02, Number(r) || 0.45));
  const cx = width * 0.5;
  const cy = height * 0.5;
  const scale = Math.min(width, height) * 0.44;

  for (let y = 0; y < height; y++) {
    const ny = (cy - y) / scale;
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const nx = (x - cx) / scale;
      const u = x / Math.max(1, width - 1);

      // 3D annular vessel fades out as lambda -> 1 (Harmor Void Collapse into 2D wave)
      const rho = Math.hypot(nx, ny);
      const effIn = rIn + lam * (rOut - rIn);
      const dOut = Math.abs(rho - rOut);
      const dIn = Math.abs(rho - effIn);
      const ring = (1 - lam * 0.85) * Math.max(Math.exp(-Math.pow(dOut / 0.05, 2)), 0.75 * Math.exp(-Math.pow(dIn / 0.045, 2)));

      // 2D modulated carrier wave grows crisper as lambda -> 1
      const env = rOut * (1 - 0.25 * (1 - lam) * Math.pow(2 * u - 1, 2));
      const yWave = env * Math.sin(2 * Math.PI * f * u + phase);
      const dWave = Math.abs(ny - yWave);
      const wave = (0.35 + 0.65 * lam) * Math.exp(-Math.pow(dWave / 0.06, 2));

      const v = Math.min(1, Math.max(ring, wave));
      if (v > 0.01) {
        const o = (rowOff + x) * 4;
        rgba[o] = Math.round(v * (60 + 80 * (1 - lam)));
        rgba[o + 1] = Math.round(v * 255);
        rgba[o + 2] = Math.round(v * (140 + 90 * (1 - lam)));
      }
    }
  }

  return { rgba, width, height };
}

export function buildHollowVesselSequence({
  R = 0.9,
  r = 0.45,
  f = 2.0,
  bpm = 120,
  beatsPerFrame = 0.5,
  numFrames = 8,
  breathing = true,
  width = 240,
  height = 180,
} = {}) {
  const N = Math.max(2, Math.min(32, Math.round(numFrames)));
  const slotDurationS = Number(((60.0 / Math.max(40, Math.min(240, bpm))) * beatsPerFrame).toFixed(4));
  const frames = [];
  for (let i = 0; i < N; i++) {
    const u = i / N;
    const phase = u * 2 * Math.PI;
    // Sweep Harmor Void collapse lambda cleanly 0 -> 1 -> 0 across the cycle
    const lambda = 0.5 - 0.5 * Math.cos(u * 2 * Math.PI);
    const grid = renderHollowVesselFrameRGBA({ R, r, f, phase, lambda, width, height });
    frames.push({
      index: i,
      title: `Vessel λ=${lambda.toFixed(2)}`,
      polarity: breathing ? (i % 2 === 0 ? "pos" : "neg") : "pos",
      lambda: Number(lambda.toFixed(4)),
      phase: Number(phase.toFixed(4)),
      ...grid,
    });
  }
  return { bpm, beatsPerFrame, slotDurationS, frames };
}

// ---------------------------------------------------------------------------
// 3. BitWave Hex Register Stack -> Spectral Image RGBA
// ---------------------------------------------------------------------------
/**
 * Render an array of BitWave hex registers (e.g. 1..8 lanes or F1..F16) as a spectrogram-ready
 * RGBA frame: each register forms a horizontal harmonic band (bottom-up), modulated smoothly
 * across X by its cyclic Fritsch-Carlson monotone-cubic spline.
 */
export function renderBitWaveStackRGBA(hexList, { width = 240, height = 180 } = {}) {
  const list = Array.isArray(hexList) && hexList.length > 0 ? hexList : ["8ADEFEDA85210125"];
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;

  const parsed = list.map((h) => {
    const nibs = nibblesFromHex(h);
    const safe = nibs.length ? nibs : [8, 8];
    return { nibs: safe, slopes: computeCyclicSlopes(safe) };
  });

  const K = parsed.length;
  for (let y = 0; y < height; y++) {
    // Bottom-anchored: row 0 (low Hz) at bottom of image, row K-1 (high Hz) at top
    const bandPos = (1.0 - (y + 0.5) / height) * K;
    const bIdx = Math.max(0, Math.min(K - 1, Math.floor(bandPos)));
    const localY = bandPos - bIdx; // [0, 1] inside the band
    const bandGate = Math.sin(Math.PI * localY); // crisp separation between lanes
    const { nibs, slopes } = parsed[bIdx];
    const rowOff = y * width;

    for (let x = 0; x < width; x++) {
      const u = x / Math.max(1, width - 1);
      const bipolar = sampleMonotoneBipolar(nibs, u, slopes); // [-1, +0.875]
      const mag = Math.max(0, Math.min(1, (bipolar + 1.0) * 0.5)) * (0.25 + 0.75 * bandGate);
      const o = (rowOff + x) * 4;
      rgba[o] = Math.round(mag * 90);
      rgba[o + 1] = Math.round(mag * 255);
      rgba[o + 2] = Math.round(mag * 135);
    }
  }

  return { rgba, width, height, bandCount: K };
}
