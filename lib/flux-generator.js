// lib/flux-generator.js
//
// FLUX 1.1 Pro Ultra image generation via Replicate.
//
// What this does:
//   1. POST to Replicate to start a prediction with the prompt + parameters
//   2. Poll the prediction endpoint every 1.5s until status is "succeeded" or "failed"
//   3. Download the resulting PNG from Replicate's CDN
//   4. Resize/crop to the requested email slot dimensions using sharp
//   5. Upload the final PNG to Vercel Blob
//   6. Return our own Blob URL + metadata
//
// Why we re-host: Replicate's image URLs expire after ~1 hour. If we kept
// the original URL in a saved email draft, the image would 404 by the time
// a recipient opened it. By copying to Blob immediately, the URL is stable.
//
// Author: Travelgenix
// Date:   18 May 2026

const { put } = require("@vercel/blob");
const sharp = require("sharp");

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

// FLUX 1.1 Pro Ultra model identifier on Replicate
const FLUX_MODEL = "black-forest-labs/flux-1.1-pro-ultra";
const REPLICATE_API = "https://api.replicate.com/v1";

// Polling configuration
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 60; // 90 seconds max — well within our function budget

// Email slot dimensions and their nearest FLUX-supported aspect ratio
const SLOT_TO_FLUX = {
  "hero":          { aspectRatio: "16:9",  finalWidth: 600, finalHeight: 320 },
  "hero-square":   { aspectRatio: "1:1",   finalWidth: 600, finalHeight: 600 },
  "feature-story": { aspectRatio: "21:9",  finalWidth: 600, finalHeight: 240 },
  "card":          { aspectRatio: "4:3",   finalWidth: 280, finalHeight: 200 },
  "thumbnail":     { aspectRatio: "1:1",   finalWidth: 200, finalHeight: 200 },
  "banner":        { aspectRatio: "3:1",   finalWidth: 600, finalHeight: 180 }
};

// FLUX-supported aspect ratios (anything else gets approximated then cropped)
const FLUX_SUPPORTED_RATIOS = ["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16", "9:21"];

// ─────────────────────────────────────────────────────────────────────
// REPLICATE API HELPERS
// ─────────────────────────────────────────────────────────────────────

async function startPrediction(input) {
  const res = await fetch(`${REPLICATE_API}/models/${FLUX_MODEL}/predictions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
      "Prefer": "wait=0" // don't wait at this step — we'll poll
    },
    body: JSON.stringify({ input })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Replicate start failed (${res.status}): ${txt.slice(0, 300)}`);
  }

  const data = await res.json();
  return data; // { id, status, urls: { get, cancel }, ... }
}

async function pollPrediction(predictionId) {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${REPLICATE_API}/predictions/${predictionId}`, {
      headers: { "Authorization": `Bearer ${REPLICATE_API_TOKEN}` }
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Replicate poll failed (${res.status}): ${txt.slice(0, 200)}`);
    }

    const data = await res.json();

    if (data.status === "succeeded") return data;
    if (data.status === "failed") {
      throw new Error(`Prediction failed: ${data.error || "no error message"}`);
    }
    if (data.status === "canceled") {
      throw new Error("Prediction was canceled");
    }
    // status is "starting" or "processing" — continue polling
  }

  throw new Error(`Prediction timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`);
}

// ─────────────────────────────────────────────────────────────────────
// IMAGE PROCESSING
// ─────────────────────────────────────────────────────────────────────

