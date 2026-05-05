// lib/email-sections/divider.js
const { BRAND } = require("../email-brand");

function render(props = {}) {
  const style = ["thin", "thick", "dotted", "space"].includes(props.style)
    ? props.style
    : "thin";

  if (style === "space") {
    return `
<tr><td bgcolor="${BRAND.surface}" style="background-color:${BRAND.surface};font-size:0;line-height:0;height:32px;">&nbsp;</td></tr>`;
  }

  const borderWidth = style === "thick" ? "2px" : "1px";
  const borderStyle = style === "dotted" ? "dotted" : "solid";

  return `
<tr><td bgcolor="${BRAND.surface}" style="background-color:${BRAND.surface};padding:16px 32px;">
<div style="border-top:${borderWidth} ${borderStyle} ${BRAND.rule};font-size:0;line-height:0;height:0;">&nbsp;</div>
</td></tr>`;
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
