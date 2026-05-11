// lib/email-sections/confirmation-block.js
// Archetype D (Transactional): success confirmation header.
// See travelgenix-email-design SKILL.md §4 (component library)
// and Appendix A.4 for the visual reference.

const STATIC_BRAND = require("../email-brand");
const { escHtml, fallback } = require("./_helpers");

const ICONS = {
  // Inline SVGs supported in Apple Mail, modern Outlook (2019+), Gmail, mobile.
  // Outlook 2016 will show the alt text or nothing — green icon tile background
  // still reads as a positive confirmation.
  check: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  clock: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  alert: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
};

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  // ICON_COLOURS reads from DESIGN_TOKENS, so it must live inside render
  // (otherwise it would only see the static Travelgenix defaults at module
  // load time, breaking brand kit theming for the success/info colours).
  const ICON_COLOURS = {
    success: { fg: DESIGN_TOKENS.success, bg: DESIGN_TOKENS.successBg },
    info:    { fg: DESIGN_TOKENS.accent,  bg: "#E0F7FA" },
    warning: { fg: "#D97706",             bg: "#FEF3C7" },
  };

  const icon = ICONS[props.icon] ? props.icon : "check";
  const colourKey = ICON_COLOURS[props.iconColour] ? props.iconColour : "success";
  const colours = ICON_COLOURS[colourKey];
  const eyebrow = escHtml(fallback(props.eyebrow, "Confirmed"));
  const headline = escHtml(fallback(props.headline, "All set."));
  const text = props.text ? escHtml(props.text) : "";

  // Eyebrow uses the same colour as the icon foreground for visual continuity
  const eyebrowColor = colours.fg;

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:48px 32px 32px;">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="56" align="left" style="margin:0 0 24px 0;">
    <tr>
      <td bgcolor="${colours.bg}" align="center" valign="middle" width="56" height="56" style="background-color:${colours.bg};border-radius:14px;color:${colours.fg};">
        <div style="line-height:0;color:${colours.fg};">${ICONS[icon]}</div>
      </td>
    </tr>
  </table>
  <div style="clear:both;"></div>
  <div style="font-family:${FONTS.body};font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${eyebrowColor};margin:0 0 8px 0;">${eyebrow}</div>
  <div style="font-family:${FONTS.heading};font-size:28px;font-weight:700;line-height:34px;letter-spacing:-0.025em;color:${DESIGN_TOKENS.textPrimary};margin:0 0 12px 0;">${headline}</div>
  ${text ? `<div style="font-family:${FONTS.body};font-size:15px;line-height:24px;color:${DESIGN_TOKENS.textSecondary};margin:0;">${text}</div>` : ""}
</td></tr>`;
}

const schema = {
  type: "confirmation-block",
  label: "Confirmation block",
  description: "Success header with icon, eyebrow, headline and supporting text. For transactional emails.",
  fields: [
    { key: "icon", label: "Icon", type: "select",
      options: ["check", "clock", "alert"], default: "check" },
    { key: "iconColour", label: "Icon colour theme", type: "select",
      options: ["success", "info", "warning"], default: "success" },
    { key: "eyebrow", label: "Eyebrow text", type: "text", required: true, maxLength: 40 },
    { key: "headline", label: "Headline", type: "text", required: true, maxLength: 80 },
    { key: "text", label: "Supporting copy", type: "longText", optional: true, maxLength: 280 },
  ],
};

module.exports = { render, schema };
