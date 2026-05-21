// lib/email-sections/image-duo.js
//
// A two-up side-by-side image grid with an optional shared caption.
// Useful for: destination spotlights, hotel exterior + interior, before/
// after, comparison shots, twin features. Daily Beacon style — sharp
// corners (no border-radius), small gap between images, italic caption.
//
// What it accepts:
//   image_one_url     — required first image
//   image_one_alt     — alt text for first image
//   image_two_url     — required second image
//   image_two_alt     — alt text for second image
//   caption           — optional shared caption below both images
//   show_rule_below   — boolean, render a thin rule under the row (default true)
//   background_colour — optional section bg colour (defaults to transparent)
//   rule_colour       — colour of the bottom rule (default #000000)
//
// Layout:
//   [Image 1] [12px gap] [Image 2]   <- 50/50 split
//   [Caption centred]
//   ----------------------
//
// Mobile: images stack via `.tg-stack-narrow`.

const STATIC_BRAND = require("../email-brand");
const { escHtml, escAttr, safeUrl } = require("./_helpers");

function safeHex(value) {
  if (typeof value !== "string") return null;
  return /^#[0-9A-Fa-f]{6}$/.test(value.trim()) ? value.trim() : null;
}

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const bgColour = safeHex(props.background_colour);
  const ruleColour = safeHex(props.rule_colour) || "#000000";
  const showRule = props.show_rule_below !== false;

  const img1Url = safeUrl(props.image_one_url);
  const img1Alt = props.image_one_alt ? escAttr(props.image_one_alt) : "";
  const img2Url = safeUrl(props.image_two_url);
  const img2Alt = props.image_two_alt ? escAttr(props.image_two_alt) : "";

  if (!img1Url && !img2Url) return "";

  const caption = props.caption ? escHtml(props.caption) : "";

  const renderImageCell = (url, alt) => {
    if (url) {
      return `<img src="${url}" alt="${alt}" width="258" class="tg-img-fluid" style="display:block;width:100%;max-width:258px;height:auto;border:0;outline:none;text-decoration:none;">`;
    }
    return `<div style="width:100%;max-width:258px;height:180px;background-color:#EFEFEF;"></div>`;
  };

  const outerBg = bgColour ? `bgcolor="${bgColour}"` : "";
  const outerStyle = bgColour
    ? `background-color:${bgColour};padding:16px 36px 24px 36px;`
    : `padding:16px 36px 24px 36px;`;

  const captionHtml = caption
    ? `<tr>
        <td colspan="3" align="center" style="padding:14px 0 0 0;">
          <p style="font-family:${FONTS.body};font-size:12px;color:${DESIGN_TOKENS.textTertiary || "#888888"};line-height:18px;margin:0;mso-line-height-rule:exactly;">${caption}</p>
        </td>
      </tr>`
    : "";

  const ruleHtml = showRule
    ? `<tr>
        <td colspan="3" style="padding:18px 0 0 0;font-size:0;line-height:0;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
            <tr><td style="border-bottom:1px solid ${ruleColour};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
          </table>
        </td>
      </tr>`
    : "";

  return `
<tr><td ${outerBg} class="tg-pad-mobile" style="${outerStyle}">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
    <tr>
      <td width="258" valign="top" class="tg-stack-narrow" style="width:258px;">
        ${renderImageCell(img1Url, img1Alt)}
      </td>
      <td width="12" class="tg-stack-narrow" style="width:12px;font-size:0;line-height:0;">&nbsp;</td>
      <td width="258" valign="top" class="tg-stack-narrow" style="width:258px;">
        ${renderImageCell(img2Url, img2Alt)}
      </td>
    </tr>
    ${captionHtml}
    ${ruleHtml}
  </table>
</td></tr>`;
}

const schema = {
  type: "image-duo",
  label: "Image (two-up)",
  description: "Two side-by-side images with optional shared caption and underline rule. Daily Beacon style. Stacks vertically on mobile.",
  fields: [
    { key: "image_one_url", label: "First image URL", type: "url", required: true },
    { key: "image_one_alt", label: "First image alt text", type: "text", optional: true, maxLength: 120 },
    { key: "image_two_url", label: "Second image URL", type: "url", required: true },
    { key: "image_two_alt", label: "Second image alt text", type: "text", optional: true, maxLength: 120 },
    { key: "caption", label: "Shared caption (optional)", type: "text", optional: true, maxLength: 200 },
    { key: "show_rule_below", label: "Show rule below images", type: "boolean", optional: true, checkboxLabel: "Show a thin rule under the row" },
    { key: "rule_colour", label: "Rule colour", type: "colour", optional: true, defaultPreview: "#000000", placeholder: "#000000" },
    { key: "background_colour", label: "Section background colour (optional)", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Leave empty for transparent", help: "Apply a tinted background behind the image row." },
  ],
};

module.exports = { render, schema };
