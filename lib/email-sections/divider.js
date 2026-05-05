// lib/email-sections/divider.js
// Visual break between content blocks.

const { BRAND } = require("../email-brand");

/**
 * Schema:
 *   style?: 'thin' | 'thick' | 'dotted' | 'space'  (default 'thin')
 */
function render(props = {}) {
  const style = ["thin", "thick", "dotted", "space"].includes(props.style)
    ? props.style
    : "thin";

  if (style === "space") {
    return `
      <mj-section background-color="${BRAND.surface}" padding="0">
        <mj-column>
          <mj-spacer height="32px" />
        </mj-column>
      </mj-section>`;
  }

  const borderWidth = style === "thick" ? "2px" : "1px";
  const borderStyle = style === "dotted" ? "dotted" : "solid";

  return `
    <mj-section background-color="${BRAND.surface}" padding="16px 32px">
      <mj-column>
        <mj-divider
          border-color="${BRAND.rule}"
          border-width="${borderWidth}"
          border-style="${borderStyle}"
          padding="0"
        />
      </mj-column>
    </mj-section>`;
}

const schema = {
  type: "divider",
  label: "Divider",
  description: "Visual break between content",
  fields: [
    { key: "style", label: "Style", type: "select",
      options: ["thin", "thick", "dotted", "space"], default: "thin" },
  ],
};

module.exports = { render, schema };
