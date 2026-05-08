// lib/email-sections/offers-three-up.js
//
// Variant B — Three offers side by side. Workhorse for newsletters and
// weekly digests. Stacks vertically on mobile (uses tg-stack class for
// responsive collapse).
//
// Schema:
//   props.fetch       — Travelify filters
//   props.offers      — pre-fetched (set by render-prep)
//   props.eyebrow     — small label (default "Handpicked this week")
//   props.heading     — heading text (default "Three you'll love")
//   props.ctaText     — per-card CTA text (default "View")

const { BRAND, FONTS } = require("../email-brand");
const { escHtml, safeUrl } = require("./_helpers");
const {
  imageCell,
  starRow,
  locationLine,
  staySummary,
  calcSaving,
  emptyRow,
  demoBanner,
} = require("./_offer-helpers");

function renderCard(offer, ctaText) {
  const safe = safeUrl(offer.url);
  const saving = calcSaving(offer);
  const primary = offer.formattedPPPrice || offer.formattedPrice || "";
  const sub = offer.formattedPPPrice ? "pp" : "total";
  const wasHtml = offer.wasFormatted
    ? `<span style="font-family:${FONTS.body};font-size:12px;color:${BRAND.inkMuted};text-decoration:line-through;margin-right:6px;">${escHtml(offer.wasFormatted)}</span>`
    : "";

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;border:1px solid ${BRAND.rule};border-radius:10px;overflow:hidden;background:${BRAND.surface};">
<tr><td style="padding:0;font-size:0;line-height:0;position:relative;">
${imageCell({ offer, height: 140 })}
${saving ? `<!-- saving badge -->` : ""}
</td></tr>
<tr><td style="padding:14px 14px 4px 14px;">
<div style="font-family:${FONTS.body};font-size:10px;font-weight:700;letter-spacing:0.1em;color:${BRAND.inkMuted};text-transform:uppercase;margin:0 0 4px 0;">${escHtml(locationLine(offer))}</div>
<div style="font-family:${FONTS.heading};font-size:14px;font-weight:700;color:${BRAND.ink};line-height:20px;margin:0 0 6px 0;min-height:40px;">${escHtml(offer.name || "")}</div>
${offer.rating ? `<div style="margin:0 0 6px 0;font-size:11px;">${starRow(offer.rating)}</div>` : ""}
<div style="font-family:${FONTS.body};font-size:11px;color:${BRAND.inkMuted};line-height:16px;margin:0 0 12px 0;">${escHtml(staySummary(offer))}</div>
</td></tr>
<tr><td style="padding:0 14px 14px 14px;border-top:1px solid ${BRAND.ruleSubtle};">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;padding-top:10px;">
<tr>
<td valign="middle" style="vertical-align:middle;">
${wasHtml}<span style="font-family:${FONTS.heading};font-size:18px;font-weight:800;color:${BRAND.ink};letter-spacing:-0.02em;">${escHtml(primary)}</span><span style="font-family:${FONTS.body};font-size:11px;color:${BRAND.inkMuted};margin-left:3px;">${sub}</span>
</td>
<td valign="middle" align="right" style="vertical-align:middle;text-align:right;">
<a href="${safe}" target="_blank" rel="noopener noreferrer" style="font-family:${FONTS.body};font-size:12px;font-weight:700;color:${BRAND.tealDeep};text-decoration:none;">${escHtml(ctaText)} &rarr;</a>
</td>
</tr>
</table>
</td></tr>
</table>`;
}

function render(props = {}) {
  const offers = Array.isArray(props.offers) ? props.offers.slice(0, 3) : [];
  if (offers.length === 0) return emptyRow();

  // Pad to 3 if fewer came back, so layout doesn't break — but only show
  // what we have, no fake offers.
  const cells = offers
    .map((o) => `<td valign="top" width="33.33%" class="tg-stack-narrow" style="vertical-align:top;padding:0 6px;">${renderCard(o, props.ctaText || "View")}</td>`)
    .join("");

  // If fewer than 3, pad with empty <td>s of equal width to preserve grid
  const filler = "<td width=\"33.33%\" class=\"tg-stack-narrow\" style=\"display:none\"></td>".repeat(Math.max(0, 3 - offers.length));

  const eyebrow = escHtml(props.eyebrow || "Handpicked this week");
  const heading = escHtml(props.heading || "Three you'll love");

  return `
${demoBanner(offers, { suppress: props._suppressDemoBanner })}
<tr><td bgcolor="${BRAND.surface}" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:28px 26px 12px 26px;">
<div style="font-family:${FONTS.body};font-size:11px;font-weight:700;letter-spacing:0.12em;color:${BRAND.tealDeep};text-transform:uppercase;margin:0 0 4px 0;">${eyebrow}</div>
<div style="font-family:${FONTS.heading};font-size:20px;font-weight:700;color:${BRAND.ink};line-height:26px;letter-spacing:-0.01em;margin:0;">${heading}</div>
</td></tr>

<tr><td bgcolor="${BRAND.surface}" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:8px 20px 28px 20px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;">
<tr>${cells}${filler}</tr>
</table>
</td></tr>`;
}

const schema = {
  type: "offers-three-up",
  label: "Offer · Three-up grid",
  description: "Three offers side by side, stacks on mobile. Best for newsletters.",
  fields: [
    { key: "fetch", label: "Offer filters (auto)", type: "object", optional: true },
    { key: "eyebrow", label: "Eyebrow label", type: "text", optional: true, maxLength: 40, default: "Handpicked this week" },
    { key: "heading", label: "Heading", type: "text", optional: true, maxLength: 60, default: "Three you'll love" },
    { key: "ctaText", label: "Per-card link text", type: "text", optional: true, maxLength: 16, default: "View" },
  ],
};

module.exports = { render, schema };
