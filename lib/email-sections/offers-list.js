// lib/email-sections/offers-list.js
//
// Variant D — Compact list. Stacked rows, image left, details right.
// Renders identically on desktop and mobile (no column collapse needed)
// which makes it bombproof across email clients.
//
// Schema:
//   props.fetch       — Travelify filters
//   props.offers      — pre-fetched (set by render-prep)
//   props.eyebrow     — small label (default "Your digest")
//   props.heading     — heading text (default "Trips worth a look")
//   props.maxItems    — cap on offers shown (1-6, default 4)

const { BRAND, FONTS } = require("../email-brand");
const { escHtml, safeUrl } = require("./_helpers");
const {
  imageCell,
  locationLine,
  staySummary,
  emptyRow,
  demoBanner,
} = require("./_offer-helpers");

function renderRow(offer) {
  const safe = safeUrl(offer.url);
  const primary = offer.formattedPPPrice || offer.formattedPrice || "";
  const sub = offer.formattedPPPrice ? "per person" : "total";

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;border:1px solid ${BRAND.rule};border-radius:10px;overflow:hidden;background:${BRAND.surface};margin-bottom:8px;">
<tr>
<td valign="middle" width="120" style="vertical-align:middle;width:120px;padding:0;font-size:0;line-height:0;">
${imageCell({ offer, height: 110, width: "120px" })}
</td>
<td valign="middle" style="vertical-align:middle;padding:14px 16px;">
<div style="font-family:${FONTS.body};font-size:10px;font-weight:700;letter-spacing:0.1em;color:${BRAND.inkMuted};text-transform:uppercase;margin:0 0 4px 0;">${escHtml(locationLine(offer))}</div>
<div style="font-family:${FONTS.heading};font-size:14px;font-weight:700;color:${BRAND.ink};line-height:18px;margin:0 0 4px 0;">${escHtml(offer.name || "")}</div>
<div style="font-family:${FONTS.body};font-size:11px;color:${BRAND.inkMuted};line-height:16px;margin:0;">${escHtml(staySummary(offer))}</div>
</td>
<td valign="middle" align="right" style="vertical-align:middle;text-align:right;padding:14px 16px 14px 0;white-space:nowrap;">
<div style="font-family:${FONTS.body};font-size:9px;color:${BRAND.inkMuted};font-weight:600;letter-spacing:0.05em;text-transform:uppercase;margin:0;">From</div>
<div style="font-family:${FONTS.heading};font-size:18px;font-weight:800;color:${BRAND.ink};letter-spacing:-0.02em;line-height:1;margin:2px 0;">${escHtml(primary)}</div>
<div style="font-family:${FONTS.body};font-size:10px;color:${BRAND.inkMuted};line-height:1;margin:0 0 6px 0;">${escHtml(sub)}</div>
<a href="${safe}" target="_blank" rel="noopener noreferrer" style="font-family:${FONTS.body};font-size:11px;font-weight:700;color:${BRAND.tealDeep};text-decoration:none;">View &rarr;</a>
</td>
</tr>
</table>`;
}

function render(props = {}) {
  const cap = Math.max(1, Math.min(6, parseInt(props.maxItems, 10) || 4));
  const offers = Array.isArray(props.offers) ? props.offers.slice(0, cap) : [];
  if (offers.length === 0) return emptyRow();

  const eyebrow = escHtml(props.eyebrow || "Your digest");
  const heading = escHtml(props.heading || "Trips worth a look");
  const rowsHtml = offers.map(renderRow).join("");

  return `
${demoBanner(offers, { suppress: props._suppressDemoBanner })}
<tr><td bgcolor="${BRAND.surface}" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:28px 26px 12px 26px;">
<div style="font-family:${FONTS.body};font-size:11px;font-weight:700;letter-spacing:0.12em;color:${BRAND.tealDeep};text-transform:uppercase;margin:0 0 4px 0;">${eyebrow}</div>
<div style="font-family:${FONTS.heading};font-size:20px;font-weight:700;color:${BRAND.ink};line-height:26px;letter-spacing:-0.01em;margin:0;">${heading}</div>
</td></tr>

<tr><td bgcolor="${BRAND.surface}" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:8px 26px 28px 26px;">
${rowsHtml}
</td></tr>`;
}

const schema = {
  type: "offers-list",
  label: "Offer · Compact list",
  description: "Stacked rows, image left, details right. Bombproof across email clients.",
  fields: [
    { key: "fetch", label: "Offer filters (auto)", type: "object", optional: true },
    { key: "eyebrow", label: "Eyebrow label", type: "text", optional: true, maxLength: 40, default: "Your digest" },
    { key: "heading", label: "Heading", type: "text", optional: true, maxLength: 60, default: "Trips worth a look" },
    { key: "maxItems", label: "Max offers shown", type: "number", optional: true, min: 1, max: 6, default: 4 },
  ],
};

module.exports = { render, schema };
