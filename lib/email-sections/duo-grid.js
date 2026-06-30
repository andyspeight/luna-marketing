// lib/email-sections/duo-grid.js
// Archetype A (B2B Weekly): two-column secondary stories.
// Each item has a small teal eyebrow tag, a 3-line headline, supporting
// copy, and a "Read more →" small link. Two items side by side, stacks
// to one column on mobile.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.1.
//
// Outlook patterns used:
//   - P6 (two-column without flex/grid) via the shared twoColumn helper

const STATIC_BRAND = require("../email-brand");
const { escHtml, safeUrl, fallback, scaleFont, safeHex } = require("./_helpers");
const { twoColumn } = require("./_outlook-bulletproof");

function renderItem(item, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  if (!item) return "";
  const tag = escHtml(fallback(item.tag, ""));
  const headline = escHtml(fallback(item.headline, ""));
  const body = item.body ? escHtml(item.body) : "";
  const linkText = escHtml(fallback(item.link_text, "Read more →"));
  const linkUrl = safeUrl(item.link_url);

  if (!headline) return "";

  // Per-text-area sizes. Bases match the px values used in the markup below.
  const headlineSize = scaleFont(18, item.headline_size);
  const bodySize = scaleFont(14, item.body_size);

  // Read-more link colour. Defaults keep the original brand primary label.
  const ctaFg = safeHex(item.cta_text_colour) || DESIGN_TOKENS.primary;

  return `
${tag ? `<div style="font-family:${FONTS.body};font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${DESIGN_TOKENS.accent};line-height:14px;margin:0 0 8px 0;">${tag}</div>` : ""}
<div style="font-family:${FONTS.heading};font-size:${headlineSize}px;font-weight:700;line-height:1.3;letter-spacing:-0.015em;color:${DESIGN_TOKENS.textPrimary};margin:0 0 8px 0;">${headline}</div>
${body ? `<p style="font-family:${FONTS.body};font-size:${bodySize}px;line-height:1.6;color:${DESIGN_TOKENS.textSecondary};margin:0 0 12px 0;">${body}</p>` : ""}
${linkUrl ? `<a href="${linkUrl}" style="font-family:${FONTS.body};font-size:13px;font-weight:600;color:${ctaFg};text-decoration:none;display:inline-block;line-height:18px;">${linkText}</a>` : ""}`.trim();
}

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const left = renderItem(props.left, brand);
  const right = renderItem(props.right, brand);

  // If only one item is populated, render it full-width rather than
  // leaving an empty column.
  if (!left && !right) return "";
  if (left && !right) {
    return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:36px;border-bottom:1px solid ${DESIGN_TOKENS.border};">
  ${left}
</td></tr>`;
  }
  if (!left && right) {
    return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:36px;border-bottom:1px solid ${DESIGN_TOKENS.border};">
  ${right}
</td></tr>`;
  }

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:36px;border-bottom:1px solid ${DESIGN_TOKENS.border};">
  ${twoColumn(left, right, { gap: 28 })}
</td></tr>`;
}

const itemFields = [
  { key: "tag", label: "Tag (e.g. \"Trend watch\", \"Operator update\")", type: "text", optional: true, maxLength: 30 },
  { key: "headline", label: "Headline", type: "text", required: true, maxLength: 100 },
  { key: "headline_size", label: "Headline text size", type: "fontSize", optional: true },
  { key: "body", label: "Supporting copy", type: "longText", optional: true, maxLength: 280 },
  { key: "body_size", label: "Supporting copy text size", type: "fontSize", optional: true },
  { key: "link_text", label: "Link text", type: "text", optional: true, maxLength: 30, default: "Read more →" },
  { key: "link_url", label: "Link URL", type: "url", optional: true },
  { key: "cta_text_colour", label: "Button text colour", type: "colour", optional: true, defaultPreview: "#1B2B5B", placeholder: "Defaults to current label colour", help: "Colour of the button label. Leave empty to keep the default." },
];

const schema = {
  type: "duo-grid",
  label: "Duo grid (two stories)",
  description: "Two secondary stories side by side. Each has an eyebrow tag, headline, copy, and link. For B2B Weekly newsletters.",
  fields: [
    { key: "left", label: "Left story", type: "group", required: true, fields: itemFields },
    { key: "right", label: "Right story", type: "group", required: true, fields: itemFields },
  ],
};

module.exports = { render, schema };
