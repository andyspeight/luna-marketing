// lib/email-sections/offers-hero.js
//
// Variant A — Single hero offer.
// One full-width offer with big image, hotel name, key details, price
// and CTA. The default block, used for featured deals and headline campaigns.
//
// In v1 (auto mode) this section is fed pre-fetched offers via props.offers
// (which the email-render-prepare step populates from props.fetch). The
// section itself never makes a network call.
//
// Schema:
//   props.fetch       — Travelify-style filters (auto fetched at render-prep)
//   props.offers      — pre-fetched offers (set by render-prep step)
//   props.eyebrow     — small label above the headline (default "Featured")
//   props.headline    — headline override (default uses offer.name)
//   props.ctaText     — CTA text (default "View this trip")

const { BRAND, FONTS } = require("../email-brand");
const { escHtml } = require("./_helpers");
const {
  imageCell,
  priceBlock,
  ctaButton,
  starRow,
  staySummary,
  locationLine,
  calcSaving,
  emptyRow,
  formatEnum,
  demoBanner,
} = require("./_offer-helpers");

function render(props = {}) {
  const offer = Array.isArray(props.offers) && props.offers[0] ? props.offers[0] : null;
  if (!offer) return emptyRow().toString();

  const eyebrow = escHtml(props.eyebrow || "Featured");
  const headline = escHtml(props.headline || offer.name || "Your next trip");
  const ctaText = props.ctaText || "View this trip";
  const saving = calcSaving(offer);

  return `
${demoBanner([offer], { suppress: props._suppressDemoBanner })}
<tr><td bgcolor="${BRAND.surface}" style="background-color:${BRAND.surface};padding:0;font-size:0;line-height:0;position:relative;">
${imageCell({ offer, height: 280 })}
</td></tr>

<tr><td bgcolor="${BRAND.tealDeep}" style="background-color:${BRAND.tealDeep};font-size:0;line-height:0;height:4px;">&nbsp;</td></tr>

<tr><td bgcolor="${BRAND.surface}" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:28px 32px 8px 32px;">

<div style="font-family:${FONTS.body};font-size:11px;font-weight:700;letter-spacing:0.12em;color:${BRAND.tealDeep};text-transform:uppercase;margin:0 0 6px 0;">
${eyebrow}${locationLine(offer) ? ` &middot; ${escHtml(locationLine(offer).toUpperCase())}` : ""}
</div>

<div style="font-family:${FONTS.heading};font-size:26px;font-weight:700;color:${BRAND.ink};line-height:32px;letter-spacing:-0.01em;margin:0 0 6px 0;">
${headline}
</div>

${offer.rating ? `<div style="margin:0 0 10px 0;">${starRow(offer.rating)}</div>` : ""}

<div style="font-family:${FONTS.body};font-size:14px;color:${BRAND.inkSoft};line-height:22px;margin:0;">
${escHtml(staySummary(offer))}
</div>

</td></tr>

<tr><td bgcolor="${BRAND.surface}" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:20px 32px 28px 32px;">

<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;">
<tr>
<td valign="middle" class="tg-stack" style="vertical-align:middle;padding-right:12px;">
${priceBlock(offer)}
${saving ? `<div style="font-family:${FONTS.body};font-size:12px;font-weight:700;color:${BRAND.pink};line-height:1;margin:6px 0 0 0;">You save &pound;${saving}pp</div>` : ""}
</td>
<td valign="middle" align="right" class="tg-stack" style="vertical-align:middle;text-align:right;">
${ctaButton(offer.url, ctaText)}
</td>
</tr>
</table>

</td></tr>`;
}

const schema = {
  type: "offers-hero",
  label: "Offer · Single hero",
  description: "One full-width offer with image, price and CTA — the default offer block.",
  fields: [
    { key: "fetch", label: "Offer filters (auto)", type: "object", optional: true,
      description: "Travelify filters — destinations, sort, etc. Leave empty for cheapest first." },
    { key: "eyebrow", label: "Eyebrow label", type: "text", optional: true, maxLength: 40 },
    { key: "headline", label: "Headline override", type: "text", optional: true, maxLength: 120,
      description: "Defaults to the hotel name." },
    { key: "ctaText", label: "Button text", type: "text", optional: true, maxLength: 30, default: "View this trip" },
  ],
};

module.exports = { render, schema };
