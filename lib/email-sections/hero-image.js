// lib/email-sections/hero-image.js
// Archetype B (Marketing Newsletter): hero with full-width image above
// a navy panel containing eyebrow, headline, deck, and CTA.
//
// Uses §12 P3 (gradient hero) and P2 (bulletproof CTA). For the simpler
// centred-logo header used at the very top of emails, see header.js.
// For the dark mesh-gradient launch hero, see hero-dark.js (Archetype C).
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.2.

const STATIC_BRAND = require("../email-brand");
const { escHtml, safeUrl, fallback } = require("./_helpers");
const { bulletproofCta } = require("./_outlook-bulletproof");

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const imageUrl = safeUrl(props.image_url);
  const imageAlt = escHtml(fallback(props.image_alt, ""));
  const eyebrow = props.eyebrow ? escHtml(props.eyebrow) : "";
  const headline = escHtml(fallback(props.headline, "Your headline here"));
  const deck = props.deck ? escHtml(props.deck) : "";
  const ctaText = props.cta && props.cta.text ? escHtml(props.cta.text) : "";
  const ctaUrl = props.cta && props.cta.url ? safeUrl(props.cta.url) : "";

  // Image row — bare <img> in Outlook, image with background gradient overlay
  // in modern clients (the gradient creates the smooth transition into the
  // navy panel below). Outlook just gets the image; the navy panel below
  // does the heavy lifting visually anyway.
  const imageHtml = imageUrl
    ? `
<tr><td bgcolor="${DESIGN_TOKENS.primary}" style="background-color:${DESIGN_TOKENS.primary};padding:0;font-size:0;line-height:0;">
  <!--[if mso]>
    <img src="${imageUrl}" alt="${imageAlt}" width="600" height="320" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;"/>
  <![endif]-->
  <!--[if !mso]><!-- -->
    <div style="background-image:linear-gradient(180deg, rgba(27,43,91,0) 0%, rgba(27,43,91,0.7) 100%), url('${imageUrl}');background-size:cover;background-position:center;height:320px;width:100%;">
      <img src="${imageUrl}" alt="${imageAlt}" width="600" height="320" style="display:block;width:100%;max-width:600px;height:320px;object-fit:cover;border:0;outline:none;text-decoration:none;visibility:hidden;"/>
    </div>
  <!--<![endif]-->
</td></tr>`
    : "";

  // Eyebrow pill — only renders if eyebrow text supplied
  const eyebrowHtml = eyebrow
    ? `<div style="display:inline-block;padding:6px 12px;background-color:rgba(0,180,216,0.15);border:1px solid rgba(0,180,216,0.3);border-radius:999px;font-family:${FONTS.body};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${DESIGN_TOKENS.accentLight};margin:0 0 20px 0;line-height:18px;">${eyebrow}</div>`
    : "";

  const deckHtml = deck
    ? `<div style="font-family:${FONTS.body};font-size:16px;font-weight:400;line-height:25px;color:rgba(255,255,255,0.8);margin:0 0 28px 0;max-width:480px;letter-spacing:-0.005em;">${deck}</div>`
    : "";

  const ctaHtml = ctaText && ctaUrl
    ? bulletproofCta({
        text: ctaText,
        url: ctaUrl,
        bgColor: DESIGN_TOKENS.accent,
        textColor: DESIGN_TOKENS.textPrimary,
        align: "left",
      })
    : "";

  // The content panel sits directly below the image with no gap, on the
  // same navy background. The image's bottom-fading gradient (in modern
  // clients) bleeds into the panel for a continuous feel.
  return `
${imageHtml}
<tr><td bgcolor="${DESIGN_TOKENS.primary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.primary};padding:48px 32px 40px;color:#ffffff;">
  ${eyebrowHtml}
  <div style="font-family:${FONTS.heading};font-size:36px;font-weight:700;line-height:42px;letter-spacing:-0.025em;color:#ffffff;margin:0 0 16px 0;">${headline}</div>
  ${deckHtml}
  ${ctaHtml}
</td></tr>`;
}

const schema = {
  type: "hero-image",
  label: "Hero (image + dark panel)",
  description: "Full-width image with a dark navy panel below containing eyebrow, headline, deck, and CTA. Used for marketing newsletters.",
  fields: [
    { key: "image_url", label: "Hero image URL", type: "url", optional: true },
    { key: "image_alt", label: "Image alt text", type: "text", optional: true, maxLength: 100 },
    { key: "eyebrow", label: "Eyebrow label", type: "text", optional: true, maxLength: 30 },
    { key: "headline", label: "Headline", type: "text", required: true, maxLength: 100 },
    { key: "deck", label: "Subhead / deck", type: "longText", optional: true, maxLength: 280 },
    { key: "cta", label: "CTA button", type: "object", optional: true, schema: {
      text: { type: "text", required: true, maxLength: 40 },
      url: { type: "url", required: true },
    }},
  ],
};

module.exports = { render, schema };
