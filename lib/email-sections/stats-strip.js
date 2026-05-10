// lib/email-sections/stats-strip.js
// Archetype C (Product Launch): horizontal three-stat strip.
// Light grey background panel between sections, three big bold numbers
// (36px navy, tabular nums) with small grey labels underneath. Stats
// are centred within their column. Borders top and bottom to separate
// from the surrounding white content.
//
// Distinct from `pulse-stats` (Archetype A) which is on dark navy and
// has more meta around it. This one is purely a quick conversion
// wedge between the features and testimonial blocks.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.3.
//
// Outlook patterns used:
//   - P7 (three-column without flex/grid) via the shared threeColumn
//   - tabular-nums for the numbers (Outlook ignores font-variant; this
//     is a graceful degradation with no visual harm)

const { DESIGN_TOKENS, FONTS } = require("../email-brand");
const { escHtml, fallback } = require("./_helpers");
const { threeColumn } = require("./_outlook-bulletproof");

function renderStat(stat) {
  if (!stat) return "";
  const value = escHtml(fallback(stat.value, "")).trim();
  const label = escHtml(fallback(stat.label, "")).trim();
  if (!value && !label) return "";

  return `
<div style="text-align:center;">
  <div style="font-family:${FONTS.heading};font-size:36px;font-weight:800;letter-spacing:-0.035em;line-height:1;color:${DESIGN_TOKENS.primary};margin:0 0 8px 0;font-variant-numeric:tabular-nums;">${value || "&nbsp;"}</div>
  <div style="font-family:${FONTS.body};font-size:12px;font-weight:500;color:${DESIGN_TOKENS.textSecondary};line-height:1.4;margin:0;">${label}</div>
</div>`.trim();
}

function render(props = {}) {
  const stats = Array.isArray(props.stats) ? props.stats : [];
  if (!stats.length) return "";

  // Pad / truncate to exactly 3 cells so the geometry is stable.
  const padded = [stats[0], stats[1], stats[2]].map((s) => renderStat(s) || "&nbsp;");
  const inner = threeColumn(padded, { gap: 24 });

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgSecondary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgSecondary};padding:40px;border-top:1px solid ${DESIGN_TOKENS.border};border-bottom:1px solid ${DESIGN_TOKENS.border};">
  ${inner}
</td></tr>`;
}

const schema = {
  type: "stats-strip",
  label: "Stats strip (3 centred stats)",
  description: "Light grey horizontal strip with three centred stats. Big navy number + small grey label per stat. For product launch emails.",
  fields: [
    { key: "stats", label: "Stats (exactly 3)", type: "array", required: true, max: 3, itemLabel: "stat", itemFields: [
      { key: "value", label: "Number / value (e.g. \"3.2x\", \"42%\")", type: "text", required: true, maxLength: 20 },
      { key: "label", label: "Label (one short line)", type: "text", required: true, maxLength: 100 },
    ]},
  ],
};

module.exports = { render, schema };
