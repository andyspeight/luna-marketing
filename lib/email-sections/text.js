// lib/email-sections/text.js
const { BRAND, FONTS } = require("../email-brand");
const { escHtml, renderBody } = require("./_helpers");

function render(props = {}) {
  const headline = props.headline ? escHtml(props.headline) : "";
  const subhead = props.subhead ? escHtml(props.subhead) : "";
  const bodyHtml = renderBody(props.body || "");
  const align = props.align === "center" ? "center" : "left";

  let inner = "";
  if (headline) {
    inner += `<div style="font-family:${FONTS.heading};font-size:22px;font-weight:700;color:${BRAND.ink};line-height:30px;text-align:${align};margin:0 0 8px 0;">${headline}</div>`;
  }
  if (subhead) {
    inner += `<div style="font-family:${FONTS.body};font-size:15px;color:${BRAND.inkMuted};line-height:22px;text-align:${align};margin:0 0 12px 0;">${subhead}</div>`;
  }
  if (bodyHtml) {
    inner += `<div style="font-family:${FONTS.body};font-size:16px;color:${BRAND.inkSoft};line-height:26px;text-align:${align};margin:0;">${bodyHtml}</div>`;
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
    { key: "subhead", label: "Subhead", type: "text", optional: true, maxLength: 160 },
    { key: "body", label: "Body", type: "longText", required: true, maxLength: 2000 },
    { key: "align", label: "Alignment", type: "select",
      options: ["left", "center"], default: "left" },
  ],
};

module.exports = { render, schema };
