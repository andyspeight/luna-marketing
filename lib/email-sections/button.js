// lib/email-sections/button.js
//
// A standalone button. Sister to `cta` (headline + copy + button on a
// tinted band), `cta-banner` (navy banner) and `cta-pill` (rounded pill
// with italic label) — this one is just the button, for dropping between
// text blocks or under an image. Solid or outline, three sizes, left /
// centre / right or full width, and an optional second outline button
// beside it for a secondary action.
//
// What it accepts:
//   text, url          — required
//   style              — 'solid' (default) | 'outline'
//   size               — 'small' | 'medium' (default) | 'large'
//   align              — 'left' | 'center' (default) | 'right'
//   full_width         — boolean, stretch the (single) button across the email
//   secondary_text     — optional second button label (rendered as outline)
//   secondary_url      — its link
//   cta_colour         — button colour (solid fill, or outline border + label)
//   cta_text_colour    — solid button label colour
//   spacing            — 'compact' | 'normal' (default) | 'roomy'
//   background_colour  — section background (default white)
//
// Outlook patterns used:
//   - P2 bulletproof VML button for the solid style
//   - The outline style is a bordered table cell (square corners in Outlook,
//     rounded everywhere else — acceptable per §12)

const STATIC_BRAND = require("../email-brand");
const { escHtml, safeUrl, fallback, safeHex, editAttr } = require("./_helpers");
const { bulletproofCta } = require("./_outlook-bulletproof");

const SIZES = {
  small: { fontSize: 13, paddingY: 10, paddingX: 18, height: 36, radius: 8 },
  medium: { fontSize: 15, paddingY: 14, paddingX: 28, height: 48, radius: 10 },
  large: { fontSize: 17, paddingY: 18, paddingX: 36, height: 58, radius: 12 },
};
const SPACING = { compact: 8, normal: 20, roomy: 36 };
const INNER_WIDTH = 536;

function pick(value, allowed, fallbackValue) {
  return allowed.includes(value) ? value : fallbackValue;
}

// Outline button — bordered cell, transparent fill, label in the button colour.
function outlineButton({ text, url, colour, size, fonts, attrs, fullWidth }) {
  const s = SIZES[size];
  const display = fullWidth ? "display:block;text-align:center;" : "display:inline-block;";
  const tableAttrs = fullWidth ? ` width="100%" style="width:100%;"` : "";
  return `<table role="presentation" border="0" cellspacing="0" cellpadding="0"${tableAttrs}><tr><td align="center" style="border:2px solid ${colour};border-radius:${s.radius}px;"><a href="${url}"${attrs} style="${display}padding:${s.paddingY - 2}px ${s.paddingX}px;color:${colour};text-decoration:none;border-radius:${s.radius}px;font-family:${fonts.body};font-size:${s.fontSize}px;font-weight:700;letter-spacing:-0.005em;line-height:1;">${text}</a></td></tr></table>`;
}

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const text = escHtml(fallback(props.text, "Find out more"));
  const url = safeUrl(props.url);
  if (!url) return "";

  const style = pick(props.style, ["solid", "outline"], "solid");
  const size = pick(props.size, ["small", "medium", "large"], "medium");
  const align = pick(props.align, ["left", "center", "right"], "center");
  const spacingKey = pick(props.spacing, ["compact", "normal", "roomy"], "normal");
  const fullWidth = props.full_width === true;

  const colour = safeHex(props.cta_colour) || DESIGN_TOKENS.accent;
  const labelColour = safeHex(props.cta_text_colour) || DESIGN_TOKENS.textPrimary;
  const sectionBg = safeHex(props.background_colour) || DESIGN_TOKENS.bgPrimary;

  const secondaryText = props.secondary_text ? escHtml(props.secondary_text) : "";
  const secondaryUrl = safeUrl(props.secondary_url);
  const hasSecondary = !!(secondaryText && secondaryUrl);
  // A full-width button has no room for a second one beside it.
  const stretch = fullWidth && !hasSecondary;

  const s = SIZES[size];
  let primary;
  if (style === "solid") {
    primary = bulletproofCta({
      text,
      url,
      bgColor: colour,
      textColor: labelColour,
      align: "left",
      fontSize: s.fontSize,
      paddingY: s.paddingY,
      paddingX: s.paddingX,
      height: s.height,
      radius: s.radius,
      width: stretch ? INNER_WIDTH : Math.min(INNER_WIDTH, Math.round(text.length * s.fontSize * 0.6) + s.paddingX * 2),
      fullWidth: stretch,
      attrs: editAttr(editable, "text"),
    });
  } else {
    primary = outlineButton({ text, url, colour, size, fonts: FONTS, attrs: editAttr(editable, "text"), fullWidth: stretch });
  }

  let buttons;
  if (hasSecondary) {
    const secondary = outlineButton({ text: secondaryText, url: secondaryUrl, colour, size, fonts: FONTS, attrs: editAttr(editable, "secondary_text"), fullWidth: false });
    buttons = `<table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr><td valign="middle" style="padding:0 12px 0 0;">${primary}</td><td valign="middle" style="padding:0;">${secondary}</td></tr></table>`;
  } else {
    buttons = primary;
  }

  const pad = SPACING[spacingKey];
  return `
<tr><td bgcolor="${sectionBg}" class="tg-pad-mobile" align="${align}" style="background-color:${sectionBg};padding:${pad}px 32px;text-align:${align};">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" align="${align}"${stretch ? ` width="100%"` : ""} style="margin:${align === "center" ? "0 auto" : (align === "right" ? "0 0 0 auto" : "0")};${stretch ? "width:100%;" : ""}"><tr><td align="${align}" style="padding:0;">${buttons}</td></tr></table>
</td></tr>`;
}

