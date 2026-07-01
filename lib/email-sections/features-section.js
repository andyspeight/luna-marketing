// lib/email-sections/features-section.js
// Archetype C (Product Launch): "What it does" feature list.
// Centred header (small teal eyebrow, large title, supporting lede),
// then a vertical list of feature rows. Each row: 48px teal-gradient
// rounded-square icon tile on the left, content (h3 + body) on the
// right. Bottom border on every row except the last.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.3.
//
// Outlook patterns used:
//   - P6 (two-column, fixed-width left cell for the icon)
//   - Icon tile uses bgcolor (no gradient) — Outlook gets flat teal
//   - Inline SVGs for stock icons; users can pass their own SVG via
//     `icon_svg` for full custom

const STATIC_BRAND = require("../email-brand");
const { escHtml, fallback, scaleFont, editAttr } = require("./_helpers");

// Stock icon library. Users can pick by short name or supply custom
// SVG via `icon_svg`. All icons are stroke-based outline icons sized
// to 22x22 inside the 48px tile.
const STOCK_ICONS = {
  chat: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  bolt: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  users: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  clock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  globe: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  star: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  shield: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  trending: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  search: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  spark: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6m0 6v6M3 12h6m6 0h6M5.6 5.6l4.2 4.2m4.4 4.4l4.2 4.2M5.6 18.4l4.2-4.2m4.4-4.4l4.2-4.2"/></svg>',
};

function renderFeatureRow(feature, isLast, brand, editable, index) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  if (!feature) return "";
  const heading = escHtml(fallback(feature.heading, "")).trim();
  const text = feature.text ? escHtml(feature.text) : "";
  if (!heading && !text) return "";

  // Icon: prefer custom SVG if provided; else look up by name; else
  // fall back to a generic dot.
  const iconKey = feature.icon ? String(feature.icon).toLowerCase() : "";
  let iconSvg = "";
  if (feature.icon_svg) {
    // Trust the supplied SVG markup. Caller is responsible for safety.
    iconSvg = String(feature.icon_svg);
  } else if (STOCK_ICONS[iconKey]) {
    iconSvg = STOCK_ICONS[iconKey];
  } else {
    // Generic small circle as last resort
    iconSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6"/></svg>';
  }

  const borderStyle = isLast ? "" : `border-bottom:1px solid ${DESIGN_TOKENS.borderLight};`;

  return `
<tr>
  <td style="padding:24px 0;${borderStyle}">
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        <td width="68" valign="top" style="padding-right:20px;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="48">
            <tr>
              <td bgcolor="${DESIGN_TOKENS.accent}" align="center" valign="middle" width="48" height="48" style="background-color:${DESIGN_TOKENS.accent};border-radius:12px;color:#ffffff;line-height:0;width:48px;height:48px;mso-line-height-rule:exactly;">
                <span style="display:inline-block;vertical-align:middle;line-height:0;color:#ffffff;">${iconSvg}</span>
              </td>
            </tr>
          </table>
        </td>
        <td valign="top">
          ${heading ? `<div${editAttr(editable, `features.${index}.heading`)} style="font-family:${FONTS.heading};font-size:18px;font-weight:700;letter-spacing:-0.015em;color:${DESIGN_TOKENS.textPrimary};line-height:1.3;margin:4px 0 6px 0;">${heading}</div>` : ""}
          ${text ? `<div${editAttr(editable, `features.${index}.text`)} style="font-family:${FONTS.body};font-size:14px;line-height:1.6;color:${DESIGN_TOKENS.textSecondary};margin:0;">${text}</div>` : ""}
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
    .map((f, i) => renderFeatureRow(f, i === features.length - 1, brand, editable, i))
    .filter(Boolean)
    .join("");

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:60px 40px 48px;">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
    ${eyebrow ? `
    <tr>
      <td align="center" style="padding:0 0 12px 0;">
        <span${editAttr(editable, "eyebrow")} style="font-family:${FONTS.body};font-size:${eyebrowSize}px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${DESIGN_TOKENS.accent};line-height:${Math.round(eyebrowSize * (14 / 11))}px;">${eyebrow}</span>
      </td>
    </tr>` : ""}
    ${title ? `
    <tr>
      <td align="center" style="padding:0 0 12px 0;">
        <h2${editAttr(editable, "title")} style="font-family:${FONTS.heading};font-size:${titleSize}px;font-weight:700;line-height:1.2;letter-spacing:-0.025em;color:${DESIGN_TOKENS.textPrimary};margin:0;">${title}</h2>
      </td>
    </tr>` : ""}
    ${lede ? `
    <tr>
      <td align="center" style="padding:0 0 40px 0;">
        <p${editAttr(editable, "lede")} style="font-family:${FONTS.body};font-size:${ledeSize}px;line-height:1.6;color:${DESIGN_TOKENS.textSecondary};margin:0 auto;max-width:460px;text-align:center;">${lede}</p>
      </td>
    </tr>` : `<tr><td style="height:32px;line-height:32px;font-size:32px;">&nbsp;</td></tr>`}
    <tr>
      <td>
        <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">${featuresHtml}</table>
      </td>
    </tr>
  </table>
</td></tr>`;
}

const schema = {
  type: "features-section",
  label: "Features list",
  description: "Centred header (eyebrow + title + lede) followed by a list of features. Each feature has an icon tile, heading, and body. Pick from stock icons or supply custom SVG. For product launch emails.",
  fields: [
    { key: "eyebrow", label: "Eyebrow label", type: "text", optional: true, maxLength: 30, default: "What it does" },
    { key: "eyebrow_size", label: "Eyebrow text size", type: "fontSize", optional: true },
    { key: "title", label: "Section title", type: "text", required: true, maxLength: 80 },
    { key: "title_size", label: "Title text size", type: "fontSize", optional: true },
    { key: "lede", label: "Lede paragraph", type: "longText", optional: true, maxLength: 280 },
    { key: "lede_size", label: "Lede text size", type: "fontSize", optional: true },
    { key: "features", label: "Features", type: "array", required: true, itemLabel: "feature", itemFields: [
      { key: "icon", label: "Icon", type: "select", options: ["chat", "bolt", "users", "clock", "globe", "star", "shield", "trending", "search", "spark"] },
      { key: "icon_svg", label: "Custom SVG (overrides icon if set)", type: "longText", optional: true, maxLength: 2000 },
      { key: "heading", label: "Feature heading", type: "text", required: true, maxLength: 80 },
      { key: "text", label: "Feature description", type: "longText", optional: true, maxLength: 240 },
    ]},
  ],
};

module.exports = { render, schema };
