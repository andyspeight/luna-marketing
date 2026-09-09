// lib/email-sections/_outlook-bulletproof.js
// Shared bulletproof Outlook patterns from travelgenix-email-design SKILL.md §12.
// Every component built per the new design system uses these helpers
// instead of re-implementing the patterns inline.

const { FONTS } = require("../email-brand");

/**
 * P2 — Bulletproof CTA button (§12.2 in skill).
 * Renders as a clickable rounded rectangle in every email client including
 * Outlook 2016+ (which ignores border-radius on <a> without VML).
 *
 * Other clients see the regular HTML <a>; Outlook sees the VML <v:roundrect>.
 *
 * @param {Object} opts
 * @param {string} opts.text       Button label (already HTML-escaped by caller)
 * @param {string} opts.url        Button href (already validated by caller)
 * @param {string} [opts.bgColor]  Background colour (default: vivid teal)
 * @param {string} [opts.textColor] Text colour (default: dark navy on teal)
 * @param {number} [opts.width]    Approx width in pixels for VML (default: 200)
 * @param {number} [opts.height]   Height in pixels for VML (default: 48)
 * @param {string} [opts.align]    "left" | "center" | "right" (default: "left")
 * @param {number} [opts.fontSize] Label size in px (default: 15)
 * @param {number} [opts.paddingY] Vertical padding in px (default: 14)
 * @param {number} [opts.paddingX] Horizontal padding in px (default: 28)
 * @param {number} [opts.radius]   Corner radius in px (default: 10)
 * @param {boolean} [opts.fullWidth] Stretch the button across its container
 * @param {string} [opts.attrs]    Extra attributes for the <a> (e.g. an
 *                                 editAttr() hook). Must start with a space.
 * @returns {string} HTML markup
 *
 * The size/radius/fullWidth/attrs options were added for the standalone
 * `button` and `image-text` sections. Every option defaults to the value
 * that was hard-coded before, so callers that don't pass them get
 * byte-identical output.
 */