async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function resizeForSlot(pngBuffer, slot) {
  const target = SLOT_TO_FLUX[slot] || SLOT_TO_FLUX["hero"];
  return sharp(pngBuffer)
    .resize(target.finalWidth, target.finalHeight, {
      fit: "cover",         // crop if needed, never distort
      position: "centre"
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function uploadToBlob(pngBuffer, filename) {
  if (!BLOB_TOKEN) {
    return { url: null, error: "BLOB_READ_WRITE_TOKEN not configured" };
  }
  try {
    const blob = await put(filename, pngBuffer, {
      access: "public",
      contentType: "image/png",
      addRandomSuffix: false,
      token: BLOB_TOKEN
    });
    return { url: blob.url, error: null };
  } catch (e) {
    return { url: null, error: `Blob upload failed: ${e.message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────
// PROMPT ENRICHMENT
// ─────────────────────────────────────────────────────────────────────

/**
 * Enrich a basic brief with Travelgenix-specific style guidance.
 * FLUX responds well to detailed prompts that specify:
 *   - subject matter
 *   - composition (close-up, wide shot, etc)
 *   - lighting (golden hour, soft natural light, etc)
 *   - mood (aspirational, calm, energetic)
 *   - photographic style (editorial, documentary, commercial)
 *
 * The user can pass a raw prompt OR a "brief" that we enrich.
 */
function enrichBrief(brief, options = {}) {
  if (!brief) return "";

  // If the user has already written a detailed FLUX-style prompt, use it as-is
  if (options.rawPrompt === true) return brief;

  // Otherwise enrich with default Travelgenix photographic style
  const enrichments = [
    brief,
    "Editorial travel photography style.",
    "Natural light, soft warm tones.",
    "High detail, professional commercial photography.",
    "Aspirational mood, magazine quality.",
    "No text overlays, no logos, no watermarks."
  ];

  return enrichments.join(" ");
}

// ─────────────────────────────────────────────────────────────────────
// MAIN GENERATE FUNCTION
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate a FLUX 1.1 Pro Ultra image.
 *
 * @param {Object} input
 * @param {string} input.brief — Description of what to generate
 * @param {string} [input.slot] — Email slot key (determines aspect ratio + final size)
 * @param {string} [input.aspectRatio] — Override slot's aspect ratio
 * @param {boolean} [input.raw] — Less stylised, more photographic. Default false.
 * @param {number} [input.safetyTolerance] — 1-6, default 2
 * @param {boolean} [input.rawPrompt] — Skip enrichment, use brief as-is
 * @param {string} [input.tenantId] — For Blob path prefixing
 *
 * @returns {Promise<{ ok, pngUrl, width, height, originalUrl, finalPrompt, elapsedMs, predictionId }>}
 */
async function generateFluxImage(input) {
  if (!REPLICATE_API_TOKEN) {
    return { ok: false, error: "REPLICATE_API_TOKEN not configured" };
  }
  if (!input || !input.brief || typeof input.brief !== "string") {
    return { ok: false, error: "brief is required" };
  }

  const slot = input.slot && SLOT_TO_FLUX[input.slot] ? input.slot : "hero";
  const slotConfig = SLOT_TO_FLUX[slot];
  const aspectRatio = input.aspectRatio && FLUX_SUPPORTED_RATIOS.includes(input.aspectRatio)
    ? input.aspectRatio
    : slotConfig.aspectRatio;
  const tenantId = input.tenantId || "shared";
  const safetyTolerance = Math.max(1, Math.min(6, parseInt(input.safetyTolerance, 10) || 2));
  const raw = input.raw === true;

  const finalPrompt = enrichBrief(input.brief, { rawPrompt: input.rawPrompt });

  const startedAt = Date.now();
  let prediction;

  try {
    prediction = await startPrediction({
      prompt: finalPrompt,
      aspect_ratio: aspectRatio,
      output_format: "png",
      safety_tolerance: safetyTolerance,
      raw: raw
    });
  } catch (e) {
    return { ok: false, error: `Replicate start error: ${e.message}` };
  }

  let result;
  try {
    result = await pollPrediction(prediction.id);
  } catch (e) {
    return { ok: false, error: e.message, predictionId: prediction.id };
  }

  // FLUX returns the image URL as a string (for single-image models)
  // The output shape can be either a string URL or an array — handle both
  let originalUrl;
  if (typeof result.output === "string") {
    originalUrl = result.output;
  } else if (Array.isArray(result.output) && result.output.length > 0) {
    originalUrl = result.output[0];
  } else {
    return { ok: false, error: "No image URL in Replicate response", predictionId: prediction.id };
  }

  // Download the image from Replicate's CDN
  let pngBuffer;
  try {
    pngBuffer = await downloadImage(originalUrl);
  } catch (e) {
    return { ok: false, error: `Download failed: ${e.message}`, originalUrl, predictionId: prediction.id };
  }

  // Resize/crop to the exact email slot dimensions
  let resized;
  try {
    resized = await resizeForSlot(pngBuffer, slot);
  } catch (e) {
    return { ok: false, error: `Resize failed: ${e.message}`, originalUrl, predictionId: prediction.id };
  }

  // Upload to our Blob
  const filename = `luna-marketing/${tenantId}/flux/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.png`;
  const { url, error: uploadError } = await uploadToBlob(resized, filename);
  if (!url) {
    return { ok: false, error: uploadError, originalUrl, predictionId: prediction.id };
  }

  return {
    ok: true,
    pngUrl: url,
    originalUrl,
    width: slotConfig.finalWidth,
    height: slotConfig.finalHeight,
    aspectRatio,
    slot,
    finalPrompt,
    elapsedMs: Date.now() - startedAt,
    predictionId: prediction.id,
    metrics: result.metrics
  };
}

module.exports = {
  generateFluxImage,
  SLOT_TO_FLUX,
  FLUX_SUPPORTED_RATIOS,
  _internals: { enrichBrief, startPrediction, pollPrediction, resizeForSlot }
};
