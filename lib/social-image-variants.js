// lib/social-image-variants.js
//
// Turns ONE source image (a square product mockup, or a hero photo) into the
// four platform ratio variants the Post Queue uses, so social posts aren't a
// square jammed into every network.
//
//   landscape 1200x630  (FB / LinkedIn / GBP)   square 1200x1200 (Instagram)
//   wide      1200x675  (X / Twitter)           portrait 1200x1500 (Pinterest / TikTok)
//
// Two modes:
//   - "pad"   : place the whole image, scaled to fit, centred on a branded
//               navy canvas. Keeps a product mockup fully visible (nothing
//               cropped) and looks like an intentional social card.
//   - "cover" : crop-to-fill. Better for photographic hero images.
//
// Each variant is re-hosted to Vercel Blob and its URL returned. Never throws
// fatally — returns null on any failure so the caller falls back to the single
// image in all buckets.
//
// Author: Travelgenix
// Date:   16 June 2026

const sharp = require("sharp");
const { put } = require("@vercel/blob");

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

// Brand navy (#0F172A) canvas, matching the Travelgenix design tokens.
const BRAND_BG = { r: 15, g: 23, b: 42, alpha: 1 };

const RATIOS = {
  landscape: { w: 1200, h: 630 },
  square:    { w: 1200, h: 1200 },
  wide:      { w: 1200, h: 675 },
  portrait:  { w: 1200, h: 1500 }
};

async function fetchBuffer(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`source fetch ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf || buf.length === 0) throw new Error("empty source image");
  return buf;
}

async function renderPad(srcBuf, w, h) {
  // Scale the whole image to fit inside the canvas with an 8% margin, centred.
  const pad = Math.round(Math.min(w, h) * 0.08);
  const inner = await sharp(srcBuf)
    .resize(w - 2 * pad, h - 2 * pad, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
  const meta = await sharp(inner).metadata();
  const left = Math.max(0, Math.round((w - (meta.width || w)) / 2));
  const top = Math.max(0, Math.round((h - (meta.height || h)) / 2));
  return sharp({ create: { width: w, height: h, channels: 4, background: BRAND_BG } })
    .composite([{ input: inner, left, top }])
    .png()
    .toBuffer();
}

async function renderCover(srcBuf, w, h) {
  return sharp(srcBuf).resize(w, h, { fit: "cover", position: "centre" }).png().toBuffer();
}

async function uploadBlob(buf, tenantId, tag) {
  const filename = `luna-marketing/${tenantId || "shared"}/social/${Date.now()}-${tag}-${Math.random().toString(36).slice(2, 8)}.png`;
  const blob = await put(filename, buf, {
    access: "public",
    contentType: "image/png",
    addRandomSuffix: false,
    token: BLOB_TOKEN
  });
  return blob.url;
}

/**
 * Build the four ratio variants for a source image.
 *
 * @param {string} sourceUrl
 * @param {Object} opts
 * @param {string} [opts.tenantId]
 * @param {"pad"|"cover"} [opts.mode="pad"]
 * @returns {Promise<{landscape, square, wide, portrait}|null>}
 */
async function buildBrandedVariants(sourceUrl, opts = {}) {
  if (!sourceUrl) return null;
  if (!BLOB_TOKEN) { console.warn("[social-image-variants] BLOB token missing"); return null; }
  const mode = opts.mode === "cover" ? "cover" : "pad";
  try {
    const srcBuf = await fetchBuffer(sourceUrl);
    const out = {};
    for (const key of Object.keys(RATIOS)) {
      const { w, h } = RATIOS[key];
      const buf = mode === "cover" ? await renderCover(srcBuf, w, h) : await renderPad(srcBuf, w, h);
      out[key] = await uploadBlob(buf, opts.tenantId, key);
    }
    return out;
  } catch (e) {
    console.warn("[social-image-variants] failed (non-fatal):", e.message);
    return null;
  }
}

module.exports = { buildBrandedVariants, _internals: { RATIOS, BRAND_BG } };