function bulletproofCta(opts = {}) {
  const text = opts.text || "Continue";
  const url = opts.url || "#";
  const bgColor = opts.bgColor || "#00B4D8";
  const textColor = opts.textColor || "#0F172A";
  const width = opts.width || 200;
  const height = opts.height || 48;
  const align = opts.align === "center" || opts.align === "right" ? opts.align : "left";
  const fontSize = opts.fontSize || 15;
  const paddingY = opts.paddingY || 14;
  const paddingX = opts.paddingX || 28;
  const radius = opts.radius || 10;
  const fullWidth = opts.fullWidth === true;
  const attrs = typeof opts.attrs === "string" ? opts.attrs : "";

  // VML arcsize is the corner radius as a percentage of half the height.
  // The original fixed value (20%) is kept whenever the caller doesn't
  // override the radius, so existing emails render unchanged.
  const arcsize = opts.radius ? `${Math.max(0, Math.min(50, Math.round((radius / height) * 100)))}%` : "20%";

  // For centred/right buttons, back the deprecated align attribute with an
  // auto margin — some webmail clients (notably Gmail) drop the attribute
  // but keep the style, which would otherwise leave the button left-aligned.
  const marginStyle = align === "center" ? "0 auto" : (align === "right" ? "0 0 0 auto" : "0");
  const tableWidth = fullWidth ? ` width="100%"` : "";
  const tableStyle = fullWidth ? `margin:${marginStyle};width:100%;` : `margin:${marginStyle};`;
  const linkDisplay = fullWidth ? "display:block;text-align:center;" : "display:inline-block;";
  return `
<table role="presentation" border="0" cellspacing="0" cellpadding="0" align="${align}"${tableWidth} style="${tableStyle}">
  <tr>
    <td align="center" bgcolor="${bgColor}" style="background-color:${bgColor};border-radius:${radius}px;">
      <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
          href="${url}"
          style="height:${height}px;v-text-anchor:middle;width:${width}px;"
          arcsize="${arcsize}"
          stroke="f"
          fillcolor="${bgColor}">
          <w:anchorlock/>
          <center style="color:${textColor};font-family:'Segoe UI',Arial,sans-serif;font-size:${fontSize}px;font-weight:bold;">${text}</center>
        </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-- -->
        <a href="${url}"${attrs} style="${linkDisplay}padding:${paddingY}px ${paddingX}px;background:${bgColor};color:${textColor};text-decoration:none;border-radius:${radius}px;font-family:${FONTS.body};font-size:${fontSize}px;font-weight:700;letter-spacing:-0.005em;line-height:1;">${text}</a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;
}

/**
 * P5 — Image with optional gradient overlay text (§12.2).
 * Outlook gets just the image (no overlay); modern clients see the gradient.
 * Used for destination cards, trip cards, hero images.
 *
 * @param {Object} opts
 * @param {string} opts.imageUrl   Image URL (already validated)
 * @param {string} [opts.alt]      Alt text
 * @param {number} [opts.width]    Width in pixels (default: 600)
 * @param {number} [opts.height]   Height in pixels (default: 180)
 * @param {string} [opts.overlayHtml]  Optional HTML to position over the image
 *                                     (only renders in non-Outlook clients)
 * @returns {string} HTML markup
 */
function imageWithOverlay(opts = {}) {
  const imageUrl = opts.imageUrl || "";
  const alt = opts.alt || "";
  const width = opts.width || 600;
  const height = opts.height || 180;
  const overlayHtml = opts.overlayHtml || "";

  if (!imageUrl) return "";

  // Outlook version: just the image
  // Modern clients: image + optional positioned overlay
  return `
<!--[if mso]>
  <img src="${imageUrl}" alt="${alt}" width="${width}" height="${height}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;"/>
<![endif]-->
<!--[if !mso]><!-- -->
  <div style="position:relative;width:100%;max-width:${width}px;">
    <img src="${imageUrl}" alt="${alt}" width="${width}" height="${height}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;"/>
    ${overlayHtml ? `<div style="position:absolute;bottom:16px;left:20px;color:#ffffff;">${overlayHtml}</div>` : ""}
  </div>
<!--<![endif]-->`;
}

/**
 * P6 — Two-column layout that stacks on mobile (§12.2).
 * Outlook sees side-by-side <td>s; mobile clients honouring the stack-mobile
 * media query stack them vertically.
 *
 * @param {string} leftHtml  HTML for left column
 * @param {string} rightHtml HTML for right column
 * @param {Object} [opts]
 * @param {number} [opts.gap]  Gap in pixels between columns (default: 16)
 * @returns {string} HTML markup
 */
function twoColumn(leftHtml, rightHtml, opts = {}) {
  const gap = opts.gap || 16;
  const halfGap = Math.round(gap / 2);
  return `
<table role="presentation" class="tg-stack-mobile" border="0" cellspacing="0" cellpadding="0" width="100%">
  <tr>
    <td width="50%" valign="top" style="padding-right:${halfGap}px;">${leftHtml}</td>
    <td width="50%" valign="top" style="padding-left:${halfGap}px;">${rightHtml}</td>
  </tr>
</table>`;
}

/**
 * P7 — Three-column layout that stacks on mobile.
 * Used for destination grids, stats strips, three-up content blocks.
 *
 * @param {string[]} columnsHtml  Array of exactly 3 HTML strings
 * @param {Object} [opts]
 * @param {number} [opts.gap]  Gap in pixels (default: 16)
 * @returns {string} HTML markup
 */
function threeColumn(columnsHtml, opts = {}) {
  if (!Array.isArray(columnsHtml) || columnsHtml.length !== 3) return "";
  const gap = opts.gap || 16;
  const halfGap = Math.round(gap / 2);
  return `
<table role="presentation" class="tg-stack-mobile" border="0" cellspacing="0" cellpadding="0" width="100%">
  <tr>
    <td width="33.33%" valign="top" style="padding-right:${halfGap}px;">${columnsHtml[0]}</td>
    <td width="33.33%" valign="top" style="padding:0 ${halfGap}px;">${columnsHtml[1]}</td>
    <td width="33.33%" valign="top" style="padding-left:${halfGap}px;">${columnsHtml[2]}</td>
  </tr>
</table>`;
}

module.exports = {
  bulletproofCta,
  imageWithOverlay,
  twoColumn,
  threeColumn,
};
