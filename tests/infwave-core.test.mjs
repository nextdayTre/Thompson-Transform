import test from "node:test";
import assert from "node:assert/strict";

import {
  SAFE_ZONE_LO_HZ,
  SAFE_ZONE_HI_HZ,
  defaultConfig,
  buildFreqGrid,
  rgbaToConditionedPlane,
  computeSeamDelta,
  computeEventCameraSequence,
  renderSlotAudio,
  renderTimelineAudio,
  renderStereoEventAudio,
  encodeWavMono,
  encodeWavStereo,
  decodeWavMono,
  renderStftSpectrogramRGBA,
} from "../src/core/spectral_dsp.js";

import {
  computeSnrDb,
  computeAnalyticSignal,
  extractChimeSeedTrajectory,
  buildDyadicSafeZoneBands,
  decomposeSafeZoneBands,
  quantizeSignalToHex,
  dequantizeNibblesBipolar,
  nibblesFromHex,
  synthesizeHexCarrierPcm,
  applyBitWaveTwinOp,
  exportBitWaveSchema5Project,
} from "../src/core/analytic_carrier.js";

import {
  buildShapeMorphSequence,
  buildHollowVesselSequence,
  renderBitWaveStackRGBA,
} from "../src/core/procedural_sources.js";

import {
  CROSS_TOOL_CHANNEL,
  parseCrossToolMessage,
  buildChimeFeedMessage,
  buildBitWaveCrystallizedMessage,
} from "../src/core/cross_tool_bus.js";

test("Safe-zone 500Hz-8kHz spans exactly 4.0 octaves across K=4, 8, 16 dyadic bands", () => {
  assert.equal(SAFE_ZONE_LO_HZ * 16, SAFE_ZONE_HI_HZ);

  const b8 = buildDyadicSafeZoneBands(8);
  assert.equal(b8.length, 8);
  assert.equal(b8[0].fLo, 500);
  assert.equal(b8[7].fHi, 8000);
  for (const b of b8) {
    assert.ok(Math.abs(b.fHi / b.fLo - Math.SQRT2) < 1e-3, `Expected half-octave ratio, got ${b.fHi / b.fLo}`);
  }

  const b16 = buildDyadicSafeZoneBands(16);
  assert.equal(b16.length, 16);
  const qOct = Math.pow(2, 0.25);
  for (const b of b16) {
    assert.ok(Math.abs(b.fHi / b.fLo - qOct) < 1e-3, `Expected quarter-octave ratio, got ${b.fHi / b.fLo}`);
  }
});

test("Schroeder phase crushes crest factor on dense -NEG breathing beds and preserves + / - RMS contrast", () => {
  const cfgLog = {
    ...defaultConfig("InfWave Safe-Zone (500Hz-8kHz / 48k / 24b)"),
    slotDurationS: 0.25,
    partials: 64,
    pps: 80,
    sr: 24000,
    slotGapMs: 8,
  };
  const cfgLin = { ...cfgLog, freqScale: "linear", slotGapMs: 2 };
  const freqsLog = buildFreqGrid(cfgLog);
  const freqsLin = buildFreqGrid(cfgLin);

  const seq = buildShapeMorphSequence({
    bpm: 120,
    beatsPerFrame: 0.5,
    framesPerLeg: 2,
    style: "outline",
    breathing: true,
    width: 120,
    height: 90,
  });

  const posPlane = rgbaToConditionedPlane(seq.frames[0].rgba, seq.frames[0].width, seq.frames[0].height, cfgLog, "pos", null, true);
  const negPlane = rgbaToConditionedPlane(seq.frames[1].rgba, seq.frames[1].width, seq.frames[1].height, cfgLog, "neg", null, true);

  // On equally spaced partials, zero-phase periodically sums constructively into huge crest spikes;
  // Schroeder's quadratic phase law flattens the envelope cleanly.
  const audioZero = renderSlotAudio(negPlane.plane, negPlane.P, negPlane.C, freqsLin, { ...cfgLin, phaseMode: "zero" });
  const audioSch = renderSlotAudio(negPlane.plane, negPlane.P, negPlane.C, freqsLin, { ...cfgLin, phaseMode: "schroeder" });

  const crest = (arr) => {
    let pk = 0;
    let ss = 0;
    for (let i = 0; i < arr.length; i++) {
      const a = Math.abs(arr[i]);
      if (a > pk) pk = a;
      ss += arr[i] * arr[i];
    }
    return pk / Math.sqrt(ss / arr.length);
  };

  const cZero = crest(audioZero);
  const cSch = crest(audioSch);
  assert.ok(cSch < cZero * 0.5, `Expected Schroeder crest (${cSch.toFixed(2)}) << Zero-phase crest (${cZero.toFixed(2)})`);

  // Safe-Zone log-grid breathing contrast: -NEG slot should be significantly louder than sparse +POS outline slot
  const { slotRmsDb } = renderTimelineAudio([posPlane.plane, negPlane.plane], posPlane.P, posPlane.C, freqsLog, cfgLog);
  assert.ok(slotRmsDb[1] - slotRmsDb[0] > 4.0, `Expected -NEG (${slotRmsDb[1]} dB) louder than +POS (${slotRmsDb[0]} dB)`);
});

