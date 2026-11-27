import { useState, useRef, useEffect, useCallback } from "react";
import {
  PRESETS,
  defaultConfig,
  buildFreqGrid,
  rgbaToConditionedPlane,
  computeSeamDelta,
  computeEventCameraSequence,
  renderEventOnOffRGBA,
  renderSeamDeltaRGBA,
  renderTimelineAudio,
  renderStereoEventAudio,
  encodeWavMono,
  encodeWavStereo,
  decodeWavMono,
  renderStftSpectrogramRGBA,
} from "../core/spectral_dsp.js";
import {
  BITWAVE_WIDTHS,
  computeAnalyticSignal,
  extractChimeSeedTrajectory,
  decomposeSafeZoneBands,
  applyBitWaveTwinOp,
  exportBitWaveSchema5Project,
  quantizeSignalToHex,
} from "../core/analytic_carrier.js";
import {
  buildHollowVesselSequence,
  buildShapeMorphSequence,
  renderBitWaveStackRGBA,
} from "../core/procedural_sources.js";
import {
  CROSS_TOOL_CHANNEL,
  createCrossToolBus,
  captureDisplayFrames,
} from "../core/cross_tool_bus.js";

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&family=DM+Sans:wght@300;400;500;600;700&display=swap');`;

const DEFAULT_HEX_STACK = [
  "8ADEFEDA85210125",
  "FEDCBA9876543210",
  "8888FFFF88880000",
  "A5A55A5AA5A55A5A",
];

function paintRgbaToCanvas(canvas, rgba, w, h) {
  if (!canvas || !rgba) return;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const imgData = new ImageData(new Uint8ClampedArray(rgba), w, h);
  ctx.putImageData(imgData, 0, 0);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildFramesForSource({
  sourceMode,
  vesselR,
  vesselRIn,
  vesselF,
  bpm,
  frameCount,
  breathing,
  morphStyle,
  hexStackText,
  uploadedFrames,
}) {
  const slotDurationS = Number(((60 / Math.max(40, Math.min(240, bpm))) * 0.5).toFixed(4));

  if (sourceMode === "vessel") {
    return buildHollowVesselSequence({
      R: vesselR,
      r: Math.min(vesselR - 0.05, vesselRIn),
      f: vesselF,
      bpm,
      beatsPerFrame: 0.5,
      numFrames: frameCount,
      breathing,
      width: 192,
      height: 128,
    });
  }

  if (sourceMode === "morph") {
    const seq = buildShapeMorphSequence({
      bpm,
      beatsPerFrame: 0.5,
      framesPerLeg: Math.max(2, Math.min(4, Math.round(frameCount / 4))),
      style: morphStyle,
      breathing,
      width: 192,
      height: 128,
    });
    return seq;
  }

  if (sourceMode === "bitwave") {
    const lines = hexStackText
      .split(/[\r\n,]+/)
      .map((s) => s.trim().replace(/^0[xX]/, "").toUpperCase())
      .filter((s) => /^[0-9A-F]{2,}$/.test(s));
    const baseHexes = lines.length > 0 ? lines.slice(0, 8) : DEFAULT_HEX_STACK;
    const frames = [];
    for (let i = 0; i < Math.max(2, Math.min(8, frameCount)); i++) {
      // Rotate each register step-by-step so BitWave frames evolve rhythmically across slots
      const rotated = baseHexes.map((h) => {
        let cur = h;
        for (let r = 0; r < i % 4; r++) cur = applyBitWaveTwinOp(cur, "quad");
        return cur;
      });
      const img = renderBitWaveStackRGBA(rotated, { width: 192, height: 128 });
      frames.push({
        index: i,
        title: `BW Step ${i + 1} (${rotated.length}L)`,
        polarity: breathing ? (i % 2 === 0 ? "pos" : "neg") : "pos",
        ...img,
      });
    }
    return { bpm, beatsPerFrame: 0.5, slotDurationS, frames };
  }

  // Uploaded images / Tab Capture
  if (uploadedFrames && uploadedFrames.length > 0) {
    return {
      bpm,
      beatsPerFrame: 0.5,
      slotDurationS,
      frames: uploadedFrames.map((fr, idx) => ({
        ...fr,
        polarity: breathing ? (idx % 2 === 0 ? "pos" : "neg") : "pos",
      })),
    };
  }

  // Fallback to hollow vessel if upload is empty
  return buildHollowVesselSequence({
    R: vesselR,
    r: Math.min(vesselR - 0.05, vesselRIn),
    f: vesselF,
    bpm,
    beatsPerFrame: 0.5,
    numFrames: 4,
    breathing,
    width: 192,
    height: 128,
  });
}

function runInfWavePipeline({
  frames,
  slotDurationS,
  presetName,
  partials,
  synthMode,
  bitDepth,
  bandCount,
  bitWaveWidth,
  externalAudio = null,
}) {
  const baseCfg = defaultConfig(presetName);
  const cfg = {
    ...baseCfg,
    slotDurationS,
    partials,
    pps: Math.max(60, Math.min(120, Math.round(96))),
    bitDepth,
    sr: 24000, // Crisp & responsive interactive sample rate (Nyquist 12kHz > 8kHz Safe Zone!)
    fftSize: 2048,
  };

  let monoAudio;
  let stereoEvent = null;
  let sampleRate = cfg.sr;
  let slotRmsDb = [];
  let seamDeltas = [];
  let seamRgba = null;
  let eventRgba = null;
  let P = cfg.partials;
  let C = Math.max(8, Math.round(cfg.slotDurationS * cfg.pps));

  if (externalAudio && externalAudio.samples?.length > 0) {
    monoAudio = externalAudio.samples;
    sampleRate = externalAudio.sampleRate || 48000;
    cfg.sr = sampleRate;
  } else {
    const freqs = buildFreqGrid(cfg);
    const hasNeg = frames.some((f) => f.polarity === "neg");
    const planes = frames.map((fr) => {
      const pol = synthMode === "breathing" ? fr.polarity : "pos";
      const out = rgbaToConditionedPlane(fr.rgba, fr.width, fr.height, cfg, pol, null, hasNeg);
      P = out.P;
      C = out.C;
      return out.plane;
    });

    const demodPlanes = frames.map(
      (fr) => rgbaToConditionedPlane(fr.rgba, fr.width, fr.height, cfg, "pos", null, true).plane
    );

    // 4-State Endomorphic Seam Deltas
    for (let i = 0; i < planes.length - 1; i++) {
      seamDeltas.push(
        computeSeamDelta(
          planes[i],
          planes[i + 1],
          P,
          C,
          freqs,
          { title: frames[i].title, polarity: synthMode === "breathing" ? frames[i].polarity : "pos" },
          { title: frames[i + 1].title, polarity: synthMode === "breathing" ? frames[i + 1].polarity : "pos" },
          i
        )
      );
    }
    if (planes.length >= 2) {
      seamRgba = { rgba: renderSeamDeltaRGBA(planes[0], planes[1], P, C), width: C, height: P };
    }

    const ev = computeEventCameraSequence(demodPlanes, P, C, {
      threshold: 0.04,
      gain: 1.65,
      decay: 0.45,
    });
    if (ev.onPlanes.length > 0) {
      const idx = Math.min(1, ev.onPlanes.length - 1);
      eventRgba = {
        rgba: renderEventOnOffRGBA(ev.onPlanes[idx], ev.offPlanes[idx], P, C),
        width: C,
        height: P,
      };
    }

    if (synthMode === "event") {
      stereoEvent = renderStereoEventAudio(ev.onPlanes, ev.offPlanes, P, C, freqs, cfg);
      monoAudio = new Float64Array(stereoEvent.left.length);
      for (let i = 0; i < monoAudio.length; i++) {
        monoAudio[i] = 0.5 * (stereoEvent.left[i] + stereoEvent.right[i]);
      }
    } else {
      const res = renderTimelineAudio(planes, P, C, freqs, cfg);
      monoAudio = res.audio;
      slotRmsDb = res.slotRmsDb;
    }
  }

  // Decode STFT spectrogram from synthesized PCM
  const spectrogram = renderStftSpectrogramRGBA(monoAudio, cfg, 560, 180, -72);

  // Analytic Signal (Hilbert) + Tier A Chime Hollow-Sphere Trajectory
  const analytic = computeAnalyticSignal(monoAudio, sampleRate);
  const chime = extractChimeSeedTrajectory(monoAudio, sampleRate, {
    frames: 64,
    winSize: 512,
  });

  // Tier B Dyadic 500Hz-8kHz Safe-Zone Decomposition (K = 4, 8, 16)
  const decomp = decomposeSafeZoneBands(monoAudio, sampleRate, {
    K: bandCount,
    envPoints: Math.max(16, bitWaveWidth / 4),
  });

  // Crystallize BitWave Schema-5 project & primary envelope hex
  const bitwaveDoc = exportBitWaveSchema5Project(decomp, {
    widthBits: bitWaveWidth,
    binop: "xor",
    includeFreeFrames: true,
  });

  const primaryHex = quantizeSignalToHex(
    chime.frames.map((pt) => pt.ampNorm * 2 - 1),
    bitWaveWidth,
    { mode: "bipolar", normalize: true }
  ).hex;

  return {
    cfg,
    sampleRate,
    durationSec: monoAudio.length / sampleRate,
    monoAudio,
    stereoEvent,
    slotRmsDb,
    seamDeltas,
    seamRgba,
    eventRgba,
    spectrogram,
    analytic,
    chime,
    decomp,
    bitwaveDoc,
    primaryHex,
    externalLabel: externalAudio?.name || null,
  };
}

function FrameThumb({ frame }) {
  const ref = useRef(null);
  useEffect(() => {
    paintRgbaToCanvas(ref.current, frame.rgba, frame.width, frame.height);
  }, [frame]);

  const isNeg = frame.polarity === "neg";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        background: "#141414",
        border: `1px solid ${isNeg ? "#2E7ABF60" : "#3A8C3A60"}`,
        borderRadius: "6px",
        padding: "6px",
        minWidth: "112px",
      }}
    >
      <canvas
        ref={ref}
        style={{
          width: "100px",
          height: "64px",
          borderRadius: "4px",
          background: "#000",
          imageRendering: "pixelated",
          filter: isNeg ? "invert(1)" : "none",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "4px", fontSize: "9px", fontFamily: "JetBrains Mono" }}>
        <span style={{ color: "#999", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70px" }}>
          {frame.title}
        </span>
        <span style={{ color: isNeg ? "#5CA8F0" : "#4AF28A", fontWeight: 600 }}>
          {isNeg ? "−NEG" : "+POS"}
        </span>
      </div>
    </div>
  );
}

