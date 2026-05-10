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

const { DESIGN_TOKENS, FONTS } = require("../email-brand");
const { escHtml, safeUrl, fallback } = require("./_helpers");
const { bulletproofCta } = require("./_outlook-bulletproof");

function render(props = {}) {
  const title = escHtml(fallback(props.title, "Ready to take a look?"));
  const text = props.text ? escHtml(props.text) : "";
  const ctaText = props.cta && props.cta.text ? escHtml(props.cta.text) : "Get started";
  const ctaUrl = props.cta && props.cta.url ? safeUrl(props.cta.url) : "";

  // Outlook gets flat navy bgcolor; modern clients see linear-gradient
  // overlay via inline style. The radial glow accent (visible in the
  // design reference) is decorative and stripped in Outlook — acceptable.
  const ctaHtml = ctaText && ctaUrl
    ? bulletproofCta({
        text: ctaText,
        url: ctaUrl,
        bgColor: DESIGN_TOKENS.accent,
        textColor: DESIGN_TOKENS.textPrimary,
        align: "center",
      })
    : "";

  return `
<tr><td bgcolor="${DESIGN_TOKENS.primary}" class="tg-pad-mobile" align="center" style="background-color:${DESIGN_TOKENS.primary};background-image:linear-gradient(135deg, ${DESIGN_TOKENS.primary} 0%, ${DESIGN_TOKENS.primaryLight} 100%);padding:48px 32px;text-align:center;color:#ffffff;">
  <div style="font-family:${FONTS.heading};font-size:24px;font-weight:700;letter-spacing:-0.02em;line-height:30px;color:#ffffff;margin:0 0 12px 0;">${title}</div>
  ${text ? `<div style="font-family:${FONTS.body};font-size:15px;line-height:24px;color:rgba(255,255,255,0.8);margin:0 auto 24px auto;max-width:420px;">${text}</div>` : `<div style="height:24px;line-height:24px;font-size:24px;">&nbsp;</div>`}
  ${ctaHtml}
</td></tr>`;
}

const schema = {
  type: "cta-banner",
  label: "CTA banner (gradient navy)",
  description: "Mid-email conversion banner with title, text, and primary button on a navy gradient background. Use for marketing newsletters.",
  fields: [
    { key: "title", label: "Title", type: "text", required: true, maxLength: 80 },
    { key: "text", label: "Supporting text", type: "longText", optional: true, maxLength: 200 },
    { key: "cta", label: "CTA button", type: "object", required: true, schema: {
      text: { type: "text", required: true, maxLength: 30 },
      url: { type: "url", required: true },
    }},
  ],
};

module.exports = { render, schema };
