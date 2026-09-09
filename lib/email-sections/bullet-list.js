// lib/email-sections/bullet-list.js
//
// A plain list: bullets, ticks, dashes, arrows or numbers. "What's
// included", "Three reasons to go", "Before you fly". Lighter than
// `numbered-list` (editorial tiles + descriptions) and `next-steps`
// (transactional). Optional title and intro line, one or two columns.
//
// What it accepts:
//   title            — optional heading
//   intro            — optional line under the heading (inline markdown)
//   items            — array of strings (or { text } objects); inline markdown
//   marker           — 'bullet' (default) | 'tick' | 'dash' | 'arrow' | 'number'
//   columns          — '1' (default) | '2' — two columns for short items, stacks on mobile
//   marker_colour    — default brand accent
//   heading_colour, body_colour, title_size, text_size, background_colour
//
// Outlook patterns used:
//   - Each item is a two-cell table row (marker cell + text cell); no <ul>,
//     which Outlook indents unpredictably
//   - Markers are plain Unicode glyphs, no images or SVG

const STATIC_BRAND = require("../email-brand");
const { escHtml, fallback, scaleFont, safeHex, editAttr, richAttr, richInline } = require("./_helpers");

const MARKERS = {
  bullet: "&bull;",
  tick: "&#10003;",
  dash: "&ndash;",
  arrow: "&rarr;",
};

function pick(value, allowed, fallbackValue) {
  return allowed.includes(value) ? value : fallbackValue;
}

function itemText(item) {
  if (item === null || item === undefined) return "";
  if (typeof item === "object") return String(item.text || "");
  return String(item);
}

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const title = props.title ? escHtml(props.title) : "";
  const intro = props.intro ? richInline(props.intro) : "";
  const rawItems = Array.isArray(props.items) ? props.items : [];
  // Keep each item's original index so the on-canvas edit path lines up
  // with the source array even when blanks are skipped.
  const items = rawItems
    .map((item, idx) => ({ text: itemText(item).trim(), idx }))
    .filter((it) => it.text);

  if (!title && !intro && !items.length) return "";

  const marker = pick(props.marker, ["bullet", "tick", "dash", "arrow", "number"], "bullet");
  const columns = String(props.columns) === "2" ? 2 : 1;

  const markerColour = safeHex(props.marker_colour) || DESIGN_TOKENS.accent;
  const headingColour = safeHex(props.heading_colour) || DESIGN_TOKENS.textPrimary;
  const bodyColour = safeHex(props.body_colour) || DESIGN_TOKENS.textSecondary;
  const sectionBg = safeHex(props.background_colour) || DESIGN_TOKENS.bgPrimary;

  const titleSize = scaleFont(20, props.title_size);
  const textSize = scaleFont(15, props.text_size);
  const lineHeight = Math.round(textSize * (24 / 15));

  // Number markers need room for two digits; glyphs sit in a narrower cell.
  const markerWidth = marker === "number" ? 28 : 22;

  const renderItem = (it, n) => {
    const glyph = marker === "number" ? `${n}.` : MARKERS[marker];
    return `<tr>
      <td width="${markerWidth}" valign="top" style="width:${markerWidth}px;padding:4px 0;font-family:${FONTS.body};font-size:${textSize}px;font-weight:700;color:${markerColour};line-height:${lineHeight}px;">${glyph}</td>
      <td valign="top"${editAttr(editable, `items.${it.idx}`)}${richAttr(editable)} style="padding:4px 0;font-family:${FONTS.body};font-size:${textSize}px;color:${bodyColour};line-height:${lineHeight}px;">${richInline(it.text)}</td>
    </tr>`;
  };

  let listHtml;
  if (columns === 2 && items.length > 1) {
    const half = Math.ceil(items.length / 2);
    const left = items.slice(0, half);
    const right = items.slice(half);
    const col = (arr, offset) => `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">${arr.map((it, i) => renderItem(it, offset + i + 1)).join("")}</table>`;
    listHtml = `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%"><tr>
      <td width="50%" valign="top" class="tg-stack-narrow" style="padding:0 12px 0 0;">${col(left, 0)}</td>
      <td width="50%" valign="top" class="tg-stack-narrow" style="padding:0 0 0 12px;">${col(right, half)}</td>
    </tr></table>`;
  } else {
    listHtml = `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">${items.map((it, i) => renderItem(it, i + 1)).join("")}</table>`;
  }

  const titleHtml = title
    ? `<div${editAttr(editable, "title")} style="font-family:${FONTS.heading};font-size:${titleSize}px;font-weight:700;letter-spacing:-0.02em;color:${headingColour};line-height:${Math.round(titleSize * (26 / 20))}px;margin:0 0 ${intro ? 6 : 12}px 0;">${title}</div>`
    : "";
  const introHtml = intro
    ? `<div${editAttr(editable, "intro")}${richAttr(editable)} style="font-family:${FONTS.body};font-size:${textSize}px;color:${bodyColour};line-height:${lineHeight}px;margin:0 0 12px 0;">${intro}</div>`
    : "";

  return `
<tr><td bgcolor="${sectionBg}" class="tg-pad-mobile" style="background-color:${sectionBg};padding:20px 32px;">
  ${titleHtml}
  ${introHtml}
  ${items.length ? listHtml : ""}
</td></tr>`;
}

const schema = {
  type: "bullet-list",
  label: "List (bullets / ticks)",
  description: "A simple list with bullet, tick, dash, arrow or number markers. Optional title and intro line; one or two columns. items is an array of plain strings, e.g. [\"Flights from Manchester\", \"7 nights half board\"]. Inline **bold** and [links](url) work.",
  fields: [
    { key: "title", label: "Title (optional)", type: "text", optional: true, maxLength: 80 },
    { key: "title_size", label: "Title text size", type: "fontSize", optional: true },
    { key: "heading_colour", label: "Title colour", type: "colour", optional: true, defaultPreview: "#0F172A", help: "Leave empty to keep the default." },
    { key: "intro", label: "Intro line (optional)", type: "text", optional: true, maxLength: 200 },
    { key: "items", label: "Items", type: "array", required: true, itemLabel: "item", itemFields: [
      { key: "", label: "", type: "text", maxLength: 200 },
    ]},
    { key: "text_size", label: "Item text size", type: "fontSize", optional: true },
    { key: "body_colour", label: "Item text colour", type: "colour", optional: true, defaultPreview: "#475569", help: "Leave empty to keep the default." },
    { key: "marker", label: "Marker (bullet | tick | dash | arrow | number)", type: "select", options: ["bullet", "tick", "dash", "arrow", "number"], default: "bullet" },
    { key: "marker_colour", label: "Marker colour", type: "colour", optional: true, defaultPreview: "#00B4D8", help: "Leave empty to use the brand accent." },
    { key: "columns", label: "Columns (1 | 2)", type: "select", options: ["1", "2"], default: "1" },
    { key: "background_colour", label: "Section background colour", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Leave empty for white" },
  ],
  composerHints: {
    whenToUse: [
      "What's included / highlights (marker 'tick', columns '2' for short items)",
      "Three to six short points that would read badly as a paragraph",
    ],
    whenNotToUse: [
      "Items that need a heading and a description each (use numbered-list or feature-tiles)",
      "Steps after a booking (use next-steps)",
    ],
  },
};

module.exports = { render, schema };