test("4-State Endomorphic Seam Delta obeys partition of unity and exact XNOR Stroboscope Identity", () => {
  const P = 16;
  const C = 16;
  const n = P * C;
  const freqs = new Float64Array(P);
  for (let i = 0; i < P; i++) freqs[i] = 500 + i * 500;

  // Binary masks M1, M2 with known Hamming distance
  const M1 = new Float32Array(n);
  const M2 = new Float32Array(n);
  let hamming = 0;
  for (let i = 0; i < n; i++) {
    const a = i % 3 === 0 ? 1 : 0;
    const b = i % 4 === 0 ? 1 : 0;
    M1[i] = a;
    M2[i] = b;
    if (a !== b) hamming++;
  }

  // Alternating polarity seam: planeA = M1 (+POS), planeB = 1 - M2 (-NEG)
  const planeB = new Float32Array(n);
  for (let i = 0; i < n; i++) planeB[i] = 1 - M2[i];

  const delta = computeSeamDelta(M1, planeB, P, C, freqs, { title: "F0", polarity: "pos" }, { title: "F1", polarity: "neg" }, 0);
  const sumStates = delta.sustainedOn + delta.quenched + delta.ignited + delta.sustainedOff;
  assert.ok(Math.abs(sumStates - 1.0) < 1e-4, `Expected partition of unity, got ${sumStates}`);

  // Exact XNOR Stroboscope Identity: mean(|(1 - M2) - M1|) === 1 - hamming / n
  const expectedXnor = 1.0 - hamming / n;
  assert.ok(
    Math.abs(delta.rectifiedFlux - expectedXnor) < 1e-5,
    `Expected rectifiedFlux=${expectedXnor}, got ${delta.rectifiedFlux}`
  );
});

test("RIFF WAV mono/stereo encoder & decoder roundtrip across 16b, 24b, and 32f", () => {
  const sr = 24000;
  const n = 2048;
  const sig = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    sig[i] = 0.65 * Math.sin((2 * Math.PI * 1000 * i) / sr) + 0.2 * Math.sin((2 * Math.PI * 3300 * i) / sr);
  }

  for (const [bd, minSnr] of [
    [16, 85],
    [24, 130],
    [32, 140],
  ]) {
    const wav = encodeWavMono(sig, sr, bd);
    const dec = decodeWavMono(wav);
    assert.equal(dec.sampleRate, sr);
    assert.equal(dec.bitDepth, bd);
    assert.equal(dec.samples.length, n);
    const { snrDb } = computeSnrDb(sig, dec.samples);
    assert.ok(snrDb > minSnr, `WAV ${bd}-bit roundtrip SNR too low: ${snrDb} dB`);
  }

  // Stereo Event-Cam WAV check
  const wavSt = encodeWavStereo(sig, sig, sr, 16);
  const decSt = decodeWavMono(wavSt);
  assert.equal(decSt.channels, 2);
  assert.ok(computeSnrDb(sig, decSt.samples).snrDb > 85);
});

test("Discrete Hilbert Analytic Signal accurately recovers A(t) and f_inst(t) on AM+FM sine carrier", () => {
  const sr = 24000;
  const n = 4096;
  const x = new Float64Array(n);
  const trueAmp = new Float64Array(n);
  const trueFreq = new Float64Array(n);

  let phi = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const a = 0.6 + 0.25 * Math.cos(2 * Math.PI * 6 * t);
    const f = 1800 + 280 * Math.sin(2 * Math.PI * 3 * t);
    trueAmp[i] = a;
    trueFreq[i] = f;
    x[i] = a * Math.cos(phi);
    phi += (2 * Math.PI * f) / sr;
  }

  const an = computeAnalyticSignal(x, sr);
  assert.equal(an.nullCrossings, 0);

  // Check interior region (excluding 5% FFT edge transients)
  const i0 = Math.floor(n * 0.1);
  const i1 = Math.floor(n * 0.9);
  let maxAmpErr = 0;
  let maxFreqRelErr = 0;
  for (let i = i0; i < i1; i++) {
    maxAmpErr = Math.max(maxAmpErr, Math.abs(an.amplitude[i] - trueAmp[i]));
    maxFreqRelErr = Math.max(maxFreqRelErr, Math.abs(an.instFreqHz[i] - trueFreq[i]) / trueFreq[i]);
  }
  assert.ok(maxAmpErr < 0.025, `Hilbert amplitude error too large: ${maxAmpErr}`);
  assert.ok(maxFreqRelErr < 0.02, `Hilbert instFreq relative error too large: ${maxFreqRelErr}`);
});

