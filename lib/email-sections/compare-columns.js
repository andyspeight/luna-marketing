// lib/email-sections/compare-columns.js
//
// Two columns that contrast a before and an after: "Without Travelgenix /
// With Travelgenix", "Today / From next month", "Manual / Automated". Left
// column with cross (or dash) markers, right column with ticks and a tinted,
// accent-bordered highlight. The classic B2B SaaS nurture block. Never used
// to name a competitor — the left column describes the reader's current
// situation, not another product.
//
// Props:
//   title, intro                    — optional header
//   left_title  (default "Before"), left_items (array of strings), left_marker ('cross' | 'dash' | 'bullet')
//   right_title (default "After"),  right_items (array of strings), right_marker ('tick' | 'arrow' | 'bullet')
//   highlight_right                 — boolean, tint + accent border on the right column (default true)
//   heading_colour, body_colour, background_colour
//
// Outlook patterns used:
//   - Two fixed-width cells with a 12px gap cell; columns stack on mobile
//   - Column tint via bgcolor; the highlight tint is derived from the brand
//     accent so client brand kits carry through

const STATIC_BRAND = require("../email-brand");
const { lighten } = require("../email-brand");
const { escHtml, fallback, scaleFont, safeHex, editAttr, richAttr, richInline } = require("./_helpers");

const LEFT_MARKERS = { cross: "&#10005;", dash: "&ndash;", bullet: "&bull;" };
const RIGHT_MARKERS = { tick: "&#10003;", arrow: "&rarr;", bullet: "&bull;" };
const INNER_WIDTH = 536;
const GAP = 12;

function textOf(item) {
  if (item === null || item === undefined) return "";
  return typeof item === "object" ? String(item.text || "") : String(item);
}

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const leftItems = (Array.isArray(props.left_items) ? props.left_items : []).map((it, idx) => ({ text: textOf(it).trim(), idx })).filter((it) => it.text);
  const rightItems = (Array.isArray(props.right_items) ? props.right_items : []).map((it, idx) => ({ text: textOf(it).trim(), idx })).filter((it) => it.text);
  if (!leftItems.length && !rightItems.length) return "";

  const title = props.title ? escHtml(props.title) : "";
  const intro = props.intro ? richInline(props.intro) : "";
  const leftTitle = escHtml(fallback(props.left_title, "Before"));
  const rightTitle = escHtml(fallback(props.right_title, "After"));
  const leftMarker = LEFT_MARKERS[props.left_marker] ? props.left_marker : "cross";
  const rightMarker = RIGHT_MARKERS[props.right_marker] ? props.right_marker : "tick";
  const highlight = props.highlight_right !== false;

  const titleSize = scaleFont(26, props.title_size);
  const headingColour = safeHex(props.heading_colour) || DESIGN_TOKENS.textPrimary;
  const bodyColour = safeHex(props.body_colour) || DESIGN_TOKENS.textSecondary;
  const sectionBg = safeHex(props.background_colour) || DESIGN_TOKENS.bgPrimary;
  const colWidth = Math.floor((INNER_WIDTH - GAP) / 2);
  const tint = lighten(DESIGN_TOKENS.accent, 0.88);

  const column = (heading, items, glyph, glyphColour, key, opts) => {
    const bg = opts.highlight ? tint : DESIGN_TOKENS.bgPrimary;
    const border = opts.highlight ? `1px solid ${DESIGN_TOKENS.accent}` : `1px solid ${DESIGN_TOKENS.border}`;
    const rows = items.map(({ text, idx }) => `<tr>
        <td width="22" valign="top" style="width:22px;padding:5px 0;font-family:${FONTS.body};font-size:14px;font-weight:700;color:${glyphColour};line-height:21px;">${glyph}</td>
        <td valign="top"${editAttr(editable, `${key}.${idx}`)}${richAttr(editable)} style="padding:5px 0;font-family:${FONTS.body};font-size:14px;color:${bodyColour};line-height:21px;">${richInline(text)}</td>
      </tr>`).join("");
    return `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" bgcolor="${bg}" style="width:100%;background-color:${bg};border:${border};border-radius:12px;">
      <tr><td style="padding:18px 18px 14px;">
        <div${editAttr(editable, opts.titleKey)} style="font-family:${FONTS.heading};font-size:15px;font-weight:700;letter-spacing:-0.01em;color:${headingColour};line-height:20px;margin:0 0 8px 0;padding:0 0 8px 0;border-bottom:1px solid ${opts.highlight ? DESIGN_TOKENS.accentLight : DESIGN_TOKENS.borderLight};">${heading}</div>
        <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">${rows}</table>
      </td></tr>
    </table>`;
  };

  const leftHtml = column(leftTitle, leftItems, LEFT_MARKERS[leftMarker], DESIGN_TOKENS.textTertiary, "left_items", { highlight: false, titleKey: "left_title" });
  const rightHtml = column(rightTitle, rightItems, RIGHT_MARKERS[rightMarker], DESIGN_TOKENS.accentDark, "right_items", { highlight, titleKey: "right_title" });

  const headerHtml = (title || intro)
    ? `<div style="margin:0 0 20px 0;">
      ${title ? `<div${editAttr(editable, "title")} style="font-family:${FONTS.heading};font-size:${titleSize}px;font-weight:700;letter-spacing:-0.02em;color:${headingColour};line-height:${Math.round(titleSize * (32 / 26))}px;margin:0 0 ${intro ? 8 : 0}px 0;">${title}</div>` : ""}
      ${intro ? `<div${editAttr(editable, "intro")}${richAttr(editable)} style="font-family:${FONTS.body};font-size:15px;color:${bodyColour};line-height:24px;margin:0;max-width:520px;">${intro}</div>` : ""}
    </div>`
    : "";

  return `
<tr><td bgcolor="${sectionBg}" class="tg-pad-mobile" style="background-color:${sectionBg};padding:32px 32px;">
  ${headerHtml}
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%"><tr>
    <td width="${colWidth}" valign="top" class="tg-stack-narrow" style="width:${colWidth}px;vertical-align:top;">${leftHtml}</td>
    <td width="${GAP}" class="tg-stack-gap" style="width:${GAP}px;font-size:0;line-height:0;">&nbsp;</td>
    <td width="${colWidth}" valign="top" class="tg-stack-narrow" style="width:${colWidth}px;vertical-align:top;">${rightHtml}</td>
  </tr></table>
</td></tr>`;
}

