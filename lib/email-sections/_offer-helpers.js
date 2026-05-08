// lib/email-sections/_offer-helpers.js
//
// Shared rendering helpers for every offer-* email section. Mirrors the
// formatters in widget-offers.js so the email and the widget present the
// same offer identically.

const { BRAND, FONTS } = require("../email-brand");
const { escHtml, safeUrl } = require("./_helpers");

// ── Formatters (lifted from widget-offers.js) ─────────────────────────

function formatEnum(s) {
  if (!s) return "";
  return String(s).replace(/([A-Z])/g, " $1").trim();
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function paxString(o) {
  const a = o.adults || 0;
  const c = o.children || 0;
  const i = o.infants || 0;
  const parts = [];
  if (a) parts.push(a + " adult" + (a === 1 ? "" : "s"));
  if (c) parts.push(c + " child" + (c === 1 ? "" : "ren"));
  if (i) parts.push(i + " infant" + (i === 1 ? "" : "s"));
  return parts.join(", ");
}

function locationLine(offer) {
  const parts = [];
  if (offer.destinationName) parts.push(offer.destinationName);
  if (offer.destinationCountry) parts.push(offer.destinationCountry);
  return parts.join(", ");
}

// ── Star rating ───────────────────────────────────────────────────────

function starRow(rating) {
  if (!rating || rating <= 0) return "";
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  let html = "";
  for (let i = 0; i < full; i++) html += "★";
  if (half) html += "½";
  return `<span style="font-family:${FONTS.body};font-size:13px;color:${BRAND.yellow};letter-spacing:1px;">${html}</span>`;
}

// ── Image ─────────────────────────────────────────────────────────────

// Validate offer image. Returns the URL only if it passes basic checks.
// Email clients show broken images as ugly icons, so when in doubt return
// "" and let the section render a coloured placeholder cell.
function safeOfferImage(url) {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  // Must be https — most email clients block http images by default
  if (!/^https:\/\//i.test(trimmed)) return "";
  return safeUrl(trimmed);
}

// Image cell with deterministic placeholder if URL missing/invalid.
// Placeholder colour derives from a hash of the offer's destination so two
// offers don't get identical blocks.
function imageCell({ offer, height = 200, width = "100%", radius = 0 }) {
  const url = safeOfferImage(offer.imageUrl);
  const alt = escHtml(offer.name || offer.destinationName || "Travel offer");
  const radiusStyle = radius
    ? `border-radius:${radius}px;`
    : "";

  if (url) {
    return `<img src="${url}" alt="${alt}" width="600" class="tg-img-fluid" style="display:block;width:${width};max-width:600px;height:${height}px;object-fit:cover;${radiusStyle}border:0;outline:none;text-decoration:none;">`;
  }

  // Placeholder — gradient based on destination string hash
  const seed = (offer.destinationName || offer.name || "T").charCodeAt(0) || 84;
  const hue = (seed * 37) % 360;
  const grad = `linear-gradient(135deg, hsl(${hue},70%,55%), hsl(${(hue + 60) % 360},70%,45%))`;

  return `<div style="background:${grad};${radiusStyle}height:${height}px;width:${width};display:block;"></div>`;
}

// ── Price block ───────────────────────────────────────────────────────
//
// The widget uses formattedPPPrice when present (Travelify already gives
// "£689" with the symbol). We honour that. If the offer has a was-price,
// we show it struck through above.

function priceBlock(offer, { compact = false } = {}) {
  const primary = offer.formattedPPPrice || offer.formattedPrice || "";
  if (!primary) return "";
  const sub = offer.formattedPPPrice ? "per person" : "total";

  const wasHtml = offer.wasFormatted
    ? `<div style="font-family:${FONTS.body};font-size:${compact ? 12 : 14}px;color:${BRAND.inkMuted};text-decoration:line-through;line-height:1;margin:0 0 4px 0;">${escHtml(offer.wasFormatted)}</div>`
    : "";

  return `
${wasHtml}
<div style="font-family:${FONTS.heading};font-size:${compact ? 22 : 28}px;font-weight:800;color:${BRAND.ink};line-height:1;letter-spacing:-0.02em;margin:0;">${escHtml(primary)}</div>
<div style="font-family:${FONTS.body};font-size:${compact ? 11 : 12}px;color:${BRAND.inkMuted};line-height:1;margin:4px 0 0 0;">${escHtml(sub)}</div>`;
}

// ── CTA button ────────────────────────────────────────────────────────

function ctaButton(url, text, { full = false, colour } = {}) {
  const safe = safeUrl(url);
  if (!safe || !text) return "";
  const bg = colour || BRAND.tealDeep;
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="${full ? "center" : "left"}" style="${full ? "width:100%;" : ""}"><tr><td align="center" bgcolor="${bg}" style="background-color:${bg};border-radius:8px;">
<a href="${safe}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 24px;font-family:${FONTS.body};font-size:14px;font-weight:700;color:${BRAND.surface};text-decoration:none;border-radius:8px;">${escHtml(text)} &rarr;</a>
</td></tr></table>`;
}

// ── Was-price savings calculator ──────────────────────────────────────

function calcSaving(offer) {
  if (!offer.wasFormatted) return null;
  // Both come as "£689" / "£829" — pull the digits
  const numFrom = (s) => {
    const m = String(s || "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  };
  const now = numFrom(offer.formattedPPPrice || offer.formattedPrice);
  const was = numFrom(offer.wasFormatted);
  if (now == null || was == null || was <= now) return null;
  return Math.round(was - now);
}

// ── Stay summary one-liner ────────────────────────────────────────────

function staySummary(offer) {
  const parts = [];
  if (offer.nights) parts.push(`${offer.nights} night${offer.nights === 1 ? "" : "s"}`);
  if (offer.boardBasis) parts.push(formatEnum(offer.boardBasis));
  if (offer.departureAirport) parts.push(`from ${offer.departureAirport}`);
  if (offer.departureDate) parts.push(formatDate(offer.departureDate));
  return parts.join(" · ");
}

// ── Empty-state row (when no offers came back) ────────────────────────

function emptyRow(message = "Fresh offers loading — check back soon.") {
  return `
<tr><td bgcolor="${BRAND.surface}" style="background-color:${BRAND.surface};padding:32px;text-align:center;">
<div style="font-family:${FONTS.body};font-size:14px;color:${BRAND.inkMuted};line-height:22px;">${escHtml(message)}</div>
</td></tr>`;
}

// ── Demo-data banner ──────────────────────────────────────────────────
//
// Rendered at the top of any offer section whose offers came from the
// demo fallback (e.g. when Travelify is unreachable). Helps the user
// distinguish editor-time previews from a real send. Strip the banner
// in production by setting DEMO_OFFERS_DISABLED=true on Vercel — that
// switches the fetcher's fallback off entirely.
function demoBanner(offers) {
  const hasDemo = Array.isArray(offers) && offers.some((o) => o && o._isDemo);
  if (!hasDemo) return "";
  return `
<tr><td bgcolor="${BRAND.tealDeep}" style="background-color:${BRAND.tealDeep};padding:6px 16px;font-family:${FONTS.body};font-size:11px;font-weight:700;color:${BRAND.surface};letter-spacing:0.04em;text-align:center;text-transform:uppercase;">
Example data — your live offers will appear here once your widget is connected
</td></tr>`;
}

function isDemoSet(offers) {
  return Array.isArray(offers) && offers.some((o) => o && o._isDemo);
}

module.exports = {
  formatEnum,
  formatDate,
  paxString,
  locationLine,
  starRow,
  safeOfferImage,
  imageCell,
  priceBlock,
  ctaButton,
  calcSaving,
  staySummary,
  emptyRow,
  demoBanner,
  isDemoSet,
};
