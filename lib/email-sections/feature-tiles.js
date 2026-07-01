// lib/email-sections/feature-tiles.js
// A left-aligned feature list with coloured rounded icon tiles.
//
// Sister to `features-section` (which is centred with single-colour tiles).
// This one matches the "A CLOSER LOOK / Six worth starting with" editorial
// layout: a left-aligned header (eyebrow + title + lede) with a hairline
// rule beneath, then a vertical list of feature rows. Each row has a 48px
// pastel rounded-square icon tile on the left (one of a small curated set
// of colour themes) and a heading + description on the right, with a
// hairline divider between rows.
//
// Outlook patterns used:
//   - P6 two-column row (fixed-width left cell for the icon tile)
//   - Icon tile uses a flat bgcolor (no gradient) so Outlook renders it
//   - Inline stroke SVGs for the glyph; users can pass a custom SVG via
//     `icon_svg` for anything not in the stock set

const STATIC_BRAND = require("../email-brand");
const { escHtml, fallback, scaleFont, safeHex, editAttr } = require("./_helpers");

// Curated tile colour themes — pastel background + a darker glyph colour.
// Decorative, so these are fixed values (not pulled from the brand kit).
const TILE_THEMES = {
  teal: { bg: "#D7F0F2", fg: "#0E7C86" },
  amber: { bg: "#FBE8C8", fg: "#B9740E" },
  slate: { bg: "#E3E8EF", fg: "#475569" },
  green: { bg: "#D8F1E2", fg: "#1C8A52" },
  blue: { bg: "#DCE7FB", fg: "#2A5BD7" },
  purple: { bg: "#E7E0FB", fg: "#6B3FD1" },
  pink: { bg: "#FBE0EA", fg: "#C43E78" },
};
const DEFAULT_THEME = "teal";

// Stock icon library — stroke-based outline icons drawn at 22x22 inside
// the 48px tile. Pick by short name (`icon`) or supply custom (`icon_svg`).
const STOCK_ICONS = {
  sparkles: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 14l.7 1.8 1.8.7-1.8.7L19 19l-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
  star: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  mail: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/></svg>',
  file: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>',
  pin: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  chat: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/></svg>',
  phone: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  calendar: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  globe: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  plane: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5a2.12 2.12 0 0 0-3-3L13 8 4.8 6.2a1 1 0 0 0-.9 1.7l5.1 3.3-1.6 3.6-2.4-.3a.8.8 0 0 0-.7 1.3l2 2.4 2.4 2a.8.8 0 0 0 1.3-.7l-.3-2.4 3.6-1.6 3.3 5.1a1 1 0 0 0 1.7-.9z"/></svg>',
  search: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  tag: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
  heart: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  shield: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  bolt: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  users: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  check: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
};

