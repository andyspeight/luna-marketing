// lib/email-sections/cta-dark.js
// Archetype C (Product Launch): the final dark CTA block.
// Smaller and quieter than hero-dark — same dark navy with subtle mesh
// glow, but centred and single-action. One eyebrow line, one headline
// (32px), one supporting paragraph, one primary CTA. Sits just above
// the dark footer.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.3.
//
// Outlook patterns used:
//   - P4 dark hero with flat-fallback for the gradient backdrop
//   - P2 bulletproof CTA for the primary button
//   - Mesh glow lives inside [if !mso]; Outlook gets just the flat navy

const STATIC_BRAND = require("../email-brand");
const { escHtml, safeUrl, fallback, scaleFont, safeHex, editAttr } = require("./_helpers");
const { bulletproofCta } = require("./_outlook-bulletproof");

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const eyebrow = escHtml(fallback(props.eyebrow, "")).trim();
  const title = escHtml(fallback(props.title, "")).trim();
  const text = props.text ? escHtml(props.text) : "";
  const cta = props.cta || null;

  if (!title) return "";

  // Background colour. Defaults to the brand's dark navy gradient; a valid
  // hex override sets a flat background (both gradient endpoints the same)
  // so the result is predictable.
  const bg = safeHex(props.background_colour) || DESIGN_TOKENS.primary;
  const bg2 = safeHex(props.background_colour) || DESIGN_TOKENS.primaryDark;

  // Per-text-area sizes. Bases match the px values used in the markup below.
  const eyebrowSize = scaleFont(11, props.eyebrow_size);
  const titleSize = scaleFont(32, props.title_size);
  const textSize = scaleFont(16, props.text_size);

  const ctaHtml = (cta && cta.text && cta.url)
    ? bulletproofCta({
        text: escHtml(cta.text),
        url: safeUrl(cta.url),
        bgColor: safeHex(cta.colour) || DESIGN_TOKENS.accent,
        textColor: safeHex(cta.text_colour) || DESIGN_TOKENS.primaryDark,
        width: 220,
        height: 50,
        align: "center",
      })
    : "";

  // Mesh glow — single centred radial in this block (smaller than the
  // hero), only in non-Outlook. Outlook sees flat navy gradient
  // (rendered by primary → primaryDark below).
  const meshHtml = `
<!--[if !mso]><!-- -->
  <div style="position:absolute;top:50%;left:50%;width:600px;height:600px;background:radial-gradient(circle, rgba(0,180,216,0.18) 0%, transparent 60%);filter:blur(60px);transform:translate(-50%,-50%);pointer-events:none;"></div>
<!--<![endif]-->`;

  // Background uses a vertical 2-step gradient via VML for Outlook? No
  // — we use a single flat bgcolor (#1B2B5B) which sits between the
  // visual reference's two endpoints and reads well. Modern clients see
  // a CSS linear-gradient layered on top.
  return `
<tr><td bgcolor="${bg}" class="tg-pad-mobile" align="center" style="background-color:${bg};background-image:linear-gradient(135deg, ${bg} 0%, ${bg2} 100%);padding:60px 40px;color:#ffffff;position:relative;overflow:hidden;text-align:center;">
  ${meshHtml}
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="position:relative;">
    ${eyebrow ? `
    <tr>
      <td align="center" style="padding:0 0 16px 0;">
        <span${editAttr(editable, "eyebrow")} style="font-family:${FONTS.body};font-size:${eyebrowSize}px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:${DESIGN_TOKENS.accentLight};line-height:${Math.round(eyebrowSize * (14 / 11))}px;">${eyebrow}</span>
      </td>
    </tr>` : ""}
    <tr>
      <td align="center" style="padding:0 0 16px 0;">
        <h2${editAttr(editable, "title")} style="font-family:${FONTS.heading};font-size:${titleSize}px;font-weight:800;letter-spacing:-0.03em;line-height:1.15;color:#ffffff;margin:0;mso-line-height-rule:exactly;">${title}</h2>
      </td>
    </tr>
    ${text ? `
    <tr>
      <td align="center" style="padding:0 0 32px 0;">
        <p${editAttr(editable, "text")} style="font-family:${FONTS.body};font-size:${textSize}px;line-height:1.55;color:rgba(255,255,255,0.78);margin:0 auto;max-width:420px;">${text}</p>
      </td>
    </tr>` : `<tr><td style="height:24px;line-height:24px;font-size:24px;">&nbsp;</td></tr>`}
    ${ctaHtml ? `
    <tr>
      <td align="center"${editAttr(editable, "cta.text")} style="padding:0;">${ctaHtml}</td>
    </tr>` : ""}
  </table>
</td></tr>`;
}

const schema = {
  type: "cta-dark",
  label: "CTA (dark navy)",
  description: "Final-conversion dark navy block with eyebrow, headline, text, and single primary button. Sits above the dark footer in product launches.",
  fields: [
    { key: "eyebrow", label: "Eyebrow line (e.g. \"Limited early access\")", type: "text", optional: true, maxLength: 40 },
    { key: "eyebrow_size", label: "Eyebrow text size", type: "fontSize", optional: true },
    { key: "title", label: "Headline", type: "text", required: true, maxLength: 100 },
    { key: "title_size", label: "Headline text size", type: "fontSize", optional: true },
    { key: "text", label: "Supporting text", type: "longText", optional: true, maxLength: 220 },
    { key: "text_size", label: "Supporting text size", type: "fontSize", optional: true },
    { key: "background_colour", label: "Background colour", type: "colour", optional: true, defaultPreview: "#0A0F1F", placeholder: "Defaults to dark navy", help: "Background colour of the block. Leave empty to keep the dark navy gradient." },
    { key: "cta", label: "Primary CTA", type: "group", required: true, fields: [
      { key: "text", label: "Button text", type: "text", required: true, maxLength: 30 },
      { key: "url", label: "Button URL", type: "url", required: true },
      { key: "colour", label: "Button colour", type: "colour", optional: true, defaultPreview: "#00B4D8", placeholder: "Defaults to current button colour", help: "Background colour of the button. Leave empty to keep the default." },
      { key: "text_colour", label: "Button text colour", type: "colour", optional: true, defaultPreview: "#0A0F1F", placeholder: "Defaults to current label colour", help: "Colour of the button label. Leave empty to keep the default." },
    ]},
  ],
};

module.exports = { render, schema };
