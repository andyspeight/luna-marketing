// lib/email-sections/callout.js
//
// A tinted callout box with an accent bar: "Top tip", "Did you know?",
// "Important", "Heads up". One thing worth pulling out of the main copy.
// Sister to `pull-quote` (quotes only) and `story-numbered` (a whole
// story on a tint). Reuses the pastel tone set and hosted icon PNGs from
// `feature-tiles` so callouts and feature rows look like one family.
//
// What it accepts:
//   tone              — 'teal' (default) | 'amber' | 'slate' | 'green' | 'blue' | 'purple' | 'pink'
//   icon              — optional stock icon name (see feature-tiles), '' for none
//   label             — small caps label, e.g. "Top tip"
//   title             — optional bold heading
//   body              — required; blank line = paragraph, **bold** / *italic* / [text](url)
//   link_text, link_url — optional link at the bottom
//   background_colour — override the tone's tint
//   accent_colour     — override the tone's bar / label colour
//   heading_colour, body_colour, title_size, body_size
//
// Layout:
//   ┃ [icon] LABEL
//   ┃ Title
//   ┃ Body
//   ┃ Link →
//
// Outlook patterns used:
//   - Accent bar is a 4px table cell with bgcolor (no border-left tricks)
//   - Icons are hosted PNGs (no inline SVG)

const STATIC_BRAND = require("../email-brand");
const { escHtml, safeUrl, fallback, renderBody, scaleFont, safeHex, editAttr, richAttr } = require("./_helpers");
const { STOCK_ICONS, TILE_THEMES, ICON_BASE } = require("./feature-tiles");

const TONES = Object.keys(TILE_THEMES);
const ICONS = Object.keys(STOCK_ICONS);

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const bodyHtml = renderBody(props.body || "");
  const label = props.label ? escHtml(props.label) : "";
  const title = props.title ? escHtml(props.title) : "";
  if (!bodyHtml && !title && !label) return "";

  const toneKey = TONES.includes(String(props.tone || "").toLowerCase()) ? String(props.tone).toLowerCase() : "teal";
  const tone = TILE_THEMES[toneKey];
  const tint = safeHex(props.background_colour) || tone.bg;
  const accent = safeHex(props.accent_colour) || tone.fg;
  const headingColour = safeHex(props.heading_colour) || DESIGN_TOKENS.textPrimary;
  const bodyColour = safeHex(props.body_colour) || DESIGN_TOKENS.textSecondary;

  const iconKey = ICONS.includes(String(props.icon || "").toLowerCase()) ? String(props.icon).toLowerCase() : "";
  const iconHtml = iconKey
    ? `<img src="${ICON_BASE}/${iconKey}-${toneKey}.png" width="22" height="22" alt="" style="display:inline-block;width:22px;height:22px;border:0;vertical-align:middle;">`
    : "";

  const linkText = props.link_text ? escHtml(props.link_text) : "";
  const linkUrl = safeUrl(props.link_url);

  const titleSize = scaleFont(17, props.title_size);
  const bodySize = scaleFont(15, props.body_size);
  const labelSize = scaleFont(11, props.label_size);

  // Label row: icon (if any) beside the small-caps label. If there is an
  // icon but no label, the icon sits alone above the title.
  let labelRow = "";
  if (iconHtml || label) {
    labelRow = `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 ${title || bodyHtml ? 10 : 0}px 0;"><tr>${iconHtml ? `<td valign="middle" style="padding:0 8px 0 0;line-height:0;">${iconHtml}</td>` : ""}${label ? `<td valign="middle"${editAttr(editable, "label")} style="font-family:${FONTS.body};font-size:${labelSize}px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${accent};line-height:${Math.round(labelSize * (16 / 11))}px;">${label}</td>` : ""}</tr></table>`;
  }

  const titleHtml = title
    ? `<div${editAttr(editable, "title")} style="font-family:${FONTS.heading};font-size:${titleSize}px;font-weight:700;letter-spacing:-0.015em;color:${headingColour};line-height:${Math.round(titleSize * (24 / 17))}px;margin:0 0 ${bodyHtml ? 8 : 0}px 0;">${title}</div>`
    : "";

  const bodyBlock = bodyHtml
    ? `<div${editAttr(editable, "body")}${richAttr(editable)} style="font-family:${FONTS.body};font-size:${bodySize}px;color:${bodyColour};line-height:${Math.round(bodySize * (24 / 15))}px;margin:0;">${bodyHtml}</div>`
    : "";

  const linkHtml = linkText && linkUrl
    ? `<div style="margin:12px 0 0 0;"><a href="${linkUrl}"${editAttr(editable, "link_text")} style="display:inline-block;font-family:${FONTS.body};font-size:14px;font-weight:600;color:${accent};text-decoration:none;line-height:20px;">${linkText} &rarr;</a></div>`
    : "";

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:16px 32px;">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" bgcolor="${tint}" style="width:100%;background-color:${tint};border-radius:10px;">
    <tr>
      <td width="4" bgcolor="${accent}" style="width:4px;background-color:${accent};border-radius:10px 0 0 10px;font-size:0;line-height:0;">&nbsp;</td>
      <td style="padding:20px 24px;">
        ${labelRow}
        ${titleHtml}
        ${bodyBlock}
        ${linkHtml}
      </td>
    </tr>
  </table>
