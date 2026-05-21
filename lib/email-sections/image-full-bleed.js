// lib/email-sections/image-full-bleed.js
//
// A full-width edge-to-edge image. No padding on the outer cell. Used
// for atmospheric imagery — landscape shots, hero photography, brand
// moments. The image fills the full email width (600px desktop, 100%
// mobile via .tg-img-fluid).
//
// What it accepts:
//   image_url         — required image
//   image_alt         — alt text
//   link_url          — optional, wraps the image in an <a> tag
//   caption           — optional caption below the image (italic, grey)
//   show_rule_above   — boolean, render a thin rule above the image (default false)
//   show_rule_below   — boolean, render a thin rule below the image (default false)
//   rule_colour       — colour of any rules rendered (default #000000)
//
// Layout:
//   [Optional rule above]
//   [Full-width image]
//   [Optional caption]
//   [Optional rule below]

const STATIC_BRAND = require("../email-brand");
const { escHtml, escAttr, safeUrl } = require("./_helpers");

function safeHex(value) {
  if (typeof value !== "string") return null;
  return /^#[0-9A-Fa-f]{6}$/.test(value.trim()) ? value.trim() : null;
}

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const imgUrl = safeUrl(props.image_url);
  if (!imgUrl) return "";

  const imgAlt = props.image_alt ? escAttr(props.image_alt) : "";
  const linkUrl = safeUrl(props.link_url);
  const caption = props.caption ? escHtml(props.caption) : "";
  const ruleColour = safeHex(props.rule_colour) || "#000000";
  const showAbove = props.show_rule_above === true;  // default false
  const showBelow = props.show_rule_below === true;  // default false

  // Inner image element. Width 600 matches the email body width; max-width
  // 100% lets mobile render fluidly. No border-radius for full-bleed.
  const imgEl = `<img src="${imgUrl}" alt="${imgAlt}" width="600" class="tg-img-fluid" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">`;
  const imageHtml = linkUrl
    ? `<a href="${linkUrl}" style="text-decoration:none;display:block;">${imgEl}</a>`
    : imgEl;

  const ruleRow = (show) => show
    ? `<tr><td style="padding:0 36px;font-size:0;line-height:0;">
        <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
          <tr><td style="border-bottom:1px solid ${ruleColour};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
        </table>
      </td></tr>`
    : "";

  const captionHtml = caption
    ? `<tr>
        <td align="center" class="tg-pad-mobile" style="padding:14px 36px 0 36px;">
          <p style="font-family:${FONTS.body};font-size:12px;font-style:italic;color:${DESIGN_TOKENS.textTertiary || "#888888"};line-height:18px;margin:0;mso-line-height-rule:exactly;">${caption}</p>
        </td>
      </tr>`
    : "";

  return `
${ruleRow(showAbove)}
<tr><td style="padding:0;font-size:0;line-height:0;">
  ${imageHtml}
</td></tr>
${captionHtml}
${ruleRow(showBelow)}`;
}

const schema = {
  type: "image-full-bleed",
  label: "Image (full-bleed)",
  description: "Full-width edge-to-edge image with no padding. Use for atmospheric imagery, hero photography, brand moments. Optional caption, optional thin rules above and below.",
  fields: [
    { key: "image_url", label: "Image URL", type: "url", required: true },
    { key: "image_alt", label: "Image alt text", type: "text", optional: true, maxLength: 120 },
    { key: "link_url", label: "Optional link URL (wraps the image)", type: "url", optional: true },
    { key: "caption", label: "Caption (optional, italic)", type: "text", optional: true, maxLength: 200 },
    { key: "show_rule_above", label: "Show rule above image", type: "boolean", optional: true, checkboxLabel: "Show a thin rule above the image" },
    { key: "show_rule_below", label: "Show rule below image", type: "boolean", optional: true, checkboxLabel: "Show a thin rule below the image" },
    { key: "rule_colour", label: "Rule colour", type: "colour", optional: true, defaultPreview: "#000000", placeholder: "#000000" },
  ],
};

module.exports = { render, schema };
