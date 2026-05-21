// lib/email-sections/image.js
//
// A single inline image with standard email padding. Drop between text
// blocks for editorial layout. Sister sections:
//   - `image-full-bleed`: edge-to-edge atmospheric hero imagery
//   - `image-duo`: two side-by-side images
//   - `hero-image`: hero block with image + headline + CTA
//
// This is the everyday image section — single image, padded into the
// body, optional caption, optional link, alignment/width controls.
//
// What it accepts:
//   image_url         — required
//   image_alt         — alt text
//   link_url          — optional, wraps image in <a>
//   caption           — optional italic caption below
//   alignment         — 'left' | 'center' (default) | 'right'
//   width             — 'small' (264px) | 'medium' (396px) | 'full' (528px, default)
//                       Pixel widths sit inside the standard 600px email body
//                       minus 36px padding either side = 528px usable.
//   rounded           — boolean, rounded corners (default true)
//   background_colour — optional bg colour behind the image (default transparent)

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

  // Alignment — affects the <td align=""> on the wrapping cell.
  const validAligns = { left: "left", center: "center", right: "right" };
  const alignment = validAligns[props.alignment] || "center";

  // Width — predefined sizes only, no arbitrary pixel values from props.
  // 528px = 600 (email body) - 36*2 (standard padding) = full inner width.
  const widthMap = { small: 264, medium: 396, full: 528 };
  const widthPx = widthMap[props.width] || widthMap.full;

  // Rounded corners by default. Set to false for sharp editorial look.
  const rounded = props.rounded !== false;
  const borderRadius = rounded ? "8px" : "0";

  const bgColour = safeHex(props.background_colour);

  // Inner image — width attribute + style for fluid behaviour.
  const imgEl = `<img src="${imgUrl}" alt="${imgAlt}" width="${widthPx}" class="tg-img-fluid" style="display:block;width:100%;max-width:${widthPx}px;height:auto;border:0;border-radius:${borderRadius};outline:none;text-decoration:none;${alignment === "center" ? "margin:0 auto;" : ""}">`;
  const imageHtml = linkUrl
    ? `<a href="${linkUrl}" style="text-decoration:none;display:inline-block;">${imgEl}</a>`
    : imgEl;

  const captionHtml = caption
    ? `<tr>
        <td align="${alignment}" style="padding:12px 0 0 0;">
          <p style="font-family:${FONTS.body};font-size:12px;font-style:italic;color:${DESIGN_TOKENS.textTertiary || "#888888"};line-height:18px;margin:0;mso-line-height-rule:exactly;">${caption}</p>
        </td>
      </tr>`
    : "";

  const outerBg = bgColour ? `bgcolor="${bgColour}"` : "";
  const outerStyle = bgColour
    ? `background-color:${bgColour};padding:16px 36px;`
    : `padding:16px 36px;`;

  return `
<tr><td ${outerBg} class="tg-pad-mobile" style="${outerStyle}">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
    <tr>
      <td align="${alignment}" style="padding:0;">
        ${imageHtml}
      </td>
    </tr>
    ${captionHtml}
  </table>
</td></tr>`;
}

const schema = {
  type: "image",
  label: "Image",
  description: "A single image dropped between text blocks. Standard email padding, optional caption, alignment and width controls. For atmospheric edge-to-edge imagery use image-full-bleed instead.",
  fields: [
    { key: "image_url", label: "Image URL", type: "url", required: true },
    { key: "image_alt", label: "Image alt text", type: "text", optional: true, maxLength: 120 },
    { key: "link_url", label: "Optional link URL (wraps the image)", type: "url", optional: true },
    { key: "caption", label: "Caption (italic, below image)", type: "text", optional: true, maxLength: 200 },
    { key: "alignment", label: "Alignment", type: "select", optional: true, options: ["left", "center", "right"] },
    { key: "width", label: "Width", type: "select", optional: true, options: ["small", "medium", "full"] },
    { key: "rounded", label: "Rounded corners", type: "boolean", optional: true, checkboxLabel: "Round the image corners (uncheck for sharp editorial look)" },
    { key: "background_colour", label: "Background colour (optional)", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Leave empty for transparent", help: "Apply a tinted background behind the image." },
  ],
};

module.exports = { render, schema };
