// lib/email-sections/hero-coloured.js
//
// A coloured hero block for marketing-style emails. Sister to the existing
// `masthead` (newspaper editorial style, monochrome) and `hero-image`
// (image-driven). Use this when you want a bold coloured block at the top
// of the email — Writesonic / The Hustle / Morning Brew vibe.
//
// What it accepts:
//   eyebrow         — small caps text top-left
//   date_label      — small caps text top-right
//   headline        — large bold H1 (supports \n for line breaks)
//   subhead         — paragraph below headline
//   cta_text        — optional button text
//   cta_url         — optional button URL
//   background_colour — hex (defaults to brand accent)
//   text_colour       — hex (defaults to white)
//   eyebrow_colour    — hex (defaults to text_colour at 80% via alpha)
//
// All colour props are validated against a strict hex regex; invalid values
// fall back to defaults silently. This prevents CSS injection via props.
//
// Outlook patterns used:
//   - Table-based layout, no flex/grid
//   - bgcolor attribute alongside style for Outlook fallback
//   - mso-line-height-rule:exactly on the large headline

const STATIC_BRAND = require("../email-brand");
const { escHtml, fallback, safeUrl } = require("./_helpers");

// Strict hex validator. Six-digit hex only (no shorthand, no rgb()).
// Returns the hex as-is if valid, null otherwise.
function safeHex(value) {
  if (typeof value !== "string") return null;
  return /^#[0-9A-Fa-f]{6}$/.test(value.trim()) ? value.trim() : null;
}

// Text-size presets. Each text entry area has a base pixel size; the
// chosen preset multiplies that base so the control means the same thing
// ("Larger") on every field regardless of its default size. An empty /
// unknown value resolves to 1 (the field's default size).
const FONT_SCALE = { xs: 0.8, s: 0.9, "": 1, m: 1, l: 1.2, xl: 1.45, xxl: 1.75 };

function scaleFont(basePx, sizeKey) {
  const factor = FONT_SCALE[sizeKey];
  return Math.round(basePx * (typeof factor === "number" ? factor : 1));
}

// Convert a hex colour to rgba() with given alpha. Used to derive an
// eyebrow_colour from text_colour when no explicit override is supplied.
function hexToRgba(hex, alpha) {
  const m = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r},${g},${b},${a})`;
}

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  // Colour resolution. Section props win when valid hex, else brand accent
  // (background) / white (text). The safeHex() check rejects anything that
  // doesn't match the strict pattern, preventing CSS-injection via props.
  const bg = safeHex(props.background_colour) || DESIGN_TOKENS.accent || "#00B4D8";
  const fg = safeHex(props.text_colour) || "#FFFFFF";
  const eyebrowColour = safeHex(props.eyebrow_colour) || hexToRgba(fg, 0.85);

  const eyebrow = props.eyebrow ? escHtml(props.eyebrow) : "";
  const dateLabel = props.date_label ? escHtml(props.date_label) : "";
  // Headline supports \n for hard line breaks (e.g. "New look.\nNew data.")
  const headlineRaw = String(fallback(props.headline, "Your headline here"));
  const headlineHtml = headlineRaw
    .split(/\r?\n/)
    .map(line => escHtml(line.trim()))
    .filter(Boolean)
    .join("<br>");
  const subhead = props.subhead ? escHtml(props.subhead) : "";

  const ctaText = props.cta_text ? escHtml(props.cta_text) : "";
  const ctaUrl = safeUrl(props.cta_url);

  // Button colours. Default keeps the original treatment (button fill =
  // text colour, label = background colour) so existing emails are
  // unchanged; either can be overridden with a valid hex.
  const ctaBg = safeHex(props.cta_colour) || fg;
  const ctaFg = safeHex(props.cta_text_colour) || bg;

  // Per-text-area sizes. Bases match the px values used in the markup
  // below; the preset scales each one consistently.
  const eyebrowSize = scaleFont(11, props.eyebrow_size);
  const dateSize = scaleFont(11, props.date_label_size);
  const headlineSize = scaleFont(40, props.headline_size);
  const subheadSize = scaleFont(16, props.subhead_size);

  // Top meta row — only render the row if eyebrow or date is set. If only
  // one is set, push it to its natural edge. A semi-transparent divider
  // line sits below the row, separating the meta from the headline within
  // the same coloured block (sits at ~30% of the text colour's opacity so
  // it works on any background).
  let metaRowHtml = "";
  if (eyebrow || dateLabel) {
    const dividerColour = hexToRgba(fg, 0.30);
    metaRowHtml = `
    <tr>
      <td style="padding:0 0 16px 0;border-bottom:1px solid ${dividerColour};">
        <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
          <tr>
            <td valign="middle" align="left" style="font-family:${FONTS.body};font-size:${eyebrowSize}px;font-weight:600;letter-spacing:0.10em;text-transform:uppercase;color:${eyebrowColour};line-height:${Math.round(eyebrowSize * 1.45)}px;">${eyebrow}</td>
            <td valign="middle" align="right" style="font-family:${FONTS.body};font-size:${dateSize}px;font-weight:600;letter-spacing:0.10em;text-transform:uppercase;color:${eyebrowColour};line-height:${Math.round(dateSize * 1.45)}px;">${dateLabel}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>`;
  }

  // Optional CTA button below subhead.
  let ctaRowHtml = "";
  if (ctaText && ctaUrl) {
    ctaRowHtml = `
    <tr>
      <td style="padding:28px 0 0 0;">
        <table role="presentation" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td bgcolor="${ctaBg}" style="background-color:${ctaBg};border-radius:6px;mso-padding-alt:12px 22px;">
              <a href="${ctaUrl}" style="display:inline-block;padding:12px 22px;font-family:${FONTS.body};font-size:14px;font-weight:600;color:${ctaFg};text-decoration:none;border-radius:6px;line-height:1;">${ctaText}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
  }

  return `
<tr><td bgcolor="${bg}" class="tg-pad-mobile" style="background-color:${bg};padding:52px 48px 56px;">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
    ${metaRowHtml}
    <tr>
      <td style="padding:0;">
        <h1 class="tg-hero-headline" style="font-family:${FONTS.heading};font-size:${headlineSize}px;font-weight:800;letter-spacing:-0.03em;line-height:1.1;color:${fg};margin:0;mso-line-height-rule:exactly;">${headlineHtml}</h1>
      </td>
    </tr>
    ${subhead ? `
    <tr>
      <td style="padding:18px 0 0 0;">
        <p class="tg-hero-subhead" style="font-family:${FONTS.body};font-size:${subheadSize}px;font-weight:400;color:${fg};line-height:1.55;margin:0;opacity:0.92;">${subhead}</p>
      </td>
    </tr>` : ""}
    ${ctaRowHtml}
  </table>
</td></tr>`;
}

