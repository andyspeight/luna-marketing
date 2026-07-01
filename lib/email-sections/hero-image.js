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
const { escHtml, safeUrl, fallback, scaleFont, safeHex, editAttr } = require("./_helpers");
const { bulletproofCta } = require("./_outlook-bulletproof");

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const imageUrl = safeUrl(props.image_url);
  const imageAlt = escHtml(fallback(props.image_alt, ""));
  const eyebrow = props.eyebrow ? escHtml(props.eyebrow) : "";
  const headline = escHtml(fallback(props.headline, "Your headline here"));
  const deck = props.deck ? escHtml(props.deck) : "";
  const ctaText = props.cta && props.cta.text ? escHtml(props.cta.text) : "";
  const ctaUrl = props.cta && props.cta.url ? safeUrl(props.cta.url) : "";

  // Per-text-area sizes. Bases match the px values used in the markup below.
  const eyebrowSize = scaleFont(11, props.eyebrow_size);
  const headlineSize = scaleFont(36, props.headline_size);
  const deckSize = scaleFont(16, props.deck_size);

  // Button colours. Default keeps the original treatment so existing emails
  // are unchanged; either can be overridden with a valid hex.
  const ctaBg = safeHex(props.cta && props.cta.colour) || DESIGN_TOKENS.accent;
  const ctaFg = safeHex(props.cta && props.cta.text_colour) || DESIGN_TOKENS.textPrimary;

  // Image row — three rendering paths depending on the image source:
  //
  //   1. No image: nothing rendered.
  //   2. AI-generated product mockup (Stage B pipeline): rendered as a
  //      clean <img> at natural aspect ratio, NO gradient overlay, NO
  //      forced 320px height. These mockups are designed as standalone
  //      product portraits on a brand-coloured studio background — the
  //      gradient-to-navy treatment that helps stock photos blend into
  //      the panel below would add a haze over the clean composition.
  //   3. Stock or uploaded photo: original treatment — gradient overlay
  //      fading into the navy panel below, 320px forced height, cover
  //      crop. This is the editorial fade that makes a destination shot
  //      sit nicely above a navy text band.
  //
  // Detection is by URL pattern: our image-generator-v2 pipeline writes
  // to vercel-storage.com under luna-marketing/<tenant>/html/. Anything
  // else gets the original photo treatment.
  const isGeneratedMockup = !!imageUrl && /vercel-storage\.com\/luna-marketing\/[^/]+\/html\//.test(imageUrl);

  let imageHtml = "";
  if (imageUrl && isGeneratedMockup) {
    // Clean render for AI-generated product mockups. No overlay, no
    // forced crop — show the PNG at its native aspect (typically 1200x600
    // for hero slot, scaled to 600px wide for email). Matches the simpler
    // hero.js pattern.
    imageHtml = `
<tr><td bgcolor="${DESIGN_TOKENS.primary}" style="background-color:${DESIGN_TOKENS.primary};padding:0;font-size:0;line-height:0;">
<img src="${imageUrl}" alt="${imageAlt}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">
</td></tr>`;
  } else if (imageUrl) {
    // Original treatment for stock and uploaded photos. Outlook gets a
    // bare <img>; modern clients get the image-as-background-with-gradient
    // pattern that fades into the navy panel below.
    imageHtml = `
<tr><td bgcolor="${DESIGN_TOKENS.primary}" style="background-color:${DESIGN_TOKENS.primary};padding:0;font-size:0;line-height:0;">
  <!--[if mso]>
    <img src="${imageUrl}" alt="${imageAlt}" width="600" height="320" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;"/>
  <![endif]-->
  <!--[if !mso]><!-- -->
    <div style="background-image:linear-gradient(180deg, rgba(27,43,91,0) 0%, rgba(27,43,91,0.7) 100%), url('${imageUrl}');background-size:cover;background-position:center;height:320px;width:100%;">
      <img src="${imageUrl}" alt="${imageAlt}" width="600" height="320" style="display:block;width:100%;max-width:600px;height:320px;object-fit:cover;border:0;outline:none;text-decoration:none;visibility:hidden;"/>
    </div>
  <!--<![endif]-->
</td></tr>`;
  }

  // Eyebrow pill — only renders if eyebrow text supplied
  const eyebrowHtml = eyebrow
    ? `<div${editAttr(editable, "eyebrow")} style="display:inline-block;padding:6px 12px;background-color:rgba(0,180,216,0.15);border:1px solid rgba(0,180,216,0.3);border-radius:999px;font-family:${FONTS.body};font-size:${eyebrowSize}px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${DESIGN_TOKENS.accentLight};margin:0 0 20px 0;line-height:${Math.round(eyebrowSize * (18 / 11))}px;">${eyebrow}</div>`
    : "";

  const deckHtml = deck
    ? `<div${editAttr(editable, "deck")} style="font-family:${FONTS.body};font-size:${deckSize}px;font-weight:400;line-height:${Math.round(deckSize * (25 / 16))}px;color:rgba(255,255,255,0.8);margin:0 0 28px 0;max-width:480px;letter-spacing:-0.005em;">${deck}</div>`
    : "";

  const ctaHtml = ctaText && ctaUrl
    ? bulletproofCta({
        text: ctaText,
        url: ctaUrl,
        bgColor: ctaBg,
        textColor: ctaFg,
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
  <div${editAttr(editable, "headline")} style="font-family:${FONTS.heading};font-size:${headlineSize}px;font-weight:700;line-height:${Math.round(headlineSize * (42 / 36))}px;letter-spacing:-0.025em;color:#ffffff;margin:0 0 16px 0;">${headline}</div>
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
    { key: "eyebrow_size", label: "Eyebrow text size", type: "fontSize", optional: true },
    { key: "headline", label: "Headline", type: "text", required: true, maxLength: 100 },
    { key: "headline_size", label: "Headline text size", type: "fontSize", optional: true },
    { key: "deck", label: "Subhead / deck", type: "longText", optional: true, maxLength: 280 },
    { key: "deck_size", label: "Deck text size", type: "fontSize", optional: true },
    { key: "cta", label: "CTA button", type: "object", optional: true, schema: {
      text: { type: "text", required: true, maxLength: 40 },
      url: { type: "url", required: true },
      colour: { type: "colour", optional: true, defaultPreview: "#00B4D8", placeholder: "Defaults to current button colour", help: "Background colour of the button. Leave empty to keep the default." },
      text_colour: { type: "colour", optional: true, defaultPreview: "#0F172A", placeholder: "Defaults to current label colour", help: "Colour of the button label. Leave empty to keep the default." },
    }},
  ],
};

module.exports = { render, schema };
