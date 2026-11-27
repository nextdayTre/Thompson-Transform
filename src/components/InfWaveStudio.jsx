import { useState, useRef, useEffect, useCallback } from "react";
import "./InfWaveStudio.css";
import {
  PRESETS,
  defaultConfig,
  buildFreqGrid,
  rgbaToConditionedPlane,
  computeSeamDelta,
  computeEventCameraSequence,
  renderPlaneGreenRGBA,
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

const DEFAULT_HEX_STACK = [
  "8ADEFEDA85210125",
  "FEDCBA9876543210",
  "8888FFFF88880000",
  "A5A55A5AA5A55A5A",
];

let nextClipUid = 1;
function makeUid(prefix) {
  return `${prefix}-${nextClipUid++}`;
}

function paintRgba(canvas, rgba, w, h) {
  if (!canvas || !rgba) return;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
}

function paintScaledRgba(canvas, rgba, srcW, srcH, dstW = 540, dstH = 360) {
  if (!canvas || !rgba) return;
  const tmp = document.createElement("canvas");
  tmp.width = srcW;
  tmp.height = srcH;
  tmp.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba), srcW, srcH), 0, 0);
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, dstW, dstH);
  ctx.drawImage(tmp, 0, 0, dstW, dstH);
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

function makeMediaAndClipsFromFrames(frames, breathing) {
  const media = [];
  const clips = [];
  for (let i = 0; i < frames.length; i++) {
    const fr = frames[i];
    const mId = makeUid("m");
    media.push({
      id: mId,
      title: fr.title || `Frame #${i + 1}`,
      rgba: fr.rgba,
      width: fr.width,
      height: fr.height,
    });
    clips.push({
      id: makeUid("c"),
      mediaId: mId,
      title: fr.title || `Frame #${i + 1}`,
      polarity: breathing ? (i % 2 === 0 ? "pos" : "neg") : fr.polarity || "pos",
      rgba: fr.rgba,
      width: fr.width,
      height: fr.height,
    });
  }
  return { media, clips };
}

function synthesizeTimeline({
  clips,
  slotDurationS,
  presetName,
  partials,
  condMode,
  synthMode,
  bitDepth,
  bandCount,
  bitWaveWidth,
  externalAudio = null,
}) {
  const baseCfg = defaultConfig(presetName);
  const cfg = {
    ...baseCfg,
    slotDurationS: Math.max(0.1, Math.min(4.0, Number(slotDurationS) || 0.25)),
    partials: Math.max(32, Math.min(256, Number(partials) || 96)),
    condMode: condMode || "raw",
    pps: 96,
    bitDepth,
    sr: 24000, // Crisp Nyquist 12 kHz > 8 kHz Safe Zone with instant interactive render
    fftSize: 2048,
  };

  let monoAudio;
  let stereoEvent = null;
  let sampleRate = cfg.sr;
  let slotRmsDb = [];
  const seamDeltas = [];
  const seamPreviews = [];
  const clipPlanes = [];
  const eventPreviews = [];
  let P = cfg.partials;
  let C = Math.max(8, Math.round(cfg.slotDurationS * cfg.pps));

  if (externalAudio && externalAudio.samples?.length > 0) {
    monoAudio = externalAudio.samples;
    sampleRate = externalAudio.sampleRate || 48000;
    cfg.sr = sampleRate;
  } else if (clips.length === 0) {
    monoAudio = new Float64Array(Math.round(cfg.sr * 0.25));
  } else {
    const freqs = buildFreqGrid(cfg);
    const hasNeg = clips.some((c) => c.polarity === "neg");

    const planes = clips.map((cl) => {
      const pol = synthMode === "breathing" ? cl.polarity : "pos";
      const out = rgbaToConditionedPlane(cl.rgba, cl.width, cl.height, cfg, pol, condMode, hasNeg);
      P = out.P;
      C = out.C;
      clipPlanes.push({ rgba: renderPlaneGreenRGBA(out.plane, P, C), width: C, height: P });
      return out.plane;
    });

    const demodPlanes = clips.map(
      (cl) => rgbaToConditionedPlane(cl.rgba, cl.width, cl.height, cfg, "pos", condMode, true).plane
    );

    for (let i = 0; i < planes.length - 1; i++) {
      seamDeltas.push(
        computeSeamDelta(
          planes[i],
          planes[i + 1],
          P,
          C,
          freqs,
          { title: clips[i].title, polarity: synthMode === "breathing" ? clips[i].polarity : "pos" },
          { title: clips[i + 1].title, polarity: synthMode === "breathing" ? clips[i + 1].polarity : "pos" },
          i
        )
      );
      seamPreviews.push({
        rgba: renderSeamDeltaRGBA(planes[i], planes[i + 1], P, C),
        width: C,
        height: P,
      });
    }

    const ev = computeEventCameraSequence(demodPlanes, P, C, {
      threshold: 0.04,
      gain: 1.65,
      decay: 0.45,
    });
    for (let i = 0; i < ev.onPlanes.length; i++) {
      eventPreviews.push({
        rgba: renderEventOnOffRGBA(ev.onPlanes[i], ev.offPlanes[i], P, C),
        width: C,
        height: P,
        motion: ev.frameMotionScores[i],
      });
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

  const spectrogram = renderStftSpectrogramRGBA(monoAudio, cfg, 760, 260, -72);
  const analytic = computeAnalyticSignal(monoAudio, sampleRate);
  const chime = extractChimeSeedTrajectory(monoAudio, sampleRate, { frames: 64, winSize: 512 });
  const decomp = decomposeSafeZoneBands(monoAudio, sampleRate, {
    K: bandCount,
    envPoints: Math.max(16, bitWaveWidth / 4),
  });
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
    clipPlanes,
    seamDeltas,
    seamPreviews,
    eventPreviews,
    spectrogram,
    analytic,
    chime,
    decomp,
    bitwaveDoc,
    primaryHex,
    externalLabel: externalAudio?.name || null,
  };
}

function ThumbCanvas({ rgba, width, height, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    paintRgba(ref.current, rgba, width, height);
  }, [rgba, width, height]);
  return <canvas ref={ref} className={className} />;
}

let cachedInitialStudio = null;
function getInitialStudioData() {
  if (!cachedInitialStudio) {
    const seq = buildHollowVesselSequence({
      R: 0.9,
      r: 0.45,
      f: 2.0,
      bpm: 120,
      beatsPerFrame: 0.5,
      numFrames: 4,
      breathing: true,
      width: 192,
      height: 128,
    });
    const { media, clips } = makeMediaAndClipsFromFrames(seq.frames, true);
    const res = synthesizeTimeline({
      clips,
      slotDurationS: seq.slotDurationS,
      presetName: "InfWave Safe-Zone (500Hz-8kHz / 48k / 24b)",
      partials: 96,
      condMode: "raw",
      synthMode: "breathing",
      bitDepth: 16,
      bandCount: 8,
      bitWaveWidth: 64,
    });
    cachedInitialStudio = { media, clips, slotDurationS: seq.slotDurationS, res };
  }
  return cachedInitialStudio;
}