export default function InfWaveStudio() {
  // Source controls
  const [sourceMode, setSourceMode] = useState("vessel");
  const [vesselR, setVesselR] = useState(0.9);
  const [vesselRIn, setVesselRIn] = useState(0.45);
  const [vesselF, setVesselF] = useState(2.0);
  const [bpm, setBpm] = useState(120);
  const [frameCount, setFrameCount] = useState(4);
  const [breathing, setBreathing] = useState(true);
  const [morphStyle, setMorphStyle] = useState("outline");
  const [hexStackText, setHexStackText] = useState(DEFAULT_HEX_STACK.join("\n"));
  const [uploadedFrames, setUploadedFrames] = useState([]);
  const [externalAudio, setExternalAudio] = useState(null);

  // DSP & Bridge controls
  const [presetName, setPresetName] = useState("InfWave Safe-Zone (500Hz-8kHz / 48k / 24b)");
  const [synthMode, setSynthMode] = useState("breathing"); // breathing | event | mono
  const [partials, setPartials] = useState(96);
  const [bitDepth, setBitDepth] = useState(16);
  const [bandCount, setBandCount] = useState(8);
  const [bitWaveWidth, setBitWaveWidth] = useState(64);
  const [twinPreview, setTwinPreview] = useState("P");

  // Audio playback state
  const [playingTrack, setPlayingTrack] = useState(null); // null | "orig" | "tierA" | "tierB"
  const [statusNote, setStatusNote] = useState("Ready — 500 Hz–8 kHz exact 4-octave loop");
  const [capturing, setCapturing] = useState(false);

  // Cross-Tool BroadcastChannel live state
  const [busSupported, setBusSupported] = useState(false);
  const [busRxCount, setBusRxCount] = useState(0);
  const [lastBusMsg, setLastBusMsg] = useState(null);
  const busRef = useRef(null);

  // Compute initial result synchronously once (no setState inside useEffect!)
  const [sequence, setSequence] = useState(() =>
    buildFramesForSource({
      sourceMode: "vessel",
      vesselR: 0.9,
      vesselRIn: 0.45,
      vesselF: 2.0,
      bpm: 120,
      frameCount: 4,
      breathing: true,
      morphStyle: "outline",
      hexStackText: DEFAULT_HEX_STACK.join("\n"),
      uploadedFrames: [],
    })
  );

  const [result, setResult] = useState(() =>
    runInfWavePipeline({
      frames: buildFramesForSource({
        sourceMode: "vessel",
        vesselR: 0.9,
        vesselRIn: 0.45,
        vesselF: 2.0,
        bpm: 120,
        frameCount: 4,
        breathing: true,
        morphStyle: "outline",
        hexStackText: DEFAULT_HEX_STACK.join("\n"),
        uploadedFrames: [],
      }).frames,
      slotDurationS: 0.25,
      presetName: "InfWave Safe-Zone (500Hz-8kHz / 48k / 24b)",
      partials: 96,
      synthMode: "breathing",
      bitDepth: 16,
      bandCount: 8,
      bitWaveWidth: 64,
    })
  );

  // Canvas refs
  const specCanvasRef = useRef(null);
  const seamCanvasRef = useRef(null);
  const eventCanvasRef = useRef(null);
  const hullCanvasRef = useRef(null);

  // AudioContext refs
  const audioCtxRef = useRef(null);
  const audioSrcRef = useRef(null);

  // Mount BroadcastChannel('bitwave-feed') listener
  useEffect(() => {
    const bus = createCrossToolBus((msg) => {
      setBusRxCount((c) => c + 1);
      setLastBusMsg(msg);
      setStatusNote(`RX from ${msg.source}: ${msg.name} (${msg.width}b)`);
    });
    busRef.current = bus;
    const raf = requestAnimationFrame(() => setBusSupported(bus.supported));
    return () => {
      cancelAnimationFrame(raf);
      bus.close();
      busRef.current = null;
    };
  }, []);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioSrcRef.current) {
        try {
          audioSrcRef.current.stop();
        } catch {
          // ignore
        }
      }
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // Paint Spectrogram, Seam Delta, Event-Cam, and Analytic Hull Canvases
  useEffect(() => {
    if (!result) return;
    paintRgbaToCanvas(
      specCanvasRef.current,
      result.spectrogram.rgba,
      result.spectrogram.width,
      result.spectrogram.height
    );
    if (result.seamRgba && seamCanvasRef.current) {
      paintRgbaToCanvas(
        seamCanvasRef.current,
        result.seamRgba.rgba,
        result.seamRgba.width,
        result.seamRgba.height
      );
    }
    if (result.eventRgba && eventCanvasRef.current) {
      paintRgbaToCanvas(
        eventCanvasRef.current,
        result.eventRgba.rgba,
        result.eventRgba.width,
        result.eventRgba.height
      );
    }

    // Draw Tier-A Analytic Carrier Hull A(t) + PCM Waveform + Spectral Centroid f̄(t)
    const cv = hullCanvasRef.current;
    if (cv && result.monoAudio && result.analytic && result.chime) {
      const w = 560;
      const h = 150;
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#080B0E";
      ctx.fillRect(0, 0, w, h);

      // Grid lines
      ctx.strokeStyle = "#1A222A";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      for (let g = 1; g < 8; g++) {
        const gx = (g / 8) * w;
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
      }
      ctx.stroke();

      const pcm = result.monoAudio;
      const env = result.analytic.amplitude;
      const n = pcm.length;
      const spp = Math.max(1, Math.floor(n / w));

      // Raw PCM min/max columns
      ctx.strokeStyle = "#2E7ABF55";
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const s0 = x * spp;
        let mn = 0;
        let mx = 0;
        for (let k = 0; k < spp && s0 + k < n; k += Math.max(1, Math.floor(spp / 16))) {
          const v = pcm[s0 + k];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        ctx.moveTo(x, h / 2 - mx * (h * 0.44));
        ctx.lineTo(x, h / 2 - mn * (h * 0.44));
      }
      ctx.stroke();

      // Hilbert +A(t) / -A(t) envelope
      ctx.strokeStyle = "#4AF28A";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const idx = Math.min(n - 1, Math.floor((x / w) * n));
        const a = Math.min(1, env[idx]);
        const y = h / 2 - a * (h * 0.44);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.strokeStyle = "#4AF28A66";
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const idx = Math.min(n - 1, Math.floor((x / w) * n));
        const a = Math.min(1, env[idx]);
        const y = h / 2 + a * (h * 0.44);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Gabor centroid pitch trajectory (log mapped 500Hz..8kHz in amber)
      const frames = result.chime.frames;
      if (frames.length > 1) {
        ctx.strokeStyle = "#E09A4A";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < frames.length; i++) {
          const x = (i / (frames.length - 1)) * w;
          const u = Math.max(0, Math.min(1, Math.log2(Math.max(500, frames[i].centroidHz) / 500) / 4));
          const y = h - 10 - u * (h - 20);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }, [result]);

  const stopAudio = useCallback(() => {
    if (audioSrcRef.current) {
      try {
        audioSrcRef.current.stop();
      } catch {
        // ignore
      }
      audioSrcRef.current = null;
    }
    setPlayingTrack(null);
  }, []);

  const playTrack = useCallback(
    (kind) => {
      if (!result) return;
      if (playingTrack === kind) {
        stopAudio();
        return;
      }
      stopAudio();

      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      const ac = audioCtxRef.current;
      if (ac.state === "suspended") ac.resume();

      const sr = result.sampleRate;
      let abuf;
      if (kind === "orig" && result.stereoEvent) {
        abuf = ac.createBuffer(2, result.stereoEvent.left.length, sr);
        abuf.getChannelData(0).set(Float32Array.from(result.stereoEvent.left));
        abuf.getChannelData(1).set(Float32Array.from(result.stereoEvent.right));
      } else {
        const samples =
          kind === "tierA"
            ? result.chime.hullAudio
            : kind === "tierB"
              ? result.decomp.reconstructed
              : result.monoAudio;
        abuf = ac.createBuffer(1, samples.length, sr);
        abuf.getChannelData(0).set(Float32Array.from(samples));
      }

      const src = ac.createBufferSource();
      src.buffer = abuf;
      src.connect(ac.destination);
      src.onended = () => {
        audioSrcRef.current = null;
        setPlayingTrack(null);
      };
      src.start(0);
      audioSrcRef.current = src;
      setPlayingTrack(kind);
    },
    [result, playingTrack, stopAudio]
  );

  const handleSynthesize = useCallback(
    (overrides = {}) => {
      stopAudio();
      const effMode = overrides.sourceMode ?? sourceMode;
      const effExternal = overrides.externalAudio !== undefined ? overrides.externalAudio : externalAudio;
      const effHexText = overrides.hexStackText ?? hexStackText;
      const effUploaded = overrides.uploadedFrames ?? uploadedFrames;

      const seq = buildFramesForSource({
        sourceMode: effMode,
        vesselR,
        vesselRIn,
        vesselF,
        bpm,
        frameCount,
        breathing,
        morphStyle,
        hexStackText: effHexText,
        uploadedFrames: effUploaded,
      });
      setSequence(seq);

      const t0 = performance.now();
      const next = runInfWavePipeline({
        frames: seq.frames,
        slotDurationS: seq.slotDurationS,
        presetName,
        partials,
        synthMode,
        bitDepth,
        bandCount,
        bitWaveWidth,
        externalAudio: effExternal,
      });
      const dt = Math.round(performance.now() - t0);
      setResult(next);
      setStatusNote(
        `Synthesized ${next.durationSec.toFixed(2)}s @ ${next.sampleRate} Hz in ${dt} ms · Tier-B In-Band SNR ${next.decomp.inBandFidelity.snrDb} dB`
      );
    },
    [
      stopAudio,
      sourceMode,
      externalAudio,
      hexStackText,
      uploadedFrames,
      vesselR,
      vesselRIn,
      vesselF,
      bpm,
      frameCount,
      breathing,
      morphStyle,
      presetName,
      partials,
      synthMode,
      bitDepth,
      bandCount,
      bitWaveWidth,
    ]
  );

  const handleImageUpload = useCallback(
    async (ev) => {
      const files = Array.from(ev.target.files || []).slice(0, 12);
      if (files.length === 0) return;

      const loaded = [];
      for (let i = 0; i < files.length; i++) {
        const url = URL.createObjectURL(files[i]);
        try {
          const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = reject;
            el.src = url;
          });
          const cv = document.createElement("canvas");
          cv.width = 192;
          cv.height = 128;
          const ctx = cv.getContext("2d");
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, 192, 128);
          const sc = Math.min(192 / img.width, 128 / img.height);
          const dw = img.width * sc;
          const dh = img.height * sc;
          ctx.drawImage(img, (192 - dw) / 2, (128 - dh) / 2, dw, dh);
          loaded.push({
            index: i,
            title: files[i].name.slice(0, 14),
            polarity: breathing ? (i % 2 === 0 ? "pos" : "neg") : "pos",
            rgba: new Uint8ClampedArray(ctx.getImageData(0, 0, 192, 128).data),
            width: 192,
            height: 128,
          });
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      setUploadedFrames(loaded);
      setExternalAudio(null);
      setSourceMode("upload");
      handleSynthesize({ sourceMode: "upload", uploadedFrames: loaded, externalAudio: null });
    },
    [breathing, handleSynthesize]
  );

  const handleWavUpload = useCallback(
    async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const decoded = decodeWavMono(new Uint8Array(buf));
        // Trim very long WAVs to first 4s for snappy interactive Hilbert/FFT inspection
        const maxSamps = Math.min(decoded.samples.length, decoded.sampleRate * 4);
        const ext = {
          name: file.name,
          samples: decoded.samples.subarray(0, maxSamps),
          sampleRate: decoded.sampleRate,
        };
        setExternalAudio(ext);
        setSourceMode("upload");
        handleSynthesize({ sourceMode: "upload", externalAudio: ext });
      } catch (err) {
        setStatusNote(`WAV decode error: ${err.message}`);
      }
    },
    [handleSynthesize]
  );

  const handleTabCapture = useCallback(async () => {
    setCapturing(true);
    setStatusNote("Select your Ramanujan Chime or BitWave browser tab to capture…");
    try {
      const intervalMs = Math.round((60 / Math.max(40, Math.min(240, bpm))) * 500);
      const captured = await captureDisplayFrames({
        frameCount: Math.max(2, Math.min(8, frameCount)),
        intervalMs,
        width: 192,
        height: 128,
        breathing,
        onProgress: (p) => setStatusNote(`Capturing live tab… ${Math.round(p * 100)}%`),
      });
      setUploadedFrames(captured);
      setExternalAudio(null);
      setSourceMode("upload");
      handleSynthesize({ sourceMode: "upload", uploadedFrames: captured, externalAudio: null });
    } catch (err) {
      setStatusNote(`Tab capture cancelled: ${err.message}`);
    } finally {
      setCapturing(false);
    }
  }, [bpm, frameCount, breathing, handleSynthesize]);

  const handleIngestBusFeed = useCallback(() => {
    if (!lastBusMsg) return;
    const text = lastBusMsg.hexList.join("\n");
    setHexStackText(text);
    setExternalAudio(null);
    setSourceMode("bitwave");
    handleSynthesize({ sourceMode: "bitwave", hexStackText: text, externalAudio: null });
  }, [lastBusMsg, handleSynthesize]);

  const handleDownloadWav = useCallback(() => {
    if (!result) return;
    const bytes = result.stereoEvent
      ? encodeWavStereo(result.stereoEvent.left, result.stereoEvent.right, result.sampleRate, bitDepth)
      : encodeWavMono(result.monoAudio, result.sampleRate, bitDepth);
    const suffix = result.stereoEvent ? "event-stereo" : `safezone-${bitDepth}b`;
    downloadBlob(new Blob([bytes], { type: "audio/wav" }), `infwave-${sourceMode}-${suffix}.wav`);
    setStatusNote("Downloaded RIFF .WAV — drop directly into Ramanujan Chime 6·Floor WT (⇧ MP3)!");
  }, [result, bitDepth, sourceMode]);

  const handleDownloadBitWave = useCallback(() => {
    if (!result?.bitwaveDoc) return;
    const json = JSON.stringify(result.bitwaveDoc, null, 2);
    downloadBlob(new Blob([json], { type: "application/json" }), `infwave-${bandCount}band-${bitWaveWidth}b.bitwave.json`);
    setStatusNote(`Exported BitWave Schema-5 project (${Object.keys(result.bitwaveDoc.lanes).length} lanes, ${bitWaveWidth}b)`);
  }, [result, bandCount, bitWaveWidth]);

  const handleBroadcastChime = useCallback(() => {
    if (!result || !busRef.current) return;
    const okProject = busRef.current.sendToChime(result.bitwaveDoc, {
      name: `InfWave ${bandCount}B/${bitWaveWidth}b`,
    });
    const okHex = busRef.current.sendHexOut(result.primaryHex, {
      source: "infwave",
      preset: presetName,
      bands: bandCount,
      inBandSnrDb: result.decomp.inBandFidelity.snrDb,
    });
    setStatusNote(
      okProject || okHex
        ? `Broadcasted ${bitWaveWidth}b project & crystallized hex (${result.primaryHex.slice(0, 12)}…) on BroadcastChannel('${CROSS_TOOL_CHANNEL}')`
        : "BroadcastChannel unavailable in this browser context"
    );
  }, [result, bandCount, bitWaveWidth, presetName]);

  const handleCopySeed = useCallback(async () => {
    if (!result) return;
    const compactSeed = {
      app: "infwave",
      sourceMode,
      safeZoneHz: [500, 8000],
      chimeHullMean: {
        R: Number((result.chime.frames.reduce((a, f) => a + f.R, 0) / result.chime.frames.length).toFixed(4)),
        eta: Number((result.chime.frames.reduce((a, f) => a + f.eta, 0) / result.chime.frames.length).toFixed(4)),
        volShell: Number((result.chime.frames.reduce((a, f) => a + f.volShell, 0) / result.chime.frames.length).toFixed(4)),
      },
      primaryHex: result.primaryHex,
      laneHexA: Object.values(result.bitwaveDoc.lanes).map((l) => l.a),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(compactSeed, null, 2));
      setStatusNote("Copied compact Infinite Compassion seed JSON to clipboard");
    } catch {
      setStatusNote("Clipboard blocked — use Download .bitwave.json instead");
    }
  }, [result, sourceMode]);

  const meanVessel = result?.chime?.frames?.length
    ? {
        R: result.chime.frames.reduce((a, f) => a + f.R, 0) / result.chime.frames.length,
        r: result.chime.frames.reduce((a, f) => a + f.r, 0) / result.chime.frames.length,
        eta: result.chime.frames.reduce((a, f) => a + f.eta, 0) / result.chime.frames.length,
        V: result.chime.frames.reduce((a, f) => a + f.volShell, 0) / result.chime.frames.length,
        fHz: result.chime.frames.reduce((a, f) => a + f.centroidHz, 0) / result.chime.frames.length,
      }
    : null;

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: "#0D0D0D", color: "#E8E4DD", minHeight: "100vh", paddingBottom: "48px" }}>
      <style>{FONT_IMPORT}</style>

      {/* Studio Header */}
      <div style={{ padding: "32px 28px 20px", borderBottom: "1px solid #1A1A1A", display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#4AF28A", marginBottom: "8px", fontFamily: "JetBrains Mono" }}>
            THE INFINITE COMPASSION · ENDOMORPHIC LOOP WORKBENCH
          </div>
          <h1 style={{ fontSize: "24px", fontWeight: 300, margin: 0, letterSpacing: "-0.3px" }}>
            InfWave Studio — 500 Hz–8 kHz Information Wave
          </h1>
          <p style={{ fontSize: "13px", color: "#888", marginTop: "6px", maxWidth: "680px", lineHeight: 1.55 }}>
            Synthesize Chime vessels, Polar-SDF morphs, BitWave hex stacks, or live tab captures into 4-octave safe-zone PCM,
            then analyze as a Chime modulated carrier A(t)·sin(θ(t)) and BitWave 0x8 hex registers.
          </p>
        </div>

        {/* Live BroadcastChannel Pill */}
        <div style={{ background: "#111", border: "1px solid #222", borderRadius: "8px", padding: "10px 14px", fontFamily: "JetBrains Mono", fontSize: "11px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: busSupported ? "#4AF28A" : "#666" }} />
            <span style={{ color: "#CCC" }}>Bus: {CROSS_TOOL_CHANNEL}</span>
            <span style={{ color: "#666" }}>RX {busRxCount}</span>
          </div>
          {lastBusMsg ? (
            <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: "#4AF28A" }}>{lastBusMsg.name}</span>
              <button
                onClick={handleIngestBusFeed}
                style={{
                  padding: "3px 8px",
                  background: "#3A8C3A25",
                  border: "1px solid #4AF28A55",
                  borderRadius: "4px",
                  color: "#4AF28A",
                  fontSize: "10px",
                  cursor: "pointer",
                  fontFamily: "JetBrains Mono",
                }}
              >
                Use Feed
              </button>
            </div>
          ) : (
            <div style={{ marginTop: "4px", color: "#555", fontSize: "10px" }}>
              Listening for Chime Bow→BW & BitWave tabs
            </div>
          )}
        </div>
      </div>

      {/* Status Bar */}
      <div style={{ padding: "10px 28px", background: "#111", borderBottom: "1px solid #1A1A1A", fontFamily: "JetBrains Mono", fontSize: "11px", color: "#9AB", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
        <span>{statusNote}</span>
        {result && (
          <span style={{ color: "#666" }}>
            {result.durationSec.toFixed(2)}s · {result.sampleRate} Hz · {bitDepth}-bit · {bandCount} dyadic bands
          </span>
        )}
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px 28px", display: "flex", flexDirection: "column", gap: "24px" }}>
        {/* SECTION 1: SOURCE & SYNTHESIS CONTROLS */}
        <div style={{ background: "#111", border: "1px solid #1F1F1F", borderRadius: "10px", padding: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
            <span style={{ fontSize: "11px", fontFamily: "JetBrains Mono", letterSpacing: "1.5px", color: "#4AF28A" }}>
              01 // SOURCE GENERATOR & CAPTURE
            </span>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {[
                ["vessel", "Hollow Vessel (Chime)"],
                ["morph", "Polar-SDF Morph"],
                ["bitwave", "BitWave Hex Stack"],
                ["upload", "Upload / Tab Capture"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => {
                    setSourceMode(id);
                    setExternalAudio(null);
                  }}
                  style={{
                    padding: "6px 12px",
                    background: sourceMode === id ? "#1F2F24" : "#171717",
                    border: `1px solid ${sourceMode === id ? "#4AF28A66" : "#2A2A2A"}`,
                    color: sourceMode === id ? "#4AF28A" : "#888",
                    borderRadius: "5px",
                    fontSize: "11px",
                    fontFamily: "JetBrains Mono",
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Mode-specific controls */}
          {sourceMode === "vessel" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "14px", marginBottom: "16px" }}>
              <label style={{ fontSize: "11px", fontFamily: "JetBrains Mono", color: "#888" }}>
                Outer Carrier R: <strong style={{ color: "#E8E4DD" }}>{vesselR.toFixed(2)}</strong>
                <input type="range" min="0.4" max="1.0" step="0.05" value={vesselR} onChange={(e) => setVesselR(Number(e.target.value))} style={{ width: "100%", accentColor: "#4AF28A" }} />
              </label>
              <label style={{ fontSize: "11px", fontFamily: "JetBrains Mono", color: "#888" }}>
                Inner Cavity r: <strong style={{ color: "#E8E4DD" }}>{Math.min(vesselR - 0.05, vesselRIn).toFixed(2)}</strong> (η={(Math.min(vesselR - 0.05, vesselRIn) / vesselR).toFixed(2)})
                <input type="range" min="0.1" max="0.85" step="0.05" value={vesselRIn} onChange={(e) => setVesselRIn(Number(e.target.value))} style={{ width: "100%", accentColor: "#4AF28A" }} />
              </label>
              <label style={{ fontSize: "11px", fontFamily: "JetBrains Mono", color: "#888" }}>
                Wave Cycles f: <strong style={{ color: "#E8E4DD" }}>{vesselF.toFixed(1)}</strong>
                <input type="range" min="1" max="6" step="0.5" value={vesselF} onChange={(e) => setVesselF(Number(e.target.value))} style={{ width: "100%", accentColor: "#4AF28A" }} />
              </label>
              <label style={{ fontSize: "11px", fontFamily: "JetBrains Mono", color: "#888" }}>
                BPM: <strong style={{ color: "#E8E4DD" }}>{bpm}</strong> · Frames: <strong style={{ color: "#E8E4DD" }}>{frameCount}</strong>
                <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                  <input type="range" min="60" max="180" step="5" value={bpm} onChange={(e) => setBpm(Number(e.target.value))} style={{ flex: 1, accentColor: "#4AF28A" }} />
                  <input type="range" min="2" max="8" step="2" value={frameCount} onChange={(e) => setFrameCount(Number(e.target.value))} style={{ width: "64px", accentColor: "#4AF28A" }} />
                </div>
              </label>
            </div>
          )}

          {sourceMode === "morph" && (
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center", marginBottom: "16px", fontFamily: "JetBrains Mono", fontSize: "11px", color: "#888" }}>
              <label>
                Style:{" "}
                <select value={morphStyle} onChange={(e) => setMorphStyle(e.target.value)} style={{ background: "#1A1A1A", color: "#E8E4DD", border: "1px solid #2A2A2A", borderRadius: "4px", padding: "4px 8px" }}>
                  <option value="outline">Outline (Event-Cam Crisp)</option>
                  <option value="solid">Solid (Max Breathing Bloom)</option>
                </select>
              </label>
              <label>
                BPM: {bpm}{" "}
                <input type="range" min="60" max="180" step="5" value={bpm} onChange={(e) => setBpm(Number(e.target.value))} style={{ accentColor: "#4AF28A" }} />
              </label>
            </div>
          )}

          {sourceMode === "bitwave" && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", fontFamily: "JetBrains Mono", color: "#888", marginBottom: "6px" }}>
                1–8 BITWAVE HEX REGISTERS (ONE PER LINE, BOTTOM-UP SAFE-ZONE BANDS):
              </div>
              <textarea
                rows={4}
                value={hexStackText}
                onChange={(e) => setHexStackText(e.target.value)}
                style={{
                  width: "100%",
                  background: "#0B0B0B",
                  border: "1px solid #2A2A2A",
                  borderRadius: "6px",
                  color: "#4AF28A",
                  fontFamily: "JetBrains Mono",
                  fontSize: "12px",
                  padding: "10px",
                }}
              />
            </div>
          )}

          {sourceMode === "upload" && (
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "16px" }}>
              <label style={{ padding: "8px 14px", background: "#1A1A1A", border: "1px solid #2E7ABF66", borderRadius: "6px", color: "#5CA8F0", fontSize: "12px", fontFamily: "JetBrains Mono", cursor: "pointer" }}>
                Upload Image(s)…
                <input type="file" accept="image/*" multiple onChange={handleImageUpload} style={{ display: "none" }} />
              </label>
              <label style={{ padding: "8px 14px", background: "#1A1A1A", border: "1px solid #E09A4A66", borderRadius: "6px", color: "#E09A4A", fontSize: "12px", fontFamily: "JetBrains Mono", cursor: "pointer" }}>
                Analyze Existing .WAV…
                <input type="file" accept=".wav,audio/wav" onChange={handleWavUpload} style={{ display: "none" }} />
              </label>
              <button
                onClick={handleTabCapture}
                disabled={capturing}
                style={{
                  padding: "8px 14px",
                  background: "#1F2F24",
                  border: "1px solid #4AF28A66",
                  borderRadius: "6px",
                  color: "#4AF28A",
                  fontSize: "12px",
                  fontFamily: "JetBrains Mono",
                  cursor: capturing ? "default" : "pointer",
                }}
              >
                {capturing ? "Capturing Tab…" : "Capture Live Chime / BitWave Tab"}
              </button>
              {externalAudio && (
                <span style={{ fontSize: "11px", fontFamily: "JetBrains Mono", color: "#E09A4A" }}>
                  Loaded WAV: {externalAudio.name} ({externalAudio.sampleRate} Hz)
                </span>
              )}
            </div>
          )}

          {/* Frame Strip Preview */}
          {!externalAudio && sequence?.frames?.length > 0 && (
            <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "6px", marginBottom: "16px" }}>
              {sequence.frames.map((fr) => (
                <FrameThumb key={`${fr.index}-${fr.title}`} frame={fr} />
              ))}
            </div>
          )}

          {/* DSP Parameters Row + Synthesize CTA */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center", paddingTop: "12px", borderTop: "1px solid #1E1E1E" }}>
            <select
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              style={{ background: "#1A1A1A", color: "#E8E4DD", border: "1px solid #2A2A2A", borderRadius: "5px", padding: "7px 10px", fontSize: "11px", fontFamily: "JetBrains Mono" }}
            >
              {Object.keys(PRESETS).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>

            <select
              value={synthMode}
              onChange={(e) => setSynthMode(e.target.value)}
              style={{ background: "#1A1A1A", color: "#E8E4DD", border: "1px solid #2A2A2A", borderRadius: "5px", padding: "7px 10px", fontSize: "11px", fontFamily: "JetBrains Mono" }}
            >
              <option value="breathing">Endomorphic + / − Breathing</option>
              <option value="event">Event-Cam +ON / −OFF (Stereo)</option>
              <option value="mono">Positive Only (Mono)</option>
            </select>

            <select
              value={partials}
              onChange={(e) => setPartials(Number(e.target.value))}
              style={{ background: "#1A1A1A", color: "#E8E4DD", border: "1px solid #2A2A2A", borderRadius: "5px", padding: "7px 10px", fontSize: "11px", fontFamily: "JetBrains Mono" }}
            >
              {[64, 96, 128, 192].map((p) => (
                <option key={p} value={p}>{p} partials</option>
              ))}
            </select>

            <select
              value={bandCount}
              onChange={(e) => setBandCount(Number(e.target.value))}
              style={{ background: "#1A1A1A", color: "#E8E4DD", border: "1px solid #2A2A2A", borderRadius: "5px", padding: "7px 10px", fontSize: "11px", fontFamily: "JetBrains Mono" }}
            >
              <option value={4}>4 Octave Bands</option>
              <option value={8}>8 Half-Octave Lanes</option>
              <option value={16}>16 Quarter-Oct (F1–F16)</option>
            </select>

            <select
              value={bitWaveWidth}
              onChange={(e) => setBitWaveWidth(Number(e.target.value))}
              style={{ background: "#1A1A1A", color: "#E8E4DD", border: "1px solid #2A2A2A", borderRadius: "5px", padding: "7px 10px", fontSize: "11px", fontFamily: "JetBrains Mono" }}
            >
              {BITWAVE_WIDTHS.filter((w) => w >= 16).map((w) => (
                <option key={w} value={w}>BitWave {w}b</option>
              ))}
            </select>

            <select
              value={bitDepth}
              onChange={(e) => setBitDepth(Number(e.target.value))}
              style={{ background: "#1A1A1A", color: "#E8E4DD", border: "1px solid #2A2A2A", borderRadius: "5px", padding: "7px 10px", fontSize: "11px", fontFamily: "JetBrains Mono" }}
            >
              <option value={16}>WAV 16-bit</option>
              <option value={24}>WAV 24-bit</option>
              <option value={32}>WAV 32-bit float</option>
            </select>

            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontFamily: "JetBrains Mono", color: "#999", cursor: "pointer" }}>
              <input type="checkbox" checked={breathing} onChange={(e) => setBreathing(e.target.checked)} style={{ accentColor: "#4AF28A" }} />
              +/− Flip
            </label>

            <button
              onClick={() => handleSynthesize({ externalAudio: null })}
              style={{
                marginLeft: "auto",
                padding: "8px 18px",
                background: "#265934",
                border: "1px solid #4AF28A",
                borderRadius: "6px",
                color: "#E8FBE8",
                fontSize: "12px",
                fontFamily: "JetBrains Mono",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Synthesize & Analyze ↻
            </button>
          </div>
        </div>

        {/* SECTION 2: SPECTROGRAM, SEAM DELTA & A/B/C LISTENING */}
        {result && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "20px" }}>
            {/* Left: STFT Spectrogram & Transport */}
            <div style={{ background: "#111", border: "1px solid #1F1F1F", borderRadius: "10px", padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <span style={{ fontSize: "11px", fontFamily: "JetBrains Mono", letterSpacing: "1.5px", color: "#4AF28A" }}>
                  02 // DECODED STFT SPECTROGRAM ({result.cfg.fMinHz}–{result.cfg.fMaxHz} Hz)
                </span>
              </div>

              <canvas
                ref={specCanvasRef}
                style={{ width: "100%", height: "auto", borderRadius: "6px", border: "1px solid #222", background: "#000", display: "block" }}
              />

              {/* A/B/C Audition Transport */}
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
                {[
                  ["orig", result.stereoEvent ? "▶ Play Event Stereo" : "▶ Play Safe-Zone PCM", "#4AF28A"],
                  ["tierA", "▶ Play Tier-A 1-Carrier Hull", "#E09A4A"],
                  ["tierB", `▶ Play Tier-B ${bandCount}-Band Bus`, "#5CA8F0"],
                ].map(([key, label, col]) => {
                  const active = playingTrack === key;
                  return (
                    <button
                      key={key}
                      onClick={() => playTrack(key)}
                      style={{
                        padding: "7px 12px",
                        background: active ? `${col}30` : "#181818",
                        border: `1px solid ${active ? col : "#2A2A2A"}`,
                        borderRadius: "5px",
                        color: active ? col : "#BBB",
                        fontSize: "11px",
                        fontFamily: "JetBrains Mono",
                        cursor: "pointer",
                      }}
                    >
                      {active ? "■ Stop" : label}
                    </button>
                  );
                })}
              </div>

              {/* Slot RMS Breathing Telemetry */}
              {result.slotRmsDb.length > 0 && (
                <div style={{ marginTop: "12px", fontSize: "10px", fontFamily: "JetBrains Mono", color: "#777", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <span>SLOT RMS:</span>
                  {result.slotRmsDb.map((db, idx) => (
                    <span key={idx} style={{ color: idx % 2 === 1 && breathing ? "#5CA8F0" : "#4AF28A" }}>
                      #{idx + 1} {db} dB
                    </span>
                  ))}
                </div>
              )}

              {/* Seam Delta & Event-Cam Mini Previews */}
              {(result.seamRgba || result.eventRgba) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "14px" }}>
                  {result.seamRgba && (
                    <div>
                      <div style={{ fontSize: "10px", fontFamily: "JetBrains Mono", color: "#666", marginBottom: "4px" }}>
                        4-STATE SEAM DELTA (0→1)
                      </div>
                      <canvas ref={seamCanvasRef} style={{ width: "100%", height: "72px", borderRadius: "4px", border: "1px solid #222", imageRendering: "pixelated" }} />
                      {result.seamDeltas[0] && (
                        <div style={{ fontSize: "9px", fontFamily: "JetBrains Mono", color: "#888", marginTop: "4px" }}>
                          XNOR Flux: {result.seamDeltas[0].rectifiedFlux.toFixed(3)} · Δf: {result.seamDeltas[0].centroidDeltaHz} Hz
                        </div>
                      )}
                    </div>
                  )}
                  {result.eventRgba && (
                    <div>
                      <div style={{ fontSize: "10px", fontFamily: "JetBrains Mono", color: "#666", marginBottom: "4px" }}>
                        EVENT-CAM (+ON CYAN / −OFF AMBER)
                      </div>
                      <canvas ref={eventCanvasRef} style={{ width: "100%", height: "72px", borderRadius: "4px", border: "1px solid #222", imageRendering: "pixelated" }} />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right: Tier-A Analytic Carrier Hull A(t)·sin(θ(t)) */}
            <div style={{ background: "#111", border: "1px solid #1F1F1F", borderRadius: "10px", padding: "20px" }}>
              <div style={{ fontSize: "11px", fontFamily: "JetBrains Mono", letterSpacing: "1.5px", color: "#E09A4A", marginBottom: "12px" }}>
                03 // TIER-A CHIME ANALYTIC HULL · P(t) = V(t)·e^(iθ(t))
              </div>

              <canvas
                ref={hullCanvasRef}
                style={{ width: "100%", height: "auto", borderRadius: "6px", border: "1px solid #222", display: "block" }}
              />
              <div style={{ fontSize: "10px", fontFamily: "JetBrains Mono", color: "#666", marginTop: "6px", display: "flex", gap: "14px", flexWrap: "wrap" }}>
                <span><span style={{ color: "#2E7ABF" }}>■</span> Raw PCM</span>
                <span><span style={{ color: "#4AF28A" }}>━</span> Hilbert Envelope ±A(t)</span>
                <span><span style={{ color: "#E09A4A" }}>━</span> Gabor Centroid f̄(t)</span>
              </div>

              {meanVessel && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginTop: "14px" }}>
                  {[
                    ["MEAN VESSEL R / r", `${meanVessel.R.toFixed(2)} / ${meanVessel.r.toFixed(2)}`, "#4AF28A"],
                    ["CAVITY RATIO η", `${meanVessel.eta.toFixed(3)} (V=${meanVessel.V.toFixed(2)})`, "#5CA8F0"],
                    ["MEAN CENTROID", `${Math.round(meanVessel.fHz)} Hz`, "#E09A4A"],
                    ["1-CARRIER SNR", `${result.chime.fidelity.snrDb} dB`, "#E09A4A"],
                    ["TIER-B IN-BAND SNR", `${result.decomp.inBandFidelity.snrDb} dB`, "#4AF28A"],
                    ["NULL SENTINELS", `${result.analytic.nullCrossings}`, "#AAA"],
                  ].map(([label, val, col]) => (
                    <div key={label} style={{ background: "#0B0B0B", border: "1px solid #1E1E1E", borderRadius: "6px", padding: "10px" }}>
                      <div style={{ fontSize: "9px", fontFamily: "JetBrains Mono", color: "#666", marginBottom: "4px" }}>{label}</div>
                      <div style={{ fontSize: "13px", fontFamily: "JetBrains Mono", color: col, fontWeight: 600 }}>{val}</div>
                    </div>
                  ))}
                </div>
              )}

              <p style={{ fontSize: "11px", color: "#777", lineHeight: 1.55, marginTop: "12px", marginBottom: 0 }}>
                <strong style={{ color: "#AAA" }}>Bedrosian Honesty:</strong> A single carrier A(t)·sin(θ(t)) captures macro breathing
                and centroid motion cleanly, while broadband 2D images decompose accurately across the Tier-B{" "}
                <strong style={{ color: "#4AF28A" }}>{bandCount}-band</strong> dyadic bus ({result.decomp.inBandFidelity.snrDb} dB in-band partition of unity).
              </p>
            </div>
          </div>
        )}

        {/* SECTION 3: TIER-B SAFE-ZONE DYADIC BANDS & BITWAVE HEX BRIDGE */}
        {result && (
          <div style={{ background: "#111", border: "1px solid #1F1F1F", borderRadius: "10px", padding: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
              <span style={{ fontSize: "11px", fontFamily: "JetBrains Mono", letterSpacing: "1.5px", color: "#5CA8F0" }}>
                04 // TIER-B DYADIC SAFE-ZONE BUS (500 Hz–8 kHz) & BITWAVE 0x8 REGISTERS
              </span>
              <div style={{ display: "flex", gap: "6px", alignItems: "center", fontFamily: "JetBrains Mono", fontSize: "10px" }}>
                <span style={{ color: "#666" }}>TWIN OP:</span>
                {[
                  ["P", "P"],
                  ["not", "~P NOT"],
                  ["twos", "−P 2'sC"],
                  ["conj", "P̄ Mirror"],
                  ["quad", "90° ROTR"],
                ].map(([op, label]) => (
                  <button
                    key={op}
                    onClick={() => setTwinPreview(op)}
                    style={{
                      padding: "4px 8px",
                      background: twinPreview === op ? "#1B2A3A" : "#171717",
                      border: `1px solid ${twinPreview === op ? "#5CA8F088" : "#2A2A2A"}`,
                      color: twinPreview === op ? "#5CA8F0" : "#888",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontFamily: "JetBrains Mono",
                      fontSize: "10px",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Band Energy Bars */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: "8px", marginBottom: "16px" }}>
              {result.decomp.bands.slice(0, 8).map((b) => {
                const pct = Math.min(100, Math.round(b.energyShare * 100 * 2.5));
                return (
                  <div key={b.index} style={{ background: "#0B0B0B", border: "1px solid #1E1E1E", borderRadius: "6px", padding: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", fontFamily: "JetBrains Mono" }}>
                      <span style={{ color: "#5CA8F0" }}>L{b.index + 1}</span>
                      <span style={{ color: "#777" }}>{(b.energyShare * 100).toFixed(1)}%</span>
                    </div>
                    <div style={{ height: "42px", background: "#141414", borderRadius: "3px", display: "flex", alignItems: "flex-end", overflow: "hidden" }}>
                      <div style={{ width: "100%", height: `${Math.max(4, pct)}%`, background: "linear-gradient(180deg, #4AF28A, #2E7ABF)" }} />
                    </div>
                    <div style={{ fontSize: "9px", fontFamily: "JetBrains Mono", color: "#888", textAlign: "center" }}>
                      {b.label}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Crystallized BitWave Hex Lanes Table */}
            <div style={{ overflowX: "auto", marginBottom: "18px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", fontFamily: "JetBrains Mono" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #222", color: "#666", textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>LANE</th>
                    <th style={{ padding: "6px 8px" }}>SAFE-ZONE BAND</th>
                    <th style={{ padding: "6px 8px" }}>IN-PHASE A ({twinPreview})</th>
                    <th style={{ padding: "6px 8px" }}>QUADRATURE B (90°)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(result.bitwaveDoc.lanes).map(([key, ln], idx) => {
                    const band = result.decomp.bands[idx];
                    const shownA = applyBitWaveTwinOp(ln.a, twinPreview);
                    return (
                      <tr key={key} style={{ borderBottom: "1px solid #181818" }}>
                        <td style={{ padding: "6px 8px", color: "#5CA8F0", whiteSpace: "nowrap" }}>L{key}</td>
                        <td style={{ padding: "6px 8px", color: "#888", whiteSpace: "nowrap" }}>
                          {band ? `${Math.round(band.fLo)}–${Math.round(band.fHi)} Hz` : "—"}
                        </td>
                        <td style={{ padding: "6px 8px", color: "#4AF28A", whiteSpace: "nowrap" }}>{shownA}</td>
                        <td style={{ padding: "6px 8px", color: "#E09A4A", whiteSpace: "nowrap" }}>{ln.b}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Cross-Tool Handoff Action Bar */}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", paddingTop: "14px", borderTop: "1px solid #1E1E1E" }}>
              <button
                onClick={handleDownloadWav}
                style={{
                  padding: "9px 16px",
                  background: "#1B3322",
                  border: "1px solid #4AF28A77",
                  borderRadius: "6px",
                  color: "#4AF28A",
                  fontSize: "12px",
                  fontFamily: "JetBrains Mono",
                  cursor: "pointer",
                }}
              >
                ⬇ Download .WAV (Chime 6·Floor WT)
              </button>
              <button
                onClick={handleDownloadBitWave}
                style={{
                  padding: "9px 16px",
                  background: "#162638",
                  border: "1px solid #5CA8F077",
                  borderRadius: "6px",
                  color: "#5CA8F0",
                  fontSize: "12px",
                  fontFamily: "JetBrains Mono",
                  cursor: "pointer",
                }}
              >
                ⬇ Export .bitwave.json (Schema 5)
              </button>
              <button
                onClick={handleBroadcastChime}
                style={{
                  padding: "9px 16px",
                  background: "#2D2214",
                  border: "1px solid #E09A4A77",
                  borderRadius: "6px",
                  color: "#E09A4A",
                  fontSize: "12px",
                  fontFamily: "JetBrains Mono",
                  cursor: "pointer",
                }}
              >
                📡 Broadcast Live to Chime / BitWave
              </button>
              <button
                onClick={handleCopySeed}
                style={{
                  padding: "9px 16px",
                  background: "#181818",
                  border: "1px solid #333",
                  borderRadius: "6px",
                  color: "#CCC",
                  fontSize: "12px",
                  fontFamily: "JetBrains Mono",
                  cursor: "pointer",
                }}
              >
                📋 Copy Compact Seed JSON
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
