// lib/email-sections/spacer.js
//
// Vertical breathing room with no line. Sister to `divider` (which draws a
// rule, or a fixed 32px gap via its 'space' style). Pick the exact height.
//
// What it accepts:
//   height            — '8' | '16' | '24' (default) | '32' | '48' | '64' pixels
//   background_colour — default white so the gap matches the sections around it

const STATIC_BRAND = require("../email-brand");
const { safeHex } = require("./_helpers");

const HEIGHTS = ["8", "16", "24", "32", "48", "64"];

function render(props = {}, brand) {
  const { DESIGN_TOKENS } = brand || STATIC_BRAND;
  const height = HEIGHTS.includes(String(props.height)) ? parseInt(props.height, 10) : 24;
  const bg = safeHex(props.background_colour) || DESIGN_TOKENS.bgPrimary;
  return `
<tr><td bgcolor="${bg}" height="${height}" style="background-color:${bg};height:${height}px;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td></tr>`;
}

const schema = {
  type: "spacer",
  label: "Spacer",
  description: "An empty gap of a chosen height (8 to 64px). Use it to open up space between blocks without drawing a line.",
  fields: [
    { key: "height", label: "Height in px (8 | 16 | 24 | 32 | 48 | 64)", type: "select", options: HEIGHTS, default: "24" },
    { key: "background_colour", label: "Background colour", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Leave empty for white", help: "Match the sections either side so the gap is invisible." },
  ],
  composerHints: {
    whenToUse: ["Extra room between two dense blocks", "Before a footer when the last block sits too close"],
    whenNotToUse: ["Between every block — most sections already carry their own padding"],
  },
};

module.exports = { render, schema };