const schema = {
  type: "compare-columns",
  label: "Before / after columns",
  description: "Two contrasting columns: the reader's situation today (cross markers) beside life with the product (tick markers, highlighted). left_items and right_items are arrays of plain strings. Describe the reader's current process on the left — never name a competitor.",
  fields: [
    { key: "title", label: "Section title (optional)", type: "text", optional: true, maxLength: 80 },
    { key: "title_size", label: "Title text size", type: "fontSize", optional: true },
    { key: "intro", label: "Intro line (optional)", type: "text", optional: true, maxLength: 200 },
    { key: "left_title", label: "Left column heading", type: "text", optional: true, maxLength: 40, default: "Before" },
    { key: "left_items", label: "Left column items", type: "array", required: true, itemLabel: "item", itemFields: [
      { key: "", label: "", type: "text", maxLength: 160 },
    ]},
    { key: "left_marker", label: "Left marker (cross | dash | bullet)", type: "select", options: ["cross", "dash", "bullet"], default: "cross" },
    { key: "right_title", label: "Right column heading", type: "text", optional: true, maxLength: 40, default: "After" },
    { key: "right_items", label: "Right column items", type: "array", required: true, itemLabel: "item", itemFields: [
      { key: "", label: "", type: "text", maxLength: 160 },
    ]},
    { key: "right_marker", label: "Right marker (tick | arrow | bullet)", type: "select", options: ["tick", "arrow", "bullet"], default: "tick" },
    { key: "highlight_right", label: "Highlight right column", type: "boolean", optional: true, checkboxLabel: "Tint the right column and give it an accent border" },
    { key: "heading_colour", label: "Heading colour", type: "colour", optional: true, defaultPreview: "#0F172A", help: "Leave empty to keep the default." },
    { key: "body_colour", label: "Text colour", type: "colour", optional: true, defaultPreview: "#475569", help: "Leave empty to keep the default." },
    { key: "background_colour", label: "Section background colour", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Leave empty for white" },
  ],
  composerHints: {
    whenToUse: [
      "Nurture emails that contrast the reader's manual process with the product's workflow (three to five items a side)",
      "Migration or upgrade emails: what changes and what stays",
    ],
    whenNotToUse: [
      "Comparisons with a named competitor — hard rule, never",
      "Claims not supported by the Product Library (no invented outcomes on the right)",
    ],
  },
};

module.exports = { render, schema };