export default function InfWaveStudio({ onSwitchView }) {
  // Media Bay & Interactive Timeline State
  const [mediaItems, setMediaItems] = useState(() => getInitialStudioData().media);
  const [clips, setClips] = useState(() => getInitialStudioData().clips);
  const [selectedClipIdx, setSelectedClipIdx] = useState(0);
  const [selectedSeamIdx, setSelectedSeamIdx] = useState(0);
  const [dragClipIdx, setDragClipIdx] = useState(null);
  const [mediaDragOver, setMediaDragOver] = useState(false);

  // Monitor & Dock Tabs
  const [monTab, setMonTab] = useState("stft"); // stft | hull | bus | clip | seam | event
  const [dockTab, setDockTab] = useState("vessel"); // vessel | bitwave | dsp | deltas | export

  // Generator & DSP Config State
  const [vesselR, setVesselR] = useState(0.9);
  const [vesselRIn, setVesselRIn] = useState(0.45);
  const [vesselF, setVesselF] = useState(2.0);
  const [bpm, setBpm] = useState(120);
  const [frameCount, setFrameCount] = useState(4);
  const [morphStyle, setMorphStyle] = useState("outline");
  const [hexStackText, setHexStackText] = useState(DEFAULT_HEX_STACK.join("\n"));

  const [breathing, setBreathing] = useState(true);
  const [synthMode, setSynthMode] = useState("breathing"); // breathing | event | mono
  const [presetName, setPresetName] = useState("InfWave Safe-Zone (500Hz-8kHz / 48k / 24b)");
  const [slotDurationS, setSlotDurationS] = useState(() => getInitialStudioData().slotDurationS);
  const [partials, setPartials] = useState(96);
  const [condMode, setCondMode] = useState("raw");
  const [bitDepth, setBitDepth] = useState(16);
  const [bandCount, setBandCount] = useState(8);
  const [bitWaveWidth, setBitWaveWidth] = useState(64);
  const [twinOp, setTwinOp] = useState("P");
  const [externalAudio, setExternalAudio] = useState(null);

  // Synthesis Result
  const [result, setResult] = useState(() => getInitialStudioData().res);
  const [hudNote, setHudNote] = useState("500 Hz–8 kHz 4-Octave Safe Zone · Ready");
  const [capturing, setCapturing] = useState(false);

  // Transport & Live Playhead
  const [auditionMode, setAuditionMode] = useState("orig"); // orig | tierA | tierB
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopOn, setLoopOn] = useState(true);
  const [playProgress, setPlayProgress] = useState(0);
  const audioCtxRef = useRef(null);
  const audioSrcRef = useRef(null);
  const rafRef = useRef(null);
  const playStartRef = useRef(0);
  const playOffsetRef = useRef(0);

  // BroadcastChannel Live Bus
  const [busSupported, setBusSupported] = useState(false);
  const [busRxCount, setBusRxCount] = useState(0);
  const [lastBusMsg, setLastBusMsg] = useState(null);
  const busRef = useRef(null);

  // Monitor canvas + hidden file inputs
  const monitorCanvasRef = useRef(null);
  const imgInputRef = useRef(null);
  const wavInputRef = useRef(null);

  useEffect(() => {
    const bus = createCrossToolBus((msg) => {
      setBusRxCount((c) => c + 1);
      setLastBusMsg(msg);
      setHudNote(`RX ${msg.source}: ${msg.name} (${msg.width}b)`);
    });
    busRef.current = bus;
    const raf = requestAnimationFrame(() => setBusSupported(bus.supported));
    return () => {
      cancelAnimationFrame(raf);
      bus.close();
      busRef.current = null;
    };
  }, []);

  const stopPlayback = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioSrcRef.current) {
      try {
        audioSrcRef.current.onended = null;
        audioSrcRef.current.stop();
      } catch {
        // ignore
      }
      audioSrcRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    return () => {
      stopPlayback();
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close();
        } catch {
          // ignore
        }
      }
    };
  }, [stopPlayback]);

  // Core recompute helper (explicitly called from user interactions)
  const recompute = useCallback(
    (overrides = {}) => {
      stopPlayback();
      const nextClips = overrides.clips ?? clips;
      const nextSlotS = overrides.slotDurationS ?? slotDurationS;
      const nextPreset = overrides.presetName ?? presetName;
      const nextPartials = overrides.partials ?? partials;
      const nextCond = overrides.condMode ?? condMode;
      const nextSynth = overrides.synthMode ?? synthMode;
      const nextBitDepth = overrides.bitDepth ?? bitDepth;
      const nextBands = overrides.bandCount ?? bandCount;
      const nextBwW = overrides.bitWaveWidth ?? bitWaveWidth;
      const nextExt = overrides.externalAudio !== undefined ? overrides.externalAudio : externalAudio;

      const t0 = performance.now();
      const res = synthesizeTimeline({
        clips: nextClips,
        slotDurationS: nextSlotS,
        presetName: nextPreset,
        partials: nextPartials,
        condMode: nextCond,
        synthMode: nextSynth,
        bitDepth: nextBitDepth,
        bandCount: nextBands,
        bitWaveWidth: nextBwW,
        externalAudio: nextExt,
      });
      const ms = Math.round(performance.now() - t0);
      setResult(res);
      setPlayProgress(0);
      playOffsetRef.current = 0;
      setHudNote(
        `${res.durationSec.toFixed(2)}s @ ${res.sampleRate} Hz (${ms} ms) · Tier-B SNR ${res.decomp.inBandFidelity.snrDb} dB`
      );
    },
    [
      stopPlayback,
      clips,
      slotDurationS,
      presetName,
      partials,
      condMode,
      synthMode,
      bitDepth,
      bandCount,
      bitWaveWidth,
      externalAudio,
    ]
  );

  // Paint Monitor Canvas whenever result / tab / selection / playhead updates
  useEffect(() => {
    const cv = monitorCanvasRef.current;
    if (!cv || !result || monTab === "bus") return;
    const ctx = cv.getContext("2d");

    if (monTab === "stft") {
      const { rgba, width, height } = result.spectrogram;
      paintRgba(cv, rgba, width, height);
      // Draw slot dividers
      if (clips.length > 1 && !result.externalLabel) {
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.lineWidth = 1;
        for (let i = 1; i < clips.length; i++) {
          const x = Math.round((i / clips.length) * width);
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }
      }
      // Draw active playhead
      if (playProgress > 0) {
        const px = Math.round(playProgress * width);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
        ctx.stroke();
      }
      return;
    }

    if (monTab === "hull") {
      const w = 760;
      const h = 260;
      cv.width = w;
      cv.height = h;
      ctx.fillStyle = "#080b0f";
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "#1c232d";
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

      // Raw PCM waveform
      ctx.strokeStyle = "rgba(72, 201, 240, 0.35)";
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const s0 = x * spp;
        let mn = 0;
        let mx = 0;
        const step = Math.max(1, Math.floor(spp / 16));
        for (let k = 0; k < spp && s0 + k < n; k += step) {
          const v = pcm[s0 + k];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        ctx.moveTo(x, h / 2 - mx * (h * 0.43));
        ctx.lineTo(x, h / 2 - mn * (h * 0.43));
      }
      ctx.stroke();

      // Hilbert ±A(t) envelope
      ctx.strokeStyle = "#38d47a";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const idx = Math.min(n - 1, Math.floor((x / w) * n));
        const a = Math.min(1, env[idx]);
        const y = h / 2 - a * (h * 0.43);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.strokeStyle = "rgba(56, 212, 122, 0.4)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const idx = Math.min(n - 1, Math.floor((x / w) * n));
        const a = Math.min(1, env[idx]);
        const y = h / 2 + a * (h * 0.43);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Gabor centroid trajectory f̄(t) (500Hz..8kHz log mapped in amber)
      const fr = result.chime.frames;
      if (fr.length > 1) {
        ctx.strokeStyle = "#f5a623";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (let i = 0; i < fr.length; i++) {
          const x = (i / (fr.length - 1)) * w;
          const u = Math.max(0, Math.min(1, Math.log2(Math.max(500, fr[i].centroidHz) / 500) / 4));
          const y = h - 14 - u * (h - 28);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      if (playProgress > 0) {
        const px = Math.round(playProgress * w);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
        ctx.stroke();
      }
      return;
    }

    if (monTab === "clip") {
      const idx = Math.max(0, Math.min(result.clipPlanes.length - 1, selectedClipIdx));
      const cp = result.clipPlanes[idx];
      if (cp) paintScaledRgba(cv, cp.rgba, cp.width, cp.height, 540, 360);
      return;
    }

    if (monTab === "seam") {
      const idx = Math.max(0, Math.min(result.seamPreviews.length - 1, selectedSeamIdx));
      const sp = result.seamPreviews[idx];
      if (sp) paintScaledRgba(cv, sp.rgba, sp.width, sp.height, 540, 360);
      return;
    }

    if (monTab === "event") {
      const count = result.eventPreviews.length;
      if (count > 0) {
        const idx = isPlaying
          ? Math.min(count - 1, Math.floor(playProgress * count))
          : Math.max(0, Math.min(count - 1, selectedClipIdx));
        const ep = result.eventPreviews[idx];
        paintScaledRgba(cv, ep.rgba, ep.width, ep.height, 540, 360);
      }
    }
  }, [result, monTab, selectedClipIdx, selectedSeamIdx, playProgress, isPlaying, clips.length]);

  // Playback control
  const startPlayback = useCallback(
    (modeOverride = null, startNorm = null) => {
      if (!result) return;
      const mode = modeOverride || auditionMode;
      stopPlayback();

      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      const ac = audioCtxRef.current;
      if (ac.state === "suspended") ac.resume();

      const sr = result.sampleRate;
      let abuf;
      if (mode === "orig" && result.stereoEvent) {
        abuf = ac.createBuffer(2, result.stereoEvent.left.length, sr);
        abuf.getChannelData(0).set(Float32Array.from(result.stereoEvent.left));
        abuf.getChannelData(1).set(Float32Array.from(result.stereoEvent.right));
      } else {
        const arr =
          mode === "tierA"
            ? result.chime.hullAudio
            : mode === "tierB"
              ? result.decomp.reconstructed
              : result.monoAudio;
        abuf = ac.createBuffer(1, arr.length, sr);
        abuf.getChannelData(0).set(Float32Array.from(arr));
      }

      const dur = Math.max(0.01, abuf.duration);
      const offsetNorm = startNorm !== null ? Math.max(0, Math.min(0.99, startNorm)) : playOffsetRef.current;
      const offsetSec = offsetNorm * dur;

      const src = ac.createBufferSource();
      src.buffer = abuf;
      src.loop = loopOn;
      src.connect(ac.destination);
      src.onended = () => {
        if (!loopOn) {
          audioSrcRef.current = null;
          setIsPlaying(false);
          setPlayProgress(0);
          playOffsetRef.current = 0;
        }
      };
      src.start(0, offsetSec);
      audioSrcRef.current = src;
      playStartRef.current = ac.currentTime - offsetSec;
      setIsPlaying(true);

      const tick = () => {
        if (!audioCtxRef.current || !audioSrcRef.current) return;
        const elapsed = audioCtxRef.current.currentTime - playStartRef.current;
        const prog = loopOn ? (elapsed % dur) / dur : Math.min(1, elapsed / dur);
        playOffsetRef.current = prog;
        setPlayProgress(prog);
        if (loopOn || prog < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          setIsPlaying(false);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [result, auditionMode, loopOn, stopPlayback]
  );

  const togglePlay = useCallback(() => {
    if (isPlaying) stopPlayback();
    else startPlayback();
  }, [isPlaying, stopPlayback, startPlayback]);

  const handleMonitorScrub = useCallback(
    (ev) => {
      if (monTab !== "stft" && monTab !== "hull") return;
      const rect = ev.currentTarget.getBoundingClientRect();
      const norm = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
      playOffsetRef.current = norm;
      setPlayProgress(norm);
      if (isPlaying) startPlayback(auditionMode, norm);
    },
    [monTab, isPlaying, auditionMode, startPlayback]
  );

  // Showreel 1-Click Loader
  const loadShowreel = useCallback(
    (kind) => {
      if (!kind) return;
      let seq;
      if (kind === "vessel") {
        seq = buildHollowVesselSequence({
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
      } else if (kind === "morph") {
        seq = buildShapeMorphSequence({
          bpm,
          beatsPerFrame: 0.5,
          framesPerLeg: 2,
          style: morphStyle,
          breathing,
          width: 192,
          height: 128,
        });
      } else if (kind === "bitwave") {
        const lines = hexStackText
          .split(/[\r\n,]+/)
          .map((s) => s.trim().replace(/^0[xX]/, "").toUpperCase())
          .filter((s) => /^[0-9A-F]{2,}$/.test(s));
        const base = lines.length ? lines.slice(0, 8) : DEFAULT_HEX_STACK;
        const frames = [];
        for (let i = 0; i < 4; i++) {
          const rotated = base.map((h) => {
            let cur = h;
            for (let r = 0; r < i; r++) cur = applyBitWaveTwinOp(cur, "quad");
            return cur;
          });
          frames.push({
            index: i,
            title: `BW Q${i + 1} (${rotated.length}L)`,
            polarity: breathing ? (i % 2 === 0 ? "pos" : "neg") : "pos",
            ...renderBitWaveStackRGBA(rotated, { width: 192, height: 128 }),
          });
        }
        seq = { slotDurationS: Number(((60 / bpm) * 0.5).toFixed(4)), frames };
      } else {
        return;
      }

      const { media, clips: newClips } = makeMediaAndClipsFromFrames(seq.frames, breathing);
      setMediaItems(media);
      setClips(newClips);
      setSelectedClipIdx(0);
      setSelectedSeamIdx(0);
      setSlotDurationS(seq.slotDurationS);
      setExternalAudio(null);
      recompute({ clips: newClips, slotDurationS: seq.slotDurationS, externalAudio: null });
    },
    [vesselR, vesselRIn, vesselF, bpm, frameCount, breathing, morphStyle, hexStackText, recompute]
  );

  // Import Images or WAV via file picker or drag-and-drop
  const ingestFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []);
      if (files.length === 0) return;

      // Check for WAV file first
      const wavFile = files.find((f) => /\.wav$/i.test(f.name) || f.type === "audio/wav");
      if (wavFile) {
        try {
          const buf = await wavFile.arrayBuffer();
          const dec = decodeWavMono(new Uint8Array(buf));
          const maxSamps = Math.min(dec.samples.length, dec.sampleRate * 4);
          const ext = { name: wavFile.name, samples: dec.samples.subarray(0, maxSamps), sampleRate: dec.sampleRate };
          setExternalAudio(ext);
          recompute({ externalAudio: ext });
          setMonTab("hull");
          return;
        } catch (err) {
          setHudNote(`WAV decode error: ${err.message}`);
          return;
        }
      }

      // Otherwise load images into Media Bay & append to Timeline
      const imgFiles = files.filter((f) => f.type.startsWith("image/")).slice(0, 16);
      if (imgFiles.length === 0) return;
      const addedMedia = [];
      const addedClips = [];
      const baseLen = clips.length;
      for (let i = 0; i < imgFiles.length; i++) {
        const url = URL.createObjectURL(imgFiles[i]);
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
          const rgba = new Uint8ClampedArray(ctx.getImageData(0, 0, 192, 128).data);
          const mId = makeUid("m");
          const title = imgFiles[i].name.replace(/\.[^.]+$/, "").slice(0, 16);
          addedMedia.push({ id: mId, title, rgba, width: 192, height: 128 });
          addedClips.push({
            id: makeUid("c"),
            mediaId: mId,
            title,
            polarity: breathing ? ((baseLen + i) % 2 === 0 ? "pos" : "neg") : "pos",
            rgba,
            width: 192,
            height: 128,
          });
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      const nextClips = [...clips, ...addedClips];
      setMediaItems((prev) => [...prev, ...addedMedia]);
      setClips(nextClips);
      setExternalAudio(null);
      recompute({ clips: nextClips, externalAudio: null });
    },
    [clips, breathing, recompute]
  );

  // Timeline Clip Editing Operations
  const addMediaToTimeline = useCallback(
    (item, forcePolarity = null) => {
      const pol = forcePolarity || (breathing ? (clips.length % 2 === 0 ? "pos" : "neg") : "pos");
      const nextClips = [
        ...clips,
        { id: makeUid("c"), mediaId: item.id, title: item.title, polarity: pol, rgba: item.rgba, width: item.width, height: item.height },
      ];
      setClips(nextClips);
      setExternalAudio(null);
      recompute({ clips: nextClips, externalAudio: null });
    },
    [clips, breathing, recompute]
  );

  const toggleClipPolarity = useCallback(
    (idx) => {
      const nextClips = clips.map((cl, i) =>
        i === idx ? { ...cl, polarity: cl.polarity === "pos" ? "neg" : "pos" } : cl
      );
      setClips(nextClips);
      recompute({ clips: nextClips, externalAudio: null });
    },
    [clips, recompute]
  );

  const moveClip = useCallback(
    (fromIdx, toIdx) => {
      if (toIdx < 0 || toIdx >= clips.length || fromIdx === toIdx) return;
      const nextClips = [...clips];
      const [moved] = nextClips.splice(fromIdx, 1);
      nextClips.splice(toIdx, 0, moved);
      setClips(nextClips);
      setSelectedClipIdx(toIdx);
      recompute({ clips: nextClips, externalAudio: null });
    },
    [clips, recompute]
  );

  const removeClip = useCallback(
    (idx) => {
      const nextClips = clips.filter((_, i) => i !== idx);
      setClips(nextClips);
      setSelectedClipIdx((prev) => Math.max(0, Math.min(nextClips.length - 1, prev)));
      recompute({ clips: nextClips, externalAudio: null });
    },
    [clips, recompute]
  );

  const toggleBreathingAll = useCallback(() => {
    const nextB = !breathing;
    setBreathing(nextB);
    const nextClips = clips.map((cl, i) => ({
      ...cl,
      polarity: nextB ? (i % 2 === 0 ? "pos" : "neg") : "pos",
    }));
    setClips(nextClips);
    recompute({ clips: nextClips, externalAudio: null });
  }, [breathing, clips, recompute]);

  const handleTabCapture = useCallback(async () => {
    setCapturing(true);
    setHudNote("Choose your Ramanujan Chime or BitWave browser tab…");
    try {
      const intervalMs = Math.round((60 / Math.max(40, Math.min(240, bpm))) * 500);
      const captured = await captureDisplayFrames({
        frameCount: Math.max(2, Math.min(8, frameCount)),
        intervalMs,
        width: 192,
        height: 128,
        breathing,
        onProgress: (p) => setHudNote(`Capturing tab… ${Math.round(p * 100)}%`),
      });
      const { media, clips: newClips } = makeMediaAndClipsFromFrames(captured, breathing);
      setMediaItems(media);
      setClips(newClips);
      setExternalAudio(null);
      recompute({ clips: newClips, externalAudio: null });
    } catch (err) {
      setHudNote(`Tab capture cancelled: ${err.message}`);
    } finally {
      setCapturing(false);
    }
  }, [bpm, frameCount, breathing, recompute]);

  const handleUseBusFeed = useCallback(() => {
    if (!lastBusMsg) return;
    const text = lastBusMsg.hexList.join("\n");
    setHexStackText(text);
    const frames = [];
    for (let i = 0; i < 4; i++) {
      const rotated = lastBusMsg.hexList.slice(0, 8).map((h) => {
        let cur = h;
        for (let r = 0; r < i; r++) cur = applyBitWaveTwinOp(cur, "quad");
        return cur;
      });
      frames.push({
        index: i,
        title: `${lastBusMsg.source.slice(0, 5)} Q${i + 1}`,
        polarity: breathing ? (i % 2 === 0 ? "pos" : "neg") : "pos",
        ...renderBitWaveStackRGBA(rotated, { width: 192, height: 128 }),
      });
    }
    const { media, clips: newClips } = makeMediaAndClipsFromFrames(frames, breathing);
    setMediaItems(media);
    setClips(newClips);
    setExternalAudio(null);
    recompute({ clips: newClips, externalAudio: null });
  }, [lastBusMsg, breathing, recompute]);

  // Cross-Tool Exports
  const handleDownloadWav = useCallback(() => {
    if (!result) return;
    const bytes = result.stereoEvent
      ? encodeWavStereo(result.stereoEvent.left, result.stereoEvent.right, result.sampleRate, bitDepth)
      : encodeWavMono(result.monoAudio, result.sampleRate, bitDepth);
    downloadBlob(new Blob([bytes], { type: "audio/wav" }), `infwave-${synthMode}-${bitDepth}b.wav`);
    setHudNote("Downloaded RIFF .WAV — drop directly into Ramanujan Chime 6·Floor WT (⇧ MP3)");
  }, [result, bitDepth, synthMode]);

  const handleDownloadBitWave = useCallback(() => {
    if (!result?.bitwaveDoc) return;
    downloadBlob(
      new Blob([JSON.stringify(result.bitwaveDoc, null, 2)], { type: "application/json" }),
      `infwave-${bandCount}band-${bitWaveWidth}b.bitwave.json`
    );
    setHudNote(`Exported BitWave Schema-5 project (${bandCount} bands, ${bitWaveWidth}b)`);
  }, [result, bandCount, bitWaveWidth]);

  const handleBroadcastChime = useCallback(() => {
    if (!result || !busRef.current) return;
    const ok1 = busRef.current.sendToChime(result.bitwaveDoc, { name: `InfWave ${bandCount}B/${bitWaveWidth}b` });
    const ok2 = busRef.current.sendHexOut(result.primaryHex, {
      source: "infwave",
      bands: bandCount,
      inBandSnrDb: result.decomp.inBandFidelity.snrDb,
    });
    setHudNote(
      ok1 || ok2
        ? `Broadcasted ${bitWaveWidth}b project & hex (${result.primaryHex.slice(0, 12)}…) on '${CROSS_TOOL_CHANNEL}'`
        : "BroadcastChannel unavailable in this browser context"
    );
  }, [result, bandCount, bitWaveWidth]);

  const handleCopySeed = useCallback(async () => {
    if (!result) return;
    const seed = {
      app: "infwave",
      safeZoneHz: [500, 8000],
      bands: bandCount,
      widthBits: bitWaveWidth,
      inBandSnrDb: result.decomp.inBandFidelity.snrDb,
      primaryHex: result.primaryHex,
      laneHexA: Object.values(result.bitwaveDoc.lanes).map((l) => l.a),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(seed, null, 2));
      setHudNote("Copied compact Infinite Compassion seed JSON");
    } catch {
      setHudNote("Clipboard unavailable — use Export .bitwave.json");
    }
  }, [result, bandCount, bitWaveWidth]);

  // Derived Telemetry
  const meanVessel = result?.chime?.frames?.length
    ? {
        R: result.chime.frames.reduce((a, f) => a + f.R, 0) / result.chime.frames.length,
        r: result.chime.frames.reduce((a, f) => a + f.r, 0) / result.chime.frames.length,
        eta: result.chime.frames.reduce((a, f) => a + f.eta, 0) / result.chime.frames.length,
        V: result.chime.frames.reduce((a, f) => a + f.volShell, 0) / result.chime.frames.length,
        fHz: result.chime.frames.reduce((a, f) => a + f.centroidHz, 0) / result.chime.frames.length,
      }
    : null;

  const curSec = (playProgress * (result?.durationSec || 0)).toFixed(2);
  const totSec = (result?.durationSec || 0).toFixed(2);
  const activeSeam = result?.seamDeltas?.[selectedSeamIdx] || null;

  return (
    <div className="iw-shell">
      {/* TOP BAR */}
      <header className="iw-topbar">
        <div className="iw-tb-left">
          <span className="iw-brand iw-mono">INFWAVE</span>
          <select
            className="iw-showreel-select iw-mono"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) loadShowreel(e.target.value);
              e.target.value = "";
            }}
            title="Load a 1-click procedural Infinite Compassion showreel"
          >
            <option value="">★ Showreels ▾</option>
            <option value="vessel">1 · Hollow Vessel λ Collapse (Chime)</option>
            <option value="morph">2 · Polar-SDF Shape Morph (BPM)</option>
            <option value="bitwave">3 · BitWave Hex Stack (4×90°)</option>
          </select>

          <span className="iw-bus-box iw-mono" title={`Live BroadcastChannel('${CROSS_TOOL_CHANNEL}')`}>
            <span className={`iw-led ${busSupported ? "iw-led-on" : "iw-led-off"}`} />
            <span>{CROSS_TOOL_CHANNEL}</span>
            <span className="iw-muted">RX {busRxCount}</span>
            {lastBusMsg && (
              <button className="iw-mini-btn active" onClick={handleUseBusFeed}>
                Use Feed
              </button>
            )}
          </span>
        </div>

        <div className="iw-tb-center iw-mono iw-hud">
          <span>{curSec} / {totSec} s</span>
          <span className="iw-sep">|</span>
          <span className="iw-muted">{hudNote}</span>
        </div>

        <div className="iw-tb-right">
          <button className="iw-mini-btn iw-btn-primary" onClick={() => recompute()} title="Re-synthesize timeline">
            Synthesize ↻
          </button>
          <button className="iw-mini-btn" onClick={handleDownloadWav} title="Export lossless RIFF WAV for Chime 6·Floor WT">
            ⬇ WAV
          </button>
          <button className="iw-mini-btn" onClick={handleBroadcastChime} title="Broadcast crystallized hex & lanes to Chime/BitWave">
            📡 Bus
          </button>
          {onSwitchView && (
            <>
              <span className="iw-sep">|</span>
              <button className="iw-mini-btn" onClick={() => onSwitchView("demo")}>Classic</button>
              <button className="iw-mini-btn" onClick={() => onSwitchView("theory")}>Economics</button>
            </>
          )}
        </div>
      </header>

      {/* UPPER WORKSPACE: MEDIA BAY (LEFT) + BIG MONITOR (RIGHT) */}
      <section className="iw-upper">
        <aside
          className={`iw-media-bay ${mediaDragOver ? "drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setMediaDragOver(true);
          }}
          onDragLeave={() => setMediaDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setMediaDragOver(false);
            if (e.dataTransfer?.files?.length) ingestFiles(e.dataTransfer.files);
          }}
        >
          <div className="iw-panel-hdr">
            <span>MEDIA BAY ({mediaItems.length})</span>
            <div style={{ display: "flex", gap: "4px" }}>
              <button className="iw-mini-btn" onClick={() => imgInputRef.current?.click()}>+ Img</button>
              <button className="iw-mini-btn" onClick={() => wavInputRef.current?.click()}>+ WAV</button>
              <button className="iw-mini-btn" onClick={handleTabCapture} disabled={capturing} title="Capture live Chime/BitWave browser tab">
                {capturing ? "…" : "Cap"}
              </button>
            </div>
          </div>
          <div className="iw-drop-hint">
            Drop .png/.jpg or .wav · Click +POS / −NEG to append clip to Timeline
          </div>
          <div className="iw-media-grid">
            {mediaItems.map((item) => (
              <div key={item.id} className="iw-media-card">
                <ThumbCanvas rgba={item.rgba} width={item.width} height={item.height} />
                <button
                  className="iw-media-del"
                  title="Remove from Media Bay"
                  onClick={() => setMediaItems((prev) => prev.filter((m) => m.id !== item.id))}
                >
                  ×
                </button>
                <div className="iw-media-meta">
                  <div className="iw-media-name iw-mono" title={item.title}>{item.title}</div>
                  <div className="iw-media-actions">
                    <button className="iw-media-add iw-mono" onClick={() => addMediaToTimeline(item, "pos")}>+POS</button>
                    <button className="iw-media-add neg iw-mono" onClick={() => addMediaToTimeline(item, "neg")}>−NEG</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* CENTER MONITOR */}
        <main className="iw-monitor">
          <div className="iw-panel-hdr">
            <div className="iw-mon-tabs">
              {[
                ["stft", "Spectrogram (500–8kHz)"],
                ["hull", "Analytic Hull (Chime)"],
                ["bus", `Safe-Zone Bus (${bandCount}B · BitWave)`],
                ["clip", "Clip Preview"],
                ["seam", "Seam Delta (4-State)"],
                ["event", "Event-Cam (Δ)"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={`iw-mon-tab ${monTab === id ? "active" : ""}`}
                  onClick={() => setMonTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="iw-mon-info iw-mono iw-muted">
              {result?.externalLabel
                ? `WAV: ${result.externalLabel}`
                : monTab === "seam" && activeSeam
                  ? `S${activeSeam.seamIndex + 1} · XNOR ${activeSeam.rectifiedFlux.toFixed(3)} · Δf ${activeSeam.centroidDeltaHz} Hz`
                  : `Tier-B ${result?.decomp?.inBandFidelity?.snrDb ?? 0} dB · 1-Car ${result?.chime?.fidelity?.snrDb ?? 0} dB`}
            </div>
          </div>

          <div className="iw-canvas-wrap">
            {monTab === "bus" ? (
              <div className="iw-bus-monitor">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                  <span className="iw-mono" style={{ fontSize: "11px", color: "#48c9f0" }}>
                    500 Hz–8000 Hz EXACT 4-OCTAVE DYADIC BUS · IN-BAND SNR {result.decomp.inBandFidelity.snrDb} dB
                  </span>
                  <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                    <span className="iw-mono iw-muted" style={{ fontSize: "10px" }}>TWIN:</span>
                    {[
                      ["P", "P"],
                      ["not", "~P NOT"],
                      ["twos", "−P 2'sC"],
                      ["conj", "P̄ Mirror"],
                      ["quad", "90° ROTR"],
                    ].map(([op, label]) => (
                      <button
                        key={op}
                        className={`iw-mini-btn iw-mono ${twinOp === op ? "active-cyan" : ""}`}
                        onClick={() => setTwinOp(op)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="iw-band-grid">
                  {result.decomp.bands.slice(0, 8).map((b) => {
                    const pct = Math.min(100, Math.round(b.energyShare * 100 * 2.5));
                    return (
                      <div key={b.index} className="iw-band-card iw-mono">
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px" }}>
                          <span style={{ color: "#48c9f0" }}>L{b.index + 1}</span>
                          <span className="iw-muted">{(b.energyShare * 100).toFixed(1)}%</span>
                        </div>
                        <div className="iw-band-bar-bg">
                          <div className="iw-band-bar-fill" style={{ height: `${Math.max(4, pct)}%` }} />
                        </div>
                        <div style={{ fontSize: "9px", textAlign: "center", color: "#9aa5b6" }}>{b.label}</div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table className="iw-hex-table iw-mono">
                    <thead>
                      <tr>
                        <th>LANE</th>
                        <th>BAND (Hz)</th>
                        <th>IN-PHASE A ({twinOp})</th>
                        <th>QUADRATURE B (90°)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(result.bitwaveDoc.lanes).map(([key, ln], idx) => {
                        const b = result.decomp.bands[idx];
                        return (
                          <tr key={key}>
                            <td style={{ color: "#48c9f0" }}>L{key}</td>
                            <td className="iw-muted">{b ? `${Math.round(b.fLo)}–${Math.round(b.fHi)}` : "—"}</td>
                            <td style={{ color: "#38d47a" }}>{applyBitWaveTwinOp(ln.a, twinOp)}</td>
                            <td style={{ color: "#f5a623" }}>{ln.b}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <>
                <canvas
                  ref={monitorCanvasRef}
                  className="iw-monitor-canvas"
                  onClick={handleMonitorScrub}
                />
                {monTab === "seam" && (
                  <div className="iw-overlay-pill iw-mono">
                    <span className="iw-leg-item"><i className="iw-sw iw-sw-11" />1→1 Carry</span>
                    <span className="iw-leg-item"><i className="iw-sw iw-sw-01" />0→1 Ignite</span>
                    <span className="iw-leg-item"><i className="iw-sw iw-sw-10" />1→0 Quench</span>
                    <span className="iw-leg-item"><i className="iw-sw iw-sw-00" />0→0 Off</span>
                  </div>
                )}
                {monTab === "hull" && meanVessel && (
                  <>
                    <div className="iw-overlay-pill iw-mono">
                      <span style={{ color: "#48c9f0" }}>■ PCM</span>
                      <span style={{ color: "#38d47a" }}>━ ±A(t) Hilbert</span>
                      <span style={{ color: "#f5a623" }}>━ f̄(t) Gabor</span>
                    </div>
                    <div className="iw-overlay-right iw-mono">
                      <span>R={meanVessel.R.toFixed(2)} r={meanVessel.r.toFixed(2)} η={meanVessel.eta.toFixed(2)}</span>
                      <span>V={meanVessel.V.toFixed(2)}</span>
                      <span>Nulls={result.analytic.nullCrossings}</span>
                    </div>
                  </>
                )}
                {monTab === "event" && result.eventPreviews[selectedClipIdx] && (
                  <div className="iw-overlay-pill iw-mono">
                    <span style={{ color: "#48c9f0" }}>+ON (Left)</span>
                    <span style={{ color: "#f5a623" }}>−OFF (Right)</span>
                    <span className="iw-muted">
                      Frame {selectedClipIdx + 1}/{result.eventPreviews.length} · Δ={result.eventPreviews[selectedClipIdx].motion}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* TRANSPORT BAR */}
          <div className="iw-transport">
            <button
              className="iw-mini-btn"
              title="Rewind"
              onClick={() => {
                playOffsetRef.current = 0;
                setPlayProgress(0);
                if (isPlaying) startPlayback(auditionMode, 0);
              }}
            >
              |&lt;
            </button>
            <button className="iw-mini-btn iw-btn-primary" onClick={togglePlay}>
              {isPlaying ? "■ Stop" : "▶ Play"}
            </button>
            <button
              className={`iw-mini-btn ${loopOn ? "active" : ""}`}
              onClick={() => setLoopOn((l) => !l)}
            >
              Loop
            </button>
            <span className="iw-sep">|</span>
            {[
              ["orig", result.stereoEvent ? "A: Event Stereo" : "A: Safe-Zone PCM", "active"],
              ["tierA", "B: Tier-A 1-Carrier", "active-amber"],
              ["tierB", `C: Tier-B ${bandCount}-Band`, "active-cyan"],
            ].map(([mode, label, cls]) => (
              <button
                key={mode}
                className={`iw-mini-btn iw-mono ${auditionMode === mode ? cls : ""}`}
                onClick={() => {
                  setAuditionMode(mode);
                  if (isPlaying) startPlayback(mode, playProgress);
                }}
              >
                {label}
              </button>
            ))}
            <span className="iw-spacer" />
            {result.slotRmsDb.length >= 2 && (
              <span className="iw-mono iw-muted" style={{ fontSize: "10px" }}>
                RMS: #1 {result.slotRmsDb[0]} dB ↔ #2 {result.slotRmsDb[1]} dB
              </span>
            )}
          </div>
        </main>
      </section>

      {/* HORIZONTAL INTERACTIVE TIMELINE STRIP */}
      <section className="iw-timeline-section">
        <div className="iw-panel-hdr">
          <div className="iw-tl-left">
            <span>TIMELINE</span>
            <span className="iw-mono iw-muted">
              {clips.length} clips · {(clips.length * slotDurationS).toFixed(2)} s
            </span>
          </div>
          <div className="iw-tl-actions">
            <select
              value={synthMode}
              onChange={(e) => {
                setSynthMode(e.target.value);
                recompute({ synthMode: e.target.value });
              }}
              className="iw-mini-btn iw-mono"
              title="Synthesis engine mode"
            >
              <option value="breathing">Synth: +/− Breathing</option>
              <option value="event">Synth: Event-Cam Stereo</option>
              <option value="mono">Synth: Positive Mono</option>
            </select>
            <button
              className={`iw-mini-btn ${breathing ? "active" : ""}`}
              onClick={toggleBreathingAll}
              title="Auto-alternate +POS and −NEG across timeline"
            >
              Breathing (+/−): {breathing ? "ON" : "OFF"}
            </button>
            <button
              className="iw-mini-btn"
              onClick={() => {
                setClips([]);
                setExternalAudio(null);
                recompute({ clips: [], externalAudio: null });
              }}
            >
              Clear
            </button>
          </div>
        </div>

        <div className="iw-timeline-strip">
          {clips.map((cl, idx) => {
            const isNeg = cl.polarity === "neg";
            const seam = result?.seamDeltas?.[idx];
            return (
              <div key={cl.id} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <div
                  className={`iw-clip-card ${isNeg ? "pol-neg" : "pol-pos"} ${selectedClipIdx === idx ? "selected" : ""} ${dragClipIdx === idx ? "dragging" : ""}`}
                  draggable
                  onDragStart={() => setDragClipIdx(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragClipIdx !== null && dragClipIdx !== idx) moveClip(dragClipIdx, idx);
                    setDragClipIdx(null);
                  }}
                  onDragEnd={() => setDragClipIdx(null)}
                  onClick={() => {
                    setSelectedClipIdx(idx);
                    if (monTab === "seam") setMonTab("clip");
                  }}
                >
                  <div className="iw-clip-top iw-mono">
                    <span className="iw-muted">#{idx + 1}</span>
                    <span>
                      <button className="iw-clip-mini" title="Move left" onClick={(e) => { e.stopPropagation(); moveClip(idx, idx - 1); }}>◀</button>
                      <button className="iw-clip-mini" title="Move right" onClick={(e) => { e.stopPropagation(); moveClip(idx, idx + 1); }}>▶</button>
                      <button className="iw-clip-mini" title="Remove clip" onClick={(e) => { e.stopPropagation(); removeClip(idx); }}>×</button>
                    </span>
                  </div>
                  <ThumbCanvas
                    rgba={cl.rgba}
                    width={cl.width}
                    height={cl.height}
                    className={`iw-clip-thumb ${isNeg ? "inv-css" : ""}`}
                  />
                  <div className="iw-clip-foot">
                    <span className="iw-clip-title iw-mono" title={cl.title}>{cl.title}</span>
                    <button
                      className={`iw-pol-btn iw-mono ${isNeg ? "neg" : "pos"}`}
                      title="Toggle +POS / −NEG polarity"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleClipPolarity(idx);
                      }}
                    >
                      {isNeg ? "−" : "+"}
                    </button>
                  </div>
                </div>

                {/* Clickable Seam Delta Chip between clip idx and idx+1 */}
                {idx < clips.length - 1 && (
                  <button
                    className={`iw-seam-chip iw-mono ${seam?.isInvertedSeam ? "inverted" : ""} ${monTab === "seam" && selectedSeamIdx === idx ? "selected" : ""}`}
                    title={`Inspect 4-State Seam Delta S${idx + 1}`}
                    onClick={() => {
                      setSelectedSeamIdx(idx);
                      setMonTab("seam");
                    }}
                  >
                    <span>S{idx + 1}</span>
                    <span>{seam ? seam.rectifiedFlux.toFixed(2) : "Δ"}</span>
                  </button>
                )}
              </div>
            );
          })}
          {clips.length === 0 && (
            <div className="iw-mono iw-muted" style={{ fontSize: "11px", padding: "0 12px" }}>
              Timeline empty — click +POS / −NEG on a Media Bay item or pick a ★ Showreel above.
            </div>
          )}
        </div>
      </section>

      {/* COMPACT TABBED BOTTOM DOCK */}
      <footer className="iw-dock">
        <div className="iw-dock-tabs">
          {[
            ["vessel", "Vessel / Shape Morph"],
            ["bitwave", "BitWave / Safe-Zone Bus"],
            ["dsp", "DSP / Preset"],
            ["deltas", `Endomorphic Deltas (${result.seamDeltas.length})`],
            ["export", "Export / Chime & BitWave Handoff"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={`iw-dock-tab ${dockTab === id ? "active" : ""}`}
              onClick={() => setDockTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="iw-dock-panel">
          {dockTab === "vessel" && (
            <div>
              <div className="iw-ctrl-row">
                <label className="iw-mono">
                  Outer R ({vesselR.toFixed(2)})
                  <input type="range" min="0.4" max="1.0" step="0.05" value={vesselR} onChange={(e) => setVesselR(Number(e.target.value))} />
                </label>
                <label className="iw-mono">
                  Cavity r ({Math.min(vesselR - 0.05, vesselRIn).toFixed(2)})
                  <input type="range" min="0.1" max="0.85" step="0.05" value={vesselRIn} onChange={(e) => setVesselRIn(Number(e.target.value))} />
                </label>
                <label className="iw-mono">
                  Cycles f ({vesselF.toFixed(1)})
                  <input type="range" min="1" max="6" step="0.5" value={vesselF} onChange={(e) => setVesselF(Number(e.target.value))} />
                </label>
                <label className="iw-mono">
                  BPM
                  <input type="number" min="40" max="240" value={bpm} onChange={(e) => setBpm(Number(e.target.value))} style={{ width: "68px" }} />
                </label>
                <label className="iw-mono">
                  Frames
                  <input type="number" min="2" max="12" step="2" value={frameCount} onChange={(e) => setFrameCount(Number(e.target.value))} style={{ width: "58px" }} />
                </label>
                <label className="iw-mono">
                  Morph Style
                  <select value={morphStyle} onChange={(e) => setMorphStyle(e.target.value)}>
                    <option value="outline">Outline</option>
                    <option value="solid">Solid</option>
                  </select>
                </label>
                <button className="iw-btn iw-btn-primary" onClick={() => loadShowreel("vessel")}>
                  Stage Hollow Vessel
                </button>
                <button className="iw-btn" onClick={() => loadShowreel("morph")}>
                  Stage Polar-SDF Morph
                </button>
              </div>
              <div className="iw-dock-help iw-mono">
                Harmor Void Collapse sweeps λ: 0 → 1 → 0 across BPM-locked slots; click any clip&apos;s + / − pill to invert polarity live.
              </div>
            </div>
          )}

          {dockTab === "bitwave" && (
            <div style={{ display: "flex", gap: "14px", alignItems: "flex-start", flexWrap: "wrap" }}>
              <textarea
                rows={4}
                value={hexStackText}
                onChange={(e) => setHexStackText(e.target.value)}
                className="iw-mono"
                style={{
                  width: "260px",
                  background: "#0d0f13",
                  color: "#38d47a",
                  border: "1px solid #2a303b",
                  borderRadius: "4px",
                  padding: "6px",
                  fontSize: "11px",
                }}
              />
              <div className="iw-ctrl-row">
                <label className="iw-mono">
                  Safe-Zone Bands (K)
                  <select
                    value={bandCount}
                    onChange={(e) => {
                      const k = Number(e.target.value);
                      setBandCount(k);
                      recompute({ bandCount: k });
                    }}
                  >
                    <option value={4}>4 (1 oct)</option>
                    <option value={8}>8 (½ oct · 8L)</option>
                    <option value={16}>16 (¼ oct · F1–F16)</option>
                  </select>
                </label>
                <label className="iw-mono">
                  BitWave Width
                  <select
                    value={bitWaveWidth}
                    onChange={(e) => {
                      const w = Number(e.target.value);
                      setBitWaveWidth(w);
                      recompute({ bitWaveWidth: w });
                    }}
                  >
                    {BITWAVE_WIDTHS.filter((w) => w >= 16).map((w) => (
                      <option key={w} value={w}>{w}-bit</option>
                    ))}
                  </select>
                </label>
                <button className="iw-btn iw-btn-primary" onClick={() => loadShowreel("bitwave")}>
                  Stage Hex Stack → Timeline
                </button>
                <button className="iw-btn" onClick={() => setMonTab("bus")}>
                  Open Safe-Zone Bus View
                </button>
              </div>
            </div>
          )}

          {dockTab === "dsp" && (
            <div>
              <div className="iw-ctrl-row">
                <label className="iw-mono">
                  Spectral Preset
                  <select
                    value={presetName}
                    onChange={(e) => {
                      setPresetName(e.target.value);
                      recompute({ presetName: e.target.value });
                    }}
                    style={{ width: "220px" }}
                  >
                    {Object.keys(PRESETS).map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <label className="iw-mono">
                  Slot ΔT (s)
                  <input
                    type="number"
                    min="0.1"
                    max="4"
                    step="0.05"
                    value={slotDurationS}
                    onChange={(e) => setSlotDurationS(Number(e.target.value))}
                    style={{ width: "74px" }}
                  />
                </label>
                <label className="iw-mono">
                  Partials
                  <select value={partials} onChange={(e) => setPartials(Number(e.target.value))}>
                    {[64, 96, 128, 192].map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </label>
                <label className="iw-mono">
                  Condition
                  <select value={condMode} onChange={(e) => setCondMode(e.target.value)}>
                    <option value="raw">raw</option>
                    <option value="stroke">stroke (edges)</option>
                  </select>
                </label>
                <label className="iw-mono">
                  WAV Bit Depth
                  <select value={bitDepth} onChange={(e) => setBitDepth(Number(e.target.value))}>
                    <option value={16}>16-bit PCM</option>
                    <option value={24}>24-bit PCM</option>
                    <option value={32}>32-bit Float</option>
                  </select>
                </label>
                <button className="iw-btn iw-btn-primary" onClick={() => recompute()}>
                  Apply & Re-Synthesize
                </button>
              </div>
              <div className="iw-dock-help iw-mono">
                Schroeder minimum-crest phase law active · Per-column RMS EQ bypassed on inverted seams to preserve breathing contrast.
              </div>
            </div>
          )}

          {dockTab === "deltas" && (
            <table className="iw-seam-table iw-mono">
              <thead>
                <tr>
                  <th>SEAM</th>
                  <th>TRANSITION</th>
                  <th>1→1 CARRY</th>
                  <th>0→1 IGNITE</th>
                  <th>1→0 QUENCH</th>
                  <th>0→0 OFF</th>
                  <th>XNOR FLUX</th>
                  <th>ΔCENTROID</th>
                </tr>
              </thead>
              <tbody>
                {result.seamDeltas.map((d) => (
                  <tr
                    key={d.seamIndex}
                    className={monTab === "seam" && selectedSeamIdx === d.seamIndex ? "selected" : ""}
                    onClick={() => {
                      setSelectedSeamIdx(d.seamIndex);
                      setMonTab("seam");
                    }}
                  >
                    <td>S{d.seamIndex + 1}</td>
                    <td>{d.polarityTransition}</td>
                    <td style={{ color: "#38d47a" }}>{d.sustainedOn.toFixed(3)}</td>
                    <td style={{ color: "#48c9f0" }}>{d.ignited.toFixed(3)}</td>
                    <td style={{ color: "#f5a623" }}>{d.quenched.toFixed(3)}</td>
                    <td className="iw-muted">{d.sustainedOff.toFixed(3)}</td>
                    <td>{d.rectifiedFlux.toFixed(3)}</td>
                    <td>{d.centroidDeltaHz > 0 ? `+${d.centroidDeltaHz}` : d.centroidDeltaHz} Hz</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {dockTab === "export" && (
            <div>
              <div className="iw-ctrl-row">
                <button className="iw-btn iw-btn-primary" onClick={handleDownloadWav}>
                  ⬇ Download .WAV (Chime 6·Floor WT)
                </button>
                <button className="iw-btn" onClick={handleDownloadBitWave}>
                  ⬇ Export .bitwave.json (Schema 5)
                </button>
                <button className="iw-btn" onClick={handleBroadcastChime}>
                  📡 Broadcast to Chime / BitWave
                </button>
                <button className="iw-btn" onClick={handleCopySeed}>
                  📋 Copy Seed JSON
                </button>
                <button className="iw-btn" onClick={() => wavInputRef.current?.click()}>
                  ↑ Analyze Existing .WAV
                </button>
                <button className="iw-btn" onClick={handleTabCapture} disabled={capturing}>
                  {capturing ? "Capturing…" : "🎥 Capture Live Chime/BitWave Tab"}
                </button>
              </div>
              <div className="iw-dock-help iw-mono">
                Drop exported .WAV directly into The Ramanujan Chime&apos;s <code>6 · Floor WT</code> (⇧ MP3), or open <code>.bitwave.json</code> in BitWave to manipulate safe-zone lanes with bitwise algebra.
              </div>
            </div>
          )}
        </div>
      </footer>

      {/* Hidden File Inputs */}
      <input
        ref={imgInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          ingestFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={wavInputRef}
        type="file"
        accept=".wav,audio/wav"
        style={{ display: "none" }}
        onChange={(e) => {
          ingestFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