const schema = {
  type: "button",
  label: "Button",
  description: "A standalone button to drop between blocks. Solid or outline, small / medium / large, left / centre / right or full width, plus an optional second outline button beside it. For a button with its own headline and copy use cta instead.",
  fields: [
    { key: "text", label: "Button text", type: "text", required: true, maxLength: 40 },
    { key: "url", label: "Button link", type: "url", required: true },
    { key: "style", label: "Style (solid | outline)", type: "select", options: ["solid", "outline"], default: "solid" },
    { key: "size", label: "Size (small | medium | large)", type: "select", options: ["small", "medium", "large"], default: "medium" },
    { key: "align", label: "Alignment (left | center | right)", type: "select", options: ["left", "center", "right"], default: "center" },
    { key: "full_width", label: "Full width", type: "boolean", optional: true, checkboxLabel: "Stretch the button across the email (single button only)" },
    { key: "cta_colour", label: "Button colour", type: "colour", optional: true, defaultPreview: "#00B4D8", help: "Fill of a solid button, or the border and label of an outline button. Leave empty to keep the default." },
    { key: "cta_text_colour", label: "Button text colour", type: "colour", optional: true, defaultPreview: "#0F172A", help: "Label colour on a solid button. Leave empty to keep the default." },
    { key: "secondary_text", label: "Second button text (optional)", type: "text", optional: true, maxLength: 40 },
    { key: "secondary_url", label: "Second button link", type: "url", optional: true },
    { key: "spacing", label: "Vertical spacing (compact | normal | roomy)", type: "select", options: ["compact", "normal", "roomy"], default: "normal" },
    { key: "background_colour", label: "Section background colour", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Leave empty for white" },
  ],
  composerHints: {
    whenToUse: [
      "A single action directly under a text, image or image-text block",
      "A primary + secondary pair (secondary_text / secondary_url) such as 'Book a demo' and 'See pricing'",
    ],
    whenNotToUse: [
      "The closing conversion moment (use cta, cta-banner or cta-dark, which carry a headline)",
      "More than two buttons in one place — one primary action per email",
    ],
  },
};

module.exports = { render, schema };
