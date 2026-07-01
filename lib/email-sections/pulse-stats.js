// lib/email-sections/pulse-stats.js
// Archetype A (B2B Weekly): "Industry pulse" data block.
// Navy background, teal eyebrow label, white title, three stats in a row
// (each: big white number with teal accent characters, supporting label
// underneath in subdued white), and a source line at the bottom.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.1.
//
// Outlook patterns used:
//   - P7 (three-column without flex/grid) via the shared threeColumn helper
//   - Flat navy background — the radial-gradient "glow" in the visual
//     reference is decorative and gracefully strips in Outlook (P8)
//   - The teal "accent" portion of each stat number (e.g. the "12" in
//     "+12%") gets a coloured <span>; Outlook honours inline span colour

const STATIC_BRAND = require("../email-brand");
const { escHtml, fallback, scaleFont, editAttr } = require("./_helpers");
const { threeColumn } = require("./_outlook-bulletproof");

// Render a single stat. The `value` field uses a special syntax: the
// portion of the number wrapped in {} renders in teal, the rest in
// white. Example: "+{12}%" → "+<span style=teal>12</span>%". This lets
// users mark the headline figure without a separate field.
function renderStatNumber(value, brand) {
  const { DESIGN_TOKENS } = brand || STATIC_BRAND;

  const raw = String(value || "");
  // Split on {...} markers
  const parts = raw.split(/(\{[^}]*\})/g);
  return parts
    .map((p) => {
      const m = p.match(/^\{([^}]*)\}$/);
      if (m) {
        return `<span style="color:${DESIGN_TOKENS.accentLight};">${escHtml(m[1])}</span>`;
      }
      return escHtml(p);
    })
    .join("");
}

function renderStat(stat, brand, editable, index) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  if (!stat) return "";
  const value = stat.value ? renderStatNumber(stat.value, brand) : "";
  const label = escHtml(fallback(stat.label, "")).trim();
  if (!value && !label) return "";

  return `
<div${editAttr(editable, `stats.${index}.value`)} style="font-family:${FONTS.heading};font-size:32px;font-weight:800;letter-spacing:-0.03em;color:#ffffff;line-height:1;margin:0 0 6px 0;">${value || "&nbsp;"}</div>
<div${editAttr(editable, `stats.${index}.label`)} style="font-family:${FONTS.body};font-size:12px;color:rgba(255,255,255,0.7);line-height:1.4;margin:0;">${label}</div>`.trim();
}

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const label = escHtml(fallback(props.label, "Industry pulse"));
  const title = escHtml(fallback(props.title, ""));
  const stats = Array.isArray(props.stats) ? props.stats : [];
  const source = props.source ? escHtml(props.source) : "";

  // Per-text-area sizes. Bases match the px values used in the markup below.
  const labelSize = scaleFont(11, props.label_size);
  const titleSize = scaleFont(22, props.title_size);

  if (!title && !stats.length) return "";

  // Pad to exactly 3 columns. Empty stats render as &nbsp; placeholders
  // so the row geometry stays consistent.
  const padded = [stats[0], stats[1], stats[2]].map((s, i) => renderStat(s, brand, editable, i) || "&nbsp;");
  const statsHtml = threeColumn(padded, { gap: 24 });

  return `
<tr><td bgcolor="${DESIGN_TOKENS.primary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.primary};padding:36px;color:#ffffff;">
  <div${editAttr(editable, "label")} style="font-family:${FONTS.body};font-size:${labelSize}px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${DESIGN_TOKENS.accentLight};line-height:${Math.round(labelSize * (14 / 11))}px;margin:0 0 6px 0;">${label}</div>
  ${title ? `<div${editAttr(editable, "title")} style="font-family:${FONTS.heading};font-size:${titleSize}px;font-weight:700;letter-spacing:-0.02em;color:#ffffff;line-height:1.2;margin:0 0 24px 0;">${title}</div>` : `<div style="height:24px;line-height:24px;font-size:24px;">&nbsp;</div>`}
  ${statsHtml}
  ${source ? `
  <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:14px;margin-top:20px;">
    <p${editAttr(editable, "source")} style="font-family:${FONTS.body};font-size:11px;color:rgba(255,255,255,0.5);line-height:1.5;margin:0;">${source}</p>
  </div>` : ""}
</td></tr>`;
}

const schema = {
  type: "pulse-stats",
  label: "Industry pulse (3 stats)",
  description: "Navy block with three big stats and a source line. Wrap part of a number value in curly braces {...} to render that portion in teal (e.g. \"+{12}%\" highlights the 12).",
  fields: [
    { key: "label", label: "Eyebrow label", type: "text", optional: true, maxLength: 30, default: "Industry pulse" },
    { key: "label_size", label: "Eyebrow text size", type: "fontSize", optional: true },
    { key: "title", label: "Title", type: "text", required: true, maxLength: 80 },
    { key: "title_size", label: "Title text size", type: "fontSize", optional: true },
    { key: "stats", label: "Stats (exactly 3)", type: "array", required: true, max: 3, itemLabel: "stat", itemFields: [
      { key: "value", label: "Number (use {12} to teal-highlight a portion)", type: "text", required: true, maxLength: 30 },
      { key: "label", label: "Label (one line of context)", type: "text", required: true, maxLength: 100 },
    ]},
    { key: "source", label: "Source / footnote", type: "text", optional: true, maxLength: 200 },
  ],
};

module.exports = { render, schema };
