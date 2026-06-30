// lib/email-sections/cta-pill.js
//
// A centred rounded pill button — the Daily Beacon "Upgrade subscription"
// style. Different shape from the existing rectangle `cta-banner`. Use
// this when you want a soft, marketing-friendly CTA. Sister to
// `cta-banner` (rectangular, sharper) and `cta-dark` (inverted dark bg).
//
// What it accepts:
//   text              — button label (required)
//   url               — button link (required)
//   subtext           — optional one-line italic text below the button
//   background_colour — pill fill colour (default Daily Beacon orange #E85D1A)
//   text_colour       — button label colour (default #FFFFFF)
//   italic            — boolean, render label in italic (default true — Daily Beacon style)
//
// Layout:
//   Centred row containing:
//     [ button label ]   ← rounded pill, large padding
//     [ subtext line ]   ← optional, italic, small, under the button

const STATIC_BRAND = require("../email-brand");
const { escHtml, safeUrl, fallback, scaleFont, safeHex } = require("./_helpers");

function render(props = {}, brand) {
  const { FONTS } = brand || STATIC_BRAND;

  const bg = safeHex(props.background_colour) || "#E85D1A";
  const fg = safeHex(props.text_colour) || "#FFFFFF";
  const isItalic = props.italic !== false;  // default true

  // Button colour overrides. Default to the resolved pill colours so
  // existing emails are unchanged; either can be overridden with a hex.
  const ctaBg = safeHex(props.cta_colour) || bg;
  const ctaFg = safeHex(props.cta_text_colour) || fg;

  const text = escHtml(fallback(props.text, "Click here"));
  const url = safeUrl(props.url);
  const subtext = props.subtext ? escHtml(props.subtext) : "";

  // Per-text-area sizes — bases match the px values in the markup below.
  const textSize = scaleFont(15, props.text_size);
  const subtextSize = scaleFont(12, props.subtext_size);

  // If no URL provided, render nothing — a CTA without a link is dead.
  if (!url) return "";

  const fontStyle = isItalic ? "font-style:italic;" : "";

  // The pill is achieved with a high border-radius (999px effectively
  // creates a full-rounded shape). Outlook's mso-padding-alt provides
  // padding fallback for Outlook 2007+.
  const buttonHtml = `
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:0 auto;">
      <tr>
        <td bgcolor="${ctaBg}" align="center" style="background-color:${ctaBg};border-radius:999px;mso-padding-alt:16px 40px;">
          <a href="${url}" style="display:inline-block;padding:16px 40px;font-family:${FONTS.body};font-size:${textSize}px;font-weight:700;${fontStyle}color:${ctaFg};text-decoration:none;border-radius:999px;line-height:1;">${text}</a>
        </td>
      </tr>
    </table>`;

  const subtextHtml = subtext
    ? `<tr>
        <td align="center" style="padding:12px 0 0 0;">
          <p style="font-family:${FONTS.body};font-size:${subtextSize}px;font-style:italic;color:#888888;line-height:${Math.round(subtextSize * (18 / 12))}px;margin:0;">${subtext}</p>
        </td>
      </tr>`
    : "";

  return `
<tr><td class="tg-pad-mobile" align="center" style="padding:24px 36px 32px 36px;">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
    <tr>
      <td align="center">${buttonHtml}</td>
    </tr>
    ${subtextHtml}
  </table>
</td></tr>`;
}

const schema = {
  type: "cta-pill",
  label: "CTA (pill button)",
  description: "Centred rounded pill button with optional italic subtext below. Daily Beacon style — orange pill, white italic label. Different shape from the rectangular cta-banner. Use for warmer, marketing-friendly calls to action.",
  fields: [
    { key: "text", label: "Button text", type: "text", required: true, maxLength: 40 },
    { key: "text_size", label: "Button text size", type: "fontSize", optional: true },
    { key: "url", label: "Button link URL", type: "url", required: true },
    { key: "cta_colour", label: "Button colour", type: "colour", optional: true, defaultPreview: "#E85D1A", placeholder: "Defaults to current button colour", help: "Background colour of the button. Leave empty to keep the default." },
    { key: "cta_text_colour", label: "Button text colour", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Defaults to current label colour", help: "Colour of the button label. Leave empty to keep the default." },
    { key: "subtext", label: "Italic subtext below button (optional)", type: "text", optional: true, maxLength: 120 },
    { key: "subtext_size", label: "Subtext text size", type: "fontSize", optional: true },
    { key: "background_colour", label: "Pill background colour", type: "colour", optional: true, defaultPreview: "#E85D1A", placeholder: "#E85D1A", help: "Daily Beacon orange. Try your brand accent for Travelgenix emails." },
    { key: "text_colour", label: "Button text colour", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "#FFFFFF" },
    { key: "italic", label: "Italic button text", type: "boolean", optional: true, checkboxLabel: "Render button text in italic (Daily Beacon style)" },
  ],
};

module.exports = { render, schema };
