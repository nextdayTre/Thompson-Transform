# Video-as-Audio Demo & Procedural Image-Synthesis Architecture

**Date:** 2026-11-25  
**Preserved Implementation Snapshot:** [`nextdayTre/spectral-timeline`](https://github.com/nextdayTre/spectral-timeline)  
- **Pinned Commit:** `e69cff5`  
- **Frozen Branch:** [`snapshot/video-cartridge-demo`](https://github.com/nextdayTre/spectral-timeline/tree/snapshot/video-cartridge-demo)  
- **Immutable Tag:** [`v0.1.0-video-cartridge-demo`](https://github.com/nextdayTre/spectral-timeline/releases/tag/v0.1.0-video-cartridge-demo)  
- **Live GitHub Pages Demo:** https://nextdaytre.github.io/spectral-timeline/

---

## 1. Purpose & Repo-Split Strategy

`Thompson-Transform` holds the original theoretical conjectures (*Spectral Persistence*, *Substrate Independence*, *Psychoacoustic Exploitation*, and *Multimodal Bridging*) alongside a minimal React/Vite roundtrip skeleton.

This document captures the full functional, mathematical, and procedural progress achieved during the **Spectral Timeline Video-as-Audio & Synth-Cartridge** milestone (`e69cff5`) so it can serve as a **clean, bloat-free building resource** when constructing separate creative image-synthesis tools on top of the `Thompson-Transform` skeleton—without pulling in Media Bay / Timeline / DAW editor bloat.

---

## 2. Core Conceptual Leap: From Static Image Roundtrip to Dynamic Video-as-Audio

The original `Thompson-Transform` demo encodes a single static image into audio PCM and decodes it back via an STFT spectrogram. Three compounding ideas turned that static roundtrip into a real-time musical video-as-audio system:

### 2.1 Endomorphic Polarity Alternation ("Breathing" Cycle)
Instead of rendering every frame as bright content on a dark background, consecutive time-synced windows alternate **figure/ground polarity**:
- **Positive Slot (`+ POS`, frame $n$):** Content = bright partials (`1.0`), background = silent black (`0.0`). Acoustically sparse, airy, low RMS.
- **Negative Slot (`− NEG`, frame $n+1$):** Content = carved silence (`0.0`), background = full-band active spectral bed (`1.0`). Acoustically lush, dense, high RMS with resonant anti-formant cavities forming the visual silhouette.

**Critical DSP Laws Discovered:**
1. **Schroeder Minimum-Crest Phase Law:**
   $$\phi_k = \frac{\pi k(k - 1)}{P}$$
   Essential for dense `− NEG` frames. Zero-phase sums constructively into extreme crest-factor spikes (~15×) that crush normalized RMS; Schroeder phase keeps full-band spectral beds smooth, flat, and click-free.
2. **Preserve Breathing Contrast:** Per-column RMS equalization (`col_eq_alpha`) and Bark crowding compensation MUST be bypassed (`0.0`) whenever inverted slots are present; otherwise equalization flattens the natural inhale/exhale dynamic envelope (`pos ≈ -19 dB` vs. `neg ≈ -8 to -9 dB`).

### 2.2 Exact 4-State Endomorphic Seam Delta & The XNOR Stroboscope Identity
Given two consecutive aligned $[P \times C]$ planes $A$ (frame $n$) and $B$ (frame $n+1$) normalized to $[0, 1]$ *after* polarity is applied, every pixel partitions cleanly into four transition states that sum identically to $1.0$:

| State | Formula | Acoustic / Visual Meaning |
| :--- | :--- | :--- |
| **Sustained ON (`1 → 1`)** | $s_{11} = A \cdot B$ | Active partial carries continuously across the seam |
| **Quenched (`1 → 0`)** | $s_{10} = A(1 - B)$ | Downward transient collapse (overlapping ink collapses on `pos → neg`) |
| **Ignited (`0 → 1`)** | $s_{01} = (1 - A)B$ | Upward energy bloom (foreground disperses into the next frame's bed) |
| **Sustained OFF (`0 → 0`)** | $s_{00} = (1 - A)(1 - B)$ | Silent pocket remains silent |

**Derived Analytical Vectors per Seam:**
- **Dispersion Ratio:** $R = \frac{\overline{s_{01}}}{\max(\overline{s_{10}},\, 10^{-6})}$
- **Signed Flux:** $\overline{B - A} = \overline{s_{01}} - \overline{s_{10}}$
- **Rectified Flux:** $\overline{|B - A|}$
- **Vertical Spectral Optical Flow ($\Delta\text{Centroid}$ Hz):** Shift in energy-weighted mean partial frequency across the seam.

**The Stroboscope Identity:** On an alternating polarity seam ($A = M(g_n)$, $B = 1 - M(g_{n+1})$) with binary masks:
$$|B - A| = |(1 - M(g_{n+1})) - M(g_n)| = \text{XNOR}\big(M(g_n),\, M(g_{n+1})\big)$$
$$\sum |B - A| = (P \cdot C) - d_{\text{Hamming}}\big(M(g_n),\, M(g_{n+1})\big)$$
Unchanged regions strobe at **100% contrast flip** while mutating regions smear smoothly—acting as a temporal lock-in detector for invariants, fixed points, and periodic orbits.

### 2.3 Neuromorphic Event-Camera (`+ON / −OFF`) & BPM-Synced Video-as-Audio
Fighting 4K 60fps video inside an audio spectrogram hits the **Gabor Time-Frequency Uncertainty Wall** ($\Delta t \cdot \Delta f \ge \frac{1}{4\pi}$). Two design choices turn that constraint into a creative superpower:
1. **Sync Frame Rate to Musical BPM:** Lock slot duration $\Delta T = \frac{60}{\text{BPM}} \times \text{beats/frame}$ (e.g., `120 BPM × 1/4 beat = 0.125 s` → `8 fps`, or `1/2 beat = 0.25 s` → `4 fps`). Both ear and eye lock onto the rhythmic pulse instead of demanding cinema frame rates.
2. **Neuromorphic Event-Camera Audio (`frame[k] − frame[k-1]`):**
   - Static backgrounds drop to **pure dead silence (`0.0`)**.
   - **Advancing edges (`Δ > +threshold`)** fire **`+ON`** events → routed to **Left channel (`R`)** (cyan visually).
   - **Receding edges (`Δ < −threshold`)** fire **`−OFF`** events → routed to **Right channel (`G`)** (amber-red visually).
   - **Phosphor Persistence Trail (`decay ∈ [0.0, 0.72]`):** Exponential decay $v_k = \max(\text{raw}_k,\, \text{decay} \cdot v_{k-1})$ gives fast motion glowing oscilloscope sonar afterimages and smoother sonic tails.
   - **Automatic Scene-Cut Percussion:** A hard camera/scene cut creates a massive full-spectrum $\Delta$ spike (`peakCutIdx`), functioning automatically as a musical impact drop.
   - **Three Synth Source Modes:**
     - `full`: Full frame with `+ / −` breathing alternation.
     - `event`: Pure stereo Event-Cam motion (`+ON` Left / `−OFF` Right).
     - `hybrid`: `24%` breathing silhouette bed + `100%` Event-Cam motion transients.

---

## 3. Procedural Visual Generators (Zero External Assets, 100% Deterministic)

All generators in `spectral-timeline/js/glyph_grid.js` output pure `Uint8ClampedArray` RGBA buffers with zero OS font dependencies or external image files:

### 3.1 Polar-SDF Shape Morph (`Triangle → Circle → Triangle → Square → Loop`)
Regular $N$-gon polar radius function centered at $(0,0)$:
$$r_N(\theta) = \frac{R \cos(\pi / N)}{\cos\!\Big(\big((\theta - \theta_0) \bmod \frac{2\pi}{N}\big) - \frac{\pi}{N}\Big)}$$
- Smoothstep interpolation $s = 3t^2 - 2t^3$ between $r_A(\theta)$ and $r_B(\theta)$ across 4 seamless legs (`Tri→Cir`, `Cir→Tri`, `Tri→Sq`, `Sq→Tri`).
- Two render styles: **`outline`** (glowing sonar contour + optical center dot, crispest for Event-Cam) and **`solid`** (filled silhouette for maximum `+ / −` RMS breathing bloom).

### 3.2 Procedural "Plasma Sphere + Golden Aura + Hard Cut" Showreel
Zero-KB original test sequence designed to exercise Event-Cam, Chromatic Timbre Routing, and Scene-Cut Detection simultaneously:
- **Frames `0..15`:** Expanding cyan energy sphere with concentric shock rings (lower-left → low/mid Hz, cool chroma) + spiky flickering golden plasma aura with dark core silhouette (upper-right → high Hz, warm chroma).
- **Frames `16..23` (Hard Cut at `#17`):** Sudden cut to rocky horizon + upward pink/crimson shockwave + pulsing foreground silhouette, triggering peak motion delta `Δ ≈ 0.32` right on beat 17.

### 3.3 Uniform Pixel-Box Bitmap Font & `secp256k1` `K / K·G` Generator
- Pure-JS 5×7 monospace bitmap font scaled via nearest-neighbor into strict `(cellW × cellH)` uniform pixel-boxes with guard margins so consecutive frames align pixel-for-pixel.
- Pure-JS `BigInt` elliptic-curve scalar multiplication on `secp256k1` (verified against `1G`, `2G`, `3G` compressed vectors):
  - `66_header` (`3 × 22` slots): `"00" + K` (`+ POS`) aligned 1:1 with `("02"|"03") + x(K·G)` (`− NEG`).
  - `64_payload` (`4 × 16` slots): 64-char `K` vs. 64-char `x(K·G)`.
  - `rx11_lower` band mode: places glyphs in the lower ~45% with pure black silence above.

---

## 4. Synthesis Backends & Wire Protocols

### 4.1 Primary Real-Time Backend: Fragment Audio Server (`grz0zrg/fas v2.0.2`)
Rather than fighting browser CPU limits with custom oscillator loops, the frontend streams 1-pixel-wide vertical RGBA slices at `60 fps` (or `120 fps`) over loopback WebSocket (`ws://127.0.0.1:3003`, permitted directly from HTTPS GitHub Pages) to the native C11 **Fragment Audio Server (`fas.exe`)** — unlocking `512–1024` native oscillators and 10+ live synthesis engines (`Additive`, `Spectral afSTFT`, `FM`, `Subtractive PolyBLEP`, `Wavetable`, `Bandpass`, `Formant`, `Phase Distortion`, `String Resonator`, `Modal`).

**Verified Little-Endian Binary Wire Protocol (`js/fas_client.js`):**

| Packet ID | Name | Size (bytes) | Exact Layout |
| :---: | :--- | :---: | :--- |
| `0` | `BANK_SETTINGS` | `32` | `u8[0]=0`, `u32[8..19]=[h, octaves, data_type(0=u8,1=f32)]`, `f64[24..31]=base_freq` |
| `1` | `FRAME_DATA` | `16 + h*4` | `u8[0]=1`, `u32[8..11]=1` (instruments), `u8[16..]` = bottom-up RGBA slice (`idx 0 = base_freq`, `idx h-1 = max_freq`) |
| `2` | `SYNTH_SETTINGS` | `24` | `u8[0]=2`, `u8[8]=target (0=fps, 1=gain)`, `f64[16..23]=value` |
| `3` | `CHN_SETTINGS` | `24` | `u8[0]=3`, `u32[8..15]=[chn, target (0=mute, 1=out)]`, `f64[16..23]=value` |
| `5` | `ACTION` | `8` | `u8[0]=5`, `u8[1]=type (4=PAUSE, 5=PLAY)` |
| `6` | `INSTRUMENT_SETTINGS` | `24` | `u8[0]=6`, `u32[8..15]=[inst, target (0=method, 1=mute, 2=out)]`, `f64[16..23]=value` (`method=15` = `FAS_VOID` sentinel on inst `1`) |
| `0` *(S→C)* | `STREAM_INFOS` | `16` | `i32[0..7]=[0, cpu_load_pct]`, `f64[8..15]=latency_ms` |

**Channel Semantics & Chromatic Timbre Routing:**
- `R` = Left channel amplitude (`0..255`), `G` = Right channel amplitude (`0..255`).
- `B` = Secondary FAS synthesis parameter (FM index / filter / timbre). Routing normalized **color warmth** (`warmth = (0.5 + 0.5*(R-B)) * (0.25 + 0.75*sat)`, yielding `0.86` for golden aura vs. `0.07` for cyan sphere) into `B` automatically differentiates color regions by timbre in FAS `FM` / `Formant` / `Modal` modes.
- `A` = `255`.

### 4.2 Pure-JS Offline Fallback (Coupled-Rotation Additive Synth + RIFF WAV)
When FAS is offline, a module Web Worker (`js/synth_worker.js` + `js/dsp.js`) synthesizes lossless mono audio using a **coupled trigonometric rotation recurrence** per active partial:
$$u_{n+1} = c \cdot u_n - s \cdot v_n, \qquad v_{n+1} = s \cdot u_n + c \cdot v_n$$
(renormalizing every 4096 samples), running ~10× faster than per-sample `Math.sin()` (~20–55 ms for multi-clip 48 kHz renders) and encoding pure **16-bit PCM**, **24-bit PCM**, or **32-bit IEEE Float (`wFormatTag=3` + `fact` chunk)** RIFF WAV directly in the browser.

### 4.3 Dual Flipbook Resolution Insight
Decoupling the **Visual Flipbook** (`240×135` crisp 16:9 canvas with phosphor trail) from the **Audio Grid** (`[h, C]` where fast `8 fps` slots have only ~8 columns wide at `60 fps`) lets users switch live between:
- **`Hi-Res 16:9`:** Crisp anime/morph Event-Cam detail.
- **`Sonar Grid`:** Quantized horizontal kinetic neon-bar pulse synchronized directly to the audio oscillator columns.

---

## 5. Dual-Layer `APIC` MP3 Synth-Cartridge ("Blurry MP3 + Cover-Art Expansion Math")

This realizes the **Psychoacoustic Exploitation + Multimodal Bridging** conjecture of the Thompson Transform as a practical file-sharing format (`js/mp3_cartridge.js`):

### Information-Theory Boundary
- **Parametric / Procedural Sequences** (`shape_morph`, `plasma_showreel`, `secp256k1`, `text_card`): Entire lossless expansion math fits in **28–250 bytes** → **100% bit-exact lossless expansion** from a tiny `~35–65 KB` MP3.
- **Arbitrary Raster Frames** (e.g., 100 uploaded anime PNGs): Cannot fit raw megabytes inside a `512×512` cover; the MP3 carries the playable audio + mosaic cover preview while procedural recipes expand losslessly.

### Two Redundant Expansion Layers Inside One `512×512` `APIC` Cover
1. **Playable Audio Payload:** Encoded client-side to MPEG-1 Layer III (`64 / 96 / 128 kbps`) via vendored `js/vendor/lame.min.js` (`156 KB`, zero WASM/CDN) and wrapped with a pure-JS **ID3v2.3** tag (`TIT2`, `TALB`, `APIC`, and per-slot `CHAP` timestamps).
2. **Layer 1 — Lossless PNG `tEXt` Chunk (`"SpectralCartridge"`):** Pure-JS CRC32 PNG chunk injector embeds the complete JSON recipe before `IEND`. Instant exact decode when the `.mp3` is shared untouched.
3. **Layer 2 — JPEG-Resilient `8×8` Macro-Block Binary Strip (Top `32 px` = `4 × 64` blocks):**
   - `2×2` checkerboard sync corners (top-left & top-right).
   - **28-byte (224-bit) compact binary header** (`"SC"` magic, version, recipe type, `bpm×10`, `bpf×100`, frame/pair count, flags bitfield, `trail×100`, `fasMethod`, `fasHeight/8`, low-64-bit scalar `K`, `slotMs`, `numClips`, and **`CRC16`**) painted as high-contrast `8×8` black/white macro-blocks (cols `3..60`, rows `0..3`).
   - Inner-50% block luma sampling survives resizing to `500×500` and heavy JPEG-style noise (`±28` luma perturbation verified in `test_node.mjs`).
4. **Drop-to-Expand + Live `A/B` Playback:** Dropping a Cartridge `.mp3` onto the browser decodes both the raw compressed MP3 audio (for **`A: Blurry MP3`** playback) and the `APIC` cover art (Layer 1 → automatic Layer 2 fallback) to regenerate the crisp **`B: Expanded`** video + 512-oscillator audio live.

---

## 6. Clean Reuse Blueprint for `Thompson-Transform`

To build a separate, bloat-free creative image-synthesis tool on top of the `Thompson-Transform` React/Vite skeleton, import only the pure, UI-agnostic ES modules you need from [`nextdayTre/spectral-timeline` (`v0.1.0-video-cartridge-demo`)](https://github.com/nextdayTre/spectral-timeline/tree/v0.1.0-video-cartridge-demo):

| Pure ES Module (Zero DOM / Zero React Deps) | What It Gives a New Creative Tool |
| :--- | :--- |
| `js/dsp.js` | Bottom-anchored conditioning, `+ / −` polarity, 4-state Endomorphic Seam Deltas, Event-Cam `+ON / −OFF` + phosphor trail, Chroma warmth map, coupled-rotation Schroeder additive synth, radix-2 STFT, 16b/24b/32f RIFF WAV encoder |
| `js/glyph_grid.js` | Polar-SDF shape morph (`Tri→Cir→Tri→Sq`), procedural Plasma Sphere + Cut, 5×7 uniform pixel-box bitmap renderer, pure-JS `BigInt` `secp256k1` |
| `js/fas_client.js` | Exact `grz0zrg/fas v2.0.2` binary WebSocket client & 60/120 fps vertical slice streamer |
| `js/mp3_cartridge.js` + `js/vendor/lame.min.js` | Pure-JS client-side MP3 encoding, ID3v2.3 `APIC` + `CHAP` writer/parser, PNG `tEXt` chunk codec, and JPEG-safe `8×8` macro-block strip encoder/decoder |

Every module above is verified by `node test_node.mjs` (**9/9 checks passing** at tag `v0.1.0-video-cartridge-demo`) and can be dropped straight into `Thompson-Transform/src/` without bringing over any timeline or editor UI code.