function renderFeatureRow(feature, isLast, brand, idx, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  if (!feature) return "";
  const heading = escHtml(fallback(feature.heading, "")).trim();
  const text = feature.text ? escHtml(feature.text) : "";
  if (!heading && !text) return "";

  // Tile colours: theme by name, with optional per-row hex overrides.
  const theme = TILE_THEMES[String(feature.colour || "").toLowerCase()] ||
    TILE_THEMES[DEFAULT_THEME];
  const tileBg = safeHex(feature.tile_colour) || theme.bg;
  const glyphColour = safeHex(feature.icon_colour) || theme.fg;

  // Icon: custom SVG wins, else stock by name, else a generic dot.
  const iconKey = feature.icon ? String(feature.icon).toLowerCase() : "";
  let iconSvg;
  if (feature.icon_svg) {
    iconSvg = String(feature.icon_svg);
  } else if (STOCK_ICONS[iconKey]) {
    iconSvg = STOCK_ICONS[iconKey];
  } else {
    iconSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6"/></svg>';
  }

  const borderStyle = isLast ? "" : `border-bottom:1px solid ${DESIGN_TOKENS.borderLight};`;

  return `
<tr>
  <td style="padding:20px 0;${borderStyle}">
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        <td width="66" valign="top" style="padding-right:18px;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="48">
            <tr>
              <td bgcolor="${tileBg}" align="center" valign="middle" width="48" height="48" style="background-color:${tileBg};border-radius:12px;line-height:0;width:48px;height:48px;mso-line-height-rule:exactly;">
                <span style="display:inline-block;vertical-align:middle;line-height:0;color:${glyphColour};">${iconSvg}</span>
              </td>
            </tr>
          </table>
        </td>
        <td valign="top">
          ${heading ? `<div${editAttr(editable, `features.${idx}.heading`)} style="font-family:${FONTS.heading};font-size:17px;font-weight:700;letter-spacing:-0.015em;color:${DESIGN_TOKENS.textPrimary};line-height:1.3;margin:3px 0 5px 0;">${heading}</div>` : ""}
          ${text ? `<div${editAttr(editable, `features.${idx}.text`)} style="font-family:${FONTS.body};font-size:15px;line-height:1.55;color:${DESIGN_TOKENS.textSecondary};margin:0;">${text}</div>` : ""}
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const eyebrow = escHtml(fallback(props.eyebrow, "")).trim();
  const title = escHtml(fallback(props.title, "")).trim();
  const lede = props.lede ? escHtml(props.lede) : "";
  const features = Array.isArray(props.features) ? props.features : [];

  if (!title && !features.length) return "";

  // Per-text-area sizes. Bases match the px values used in the markup below.
  const eyebrowSize = scaleFont(11, props.eyebrow_size);
  const titleSize = scaleFont(30, props.title_size);
  const ledeSize = scaleFont(16, props.lede_size);

  const featuresHtml = features
    .map((f, i) => renderFeatureRow(f, i === features.length - 1, brand, i, editable))
    .filter(Boolean)
    .join("");

  // Header rows (left aligned), then a hairline rule, then the list.
  const headerHtml = `
    ${eyebrow ? `
    <tr>
      <td align="left" style="padding:0 0 10px 0;">
        <span${editAttr(editable, "eyebrow")} style="font-family:${FONTS.body};font-size:${eyebrowSize}px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${DESIGN_TOKENS.accent};line-height:${Math.round(eyebrowSize * (14 / 11))}px;">${eyebrow}</span>
      </td>
    </tr>` : ""}
    ${title ? `
    <tr>
      <td align="left" style="padding:0 0 10px 0;">
        <h2${editAttr(editable, "title")} style="font-family:${FONTS.heading};font-size:${titleSize}px;font-weight:700;line-height:1.2;letter-spacing:-0.025em;color:${DESIGN_TOKENS.textPrimary};margin:0;">${title}</h2>
      </td>
    </tr>` : ""}
    ${lede ? `
    <tr>
      <td align="left" style="padding:0 0 18px 0;">
        <p${editAttr(editable, "lede")} style="font-family:${FONTS.body};font-size:${ledeSize}px;line-height:1.6;color:${DESIGN_TOKENS.textSecondary};margin:0;max-width:480px;">${lede}</p>
      </td>
    </tr>` : ""}`;

  const hasHeader = eyebrow || title || lede;
  const ruleHtml = hasHeader
    ? `<tr><td style="border-bottom:1px solid ${DESIGN_TOKENS.borderLight};font-size:0;line-height:0;">&nbsp;</td></tr>`
    : "";

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:44px 40px 40px;">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
    ${headerHtml}
    ${ruleHtml}
    <tr>
      <td>
        <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">${featuresHtml}</table>
      </td>
    </tr>
  </table>
</td></tr>`;
}

const ICON_OPTIONS = Object.keys(STOCK_ICONS);
const THEME_OPTIONS = Object.keys(TILE_THEMES);

const schema = {
  type: "feature-tiles",
  label: "Features (icon tiles)",
  description: "Left-aligned editorial feature list: eyebrow + title + lede header with a hairline rule, then feature rows each with a pastel coloured rounded icon tile, heading and description. Pick an icon and a tile colour theme per row, or supply custom SVG.",
  fields: [
    { key: "eyebrow", label: "Eyebrow label", type: "text", optional: true, maxLength: 40, default: "A closer look" },
    { key: "eyebrow_size", label: "Eyebrow text size", type: "fontSize", optional: true },
    { key: "title", label: "Section title", type: "text", required: true, maxLength: 80 },
    { key: "title_size", label: "Title text size", type: "fontSize", optional: true },
    { key: "lede", label: "Lede paragraph", type: "longText", optional: true, maxLength: 280 },
    { key: "lede_size", label: "Lede text size", type: "fontSize", optional: true },
    { key: "features", label: "Features", type: "array", required: true, itemLabel: "feature", itemFields: [
      { key: "icon", label: "Icon", type: "select", options: ICON_OPTIONS },
      { key: "colour", label: "Tile colour", type: "select", options: THEME_OPTIONS },
      { key: "icon_svg", label: "Custom SVG (overrides icon if set)", type: "longText", optional: true, maxLength: 2000 },
      { key: "tile_colour", label: "Custom tile colour (advanced)", type: "colour", optional: true, defaultPreview: "#D7F0F2", placeholder: "Overrides the tile colour theme", help: "Leave empty to use the chosen tile colour theme." },
      { key: "icon_colour", label: "Custom icon colour (advanced)", type: "colour", optional: true, defaultPreview: "#0E7C86", placeholder: "Overrides the glyph colour", help: "Leave empty to use the theme's glyph colour." },
      { key: "heading", label: "Feature heading", type: "text", required: true, maxLength: 80 },
      { key: "text", label: "Feature description", type: "longText", optional: true, maxLength: 240 },
    ]},
  ],
};

module.exports = { render, schema };
