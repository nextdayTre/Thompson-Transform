# InfWave (Information Wave): Spectral Persistence & Endomorphic Audio

**InfWave** *(formerly Thompson Transform)* is the high-level **Information Wave** counterpart to **BitWave** *(Binary Wave)* and **The Ramanujan Chime** *(3D Hollow-Vessel Geometry)*. Rooted in the intersection of signal theory and information economics, InfWave explores encoding images, video frames, and structured parametric states into sound (via Fourier / additive spectral decomposition and modulated carriers) and decoding them back into visuals (via spectrograms and analytic carrier envelopes).

It challenges the conventional idea of data compression by showing that while transforming an image into raw audio PCM (WAV) is vastly larger than standard compression algorithms like JPEG or WebP, the transformed signal gains unique properties:
- **Substrate Independence:** The data can survive analog transmission, D/A/D conversion, and acoustic propagation.
- **Robustness:** Partials degrade gracefully. Instead of a corrupted file, noise in the spectral domain merely adds haze to the image.
- **Steganography:** The visual data hides in plain sight as audio.
- **Psychoacoustic Exploitation (MP3):** By mapping image data to specific frequency bands ("Safe Zones" between 500Hz-8kHz), the signal can exploit MP3 compression algorithms, dramatically reducing file size while surviving lossy encoding.
- **Multimodal Bridging:** The same file is simultaneously sound and image.

## Features

This repository contains two main React components:

1. **Spectral Persistence (`spectral_persistence.jsx`)**
   A deep dive into the theory and economics of spectral encoding. It walks through the journey of a signal (from raw pixels to electromagnetic waves to acoustic propagation and back) and provides an interactive economic analysis of file sizes, cloud storage costs, and transmission overhead compared to standard image formats. It also features a togglable **MP3 Psychoacoustic Analysis** that maps human hearing sensitivity to demonstrate how spectral images can survive lossy compression.

2. **Spectral Roundtrip Demo (`spectral_roundtrip_demo.jsx`)**
   A live demonstration that allows you to:
   - Upload an image or select a preset pattern.
   - Encode the image into an audio buffer by mapping columns to time and rows to frequency bins.
   - Play back the audio and watch the image reconstruct in real-time via a live spectrogram.

## Research & Architecture Notes

- **[The Infinite Compassion — Cross-Tool System Reference & Handoff](./INFINITE-COMPASSION-HANDOFF.md)** — Three-tool endomorphic loop uniting **InfWave** (Information Wave), **The Ramanujan Chime**, and **BitWave** (Binary Wave).
- **[Video-as-Audio Demo & Procedural Architecture](./docs/VIDEO_DEMO_AND_PROCEDURAL_ARCHITECTURE.md)** — Preserved functional & mathematical specification from the [`spectral-timeline` (`v0.1.0-video-cartridge-demo`)](https://github.com/nextdayTre/spectral-timeline/releases/tag/v0.1.0-video-cartridge-demo) milestone (Endomorphic `+ / −` Breathing polarity, 4-state Seam Deltas, BPM Polar-SDF Shape Morph, Neuromorphic Event-Cam `+ON / −OFF` stereo synthesis, Fragment Audio Server `grz0zrg/fas v2.0.2` wire protocol, and Dual-Layer `APIC` MP3 Synth-Cartridges), structured as a clean, bloat-free building resource for separate creative image-synthesis tools.

## Hosting & Live Demo

This repository is designed to be hosted as a live portfolio piece via GitHub Pages.

### To Run Locally
1. `npm install`
2. `npm run dev`

### To Build
1. `npm run build`

## License

MIT License. See `LICENSE` for details.
