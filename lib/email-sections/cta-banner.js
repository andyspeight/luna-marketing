// lib/email-sections/cta-banner.js
// Mid-email CTA banner: dark navy gradient panel with centred title,
// supporting text, and primary button. Used in Archetype B (Marketing
// Newsletter) for the conversion moment between content blocks.
//
// For the dark final CTA used in product launches, see cta-dark.js.
// For the small inline CTA, see the existing cta.js.
//
// Uses §12 P2 (bulletproof CTA) and a flat navy fallback for Outlook
// (the gradient strips per §12.4).
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.2.

const STATIC_BRAND = require("../email-brand");
const { escHtml, safeUrl, fallback, scaleFont, safeHex, editAttr } = require("./_helpers");
const { bulletproofCta } = require("./_outlook-bulletproof");

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const title = escHtml(fallback(props.title, "Ready to take a look?"));
  const text = props.text ? escHtml(props.text) : "";
  const ctaText = props.cta && props.cta.text ? escHtml(props.cta.text) : "Get started";
  const ctaUrl = props.cta && props.cta.url ? safeUrl(props.cta.url) : "";

  // Per-text-area sizes. Bases match the px values used in the markup below.
  const titleSize = scaleFont(24, props.title_size);
  const textSize = scaleFont(15, props.text_size);

  // Button colours. Default keeps the original treatment so existing emails
  // are unchanged; either can be overridden with a valid hex.
  const ctaBg = safeHex(props.cta && props.cta.colour) || DESIGN_TOKENS.accent;
  const ctaFg = safeHex(props.cta && props.cta.text_colour) || DESIGN_TOKENS.textPrimary;

  // Outlook gets flat navy bgcolor; modern clients see linear-gradient
  // overlay via inline style. The radial glow accent (visible in the
  // design reference) is decorative and stripped in Outlook — acceptable.
  const ctaHtml = ctaText && ctaUrl
    ? bulletproofCta({
        text: ctaText,
        url: ctaUrl,
        bgColor: ctaBg,
        textColor: ctaFg,
        align: "center",
      })
    : "";

  return `
<tr><td bgcolor="${DESIGN_TOKENS.primary}" class="tg-pad-mobile" align="center" style="background-color:${DESIGN_TOKENS.primary};background-image:linear-gradient(135deg, ${DESIGN_TOKENS.primary} 0%, ${DESIGN_TOKENS.primaryLight} 100%);padding:48px 32px;text-align:center;color:#ffffff;">
  <div${editAttr(editable, "title")} style="font-family:${FONTS.heading};font-size:${titleSize}px;font-weight:700;letter-spacing:-0.02em;line-height:${Math.round(titleSize * (30 / 24))}px;color:#ffffff;margin:0 0 12px 0;">${title}</div>
  ${text ? `<div${editAttr(editable, "text")} style="font-family:${FONTS.body};font-size:${textSize}px;line-height:${Math.round(textSize * (24 / 15))}px;color:rgba(255,255,255,0.8);margin:0 auto 24px auto;max-width:420px;">${text}</div>` : `<div style="height:24px;line-height:24px;font-size:24px;">&nbsp;</div>`}
  ${ctaHtml}
</td></tr>`;
}

const schema = {
  type: "cta-banner",
  label: "CTA banner (gradient navy)",
  description: "Mid-email conversion banner with title, text, and primary button on a navy gradient background. Use for marketing newsletters.",
  fields: [
    { key: "title", label: "Title", type: "text", required: true, maxLength: 80 },
    { key: "title_size", label: "Title text size", type: "fontSize", optional: true },
    { key: "text", label: "Supporting text", type: "longText", optional: true, maxLength: 200 },
    { key: "text_size", label: "Supporting text size", type: "fontSize", optional: true },
    { key: "cta", label: "CTA button", type: "object", required: true, schema: {
      text: { type: "text", required: true, maxLength: 30 },
      url: { type: "url", required: true },
      colour: { type: "colour", optional: true, defaultPreview: "#00B4D8", placeholder: "Defaults to current button colour", help: "Background colour of the button. Leave empty to keep the default." },
      text_colour: { type: "colour", optional: true, defaultPreview: "#0F172A", placeholder: "Defaults to current label colour", help: "Colour of the button label. Leave empty to keep the default." },
    }},
  ],
};

module.exports = { render, schema };
