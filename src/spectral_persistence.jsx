import { useState, useMemo, useRef, useEffect } from "react";

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&family=DM+Sans:wght@300;400;500;600;700&display=swap');
`;

const STAGES = [
  {
    id: "source",
    label: "Source image",
    icon: "◻",
    color: "#E8E4DD",
    accent: "#8B8680",
    desc: "Raw pixel grid",
  },
  {
    id: "fft",
    label: "FFT encode",
    icon: "∿",
    color: "#D4E7F7",
    accent: "#2E7ABF",
    desc: "Image → sine partials",
  },
  {
    id: "wav",
    label: "WAV file",
    icon: "◎",
    color: "#D9EBD9",
    accent: "#3A8C3A",
    desc: "PCM sample stream",
  },
  {
    id: "usb",
    label: "USB / EM wave",
    icon: "⚡",
    color: "#F5E6D0",
    accent: "#B87A2E",
    desc: "Electromagnetic propagation",
  },
  {
    id: "clock",
    label: "Femtosecond clock",
    icon: "◈",
    color: "#F0D4D4",
    accent: "#B84040",
    desc: "Jitter < 200fs",
  },
  {
    id: "dac",
    label: "D/A conversion",
    icon: "≋",
    color: "#E0D4F0",
    accent: "#7040B8",
    desc: "Digital → continuous voltage",
  },
  {
    id: "air",
    label: "Acoustic wave",
    icon: "◌",
    color: "#D4E8E8",
    accent: "#2E8B8B",
    desc: "Air pressure modulation",
  },
  {
    id: "recover",
    label: "FFT decode",
    icon: "◻",
    color: "#E8E4DD",
    accent: "#8B8680",
    desc: "Spectrogram → image recovered",
  },
];

const STAGE_DETAILS = {
  source: {
    title: "The image as data",
    body: "Every image is a grid of values. A 512×512 grayscale image is 262,144 data points. Color adds 3× more. This is the information we need to preserve — not the pixels themselves, but the pattern they form.",
    formula: "Total data = width × height × channels × bit_depth",
  },
  fft: {
    title: "Fourier decomposition",
    body: "Each row of pixels maps to a frequency band. Brightness becomes amplitude. The FFT decomposes the image into sine wave partials — not as metadata, but as the signal itself. The partials ARE the image. This is the soulbinding moment.",
    formula: "freq_resolution = sample_rate / FFT_window_size",
  },
  wav: {
    title: "PCM encoding",
    body: "The sine partials are summed into a time-domain waveform and quantized to 24-bit integer samples. Each sample captures the instantaneous sum of all partials at that moment. The waveform is a compressed projection of the 2D image into 1D time.",
    formula: "file_size = duration × sample_rate × bit_depth × channels / 8",
  },
  usb: {
    title: "Electromagnetic waveguide",
    body: "The digital signal becomes voltage patterns propagating through copper at ~65% light speed. Same physics as visible light, different frequency. Your image is now an electromagnetic phenomenon — Shannon's bit riding a wave.",
    formula: "propagation_speed ≈ 0.65c ≈ 195,000 km/s",
  },
  clock: {
    title: "Temporal precision",
    body: "The Babyface's femtosecond clock ensures each sample lands within 200 femtoseconds of its target time. This prevents spectral smearing — the partials carrying your image stay phase-coherent, preserving fine detail.",
    formula: "jitter_ratio = 200fs / sample_period ≈ 3.8 × 10⁻⁸",
  },
  dac: {
    title: "Reconstruction",
    body: "The DAC oversamples (128-256×) and applies sinc interpolation to reconstruct a continuous waveform from discrete samples. Nyquist-Shannon guarantees perfect reconstruction below half the sample rate. Your image lives in this continuous signal.",
    formula: "max_frequency = sample_rate / 2 (Nyquist limit)",
  },
  air: {
    title: "Acoustic propagation",
    body: "Speaker cones transduce voltage into air pressure waves. The partials propagate at 343 m/s — your 20Hz components travel in 17-meter wavelengths, 20kHz in 1.7cm. A microphone at the other end could recapture the signal. The image persists.",
    formula: "wavelength = speed_of_sound / frequency",
  },
  recover: {
    title: "Signal recovery",
    body: "Apply FFT to the recovered signal. The spectrogram reveals the original image. Information survived: floating point → integer → photons → voltage → air pressure → voltage → integer → image. The bit doesn't care what carries it.",
    formula: "recovered_image = STFT(recorded_signal)",
  },
};

function calcEconomics(imgW, imgH, sampleRate, bitDepth, channels) {
  const fftSize = imgH * 2;
  const hopSize = fftSize / 4;
  const numColumns = imgW;
  const durationSec = (numColumns * hopSize) / sampleRate;
  const wavSizeBytes = durationSec * sampleRate * (bitDepth / 8) * channels;
  const wavSizeMB = wavSizeBytes / (1024 * 1024);
  const rawImgBytes = imgW * imgH * 3;
  const jpegBytes = rawImgBytes * 0.08;
  const pngBytes = rawImgBytes * 0.45;
  const webpBytes = rawImgBytes * 0.05;
  const jpegMB = jpegBytes / (1024 * 1024);
  const pngMB = pngBytes / (1024 * 1024);
  const webpMB = webpBytes / (1024 * 1024);
  const freqRes = sampleRate / fftSize;
  const timeRes = (hopSize / sampleRate) * 1000;
  const effPixels = imgW * imgH;
  const bitsPerPixel_wav = (wavSizeBytes * 8) / effPixels;
  const bitsPerPixel_jpeg = (jpegBytes * 8) / effPixels;
  const overheadRatio = wavSizeMB / jpegMB;

  // MP3 at three bitrates
  const mp3_128_bytes = (128 * 1000 / 8) * durationSec;
  const mp3_192_bytes = (192 * 1000 / 8) * durationSec;
  const mp3_320_bytes = (320 * 1000 / 8) * durationSec;
  const mp3_128_MB = mp3_128_bytes / (1024 * 1024);
  const mp3_192_MB = mp3_192_bytes / (1024 * 1024);
  const mp3_320_MB = mp3_320_bytes / (1024 * 1024);
  const mp3_128_ratio = mp3_128_MB / jpegMB;
  const mp3_320_ratio = mp3_320_MB / jpegMB;
  const wavToMp3_128_ratio = wavSizeMB / mp3_128_MB;

  // MP3 safe zone analysis
  // MP3 psychoacoustic model preserves best: ~500Hz - 8kHz
  // Aggressive cuts above 16kHz, reduced below 100Hz
  const nyquist = sampleRate / 2;
  const safeZoneLow = 500;
  const safeZoneHigh = Math.min(8000, nyquist);
  const fullBandLow = 20;
  const fullBandHigh = nyquist;
  const safeZoneBins = Math.floor(imgH * (safeZoneHigh - safeZoneLow) / (fullBandHigh - fullBandLow));
  const safeZonePct = (safeZoneBins / imgH) * 100;

  const storageCostPerGB = 0.023;
  const transferCostPerGB = 0.09;
  const wavCostStore = (wavSizeMB / 1024) * storageCostPerGB * 1000;
  const jpegCostStore = (jpegMB / 1024) * storageCostPerGB * 1000;
  const mp3CostStore = (mp3_128_MB / 1024) * storageCostPerGB * 1000;
  const wavCostTransfer = (wavSizeMB / 1024) * transferCostPerGB * 1000;
  const jpegCostTransfer = (jpegMB / 1024) * transferCostPerGB * 1000;
  const mp3CostTransfer = (mp3_128_MB / 1024) * transferCostPerGB * 1000;

  return {
    durationSec,
    wavSizeMB,
    jpegMB,
    pngMB,
    webpMB,
    freqRes,
    timeRes,
    bitsPerPixel_wav,
    bitsPerPixel_jpeg,
    overheadRatio,
    fftSize,
    hopSize,
    mp3_128_MB,
    mp3_192_MB,
    mp3_320_MB,
    mp3_128_ratio,
    mp3_320_ratio,
    wavToMp3_128_ratio,
    safeZoneLow,
    safeZoneHigh,
    safeZoneBins,
    safeZonePct,
    wavCostStore,
    jpegCostStore,
    mp3CostStore,
    wavCostTransfer,
    jpegCostTransfer,
    mp3CostTransfer,
  };
}

function MiniSpectrogram({ width = 200, height = 80, stage }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = width * 2;
    const h = height * 2;
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);

    const stageIdx = STAGES.findIndex((s) => s.id === stage);
    const degradation = stage === "air" ? 0.15 : stage === "recover" ? 0.08 : 0;

    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const nx = x / w;
        const ny = y / h;
        const cx = 0.5, cy = 0.5;
        const dx = nx - cx, dy = ny - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const ring1 = Math.sin(d * 28) * 0.5 + 0.5;
        const ring2 = Math.sin(d * 14 + 1.5) * 0.3 + 0.3;
        const diag = Math.sin((nx + ny) * 12) * 0.2 + 0.2;
        let val = ring1 * 0.5 + ring2 * 0.3 + diag * 0.2;
        if (degradation > 0) {
          val += (Math.random() - 0.5) * degradation;
        }
        val = Math.max(0, Math.min(1, val));

        const accent = STAGES[Math.min(stageIdx, STAGES.length - 1)].accent;
        const r = parseInt(accent.slice(1, 3), 16);
        const g = parseInt(accent.slice(3, 5), 16);
        const b = parseInt(accent.slice(5, 7), 16);

        ctx.fillStyle = `rgb(${Math.floor(r * val * 0.8)}, ${Math.floor(g * val * 0.9)}, ${Math.floor(b * val)})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }, [stage, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        borderRadius: "6px",
        imageRendering: "pixelated",
      }}
    />
  );
}

