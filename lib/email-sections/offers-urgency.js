// lib/email-sections/offers-urgency.js
//
// Variant C — Last-minute urgency.
// Single offer with red urgency strip, scarcity badge, prominent
// price-drop callout. Built for clearance and last-minute sales.
//
// Schema:
//   props.fetch       — Travelify filters (recommend sort:departure:asc, DatesMax small)
//   props.offers      — pre-fetched
//   props.urgencyText — top strip text (default "Last minute · departs soon")
//   props.scarcityText — right-side strip text, optional (e.g. "Only a few rooms left")
//   props.ctaText     — CTA text (default "Book now")

const { BRAND, FONTS } = require("../email-brand");
const { escHtml, safeUrl } = require("./_helpers");
const {
  imageCell,
  starRow,
  staySummary,
  locationLine,
  calcSaving,
  emptyRow,
} = require("./_offer-helpers");

// Red doesn't live in the brand palette as a token, but we need it here
// for genuine urgency. Defined locally rather than added to brand because
// it's specific to this section.
const URGENCY_RED = "#DC2626";
const URGENCY_RED_BG = "#FEF2F2";
const URGENCY_RED_BORDER = "#FECACA";

function render(props = {}) {
  const offer = Array.isArray(props.offers) && props.offers[0] ? props.offers[0] : null;
  if (!offer) return emptyRow();

  const urgencyText = escHtml(props.urgencyText || "Last minute · departs soon");
  const scarcityText = props.scarcityText ? escHtml(props.scarcityText) : "";
  const ctaText = props.ctaText || "Book now";
  const saving = calcSaving(offer);
  const safe = safeUrl(offer.url);
  const primary = offer.formattedPPPrice || offer.formattedPrice || "";
  const sub = offer.formattedPPPrice ? "per person" : "total";

  const scarcityCell = scarcityText
    ? `<td valign="middle" align="right" style="vertical-align:middle;text-align:right;font-family:${FONTS.body};font-size:12px;font-weight:700;color:${BRAND.surface};letter-spacing:0.04em;">${scarcityText}</td>`
    : "";

  return `
<!-- urgency strip -->
<tr><td bgcolor="${URGENCY_RED}" style="background-color:${URGENCY_RED};padding:10px 20px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;">
<tr>
<td valign="middle" style="vertical-align:middle;font-family:${FONTS.body};font-size:12px;font-weight:700;color:${BRAND.surface};letter-spacing:0.04em;text-transform:uppercase;">
${urgencyText}
</td>
${scarcityCell}
</tr>
</table>
</td></tr>

<!-- image -->
<tr><td bgcolor="${BRAND.surface}" style="background-color:${BRAND.surface};padding:0;font-size:0;line-height:0;">
${imageCell({ offer, height: 220 })}
</td></tr>

<!-- header -->
<tr><td bgcolor="${BRAND.surface}" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:24px 32px 8px 32px;">
<div style="font-family:${FONTS.body};font-size:11px;font-weight:700;letter-spacing:0.12em;color:${BRAND.inkMuted};text-transform:uppercase;margin:0 0 6px 0;">
${escHtml(locationLine(offer).toUpperCase()) || "FEATURED"}
</div>
<div style="font-family:${FONTS.heading};font-size:24px;font-weight:700;color:${BRAND.ink};line-height:30px;letter-spacing:-0.01em;margin:0 0 6px 0;">
${escHtml(offer.name || "Available now")}
</div>
${offer.rating ? `<div style="margin:0 0 8px 0;">${starRow(offer.rating)}</div>` : ""}
<div style="font-family:${FONTS.body};font-size:13px;color:${BRAND.inkSoft};line-height:20px;margin:0;">
${escHtml(staySummary(offer))}
</div>
</td></tr>

<!-- price callout -->
<tr><td bgcolor="${BRAND.surface}" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:16px 32px 28px 32px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;background-color:${URGENCY_RED_BG};border:1px solid ${URGENCY_RED_BORDER};border-radius:12px;">
<tr>
<td valign="middle" class="tg-stack" style="vertical-align:middle;padding:18px 18px 18px 20px;">
${saving ? `<div style="font-family:${FONTS.body};font-size:11px;font-weight:700;letter-spacing:0.08em;color:${URGENCY_RED};text-transform:uppercase;margin:0 0 4px 0;">Price dropped</div>` : ""}
${offer.wasFormatted ? `<div style="font-family:${FONTS.body};font-size:14px;color:${BRAND.inkMuted};text-decoration:line-through;line-height:1;margin:0 0 4px 0;">${escHtml(offer.wasFormatted)}</div>` : ""}
<div style="font-family:${FONTS.heading};font-size:32px;font-weight:800;color:${URGENCY_RED};line-height:1;letter-spacing:-0.02em;margin:0;">${escHtml(primary)}</div>
<div style="font-family:${FONTS.body};font-size:12px;color:${BRAND.inkMuted};line-height:1;margin:4px 0 0 0;">${escHtml(sub)}</div>
${saving ? `<div style="font-family:${FONTS.body};font-size:13px;font-weight:700;color:${URGENCY_RED};line-height:1;margin:8px 0 0 0;">You save &pound;${saving}pp</div>` : ""}
</td>
<td valign="middle" align="right" class="tg-stack" style="vertical-align:middle;text-align:right;padding:18px 20px 18px 12px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="right"><tr><td align="center" bgcolor="${URGENCY_RED}" style="background-color:${URGENCY_RED};border-radius:8px;">
<a href="${safe}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 24px;font-family:${FONTS.body};font-size:14px;font-weight:700;color:${BRAND.surface};text-decoration:none;border-radius:8px;">${escHtml(ctaText)} &rarr;</a>
</td></tr></table>
</td>
</tr>
</table>
</td></tr>`;
}

const schema = {
  type: "offers-urgency",
  label: "Offer · Last-minute urgency",
  description: "Single offer with urgency strip and price-drop callout. Highest converter.",
  fields: [
    { key: "fetch", label: "Offer filters (auto)", type: "object", optional: true,
      description: "Recommend sort by departure date ascending and DatesMax around 14." },
    { key: "urgencyText", label: "Urgency strip text", type: "text", optional: true, maxLength: 60,
      default: "Last minute · departs soon" },
    { key: "scarcityText", label: "Scarcity strip (right)", type: "text", optional: true, maxLength: 30,
      description: "e.g. 'Only a few rooms left'. Leave blank to omit." },
    { key: "ctaText", label: "Button text", type: "text", optional: true, maxLength: 20, default: "Book now" },
  ],
};

module.exports = { render, schema };