test("End-to-End Infinite Compassion Loop: Hollow Vessel -> Safe-Zone WAV -> Tier A Chime & Tier B 8-Band Filterbank", () => {
  const cfg = {
    ...defaultConfig("Chime Floor WT Loop (500Hz-8kHz / 48k / 16b)"),
    slotDurationS: 0.2,
    partials: 64,
    pps: 80,
    sr: 24000,
    slotGapMs: 8,
  };
  const freqs = buildFreqGrid(cfg);
  const seq = buildHollowVesselSequence({ R: 0.9, r: 0.45, f: 2.0, numFrames: 4, breathing: true, width: 120, height: 90 });

  const planes = seq.frames.map((fr) =>
    rgbaToConditionedPlane(fr.rgba, fr.width, fr.height, cfg, fr.polarity, null, true).plane
  );
  const P = cfg.partials;
  const C = Math.round(cfg.slotDurationS * cfg.pps);

  // Also exercise Event-Cam stereo synthesis & STFT spectrogram
  const demodPlanes = seq.frames.map((fr) =>
    rgbaToConditionedPlane(fr.rgba, fr.width, fr.height, cfg, "pos", null, true).plane
  );
  const ev = computeEventCameraSequence(demodPlanes, P, C, { threshold: 0.04, decay: 0.4 });
  const stereoEv = renderStereoEventAudio(ev.onPlanes, ev.offPlanes, P, C, freqs, cfg);
  assert.equal(stereoEv.left.length, stereoEv.right.length);

  // Synthesize mono safe-zone WAV and decode it back
  const { audio } = renderTimelineAudio(planes, P, C, freqs, cfg);
  const wavBytes = encodeWavMono(audio, cfg.sr, 24);
  const { samples, sampleRate } = decodeWavMono(wavBytes);
  const spec = renderStftSpectrogramRGBA(samples, cfg, 160, 64);
  assert.equal(spec.rgba.length, 160 * 64 * 4);

  // Tier A: Chime hollow-sphere trajectory
  const chime = extractChimeSeedTrajectory(samples, sampleRate, { frames: 32, winSize: 512 });
  assert.equal(chime.frames.length, 32);
  for (const pt of chime.frames) {
    assert.ok(pt.R >= 0.25 - 1e-4 && pt.R <= 1.0 + 1e-4);
    assert.ok(pt.eta >= 0.1 - 1e-4 && pt.eta <= 0.88 + 1e-4);
    assert.ok(pt.volShell > 0);
  }

  // Tier B: 8-band half-octave safe-zone filterbank (exact partition of unity in-band!)
  const decomp = decomposeSafeZoneBands(samples, sampleRate, { K: 8, envPoints: 32 });
  assert.equal(decomp.bands.length, 8);
  assert.ok(
    decomp.inBandFidelity.snrDb > 120,
    `Expected near-exact partition-of-unity in-band reconstruction, got ${decomp.inBandFidelity.snrDb} dB`
  );
  assert.ok(
    decomp.fullBandFidelity.snrDb > 20,
    `Expected strong full-band safe-zone reconstruction, got ${decomp.fullBandFidelity.snrDb} dB`
  );
  const energySum = decomp.bands.reduce((acc, b) => acc + b.energyShare, 0);
  assert.ok(Math.abs(energySum - 1.0) < 1e-3, `Expected band energy shares to sum to 1, got ${energySum}`);
});

