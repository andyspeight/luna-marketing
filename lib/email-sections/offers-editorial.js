// lib/email-sections/offers-editorial.js
//
// Variant F — Editorial feature.
// Big atmospheric image, generous spacing, narrative paragraph from the
// agent (or Luna later). Slower, more premium. For nurture and brand-
// building, not transactional pushes.
//
// Schema:
//   props.fetch       — Travelify filters
//   props.offers      — pre-fetched
//   props.eyebrow     — small label (default "Editor's Choice")
//   props.headline    — headline override (default "A long weekend in {dest}")
//   props.body        — editorial paragraph (required for this block to feel right)
//   props.ctaText     — CTA text (default "Read more · book")

const { BRAND, FONTS } = require("../email-brand");
const { escHtml, safeUrl } = require("./_helpers");
const {
  imageCell,
  staySummary,
  emptyRow,
  formatEnum,
  demoBanner,
} = require("./_offer-helpers");

function render(props = {}) {
  const offer = Array.isArray(props.offers) && props.offers[0] ? props.offers[0] : null;
  if (!offer) return emptyRow();

  const eyebrow = escHtml(props.eyebrow || "Editor's Choice");
  const dest = offer.destinationName || offer.name || "this destination";
  const headline = escHtml(props.headline || `A long weekend in ${dest}`);
  const body = props.body
    ? escHtml(String(props.body))
    : `Sometimes the right answer is just to go. ${escHtml(
        offer.name || "This trip"
      )} sits ${
        offer.boardBasis
          ? `on a ${escHtml(formatEnum(offer.boardBasis).toLowerCase())} basis`
          : "right where it should"
      }${
        offer.nights ? `, ${offer.nights} nights of it` : ""
      }${
        offer.departureAirport ? `, flying from ${escHtml(offer.departureAirport)}` : ""
      }.`;
  const ctaText = props.ctaText || "Read more · book";
  const safe = safeUrl(offer.url);
  const primary = offer.formattedPPPrice || offer.formattedPrice || "";

  return `
${demoBanner([offer])}
<!-- big image -->
<tr><td bgcolor="${BRAND.surface}" style="background-color:${BRAND.surface};padding:0;font-size:0;line-height:0;position:relative;">
${imageCell({ offer, height: 320 })}
</td></tr>

<!-- editorial body -->
<tr><td bgcolor="${BRAND.surface}" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:36px 40px 12px 40px;">
<div style="font-family:${FONTS.body};font-size:11px;font-weight:700;letter-spacing:0.15em;color:${BRAND.tealDeep};text-transform:uppercase;margin:0 0 10px 0;">
${eyebrow}
</div>
<div style="font-family:${FONTS.heading};font-size:30px;font-weight:700;color:${BRAND.ink};line-height:36px;letter-spacing:-0.02em;margin:0 0 18px 0;">
${headline}
</div>
<div style="font-family:${FONTS.body};font-size:16px;color:${BRAND.inkSoft};line-height:26px;margin:0 0 16px 0;">
${body}
</div>
<div style="font-family:${FONTS.body};font-size:13px;color:${BRAND.inkMuted};line-height:20px;margin:0;font-style:italic;">
${escHtml(staySummary(offer))}
</div>
</td></tr>

<!-- price + cta footer -->
<tr><td bgcolor="${BRAND.surface}" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:24px 40px 36px 40px;border-top:1px solid ${BRAND.ruleSubtle};">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;">
<tr>
<td valign="middle" class="tg-stack" style="vertical-align:middle;padding-right:12px;">
<div style="font-family:${FONTS.body};font-size:10px;color:${BRAND.inkMuted};font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 4px 0;">From</div>
<div style="font-family:${FONTS.heading};font-size:26px;font-weight:800;color:${BRAND.ink};line-height:1;letter-spacing:-0.02em;">
${escHtml(primary)}<span style="font-family:${FONTS.body};font-size:13px;color:${BRAND.inkMuted};font-weight:600;"> ${offer.formattedPPPrice ? "per person" : "total"}</span>
</div>
</td>
<td valign="middle" align="right" class="tg-stack" style="vertical-align:middle;text-align:right;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="right"><tr><td align="center" bgcolor="${BRAND.ink}" style="background-color:${BRAND.ink};border-radius:999px;">
<a href="${safe}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 28px;font-family:${FONTS.body};font-size:14px;font-weight:700;color:${BRAND.surface};text-decoration:none;border-radius:999px;">${escHtml(ctaText)} &rarr;</a>
</td></tr></table>
</td>
</tr>
</table>
</td></tr>`;
}

const schema = {
  type: "offers-editorial",
  label: "Offer · Editorial feature",
  description: "Big image, narrative paragraph, premium feel. For brand-building, not pushy selling.",
  fields: [
    { key: "fetch", label: "Offer filters (auto)", type: "object", optional: true },
    { key: "eyebrow", label: "Eyebrow label", type: "text", optional: true, maxLength: 40, default: "Editor's Choice" },
    { key: "headline", label: "Headline override", type: "text", optional: true, maxLength: 120 },
    { key: "body", label: "Editorial paragraph", type: "longText", optional: true, maxLength: 600,
      description: "The story. If left empty, Luna composes a short fallback line." },
    { key: "ctaText", label: "Button text", type: "text", optional: true, maxLength: 30, default: "Read more · book" },
  ],
};

module.exports = { render, schema };
