// lib/email-sections/text.js
const { BRAND, FONTS } = require("../email-brand");
const { escHtml, renderBody, scaleFont } = require("./_helpers");

function render(props = {}) {
  const headline = props.headline ? escHtml(props.headline) : "";
  const subhead = props.subhead ? escHtml(props.subhead) : "";
  const bodyHtml = renderBody(props.body || "");
  const align = props.align === "center" ? "center" : "left";

  // Per-text-area sizes. Bases match the px values used in the markup below.
  const headlineSize = scaleFont(22, props.headline_size);
  const subheadSize = scaleFont(15, props.subhead_size);
  const bodySize = scaleFont(16, props.body_size);

  let inner = "";
  if (headline) {
    inner += `<div style="font-family:${FONTS.heading};font-size:${headlineSize}px;font-weight:700;color:${BRAND.ink};line-height:${Math.round(headlineSize * (30 / 22))}px;text-align:${align};margin:0 0 8px 0;">${headline}</div>`;
  }
  if (subhead) {
    inner += `<div style="font-family:${FONTS.body};font-size:${subheadSize}px;color:${BRAND.inkMuted};line-height:${Math.round(subheadSize * (22 / 15))}px;text-align:${align};margin:0 0 12px 0;">${subhead}</div>`;
  }
  if (bodyHtml) {
    inner += `<div style="font-family:${FONTS.body};font-size:${bodySize}px;color:${BRAND.inkSoft};line-height:${Math.round(bodySize * (26 / 16))}px;text-align:${align};margin:0;">${bodyHtml}</div>`;
  }

  return `
<tr><td bgcolor="${BRAND.surface}" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:20px 32px;">${inner}</td></tr>`;
}

const schema = {
  type: "text",
  label: "Text",
  description: "Headline and body paragraph(s)",
  fields: [
    { key: "headline", label: "Headline", type: "text", optional: true, maxLength: 100 },
    { key: "headline_size", label: "Headline text size", type: "fontSize", optional: true },
    { key: "subhead", label: "Subhead", type: "text", optional: true, maxLength: 160 },
    { key: "subhead_size", label: "Subhead text size", type: "fontSize", optional: true },
    { key: "body", label: "Body", type: "longText", required: true, maxLength: 2000 },
    { key: "body_size", label: "Body text size", type: "fontSize", optional: true },
    { key: "align", label: "Alignment", type: "select",
      options: ["left", "center"], default: "left" },
  ],
};

module.exports = { render, schema };