const schema = {
  type: "hero-coloured",
  label: "Hero (coloured)",
  description: "Bold coloured hero block with eyebrow, headline, subhead, optional CTA. Sister to the editorial masthead — use this for marketing-style emails (Writesonic, The Hustle, Morning Brew style).",
  fields: [
    { key: "eyebrow", label: "Eyebrow (small caps, top-left)", type: "text", optional: true, maxLength: 60 },
    { key: "eyebrow_size", label: "Eyebrow text size", type: "fontSize", optional: true },
    { key: "date_label", label: "Date / right-side label", type: "text", optional: true, maxLength: 40 },
    { key: "date_label_size", label: "Date label text size", type: "fontSize", optional: true },
    { key: "headline", label: "Headline (use line breaks for multi-line)", type: "longText", required: true, maxLength: 200 },
    { key: "headline_size", label: "Headline text size", type: "fontSize", optional: true },
    { key: "subhead", label: "Subhead paragraph", type: "longText", optional: true, maxLength: 240 },
    { key: "subhead_size", label: "Subhead text size", type: "fontSize", optional: true },
    { key: "cta_text", label: "CTA button text", type: "text", optional: true, maxLength: 40 },
    { key: "cta_url", label: "CTA button URL", type: "url", optional: true },
    { key: "cta_colour", label: "Button colour", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Defaults to the text colour", help: "Background colour of the CTA button. Leave empty to use the text colour." },
    { key: "cta_text_colour", label: "Button text colour", type: "colour", optional: true, defaultPreview: "#00B4D8", placeholder: "Defaults to the background colour", help: "Colour of the button label. Leave empty to use the hero background colour." },
    { key: "background_colour", label: "Background colour", type: "colour", optional: true, defaultPreview: "#00B4D8", placeholder: "#00B4D8", help: "Leave empty to use your brand accent colour." },
    { key: "text_colour", label: "Text colour", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "#FFFFFF", help: "Pick a colour that contrasts strongly with the background." },
    { key: "eyebrow_colour", label: "Eyebrow colour (advanced)", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Defaults to text colour at 85% opacity", help: "Override the eyebrow/date colour. Leave empty for sensible default." },
  ],
};

module.exports = { render, schema };