function BottleViz({ economics }) {
  const bottles = [
    { label: "Audio PCM", capacity: economics.wavSizeMB, color: "#3A8C3A" },
    { label: "USB 2.0", capacity: 60, color: "#B87A2E" },
    { label: "ADAT optical", capacity: 3.075, color: "#B84040" },
    { label: "Fiber optic", capacity: 12500, color: "#7040B8" },
  ];
  const maxCap = Math.max(...bottles.map((b) => b.capacity));

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "120px", padding: "0 8px" }}>
      {bottles.map((b, i) => {
        const h = Math.max(16, (Math.log10(b.capacity + 1) / Math.log10(maxCap + 1)) * 100);
        const w = 20 + (h / 100) * 40;
        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "9px", color: "#888", fontFamily: "JetBrains Mono", whiteSpace: "nowrap" }}>
              {b.capacity >= 1000 ? `${(b.capacity / 1000).toFixed(1)}GB/s` : `${b.capacity.toFixed(1)}MB/s`}
            </span>
            <div
              style={{
                width: `${w}px`,
                height: `${h}px`,
                background: `${b.color}18`,
                border: `1px solid ${b.color}40`,
                borderRadius: `${w / 2}px ${w / 2}px 4px 4px`,
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: `${w * 0.4}px`,
                  height: "8px",
                  background: `${b.color}30`,
                  borderRadius: "2px 2px 0 0",
                  top: "-8px",
                }}
              />
            </div>
            <span style={{ fontSize: "9px", color: "#666", fontFamily: "DM Sans", whiteSpace: "nowrap" }}>
              {b.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BarCompare({ label, value, maxValue, color, suffix = "MB" }) {
  const pct = Math.min(100, (value / maxValue) * 100);
  return (
    <div style={{ marginBottom: "8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "3px" }}>
        <span style={{ color: "#888", fontFamily: "DM Sans" }}>{label}</span>
        <span style={{ fontFamily: "JetBrains Mono", fontWeight: 500, color }}>{value.toFixed(2)} {suffix}</span>
      </div>
      <div style={{ height: "6px", background: "#1a1a1a", borderRadius: "3px", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.max(1, pct)}%`,
            background: color,
            borderRadius: "3px",
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}

export default function SpectralPersistence() {
  const [activeStage, setActiveStage] = useState(0);
  const [imgW, setImgW] = useState(512);
  const [imgH, setImgH] = useState(512);
  const [sampleRate, setSampleRate] = useState(192000);
  const [bitDepth] = useState(24);
  const [tab, setTab] = useState("journey");
  const [showMp3, setShowMp3] = useState(false);

  const economics = useMemo(
    () => calcEconomics(imgW, imgH, sampleRate, bitDepth, 1),
    [imgW, imgH, sampleRate, bitDepth]
  );

  const crossoverImages = useMemo(() => {
    const results = [];
    const sizes = [32, 64, 128, 256, 512, 1024, 2048, 4096];
    for (const s of sizes) {
      const e = calcEconomics(s, s, sampleRate, bitDepth, 1);
      results.push({
        size: s,
        wavMB: e.wavSizeMB,
        mp3MB: e.mp3_128_MB,
        jpegMB: e.jpegMB,
        ratio: e.overheadRatio,
        mp3Ratio: e.mp3_128_ratio,
        bppWav: e.bitsPerPixel_wav,
        bppJpeg: e.bitsPerPixel_jpeg,
      });
    }
    return results;
  }, [sampleRate, bitDepth]);

  const stageData = STAGES[activeStage];
  const detail = STAGE_DETAILS[stageData.id];

  return (
    <div
      style={{
        fontFamily: "'DM Sans', sans-serif",
        background: "#0D0D0D",
        color: "#E8E4DD",
        minHeight: "100vh",
        padding: "0",
      }}
    >
      <style>{FONTS}</style>

      {/* Header */}
      <div style={{ padding: "48px 32px 24px", borderBottom: "1px solid #1F1F1F" }}>
        <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#666", marginBottom: "12px", fontFamily: "JetBrains Mono" }}>
          SIGNAL THEORY × INFORMATION ECONOMICS
        </div>
        <h1 style={{ fontSize: "28px", fontWeight: 300, margin: 0, letterSpacing: "-0.5px", lineHeight: 1.3 }}>
          Spectral persistence
        </h1>
        <p style={{ fontSize: "14px", color: "#888", marginTop: "8px", maxWidth: "540px", lineHeight: 1.6 }}>
          An image encoded as Fourier partials survives every physical medium transition.
          How far does the fidelity stretch — and when does the economics make sense?
        </p>
        <div style={{ marginTop: "16px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "12px", fontFamily: "JetBrains Mono", color: showMp3 ? "#E09A4A" : "#666" }}>
            <input type="checkbox" checked={showMp3} onChange={(e) => setShowMp3(e.target.checked)} style={{ accentColor: "#E09A4A" }} />
            ENABLE MP3 PSYCHOACOUSTIC ANALYSIS
          </label>
        </div>
      </div>

      {/* Tab switcher */}
      <div style={{ display: "flex", borderBottom: "1px solid #1F1F1F" }}>
        {[
          ["journey", "Signal journey"],
          ["economics", "Economics"],
          ["crossover", "Crossover analysis"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              flex: 1,
              padding: "14px",
              background: "transparent",
              border: "none",
              borderBottom: tab === key ? "2px solid #E8E4DD" : "2px solid transparent",
              color: tab === key ? "#E8E4DD" : "#555",
              fontSize: "12px",
              fontFamily: "JetBrains Mono",
              letterSpacing: "0.5px",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div style={{ padding: "20px 32px", background: "#111", borderBottom: "1px solid #1F1F1F" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px" }}>
          <div>
            <label style={{ fontSize: "10px", color: "#666", fontFamily: "JetBrains Mono", letterSpacing: "1px", display: "block", marginBottom: "6px" }}>
              IMAGE WIDTH
            </label>
            <select
              value={imgW}
              onChange={(e) => setImgW(Number(e.target.value))}
              style={{
                width: "100%",
                background: "#1A1A1A",
                border: "1px solid #2A2A2A",
                borderRadius: "4px",
                color: "#E8E4DD",
                padding: "8px",
                fontSize: "13px",
                fontFamily: "JetBrains Mono",
              }}
            >
              {[64, 128, 256, 512, 1024, 2048].map((v) => (
                <option key={v} value={v}>{v}px</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: "10px", color: "#666", fontFamily: "JetBrains Mono", letterSpacing: "1px", display: "block", marginBottom: "6px" }}>
              IMAGE HEIGHT
            </label>
            <select
              value={imgH}
              onChange={(e) => setImgH(Number(e.target.value))}
              style={{
                width: "100%",
                background: "#1A1A1A",
                border: "1px solid #2A2A2A",
                borderRadius: "4px",
                color: "#E8E4DD",
                padding: "8px",
                fontSize: "13px",
                fontFamily: "JetBrains Mono",
              }}
            >
              {[64, 128, 256, 512, 1024, 2048].map((v) => (
                <option key={v} value={v}>{v}px</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: "10px", color: "#666", fontFamily: "JetBrains Mono", letterSpacing: "1px", display: "block", marginBottom: "6px" }}>
              SAMPLE RATE
            </label>
            <select
              value={sampleRate}
              onChange={(e) => setSampleRate(Number(e.target.value))}
              style={{
                width: "100%",
                background: "#1A1A1A",
                border: "1px solid #2A2A2A",
                borderRadius: "4px",
                color: "#E8E4DD",
                padding: "8px",
                fontSize: "13px",
                fontFamily: "JetBrains Mono",
              }}
            >
              <option value={44100}>44.1 kHz</option>
              <option value={48000}>48 kHz</option>
              <option value={96000}>96 kHz</option>
              <option value={192000}>192 kHz</option>
            </select>
          </div>
        </div>
      </div>

      {/* Journey Tab */}
      {tab === "journey" && (
        <div style={{ padding: "24px 32px" }}>
          {/* Stage timeline */}
          <div style={{ display: "flex", gap: "2px", marginBottom: "24px", overflowX: "auto" }}>
            {STAGES.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setActiveStage(i)}
                style={{
                  flex: 1,
                  minWidth: "60px",
                  padding: "10px 4px",
                  background: i === activeStage ? s.color + "20" : "transparent",
                  border: "none",
                  borderBottom: `2px solid ${i === activeStage ? s.accent : "#1F1F1F"}`,
                  color: i === activeStage ? s.accent : "#555",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span style={{ fontSize: "18px" }}>{s.icon}</span>
                <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono", whiteSpace: "nowrap" }}>
                  {s.label}
                </span>
              </button>
            ))}
          </div>

          {/* Active stage detail */}
          <div
            style={{
              background: "#111",
              borderRadius: "8px",
              border: `1px solid ${stageData.accent}30`,
              padding: "28px",
              marginBottom: "24px",
            }}
          >
            <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: "280px" }}>
                <div
                  style={{
                    fontSize: "10px",
                    letterSpacing: "2px",
                    color: stageData.accent,
                    fontFamily: "JetBrains Mono",
                    marginBottom: "8px",
                  }}
                >
                  STAGE {activeStage + 1} OF {STAGES.length}
                </div>
                <h2 style={{ fontSize: "20px", fontWeight: 500, margin: "0 0 12px" }}>{detail.title}</h2>
                <p style={{ fontSize: "13px", color: "#AAA", lineHeight: 1.7, margin: "0 0 16px" }}>
                  {detail.body}
                </p>
                <div
                  style={{
                    fontFamily: "JetBrains Mono",
                    fontSize: "11px",
                    color: stageData.accent,
                    background: `${stageData.accent}10`,
                    padding: "8px 12px",
                    borderRadius: "4px",
                    display: "inline-block",
                  }}
                >
                  {detail.formula}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                <MiniSpectrogram width={160} height={100} stage={stageData.id} />
                <span style={{ fontSize: "10px", color: "#666", fontFamily: "JetBrains Mono" }}>
                  Spectrogram fidelity at this stage
                </span>
              </div>
            </div>
          </div>

          {/* Navigate */}
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => setActiveStage(Math.max(0, activeStage - 1))}
              disabled={activeStage === 0}
              style={{
                flex: 1,
                padding: "10px",
                background: "transparent",
                border: "1px solid #2A2A2A",
                borderRadius: "6px",
                color: activeStage === 0 ? "#333" : "#888",
                cursor: activeStage === 0 ? "default" : "pointer",
                fontSize: "12px",
                fontFamily: "JetBrains Mono",
              }}
            >
              ← Previous
            </button>
            <button
              onClick={() => setActiveStage(Math.min(STAGES.length - 1, activeStage + 1))}
              disabled={activeStage === STAGES.length - 1}
              style={{
                flex: 1,
                padding: "10px",
                background: "transparent",
                border: "1px solid #2A2A2A",
                borderRadius: "6px",
                color: activeStage === STAGES.length - 1 ? "#333" : "#888",
                cursor: activeStage === STAGES.length - 1 ? "default" : "pointer",
                fontSize: "12px",
                fontFamily: "JetBrains Mono",
              }}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Economics Tab */}
      {tab === "economics" && (
        <div style={{ padding: "24px 32px" }}>
          {/* Metrics row */}
          <div style={{ display: "grid", gridTemplateColumns: showMp3 ? "1fr 1fr 1fr 1fr" : "1fr 1fr 1fr", gap: "12px", marginBottom: "24px" }}>
            {[
              ["WAV duration", `${economics.durationSec.toFixed(2)}s`, "#3A8C3A"],
              ["WAV vs JPEG", `${Math.round(economics.overheadRatio)}×`, economics.overheadRatio > 50 ? "#B84040" : "#B87A2E"],
              ...(showMp3 ? [["MP3 vs JPEG", `${economics.mp3_128_ratio.toFixed(1)}×`, economics.mp3_128_ratio > 20 ? "#B84040" : "#E09A4A"]] : []),
              ["Freq resolution", `${economics.freqRes.toFixed(1)} Hz`, "#2E7ABF"],
            ].map(([label, value, color]) => (
              <div
                key={label}
                style={{
                  background: "#111",
                  borderRadius: "8px",
                  padding: "16px",
                  border: "1px solid #1F1F1F",
                }}
              >
                <div style={{ fontSize: "10px", color: "#666", fontFamily: "JetBrains Mono", letterSpacing: "1px", marginBottom: "6px" }}>
                  {label}
                </div>
                <div style={{ fontSize: "22px", fontWeight: 600, fontFamily: "JetBrains Mono", color }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* File size comparison */}
          <div style={{ background: "#111", borderRadius: "8px", padding: "24px", border: "1px solid #1F1F1F", marginBottom: "20px" }}>
            <h3 style={{ fontSize: "12px", fontFamily: "JetBrains Mono", color: "#888", letterSpacing: "1px", marginBottom: "16px" }}>
              FILE SIZE COMPARISON — {imgW}×{imgH} IMAGE
            </h3>
            <BarCompare label="Spectral WAV (mono)" value={economics.wavSizeMB} maxValue={economics.wavSizeMB} color="#3A8C3A" />
            {showMp3 && (
              <>
                <BarCompare label="MP3 320kbps" value={economics.mp3_320_MB} maxValue={economics.wavSizeMB} color="#C75A2A" />
                <BarCompare label="MP3 192kbps" value={economics.mp3_192_MB} maxValue={economics.wavSizeMB} color="#D47A3A" />
                <BarCompare label="MP3 128kbps" value={economics.mp3_128_MB} maxValue={economics.wavSizeMB} color="#E09A4A" />
              </>
            )}
            <BarCompare label="PNG (lossless)" value={economics.pngMB} maxValue={economics.wavSizeMB} color="#2E7ABF" />
            <BarCompare label="JPEG (lossy, ~92%)" value={economics.jpegMB} maxValue={economics.wavSizeMB} color="#B87A2E" />
            <BarCompare label="WebP (lossy)" value={economics.webpMB} maxValue={economics.wavSizeMB} color="#7040B8" />
          </div>

          {/* Bottle visualization */}
          <div style={{ background: "#111", borderRadius: "8px", padding: "24px", border: "1px solid #1F1F1F", marginBottom: "20px" }}>
            <h3 style={{ fontSize: "12px", fontFamily: "JetBrains Mono", color: "#888", letterSpacing: "1px", marginBottom: "16px" }}>
              CHANNEL CAPACITY — YOUR BOTTLES
            </h3>
            <BottleViz economics={economics} />
          </div>

          {/* Cost analysis */}
          <div style={{ background: "#111", borderRadius: "8px", padding: "24px", border: "1px solid #1F1F1F" }}>
            <h3 style={{ fontSize: "12px", fontFamily: "JetBrains Mono", color: "#888", letterSpacing: "1px", marginBottom: "16px" }}>
              CLOUD ECONOMICS (PER 1,000 IMAGES)
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <div style={{ fontSize: "10px", color: "#666", fontFamily: "JetBrains Mono", marginBottom: "8px" }}>STORAGE (S3-CLASS)</div>
                <div style={{ fontSize: "11px", color: "#AAA", lineHeight: 1.8 }}>
                  <div>WAV: <span style={{ color: "#3A8C3A", fontFamily: "JetBrains Mono" }}>${economics.wavCostStore.toFixed(4)}</span></div>
                  {showMp3 && <div>MP3 128k: <span style={{ color: "#E09A4A", fontFamily: "JetBrains Mono" }}>${economics.mp3CostStore.toFixed(4)}</span></div>}
                  <div>JPEG: <span style={{ color: "#B87A2E", fontFamily: "JetBrains Mono" }}>${economics.jpegCostStore.toFixed(4)}</span></div>
                </div>
              </div>
              <div>
                <div style={{ fontSize: "10px", color: "#666", fontFamily: "JetBrains Mono", marginBottom: "8px" }}>TRANSFER (EGRESS)</div>
                <div style={{ fontSize: "11px", color: "#AAA", lineHeight: 1.8 }}>
                  <div>WAV: <span style={{ color: "#3A8C3A", fontFamily: "JetBrains Mono" }}>${economics.wavCostTransfer.toFixed(4)}</span></div>
                  {showMp3 && <div>MP3 128k: <span style={{ color: "#E09A4A", fontFamily: "JetBrains Mono" }}>${economics.mp3CostTransfer.toFixed(4)}</span></div>}
                  <div>JPEG: <span style={{ color: "#B87A2E", fontFamily: "JetBrains Mono" }}>${economics.jpegCostTransfer.toFixed(4)}</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Crossover Tab */}
      {tab === "crossover" && (
        <div style={{ padding: "24px 32px" }}>
          <div style={{ background: "#111", borderRadius: "8px", padding: "24px", border: "1px solid #1F1F1F", marginBottom: "20px" }}>
            <h3 style={{ fontSize: "12px", fontFamily: "JetBrains Mono", color: "#888", letterSpacing: "1px", marginBottom: "8px" }}>
              THE CROSSOVER QUESTION
            </h3>
            <p style={{ fontSize: "13px", color: "#AAA", lineHeight: 1.7, marginBottom: "16px" }}>
              WAV is lossless but heavy. MP3 is lossy but predictably so — its psychoacoustic model
              preserves the frequencies human ears care about most. That predictability is exploitable.
              Below: overhead ratios for both formats at each resolution.
            </p>
          </div>

          {/* Crossover table */}
          <div style={{ background: "#111", borderRadius: "8px", border: "1px solid #1F1F1F", overflow: "hidden", marginBottom: "20px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", fontFamily: "JetBrains Mono" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #2A2A2A" }}>
                  {(showMp3 ? ["Resolution", "WAV", "MP3 128k", "JPEG", "WAV/JPEG", "MP3/JPEG"] : ["Resolution", "WAV", "JPEG", "Overhead"]).map((h) => (
                    <th key={h} style={{ padding: "12px 8px", textAlign: "left", color: "#666", fontWeight: 400, fontSize: "10px", letterSpacing: "0.5px" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {crossoverImages.map((row) => (
                  <tr key={row.size} style={{ borderBottom: "1px solid #1A1A1A" }}>
                    <td style={{ padding: "10px 8px", color: "#E8E4DD" }}>{row.size}×{row.size}</td>
                    <td style={{ padding: "10px 8px", color: "#3A8C3A" }}>{row.wavMB < 0.01 ? (row.wavMB * 1024).toFixed(1) + " KB" : row.wavMB.toFixed(2) + " MB"}</td>
                    {showMp3 && <td style={{ padding: "10px 8px", color: "#E09A4A" }}>{row.mp3MB < 0.01 ? (row.mp3MB * 1024).toFixed(1) + " KB" : row.mp3MB.toFixed(2) + " MB"}</td>}
                    <td style={{ padding: "10px 8px", color: "#B87A2E" }}>{row.jpegMB < 0.01 ? (row.jpegMB * 1024).toFixed(1) + " KB" : row.jpegMB.toFixed(2) + " MB"}</td>
                    <td style={{ padding: "10px 8px", color: row.ratio > 100 ? "#B84040" : row.ratio > 50 ? "#B87A2E" : "#3A8C3A" }}>
                      {Math.round(row.ratio)}×
                    </td>
                    {showMp3 && <td style={{ padding: "10px 8px", color: row.mp3Ratio > 20 ? "#B84040" : row.mp3Ratio > 10 ? "#E09A4A" : "#3A8C3A" }}>
                      {row.mp3Ratio.toFixed(1)}×
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* The thesis */}
          <div
            style={{
              background: "#0A1A0A",
              borderRadius: "8px",
              padding: "24px",
              border: "1px solid #1A3A1A",
            }}
          >
            <h3 style={{ fontSize: "12px", fontFamily: "JetBrains Mono", color: "#3A8C3A", letterSpacing: "1px", marginBottom: "12px" }}>
              WHERE THE VALUE LIVES
            </h3>
            <div style={{ fontSize: "13px", color: "#AAA", lineHeight: 1.8 }}>
              <p style={{ marginBottom: "12px" }}>
                {showMp3
                  ? `MP3 at 128kbps closes the gap dramatically — the overhead ratio drops from ~${Math.round(economics.overheadRatio)}× (WAV) to ~${economics.mp3_128_ratio.toFixed(1)}× (MP3) vs JPEG. Still larger, but now in the range where the tradeoffs become interesting:`
                  : `The spectral encoding is 50-200× larger than JPEG at every resolution. Raw efficiency never crosses. But efficiency isn't the only axis:`
                }
              </p>
              <div style={{ paddingLeft: "16px", borderLeft: "2px solid #3A8C3A30", marginBottom: "12px" }}>
                <p style={{ marginBottom: "6px" }}><span style={{ color: "#3A8C3A" }}>Robustness:</span> Partials degrade gracefully. A corrupted byte in JPEG destroys the image. Noise in the spectral domain just adds haze.</p>
                <p style={{ marginBottom: "6px" }}><span style={{ color: "#3A8C3A" }}>Substrate independence:</span> The WAV survives analog transmission, D/A/D conversion, acoustic propagation, format obsolescence. The MP3 survives digital distribution channels that strip metadata.</p>
                <p style={{ marginBottom: "6px" }}><span style={{ color: "#3A8C3A" }}>Steganographic value:</span> The image hides in plain sight as audio. An MP3 on a streaming platform carries image data no one would think to look for.</p>
                <p style={{ marginBottom: "0" }}><span style={{ color: "#3A8C3A" }}>Multimodal bridging:</span> The same file IS both a sound and an image. It can travel any audio channel — including ones that only support lossy formats.</p>
              </div>
              <p style={{ color: "#E8E4DD", fontStyle: "italic" }}>
                The crossover isn't about the bottle getting big enough. It's about needing a bottle that survives being dropped, buried, melted, and reformed — and still holding the same water.
                {showMp3 && " MP3 is a bottle that's been through the crusher and still holds most of it."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: "24px 32px", borderTop: "1px solid #1F1F1F", textAlign: "center" }}>
        <p style={{ fontSize: "10px", color: "#444", fontFamily: "JetBrains Mono", letterSpacing: "1px" }}>
          "The fundamental problem of communication is that of reproducing at one point a message selected at another point." — Claude Shannon, 1948
        </p>
      </div>
    </div>
  );
}