</td></tr>`;
}

const schema = {
  type: "callout",
  label: "Callout",
  description: "A tinted box with an accent bar for one thing worth pulling out: a tip, a reminder, a key takeaway. Small-caps label, optional title, body and link. Pick a colour tone and an optional icon.",
  fields: [
    { key: "tone", label: "Colour tone (teal | amber | slate | green | blue | purple | pink)", type: "select", options: TONES, default: "teal" },
    { key: "icon", label: "Icon (optional)", type: "select", options: ICONS, optional: true },
    { key: "label", label: "Label (small caps, e.g. \"Top tip\")", type: "text", optional: true, maxLength: 40 },
    { key: "label_size", label: "Label text size", type: "fontSize", optional: true },
    { key: "title", label: "Title (optional)", type: "text", optional: true, maxLength: 100 },
    { key: "title_size", label: "Title text size", type: "fontSize", optional: true },
    { key: "heading_colour", label: "Title colour", type: "colour", optional: true, defaultPreview: "#0F172A", help: "Leave empty to keep the default." },
    { key: "body", label: "Body (blank line between paragraphs)", type: "longText", required: true, maxLength: 800, help: "**bold**, *italic* and [text](url) work inline." },
    { key: "body_size", label: "Body text size", type: "fontSize", optional: true },
    { key: "body_colour", label: "Body colour", type: "colour", optional: true, defaultPreview: "#475569", help: "Leave empty to keep the default." },
    { key: "link_text", label: "Link text (optional)", type: "text", optional: true, maxLength: 40 },
    { key: "link_url", label: "Link URL", type: "url", optional: true },
    { key: "background_colour", label: "Box tint colour", type: "colour", optional: true, defaultPreview: "#D7F0F2", placeholder: "Leave empty to use the tone", help: "Overrides the tone's pastel tint." },
    { key: "accent_colour", label: "Accent colour (bar + label)", type: "colour", optional: true, defaultPreview: "#0E7C86", placeholder: "Leave empty to use the tone", help: "Overrides the tone's accent." },
  ],
  composerHints: {
    whenToUse: [
      "One practical tip, reminder or takeaway that would get lost in body copy",
      "A booking deadline or date the reader must not miss (tone 'amber')",
    ],
    whenNotToUse: [
      "Quotes from people (use pull-quote or testimonial)",
      "More than one per email — a second callout stops standing out",
    ],
  },
};

module.exports = { render, schema };
