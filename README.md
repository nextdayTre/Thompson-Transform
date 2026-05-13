# Thompson Transform: Spectral Persistence & Roundtrip Demo

Thompson Transform is an exploration into the intersection of signal theory and information economics. This project demonstrates the encoding of images into sound (via Fourier decomposition) and decoding them back into images (via spectrograms). 

It challenges the conventional idea of data compression by showing that while transforming an image into raw audio PCM is vastly larger than standard compression algorithms like JPEG or WebP, the transformed signal gains unique properties:
- **Substrate Independence:** The data can survive analog transmission, D/A/D conversion, and acoustic propagation.
- **Robustness:** Partials degrade gracefully. Instead of a corrupted file, noise in the spectral domain merely adds haze to the image.
- **Steganography:** The visual data hides in plain sight as audio.
- **Multimodal Bridging:** The same file is simultaneously sound and image.

## Features

This repository contains two main React components:

1. **Spectral Persistence (`spectral_persistence.jsx`)**
   A deep dive into the theory and economics of spectral encoding. It walks through the journey of a signal (from raw pixels to electromagnetic waves to acoustic propagation and back) and provides an interactive economic analysis of file sizes, cloud storage costs, and transmission overhead compared to standard image formats.

2. **Spectral Roundtrip Demo (`spectral_roundtrip_demo.jsx`)**
   A live demonstration that allows you to:
   - Upload an image or select a preset pattern.
   - Encode the image into an audio buffer by mapping columns to time and rows to frequency bins.
   - Play back the audio and watch the image reconstruct in real-time via a live spectrogram.

## Hosting & Live Demo

This repository is designed to be hosted as a live portfolio piece via GitHub Pages.

### To Run Locally
1. `npm install`
2. `npm run dev`

### To Build
1. `npm run build`

## License

MIT License. See `LICENSE` for details.
