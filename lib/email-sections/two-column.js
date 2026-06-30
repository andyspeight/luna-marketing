// lib/email-sections/two-column.js
const { BRAND, FONTS } = require("../email-brand");
const { escHtml, safeUrl, renderBody, fallback, scaleFont, safeHex } = require("./_helpers");

function render(props = {}) {
  const left = props.left || {};
  const right = props.right || {};

  function renderColumnCell(col, isLeft) {
    const imageUrl = safeUrl(col.imageUrl);
    const imageAlt = escHtml(col.imageAlt || "");
    const headline = escHtml(fallback(col.headline, ""));
    const bodyHtml = renderBody(col.body || "");
    const linkText = col.linkText ? escHtml(col.linkText) : "";
    const linkUrl = safeUrl(col.linkUrl);

    // Per-text-area sizes. Bases match the px values used in the markup below.
    const headlineSize = scaleFont(17, col.headline_size);
    const bodySize = scaleFont(14, col.body_size);

    // Link colour defaults to the original treatment so existing emails are
    // unchanged; can be overridden with a valid hex.
    const linkColour = safeHex(col.cta_text_colour) || BRAND.tealDeep;

    const innerPadding = isLeft ? "0 12px 0 0" : "0 0 0 12px";

    let inner = "";
    if (imageUrl) {
      inner += `<img src="${imageUrl}" alt="${imageAlt}" width="200" class="tg-img-fluid" style="display:block;width:100%;max-width:200px;height:auto;border:0;outline:none;text-decoration:none;border-radius:6px;margin:0 0 16px 0;">`;
    }
    if (headline) {
      inner += `<div style="font-family:${FONTS.heading};font-size:${headlineSize}px;font-weight:700;color:${BRAND.ink};line-height:${Math.round(headlineSize * (24 / 17))}px;margin:0 0 8px 0;">${headline}</div>`;
    }
    if (bodyHtml) {
      inner += `<div style="font-family:${FONTS.body};font-size:${bodySize}px;color:${BRAND.inkSoft};line-height:${Math.round(bodySize * (22 / 14))}px;margin:0 0 8px 0;">${bodyHtml}</div>`;
    }
    if (linkText && linkUrl) {
      inner += `<div style="font-family:${FONTS.body};font-size:13px;font-weight:600;line-height:20px;margin:0;"><a href="${linkUrl}" style="color:${linkColour};text-decoration:none;">${linkText} &rarr;</a></div>`;
    }

    return `<td valign="top" width="50%" class="tg-stack" style="vertical-align:top;padding:${innerPadding};">${inner}</td>`;
  }

  return `
<tr><td bgcolor="${BRAND.surface}" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:20px 32px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;">
<tr>${renderColumnCell(left, true)}${renderColumnCell(right, false)}</tr>
</table>
</td></tr>`;
}

const columnFields = [
  { key: "imageUrl", label: "Image URL", type: "url", optional: true },
  { key: "imageAlt", label: "Image alt", type: "text", optional: true },
  { key: "headline", label: "Headline", type: "text", required: true, maxLength: 60 },
  { key: "headline_size", label: "Headline text size", type: "fontSize", optional: true },
  { key: "body", label: "Body", type: "longText", required: true, maxLength: 280 },
  { key: "body_size", label: "Body text size", type: "fontSize", optional: true },
  { key: "linkText", label: "Link text", type: "text", optional: true, maxLength: 30 },
  { key: "linkUrl", label: "Link URL", type: "url", optional: true },
  { key: "cta_text_colour", label: "Link colour", type: "colour", optional: true, defaultPreview: "#067A75", placeholder: "Defaults to current link colour", help: "Colour of the link text. Leave empty to keep the default." },
];

const schema = {
  type: "two-column",
  label: "Two columns",
  description: "Side-by-side blocks, stacks on mobile",
  fields: [
    { key: "left", label: "Left column", type: "object", fields: columnFields },
    { key: "right", label: "Right column", type: "object", fields: columnFields },
  ],
};

module.exports = { render, schema };
