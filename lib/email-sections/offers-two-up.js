// lib/email-sections/offers-two-up.js
//
// Variant E — Two offers side by side. More breathing room than three-up,
// easier to digest. Stacks vertically on mobile.
//
// Schema:
//   props.fetch       — Travelify filters
//   props.offers      — pre-fetched
//   props.eyebrow     — optional eyebrow above (no default — section
//                       can render naked if not set)
//   props.heading     — optional heading (no default)

const { BRAND, FONTS } = require("../email-brand");
const { escHtml, safeUrl } = require("./_helpers");
const {
  imageCell,
  starRow,
  locationLine,
  staySummary,
  calcSaving,
  emptyRow,
} = require("./_offer-helpers");

function renderCard(offer) {
  const safe = safeUrl(offer.url);
  const saving = calcSaving(offer);
  const primary = offer.formattedPPPrice || offer.formattedPrice || "";
  const sub = offer.formattedPPPrice ? "pp" : "total";
  const wasHtml = offer.wasFormatted
    ? `<span style="font-family:${FONTS.body};font-size:13px;color:${BRAND.inkMuted};text-decoration:line-through;margin-right:6px;">${escHtml(offer.wasFormatted)}</span>`
    : "";

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;border:1px solid ${BRAND.rule};border-radius:12px;overflow:hidden;background:${BRAND.surface};">
<tr><td style="padding:0;font-size:0;line-height:0;">
${imageCell({ offer, height: 170 })}
</td></tr>
<tr><td style="padding:18px 18px 6px 18px;">
<div style="font-family:${FONTS.body};font-size:10px;font-weight:700;letter-spacing:0.1em;color:${BRAND.inkMuted};text-transform:uppercase;margin:0 0 4px 0;">${escHtml(locationLine(offer))}</div>
<div style="font-family:${FONTS.heading};font-size:16px;font-weight:700;color:${BRAND.ink};line-height:22px;margin:0 0 8px 0;">${escHtml(offer.name || "")}</div>
${offer.rating ? `<div style="margin:0 0 8px 0;">${starRow(offer.rating)}</div>` : ""}
<div style="font-family:${FONTS.body};font-size:12px;color:${BRAND.inkMuted};line-height:18px;margin:0 0 4px 0;">${escHtml(staySummary(offer))}</div>
</td></tr>
<tr><td style="padding:14px 18px 18px 18px;border-top:1px solid ${BRAND.ruleSubtle};">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;">
<tr>
<td valign="middle" style="vertical-align:middle;">
<div style="font-family:${FONTS.body};font-size:9px;color:${BRAND.inkMuted};font-weight:600;letter-spacing:0.05em;text-transform:uppercase;margin:0;">From</div>
<div style="margin-top:2px;">
${wasHtml}<span style="font-family:${FONTS.heading};font-size:22px;font-weight:800;color:${BRAND.ink};letter-spacing:-0.02em;">${escHtml(primary)}</span><span style="font-family:${FONTS.body};font-size:11px;color:${BRAND.inkMuted};margin-left:3px;">${sub}</span>
</div>
${saving ? `<div style="font-family:${FONTS.body};font-size:11px;font-weight:700;color:${BRAND.pink};margin-top:4px;">Save &pound;${saving}pp</div>` : ""}
</td>
<td valign="middle" align="right" style="vertical-align:middle;text-align:right;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="right"><tr><td align="center" bgcolor="${BRAND.tealDeep}" style="background-color:${BRAND.tealDeep};border-radius:8px;">
<a href="${safe}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 16px;font-family:${FONTS.body};font-size:12px;font-weight:700;color:${BRAND.surface};text-decoration:none;border-radius:8px;">View &rarr;</a>
</td></tr></table>
</td>
</tr>
</table>
</td></tr>
</table>`;
}

function render(props = {}) {
  const offers = Array.isArray(props.offers) ? props.offers.slice(0, 2) : [];
  if (offers.length === 0) return emptyRow();

  const eyebrow = props.eyebrow ? escHtml(props.eyebrow) : "";
  const heading = props.heading ? escHtml(props.heading) : "";

  const headerHtml = (eyebrow || heading)
    ? `<tr><td bgcolor="${BRAND.surface}" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:28px 32px 4px 32px;">
${eyebrow ? `<div style="font-family:${FONTS.body};font-size:11px;font-weight:700;letter-spacing:0.12em;color:${BRAND.tealDeep};text-transform:uppercase;margin:0 0 4px 0;">${eyebrow}</div>` : ""}
${heading ? `<div style="font-family:${FONTS.heading};font-size:20px;font-weight:700;color:${BRAND.ink};line-height:26px;letter-spacing:-0.01em;margin:0;">${heading}</div>` : ""}
</td></tr>`
    : "";

  const cells = offers
    .map((o) => `<td valign="top" width="50%" class="tg-stack" style="vertical-align:top;padding:0 8px;">${renderCard(o)}</td>`)
    .join("");
  const filler = offers.length === 1
    ? `<td width="50%" class="tg-stack" style="display:none"></td>`
    : "";

  return `
${headerHtml}
<tr><td bgcolor="${BRAND.surface}" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:${(eyebrow || heading) ? 12 : 28}px 24px 28px 24px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;">
<tr>${cells}${filler}</tr>
</table>
</td></tr>`;
}

const schema = {
  type: "offers-two-up",
  label: "Offer · Two-up split",
  description: "Two offers side by side. Roomy and easier to digest than three-up.",
  fields: [
    { key: "fetch", label: "Offer filters (auto)", type: "object", optional: true },
    { key: "eyebrow", label: "Eyebrow label", type: "text", optional: true, maxLength: 40 },
    { key: "heading", label: "Heading", type: "text", optional: true, maxLength: 60 },
  ],
};

module.exports = { render, schema };
