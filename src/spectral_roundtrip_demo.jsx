import { useState, useRef, useEffect, useCallback } from "react";

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&family=DM+Sans:wght@300;400;500;600;700&display=swap');`;

const FREQ_BINS = 80;
const TIME_COLS = 192;
const HOP_SIZE = 512;
const SAMPLE_RATE = 44100;
const MIN_FREQ = 200;
const MAX_FREQ = 12000;

function drawPresetImage(ctx, w, h, preset) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  if (preset === "rings") {
    const cx = w / 2, cy = h / 2;
    for (let r = 8; r < Math.min(w, h) / 2; r += 6) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.9 - r / (Math.min(w, h) / 2) * 0.7})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  } else if (preset === "wave") {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    for (let layer = 0; layer < 4; layer++) {
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const y = h / 2 + Math.sin(x / w * Math.PI * (3 + layer) + layer) * (h * 0.15 - layer * 4) + (layer - 1.5) * 14;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.globalAlpha = 1 - layer * 0.2;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (preset === "text") {
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.floor(h * 0.55)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("HELLO", w / 2, h / 2);
  } else if (preset === "gradient") {
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const dx = x / w - 0.3, dy = y / h - 0.5;
        const d1 = Math.sqrt(dx * dx + dy * dy);
        const dx2 = x / w - 0.7, dy2 = y / h - 0.4;
        const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        const v = Math.max(0, 1 - d1 * 1.8) + Math.max(0, 1 - d2 * 2.2) * 0.7;
        const b = Math.min(255, Math.floor(v * 255));
        ctx.fillStyle = `rgb(${b},${b},${b})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

function getImageData(canvas) {
  const ctx = canvas.getContext("2d");
  const w = TIME_COLS;
  const h = FREQ_BINS;
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = w;
  tmpCanvas.height = h;
  const tmpCtx = tmpCanvas.getContext("2d");
  tmpCtx.drawImage(canvas, 0, 0, w, h);
  const data = tmpCtx.getImageData(0, 0, w, h).data;
  const grid = [];
  for (let col = 0; col < w; col++) {
    const column = [];
    for (let row = 0; row < h; row++) {
      const flippedRow = h - 1 - row;
      const idx = (flippedRow * w + col) * 4;
      const gray = (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) / 255;
      column.push(gray);
    }
    grid.push(column);
  }
  return grid;
}

function synthesizeAudio(grid) {
  const numCols = grid.length;
  const numBins = grid[0].length;
  const totalSamples = numCols * HOP_SIZE;
  const buffer = new Float32Array(totalSamples);
  const freqs = [];
  for (let i = 0; i < numBins; i++) {
    freqs.push(MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / (numBins - 1)));
  }
  const phaseAccum = new Float64Array(numBins);
  for (let col = 0; col < numCols; col++) {
    const amps = grid[col];
    const baseIdx = col * HOP_SIZE;
    for (let s = 0; s < HOP_SIZE; s++) {
      let val = 0;
      for (let bin = 0; bin < numBins; bin++) {
        if (amps[bin] < 0.02) continue;
        const phase = phaseAccum[bin] + (2 * Math.PI * freqs[bin] * s) / SAMPLE_RATE;
        val += amps[bin] * Math.sin(phase);
      }
      buffer[baseIdx + s] = val;
    }
    for (let bin = 0; bin < numBins; bin++) {
      phaseAccum[bin] += (2 * Math.PI * freqs[bin] * HOP_SIZE) / SAMPLE_RATE;
    }
  }
  let peak = 0;
  for (let i = 0; i < totalSamples; i++) peak = Math.max(peak, Math.abs(buffer[i]));
  if (peak > 0) for (let i = 0; i < totalSamples; i++) buffer[i] = (buffer[i] / peak) * 0.85;
  return buffer;
}

function drawWaveform(canvas, buffer, playProgress) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, w, h);
  const samplesPerPixel = Math.floor(buffer.length / w);
  ctx.strokeStyle = "#3A8C3A55";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const si = x * samplesPerPixel;
    let min = 0, max = 0;
    for (let s = 0; s < samplesPerPixel && si + s < buffer.length; s++) {
      const v = buffer[si + s];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const yMin = h / 2 - max * (h / 2) * 0.9;
    const yMax = h / 2 - min * (h / 2) * 0.9;
    ctx.moveTo(x, yMin);
    ctx.lineTo(x, yMax);
  }
  ctx.stroke();
  if (playProgress > 0) {
    const px = playProgress * w;
    ctx.strokeStyle = "#E8E4DD";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
  }
}

function drawSpectrogram(canvas, fftData, currentCol, totalCols) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  if (currentCol === 0) {
    ctx.fillStyle = "#0D0D0D";
    ctx.fillRect(0, 0, w, h);
  }
  const colWidth = w / totalCols;
  const x = Math.floor(currentCol * colWidth);
  const cw = Math.ceil(colWidth) + 1;
  for (let bin = 0; bin < fftData.length; bin++) {
    const val = fftData[bin];
    const y = h - (bin / fftData.length) * h;
    const binH = Math.ceil(h / fftData.length) + 1;
    const intensity = Math.max(0, Math.min(1, val));
    const r = Math.floor(40 + intensity * 180);
    const g = Math.floor(60 + intensity * 140);
    const b = Math.floor(30 + intensity * 80);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y - binH, cw, binH);
  }
}

function drawOriginalSpectrogram(canvas, grid) {
  if (!canvas || !grid) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#0D0D0D";
  ctx.fillRect(0, 0, w, h);
  const colWidth = w / grid.length;
  const numBins = grid[0].length;
  for (let col = 0; col < grid.length; col++) {
    const x = Math.floor(col * colWidth);
    const cw = Math.ceil(colWidth) + 1;
    for (let bin = 0; bin < numBins; bin++) {
      const val = grid[col][bin];
      const y = h - ((bin + 1) / numBins) * h;
      const binH = Math.ceil(h / numBins) + 1;
      const r = Math.floor(40 + val * 180);
      const g = Math.floor(60 + val * 140);
      const b = Math.floor(30 + val * 80);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y, cw, binH);
    }
  }
}

export default function SpectralDemo() {
  const [phase, setPhase] = useState("idle");
  const [imageLoaded, setImageLoaded] = useState(false);
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [grid, setGrid] = useState(null);
  const [playProgress, setPlayProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [encodingProgress, setEncodingProgress] = useState(0);

  const sourceCanvasRef = useRef(null);
  const waveformCanvasRef = useRef(null);
  const spectrogramCanvasRef = useRef(null);
  const encodedSpectRef = useRef(null);
  const audioCtxRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const startTimeRef = useRef(0);
  const durationRef = useRef(0);
  const rawBufferRef = useRef(null);

  const loadPreset = useCallback((preset) => {
    const canvas = sourceCanvasRef.current;
    if (!canvas) return;
    canvas.width = TIME_COLS;
    canvas.height = FREQ_BINS;
    const ctx = canvas.getContext("2d");
    drawPresetImage(ctx, TIME_COLS, FREQ_BINS, preset);
    setImageLoaded(true);
    setPhase("loaded");
    setAudioBuffer(null);
    setGrid(null);
    setPlayProgress(0);
  }, []);

  const handleUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const canvas = sourceCanvasRef.current;
      if (!canvas) return;
      canvas.width = TIME_COLS;
      canvas.height = FREQ_BINS;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, TIME_COLS, FREQ_BINS);
      const scale = Math.min(TIME_COLS / img.width, FREQ_BINS / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (TIME_COLS - dw) / 2, (FREQ_BINS - dh) / 2, dw, dh);
      setImageLoaded(true);
      setPhase("loaded");
      setAudioBuffer(null);
      setGrid(null);
      setPlayProgress(0);
    };
    img.src = URL.createObjectURL(file);
  }, []);

  const encode = useCallback(async () => {
    const canvas = sourceCanvasRef.current;
    if (!canvas) return;
    setPhase("encoding");
    setEncodingProgress(0);

    await new Promise((r) => setTimeout(r, 50));

    const imgGrid = getImageData(canvas);
    setGrid(imgGrid);

    drawOriginalSpectrogram(encodedSpectRef.current, imgGrid);

    const totalCols = imgGrid.length;
    const numBins = imgGrid[0].length;
    const totalSamples = totalCols * HOP_SIZE;
    const buffer = new Float32Array(totalSamples);
    const freqs = [];
    for (let i = 0; i < numBins; i++) {
      freqs.push(MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / (numBins - 1)));
    }

    const CHUNK = 8;
    const phaseAccum = new Float64Array(numBins);

    for (let colStart = 0; colStart < totalCols; colStart += CHUNK) {
      const colEnd = Math.min(colStart + CHUNK, totalCols);
      for (let col = colStart; col < colEnd; col++) {
        const amps = imgGrid[col];
        const baseIdx = col * HOP_SIZE;
        for (let s = 0; s < HOP_SIZE; s++) {
          let val = 0;
          for (let bin = 0; bin < numBins; bin++) {
            if (amps[bin] < 0.02) continue;
            const ph = phaseAccum[bin] + (2 * Math.PI * freqs[bin] * s) / SAMPLE_RATE;
            val += amps[bin] * Math.sin(ph);
          }
          buffer[baseIdx + s] = val;
        }
        for (let bin = 0; bin < numBins; bin++) {
          phaseAccum[bin] += (2 * Math.PI * freqs[bin] * HOP_SIZE) / SAMPLE_RATE;
        }
      }
      setEncodingProgress(colEnd / totalCols);
      await new Promise((r) => setTimeout(r, 0));
    }

    let peak = 0;
    for (let i = 0; i < totalSamples; i++) peak = Math.max(peak, Math.abs(buffer[i]));
    if (peak > 0) for (let i = 0; i < totalSamples; i++) buffer[i] = (buffer[i] / peak) * 0.85;

    rawBufferRef.current = buffer;
    setPhase("ready");

    if (waveformCanvasRef.current) {
      drawWaveform(waveformCanvasRef.current, buffer, 0);
    }
  }, []);

  const play = useCallback(() => {
    const rawBuf = rawBufferRef.current;
    if (!rawBuf) return;
    if (isPlaying) {
      if (sourceNodeRef.current) {
        try { sourceNodeRef.current.stop(); } catch(e) {}
        sourceNodeRef.current = null;
      }
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch(e) {}
        audioCtxRef.current = null;
      }
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      setIsPlaying(false);
      return;
    }

    // Clean up any previous context
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch(e) {}
    }

    const actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    audioCtxRef.current = actx;

    // Create fresh AudioBuffer in this context
    const abuf = actx.createBuffer(1, rawBuf.length, SAMPLE_RATE);
    abuf.getChannelData(0).set(rawBuf);

    const analyser = actx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;
    analyserRef.current = analyser;

    const source = actx.createBufferSource();
    source.buffer = abuf;
    source.connect(analyser);
    analyser.connect(actx.destination);

    const specCanvas = spectrogramCanvasRef.current;
    if (specCanvas) {
      const sctx = specCanvas.getContext("2d");
      sctx.fillStyle = "#0D0D0D";
      sctx.fillRect(0, 0, specCanvas.width, specCanvas.height);
    }

    const duration = abuf.duration;
    durationRef.current = duration;
    source.start(0);
    startTimeRef.current = actx.currentTime;
    sourceNodeRef.current = source;
    setIsPlaying(true);

    let lastCol = -1;
    const freqData = new Float32Array(analyser.frequencyBinCount);
    const numFreqs = FREQ_BINS;
    const binHz = SAMPLE_RATE / analyser.fftSize;

    const tick = () => {
      if (!audioCtxRef.current) return;
      const elapsed = audioCtxRef.current.currentTime - startTimeRef.current;
      const progress = Math.min(1, elapsed / duration);
      setPlayProgress(progress);

      if (rawBufferRef.current && waveformCanvasRef.current) {
        drawWaveform(waveformCanvasRef.current, rawBufferRef.current, progress);
      }

      const currentCol = Math.floor(progress * TIME_COLS);
      if (currentCol !== lastCol && currentCol < TIME_COLS) {
        analyser.getFloatFrequencyData(freqData);
        const normalized = [];
        for (let i = 0; i < numFreqs; i++) {
          const freq = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / (numFreqs - 1));
          const fftBin = Math.round(freq / binHz);
          const db = freqData[Math.min(fftBin, freqData.length - 1)];
          const val = Math.max(0, Math.min(1, (db + 70) / 55));
          normalized.push(val);
        }
        drawSpectrogram(specCanvas, normalized, currentCol, TIME_COLS);
        lastCol = currentCol;
      }

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(tick);
      } else {
        setIsPlaying(false);
        sourceNodeRef.current = null;
      }
    };

    source.onended = () => {
      setIsPlaying(false);
      sourceNodeRef.current = null;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };

    animFrameRef.current = requestAnimationFrame(tick);
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (sourceNodeRef.current) try { sourceNodeRef.current.stop(); } catch(e) {}
      if (audioCtxRef.current) try { audioCtxRef.current.close(); } catch(e) {}
    };
  }, []);

  const duration = (TIME_COLS * HOP_SIZE) / SAMPLE_RATE;

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: "#0D0D0D", color: "#E8E4DD", minHeight: "100vh" }}>
      <style>{FONT_IMPORT}</style>

      {/* Header */}
      <div style={{ padding: "40px 28px 20px", borderBottom: "1px solid #1A1A1A" }}>
        <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#555", marginBottom: "10px", fontFamily: "JetBrains Mono" }}>
          LIVE DEMONSTRATION
        </div>
        <h1 style={{ fontSize: "24px", fontWeight: 300, margin: 0, letterSpacing: "-0.3px" }}>
          Image → sound → image
        </h1>
        <p style={{ fontSize: "13px", color: "#777", marginTop: "8px", lineHeight: 1.6 }}>
          Upload an image or choose a preset. Watch it become sound. Listen. Then watch the spectrogram reconstruct it.
        </p>
      </div>

      {/* Step 1: Source */}
      <div style={{ padding: "24px 28px", borderBottom: "1px solid #1A1A1A" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
          <span style={{
            width: "22px", height: "22px", borderRadius: "50%", background: imageLoaded ? "#3A8C3A" : "#2A2A2A",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "11px", fontFamily: "JetBrains Mono", color: imageLoaded ? "#0D0D0D" : "#666",
          }}>1</span>
          <span style={{ fontSize: "13px", fontFamily: "JetBrains Mono", letterSpacing: "0.5px", color: "#999" }}>
            SOURCE IMAGE
          </span>
        </div>

        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <canvas
              ref={sourceCanvasRef}
              width={TIME_COLS}
              height={FREQ_BINS}
              style={{
                width: "240px", height: `${240 * (FREQ_BINS / TIME_COLS)}px`,
                borderRadius: "6px", border: "1px solid #2A2A2A",
                background: "#111", imageRendering: "pixelated",
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ fontSize: "11px", color: "#666", fontFamily: "JetBrains Mono", marginBottom: "4px" }}>PRESETS</div>
            {[
              ["text", "HELLO text"],
              ["rings", "Concentric rings"],
              ["wave", "Sine waves"],
              ["gradient", "Light blobs"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => loadPreset(id)}
                style={{
                  padding: "8px 14px", background: "#1A1A1A", border: "1px solid #2A2A2A",
                  borderRadius: "5px", color: "#AAA", fontSize: "12px", fontFamily: "DM Sans",
                  cursor: "pointer", textAlign: "left", transition: "border-color 0.2s",
                }}
                onMouseEnter={(e) => e.target.style.borderColor = "#444"}
                onMouseLeave={(e) => e.target.style.borderColor = "#2A2A2A"}
              >
                {label}
              </button>
            ))}
            <div style={{ marginTop: "4px" }}>
              <label
                style={{
                  padding: "8px 14px", background: "#1A1A1A", border: "1px solid #2A2A2A",
                  borderRadius: "5px", color: "#AAA", fontSize: "12px", fontFamily: "DM Sans",
                  cursor: "pointer", display: "inline-block",
                }}
              >
                Upload image…
                <input type="file" accept="image/*" onChange={handleUpload} style={{ display: "none" }} />
              </label>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "10px", fontSize: "11px", color: "#555", fontFamily: "JetBrains Mono" }}>
          {TIME_COLS}×{FREQ_BINS} grid · {FREQ_BINS} frequency bins · {MIN_FREQ}–{Math.round(MAX_FREQ / 1000)}k Hz · {duration.toFixed(1)}s duration
        </div>
      </div>

      {/* Step 2: Encode */}
      <div style={{ padding: "24px 28px", borderBottom: "1px solid #1A1A1A", opacity: imageLoaded ? 1 : 0.3, pointerEvents: imageLoaded ? "auto" : "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
          <span style={{
            width: "22px", height: "22px", borderRadius: "50%", background: phase === "ready" || phase === "encoding" ? "#2E7ABF" : "#2A2A2A",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "11px", fontFamily: "JetBrains Mono", color: phase === "ready" ? "#0D0D0D" : "#666",
          }}>2</span>
          <span style={{ fontSize: "13px", fontFamily: "JetBrains Mono", letterSpacing: "0.5px", color: "#999" }}>
            FOURIER ENCODE
          </span>
        </div>

        <button
          onClick={encode}
          disabled={phase === "encoding"}
          style={{
            padding: "10px 24px", background: phase === "encoding" ? "#1A1A1A" : "#2E7ABF20",
            border: `1px solid ${phase === "encoding" ? "#2A2A2A" : "#2E7ABF50"}`,
            borderRadius: "6px", color: phase === "encoding" ? "#555" : "#2E7ABF",
            fontSize: "13px", fontFamily: "JetBrains Mono", cursor: phase === "encoding" ? "default" : "pointer",
            marginBottom: "12px",
          }}
        >
          {phase === "encoding" ? `Synthesizing partials… ${Math.round(encodingProgress * 100)}%` : phase === "ready" ? "Re-encode ↻" : "Encode image → audio"}
        </button>

        {phase === "encoding" && (
          <div style={{ height: "4px", background: "#1A1A1A", borderRadius: "2px", overflow: "hidden", marginBottom: "12px" }}>
            <div style={{ height: "100%", width: `${encodingProgress * 100}%`, background: "#2E7ABF", borderRadius: "2px", transition: "width 0.1s" }} />
          </div>
        )}

        {grid && (
          <div>
            <div style={{ fontSize: "11px", color: "#666", fontFamily: "JetBrains Mono", marginBottom: "6px" }}>
              ENCODED SPECTROGRAM (what the FFT sees)
            </div>
            <canvas
              ref={encodedSpectRef}
              width={480}
              height={200}
              style={{
                width: "100%", maxWidth: "480px", height: "auto",
                borderRadius: "6px", border: "1px solid #2A2A2A",
              }}
            />
          </div>
        )}
      </div>

      {/* Step 3: Play & Reconstruct */}
      <div style={{ padding: "24px 28px", borderBottom: "1px solid #1A1A1A", opacity: phase === "ready" ? 1 : 0.3, pointerEvents: phase === "ready" ? "auto" : "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
          <span style={{
            width: "22px", height: "22px", borderRadius: "50%", background: isPlaying ? "#B87A2E" : "#2A2A2A",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "11px", fontFamily: "JetBrains Mono", color: isPlaying ? "#0D0D0D" : "#666",
          }}>3</span>
          <span style={{ fontSize: "13px", fontFamily: "JetBrains Mono", letterSpacing: "0.5px", color: "#999" }}>
            PLAY & RECONSTRUCT
          </span>
        </div>

        <button
          onClick={play}
          style={{
            padding: "10px 24px", background: isPlaying ? "#B84040" + "20" : "#B87A2E20",
            border: `1px solid ${isPlaying ? "#B84040" + "50" : "#B87A2E50"}`,
            borderRadius: "6px", color: isPlaying ? "#B84040" : "#B87A2E",
            fontSize: "13px", fontFamily: "JetBrains Mono", cursor: "pointer",
            marginBottom: "16px",
          }}
        >
          {isPlaying ? "■ Stop" : "▶ Play audio & watch reconstruction"}
        </button>

        {/* Waveform */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", color: "#666", fontFamily: "JetBrains Mono", marginBottom: "6px" }}>
            WAVEFORM
          </div>
          <canvas
            ref={waveformCanvasRef}
            width={480}
            height={60}
            style={{
              width: "100%", maxWidth: "480px", height: "auto",
              borderRadius: "6px", border: "1px solid #2A2A2A",
            }}
          />
        </div>

        {/* Reconstructed spectrogram */}
        <div>
          <div style={{ fontSize: "11px", color: "#666", fontFamily: "JetBrains Mono", marginBottom: "6px" }}>
            LIVE SPECTROGRAM RECONSTRUCTION (from audio output)
          </div>
          <canvas
            ref={spectrogramCanvasRef}
            width={480}
            height={200}
            style={{
              width: "100%", maxWidth: "480px", height: "auto",
              borderRadius: "6px", border: "1px solid #2A2A2A",
              background: "#0D0D0D",
            }}
          />
        </div>

        {playProgress > 0 && (
          <div style={{ marginTop: "12px", fontSize: "12px", color: "#777", fontFamily: "JetBrains Mono" }}>
            {playProgress >= 0.99
              ? "✓ Image reconstructed from audio. The partials survived."
              : `Reconstructing… ${Math.round(playProgress * 100)}%`}
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: "24px 28px" }}>
        <div style={{ background: "#0A1A0A", borderRadius: "8px", padding: "20px", border: "1px solid #1A3A1A" }}>
          <div style={{ fontSize: "11px", color: "#3A8C3A", fontFamily: "JetBrains Mono", letterSpacing: "1px", marginBottom: "8px" }}>
            WHAT JUST HAPPENED
          </div>
          <p style={{ fontSize: "13px", color: "#999", lineHeight: 1.7, margin: 0 }}>
            Each column of your image became a moment in time. Each row became a frequency. Brightness became amplitude.
            The image was decomposed into {FREQ_BINS} sine wave partials and synthesized into {duration.toFixed(1)} seconds
            of audio at {SAMPLE_RATE.toLocaleString()} Hz. When played back, the Web Audio API's FFT analyzer
            decomposes the audio back into its frequency components — revealing the original image in the spectrogram.
            The arrangement of partials IS the image. It survived the round trip.
          </p>
        </div>
      </div>
    </div>
  );
}