test("BitWave 0x8 Hex Codec, Twin Algebra, Carrier Synthesis & Schema-5 Project Export", () => {
  // Exact 16-nibble roundtrip (0x0..0xF) centered on 0x8 = 0.0
  const allHex = "0123456789ABCDEF";
  const nibs = nibblesFromHex(allHex);
  const bipolar = dequantizeNibblesBipolar(nibs);
  assert.equal(bipolar[8], 0.0, "Nibble 0x8 must map identically to 0.0");
  assert.equal(bipolar[0], -1.0, "Nibble 0x0 must map identically to -1.0");
  const requant = quantizeSignalToHex(bipolar, 64, { mode: "bipolar", normalize: false });
  assert.equal(requant.hex, allHex);

  // Rosetta Stone Twin identities on 64-bit register
  const H = "8ADEFEDA85210125";
  assert.equal(applyBitWaveTwinOp(applyBitWaveTwinOp(H, "not"), "not"), H);
  assert.equal(applyBitWaveTwinOp(applyBitWaveTwinOp(H, "conj"), "conj"), H);
  // Two's complement: (H + (-H)) mod 2^64 === 0
  const negH = applyBitWaveTwinOp(H, "twos");
  const sumMod = (BigInt("0x" + H) + BigInt("0x" + negH)) & ((1n << 64n) - 1n);
  assert.equal(sumMod, 0n);
  // Four 90-degree quadrature rotations return identically to H
  let q = H;
  for (let i = 0; i < 4; i++) q = applyBitWaveTwinOp(q, "quad");
  assert.equal(q, H);

  // Synthesize BitWave hex carrier at 1000Hz inside safe zone -> decompose -> export Schema-5 JSON
  const pcm = synthesizeHexCarrierPcm(H, { sr: 24000, durationSec: 0.15, carrierHz: 1000 });
  const decomp = decomposeSafeZoneBands(pcm, 24000, { K: 8, envPoints: 16 });
  const doc = exportBitWaveSchema5Project(decomp, { widthBits: 64, binop: "xor", includeFreeFrames: true });

  assert.equal(doc.schema, 5);
  assert.equal(doc.app, "bitwave");
  assert.equal(doc.N, 64);
  assert.equal(Object.keys(doc.lanes).length, 8);
  assert.equal(Object.keys(doc.frames).length, 8);
  for (let i = 1; i <= 8; i++) {
    assert.match(doc.lanes[String(i)].a, /^[0-9A-F]{16}$/);
    assert.match(doc.lanes[String(i)].b, /^[0-9A-F]{16}$/);
    assert.equal(doc.lanes[String(i)].z, undefined, "Derived Z must never be stored in BitWave docs");
    assert.match(doc.frames[String(i)].hex, /^[0-9A-F]{16}$/);
  }

  // Render BitWave stack back to spectral RGBA frame (closes BitWave -> InfWave visual path)
  const stackImg = renderBitWaveStackRGBA(
    Object.values(doc.lanes).map((l) => l.a),
    { width: 120, height: 90 }
  );
  assert.equal(stackImg.rgba.length, 120 * 90 * 4);
  assert.equal(stackImg.bandCount, 8);
});

test("Cross-Tool BroadcastChannel message codec matches Chime and BitWave contracts", () => {
  assert.equal(CROSS_TOOL_CHANNEL, "bitwave-feed");

  // 1. Chime Bow->BW outbound message parsed cleanly
  const fromChime = parseCrossToolMessage({
    type: "bitwave-chime-out",
    source: "ramanujan-chime",
    hex: "FD80038FFC80038F",
    width: 64,
    meta: { preset: 12, lambda: 0.5, kappa: 0.35, contact: true },
  });
  assert.equal(fromChime.kind, "chime-out");
  assert.equal(fromChime.width, 64);
  assert.equal(fromChime.hex, "FD80038FFC80038F");
  assert.equal(fromChime.meta.preset, 12);

  // 2. BitWave Schema-5 project feed parsed into multi-lane hex stack
  const fromBitWave = parseCrossToolMessage({
    type: "bitwave-feed",
    name: "BitWave Live",
    payload: {
      schema: 5,
      app: "bitwave",
      N: 64,
      lanes: {
        "1": { a: "8ADEFEDA85210125", b: "FFFFFFFF00000000" },
        "2": { a: "0123456789ABCDEF", b: "FEDCBA9876543210" },
      },
    },
  });
  assert.equal(fromBitWave.kind, "bitwave-project");
  assert.equal(fromBitWave.hexList.length, 2);
  assert.equal(fromBitWave.hexList[1], "0123456789ABCDEF");

  // 3. Self-echo from InfWave is ignored cleanly
  const outToChime = buildChimeFeedMessage("8ADEFEDA85210125", { name: "InfWave Test" });
  assert.equal(outToChime.type, "bitwave-feed");
  assert.equal(parseCrossToolMessage(outToChime), null);

  // 4. Outbound crystallized message conforms to Chime->BitWave schema
  const outCryst = buildBitWaveCrystallizedMessage("0x8ADEFEDA85210125", { bands: 8 });
  assert.equal(outCryst.type, "bitwave-chime-out");
  assert.equal(outCryst.hex, "8ADEFEDA85210125");
  assert.equal(outCryst.width, 64);
});
