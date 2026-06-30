// lib/email-sections/numbered-list.js
// Archetype A (B2B Weekly): "Five things to do this week" style list.
// Header row with title + optional meta (e.g. "10 min total"), then a
// list of items with 28px navy rounded-square tiles, item title, and
// supporting copy. Items separated by thin dividers, no divider after
// the last item.
//
// Bigger and more emphatic than `next-steps` (which uses 24px circular
// pale tiles). The B2B Weekly equivalent is denser, more editorial.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.1.
//
// Outlook patterns used:
//   - P6 (two-column without flex/grid) for the header row
//   - P6 for each item's tile/content row
//   - Tile uses bgcolor (no gradient) so Outlook renders it correctly

const STATIC_BRAND = require("../email-brand");
const { escHtml, fallback, inlineMarkdown, scaleFont } = require("./_helpers");

function renderItem(item, index, isLast, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  if (!item) return "";
  const title = escHtml(fallback(item.title, "")).trim();
  const text = item.text ? inlineMarkdown(escHtml(item.text)) : "";
  if (!title && !text) return "";

  const num = String(index + 1);
  const borderStyle = isLast ? "" : `border-bottom:1px solid ${DESIGN_TOKENS.borderLight};`;

  return `
<tr>
  <td style="padding:16px 0;${borderStyle}">
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        <td width="44" valign="top" style="padding-right:16px;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="28">
            <tr>
              <td bgcolor="${DESIGN_TOKENS.primary}" align="center" valign="middle" width="28" height="28" style="background-color:${DESIGN_TOKENS.primary};border-radius:6px;font-family:${FONTS.body};font-size:12px;font-weight:700;color:#ffffff;line-height:28px;width:28px;height:28px;mso-line-height-rule:exactly;">
                ${num}
              </td>
            </tr>
          </table>
        </td>
        <td valign="top">
          ${title ? `<div style="font-family:${FONTS.heading};font-size:14px;font-weight:600;letter-spacing:-0.01em;color:${DESIGN_TOKENS.textPrimary};line-height:21px;margin:2px 0 4px 0;">${title}</div>` : ""}
          ${text ? `<div style="font-family:${FONTS.body};font-size:13px;line-height:1.55;color:${DESIGN_TOKENS.textSecondary};margin:0;">${text}</div>` : ""}
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const title = escHtml(fallback(props.title, ""));
  const meta = props.meta ? escHtml(props.meta) : "";
  const items = Array.isArray(props.items) ? props.items : [];

  // Per-text-area size. Base matches the px value used in the header below.
  const titleSize = scaleFont(20, props.title_size);

  if (!title && !items.length) return "";

  const headerHtml = `
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        <td valign="baseline" align="left" style="font-family:${FONTS.heading};font-size:${titleSize}px;font-weight:700;letter-spacing:-0.02em;color:${DESIGN_TOKENS.textPrimary};line-height:1.2;">${title || "&nbsp;"}</td>
        ${meta ? `<td valign="baseline" align="right" style="font-family:${FONTS.body};font-size:11px;color:${DESIGN_TOKENS.textTertiary};font-weight:500;line-height:1.4;">${meta}</td>` : ""}
      </tr>
    </table>`;

  const itemsHtml = items
    .map((item, i) => renderItem(item, i, i === items.length - 1, brand))
    .filter(Boolean)
    .join("");

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:36px;border-bottom:1px solid ${DESIGN_TOKENS.border};">
  <div style="margin:0 0 20px 0;">${headerHtml}</div>
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">${itemsHtml}</table>
</td></tr>`;
}

const schema = {
  type: "numbered-list",
  label: "Numbered list",
  description: "Editorial numbered list with title and optional time-meta on the header row. Items use small navy tiles. Body supports inline markdown (**bold**, *italic*, [text](url)). For B2B Weekly newsletters.",
  fields: [
    { key: "title", label: "Title", type: "text", required: true, maxLength: 80 },
    { key: "title_size", label: "Title text size", type: "fontSize", optional: true },
    { key: "meta", label: "Header meta (e.g. \"10 min total\")", type: "text", optional: true, maxLength: 30 },
    { key: "items", label: "Items", type: "array", required: true, itemLabel: "item", itemFields: [
      { key: "title", label: "Item title", type: "text", required: true, maxLength: 100 },
      { key: "text", label: "Description", type: "longText", optional: true, maxLength: 280, help: "Use [link text](url) for inline links." },
    ]},
  ],
};

module.exports = { render, schema };
