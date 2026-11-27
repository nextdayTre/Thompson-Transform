// InfWave Cross-Tool Bus — Live BroadcastChannel('bitwave-feed') + Optional BPM Tab Capture
// Compatible with:
//   - The Ramanujan Chime (`js/bitwave-feed.js`: listens on 'bitwave-feed', emits 'bitwave-chime-out')
//   - BitWave (Schema 1-5 `.bitwave.json` documents, 1..8 lanes, 8..256b hex registers)
//
// Pure message parsing and builders run identically in Node (`node --test`) and browsers.

export const CROSS_TOOL_CHANNEL = "bitwave-feed";

function cleanHex(raw) {
  const s = String(raw || "")
    .trim()
    .replace(/^0[xX]/, "")
    .replace(/[\s_-]+/g, "")
    .toUpperCase();
  return /^[0-9A-F]+$/.test(s) ? s : "";
}

/**
 * Pure parser normalizing inbound BroadcastChannel / postMessage payloads from
 * either The Ramanujan Chime (`bitwave-chime-out`) or BitWave (`bitwave-feed`).
 */
export function parseCrossToolMessage(data) {
  if (!data || typeof data !== "object") return null;

  // 1. Chime -> BitWave / InfWave (4-Bit Violin Bow / x2b crystallizer)
  if (data.type === "bitwave-chime-out") {
    const hex = cleanHex(data.hex);
    if (!hex) return null;
    return {
      kind: "chime-out",
      source: data.source || "ramanujan-chime",
      name: data.name || `Chime Bow ${hex.length * 4}b`,
      hex,
      hexList: [hex],
      width: Number(data.width) || hex.length * 4,
      meta: data.meta && typeof data.meta === "object" ? data.meta : null,
    };
  }

  // 2. BitWave / External -> Chime / InfWave (`bitwave-feed` or `bitwave:feed`)
  if (data.type === "bitwave-feed" || data.type === "bitwave:feed") {
    // Ignore our own echoes
    if (data.source === "infwave") return null;
    const payload = data.payload !== undefined ? data.payload : data;

    // Bare hex string
    if (typeof payload === "string") {
      const hex = cleanHex(payload);
      if (!hex) return null;
      return {
        kind: "bitwave-feed",
        source: data.source || "bitwave",
        name: data.name || data.label || `BitWave ${hex.length * 4}b`,
        hex,
        hexList: [hex],
        width: hex.length * 4,
        meta: null,
      };
    }

    // Structured BitWave schema 1-5 document or `{ hex }` object
    if (payload && typeof payload === "object") {
      if (payload.lanes && typeof payload.lanes === "object") {
        const keys = Object.keys(payload.lanes).sort((a, b) => Number(a) - Number(b));
        const hexList = [];
        for (const k of keys) {
          const ln = payload.lanes[k];
          const ha = cleanHex(ln?.a);
          if (ha) hexList.push(ha);
        }
        if (hexList.length === 0) return null;
        return {
          kind: "bitwave-project",
          source: data.source || "bitwave",
          name: data.name || `BitWave ${payload.N || hexList[0].length * 4}b (${hexList.length}L)`,
          hex: hexList[0],
          hexList,
          width: Number(payload.N) || hexList[0].length * 4,
          meta: { schema: payload.schema || 5, laneCount: hexList.length },
        };
      }
      const hex = cleanHex(payload.hex);
      if (hex) {
        return {
          kind: "bitwave-feed",
          source: data.source || "bitwave",
          name: data.name || `BitWave ${hex.length * 4}b`,
          hex,
          hexList: [hex],
          width: Number(payload.width) || hex.length * 4,
          meta: payload.meta || null,
        };
      }
    }
  }

  return null;
}

/**
 * Build canonical outbound payload accepted directly by `Ramanujan Sphere/js/bitwave-feed.js`.
 */
export function buildChimeFeedMessage(payload, { name = "InfWave Bridge" } = {}) {
  return {
    type: "bitwave-feed",
    source: "infwave",
    name,
    payload,
  };
}

/**
 * Build canonical outbound payload matching Chime's `bitwave-chime-out` contract for BitWave receivers.
 */
export function buildBitWaveCrystallizedMessage(hexStr, meta = null) {
  const hex = cleanHex(hexStr);
  return {
    type: "bitwave-chime-out",
    source: "infwave",
    hex,
    width: hex.length * 4,
    meta,
  };
}

/**
 * Open a browser BroadcastChannel('bitwave-feed') session safely (graceful no-op in Node or opaque origins).
 */
export function createCrossToolBus(onMessage) {
  let channel = null;
  let supported = false;

  if (typeof globalThis.BroadcastChannel === "function") {
    try {
      channel = new globalThis.BroadcastChannel(CROSS_TOOL_CHANNEL);
      supported = true;
      channel.onmessage = (ev) => {
        const parsed = parseCrossToolMessage(ev?.data);
        if (parsed && typeof onMessage === "function") {
          onMessage(parsed);
        }
      };
    } catch {
      channel = null;
      supported = false;
    }
  }

  return {
    supported,
    channelName: CROSS_TOOL_CHANNEL,
    sendToChime(payload, opts) {
      if (!channel) return false;
      try {
        channel.postMessage(buildChimeFeedMessage(payload, opts));
        return true;
      } catch {
        return false;
      }
    },
    sendHexOut(hexStr, meta) {
      if (!channel) return false;
      try {
        channel.postMessage(buildBitWaveCrystallizedMessage(hexStr, meta));
        return true;
      } catch {
        return false;
      }
    },
    close() {
      if (channel) {
        try {
          channel.close();
        } catch {
          // ignore close errors
        }
        channel = null;
      }
    },
  };
}

/**
 * Opt-in BPM-locked browser tab/window visual capture (`getDisplayMedia`) for pulling live
 * Ramanujan Chime or BitWave GUI animations straight into InfWave Video-as-Audio frames.
 */
export async function captureDisplayFrames({
  frameCount = 6,
  intervalMs = 250,
  width = 240,
  height = 180,
  breathing = true,
  onProgress = null,
} = {}) {
  if (!navigator?.mediaDevices?.getDisplayMedia) {
    throw new Error("Screen/Tab capture (getDisplayMedia) is unavailable in this browser.");
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30 } },
    audio: false,
  });

  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;

  try {
    await video.play();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const frames = [];
    const total = Math.max(2, Math.min(24, Math.round(frameCount)));
    const waitMs = Math.max(80, Math.min(2000, Math.round(intervalMs)));

    for (let i = 0; i < total; i++) {
      ctx.drawImage(video, 0, 0, width, height);
      const img = ctx.getImageData(0, 0, width, height);
      frames.push({
        index: i,
        title: `Capture #${i + 1}`,
        polarity: breathing ? (i % 2 === 0 ? "pos" : "neg") : "pos",
        rgba: new Uint8ClampedArray(img.data),
        width,
        height,
      });
      if (onProgress) onProgress((i + 1) / total);
      if (i + 1 < total) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    return frames;
  } finally {
    stream.getTracks().forEach((tr) => tr.stop());
    video.srcObject = null;
  }
}
