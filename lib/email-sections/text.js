// lib/email-sections/text.js
// Single-column text block. Optional headline + body. The workhorse.

const { BRAND, FONTS } = require("../email-brand");
const { escHtml, renderBody } = require("./_helpers");

/**
 * Schema:
 *   headline?: string
 *   subhead?: string
 *   body: string
 *   align?: 'left' | 'center'  (default 'left')
 */
function render(props = {}) {
  const headline = props.headline ? escHtml(props.headline) : "";
  const subhead = props.subhead ? escHtml(props.subhead) : "";
  const bodyHtml = renderBody(props.body || "");
  const align = props.align === "center" ? "center" : "left";

  return `
    <mj-section background-color="${BRAND.surface}" padding="20px 32px">
      <mj-column>
        ${headline ? `<mj-text
          font-family="${FONTS.heading}"
          font-size="22px"
          font-weight="700"
          color="${BRAND.ink}"
          line-height="30px"
          align="${align}"
          padding="0 0 8px 0"
        >${headline}</mj-text>` : ""}
        ${subhead ? `<mj-text
          font-family="${FONTS.body}"
          font-size="15px"
          color="${BRAND.inkMuted}"
          line-height="22px"
          align="${align}"
          padding="0 0 12px 0"
        >${subhead}</mj-text>` : ""}
        ${bodyHtml ? `<mj-text
          font-family="${FONTS.body}"
          font-size="16px"
          color="${BRAND.inkSoft}"
          line-height="26px"
          align="${align}"
          padding="0"
        >${bodyHtml}</mj-text>` : ""}
      </mj-column>
    </mj-section>`;
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
