// lib/email-sections/toc.js
// Archetype A (B2B Weekly): table of contents strip.
// Sits directly below the masthead. Light grey background, teal eyebrow
// label, two-column numbered list (stacks to one column on mobile).
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.1.
//
// Outlook patterns used:
//   - P6 (two-column without flex/grid). When items.length > 1, items are
//     split half-and-half across the two columns. Falls back to single
//     column when only one item exists.

const { DESIGN_TOKENS, FONTS } = require("../email-brand");
const { escHtml, fallback } = require("./_helpers");

function renderItem(item, index) {
  if (!item) return "";
  const text = escHtml(fallback(item.text, "")).trim();
  if (!text) return "";

  // Issue numbers always two-digit zero-padded. tabular-nums via
  // font-variant-numeric works in Apple Mail / Gmail; Outlook falls back
  // to its default which is fine — both digits sit side by side anyway.
  const num = String(index + 1).padStart(2, "0");

  return `
<tr>
  <td style="padding:5px 0;">
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        <td width="28" valign="top" style="padding-right:10px;">
          <span style="font-family:${FONTS.body};font-size:13px;font-weight:700;color:${DESIGN_TOKENS.primary};line-height:21px;font-variant-numeric:tabular-nums;">${num}</span>
        </td>
        <td valign="top">
          <span style="font-family:${FONTS.body};font-size:13px;color:${DESIGN_TOKENS.textSecondary};line-height:21px;">${text}</span>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function render(props = {}) {
  const label = escHtml(fallback(props.label, "In this issue"));
  const items = Array.isArray(props.items) ? props.items : [];

  if (!items.length) return "";

  // Split items roughly in half across two columns. With odd counts the
  // left column carries the extra one. Single-column fallback for tiny
  // lists keeps the layout from looking lopsided.
  const useTwoColumns = items.length >= 4;
  let bodyHtml;

  if (useTwoColumns) {
    const half = Math.ceil(items.length / 2);
    const leftItems = items.slice(0, half);
    const rightItems = items.slice(half);

    const leftRows = leftItems.map((it, i) => renderItem(it, i)).filter(Boolean).join("");
    const rightRows = rightItems
      .map((it, i) => renderItem(it, i + half))
      .filter(Boolean)
      .join("");

    bodyHtml = `
    <table role="presentation" class="tg-stack-mobile" border="0" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        <td width="50%" valign="top" style="padding-right:12px;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">${leftRows}</table>
        </td>
        <td width="50%" valign="top" style="padding-left:12px;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">${rightRows}</table>
        </td>
      </tr>
    </table>`;
  } else {
    const rows = items.map(renderItem).filter(Boolean).join("");
    bodyHtml = `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">${rows}</table>`;
  }

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgSecondary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgSecondary};padding:20px 36px;border-bottom:1px solid ${DESIGN_TOKENS.border};">
  <div style="font-family:${FONTS.body};font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${DESIGN_TOKENS.accent};line-height:14px;margin:0 0 10px 0;">${label}</div>
  ${bodyHtml}
</td></tr>`;
}

const schema = {
  type: "toc",
  label: "Table of contents",
  description: "Light grey strip below the masthead listing this issue's articles in two columns. For B2B Weekly newsletters.",
  fields: [
    { key: "label", label: "Eyebrow label", type: "text", optional: true, maxLength: 30, default: "In this issue" },
    { key: "items", label: "TOC items (numbers auto-generated)", type: "array", required: true, itemLabel: "item", itemFields: [
      { key: "text", label: "Headline", type: "text", required: true, maxLength: 100 },
    ]},
  ],
};

module.exports = { render, schema };
