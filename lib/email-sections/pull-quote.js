// lib/email-sections/pull-quote.js
// Editorial pull quote with optional eyebrow label and attribution.
// Used in Archetype B (Marketing Newsletter) and Archetype A (B2B Weekly).
//
// Two visual variants:
//   - default (B2B Weekly): on bgSecondary background, label + leading curly
//     quote mark, italic 20px quote, attribution below
//   - simple (Marketing): on white background, left teal accent bar,
//     italic 19px quote, attribution below
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.1, A.2.

const STATIC_BRAND = require("../email-brand");
const { escHtml, fallback } = require("./_helpers");

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const variant = props.variant === "labelled" ? "labelled" : "simple";
  const label = props.label ? escHtml(props.label) : "";
  const quote = escHtml(fallback(props.quote, ""));
  if (!quote) return "";

  const attribution = props.attribution || {};
  const name = attribution.name ? escHtml(attribution.name) : "";
  const role = attribution.role ? escHtml(attribution.role) : "";

  const attributionHtml = (name || role)
    ? `<div style="font-family:${FONTS.body};font-size:13px;color:${DESIGN_TOKENS.textSecondary};line-height:20px;font-style:normal;margin:0;">
         ${name ? `<span style="font-weight:600;color:${DESIGN_TOKENS.textPrimary};">${name}</span>` : ""}
         ${name && role ? ` &middot; ` : ""}
         ${role}
       </div>`
    : "";

  if (variant === "labelled") {
    // B2B Weekly variant: light grey background, label + leading curly quote
    return `
<tr><td bgcolor="${DESIGN_TOKENS.bgSecondary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgSecondary};padding:36px 32px;border-bottom:1px solid ${DESIGN_TOKENS.border};">
  ${label ? `<div style="font-family:${FONTS.body};font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${DESIGN_TOKENS.accent};margin:0 0 14px 0;line-height:14px;">${label}</div>` : ""}
  <div style="font-family:${FONTS.heading};font-size:20px;font-weight:500;line-height:29px;letter-spacing:-0.015em;color:${DESIGN_TOKENS.textPrimary};margin:0 0 16px 0;font-style:italic;">
    <span style="color:${DESIGN_TOKENS.accent};font-size:32px;line-height:0;vertical-align:-8px;margin-right:4px;font-family:Georgia,serif;font-style:normal;">&ldquo;</span>${quote}
  </div>
  ${attributionHtml}
</td></tr>`;
  }

  // Simple variant: marketing newsletter — left teal accent bar
  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:56px 32px;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
      <td width="3" bgcolor="${DESIGN_TOKENS.accent}" style="background-color:${DESIGN_TOKENS.accent};width:3px;font-size:0;line-height:0;">&nbsp;</td>
      <td style="padding:0 0 0 28px;">
        <div style="font-family:${FONTS.heading};font-size:19px;font-weight:500;line-height:28px;letter-spacing:-0.015em;color:${DESIGN_TOKENS.textPrimary};margin:0 0 16px 0;font-style:italic;">${quote}</div>
        ${attributionHtml}
      </td>
    </tr>
  </table>
</td></tr>`;
}

const schema = {
  type: "pull-quote",
  label: "Pull quote",
  description: "Editorial italic quote with attribution. Use sparingly — once per email max. Two variants: 'simple' (left accent bar, marketing) or 'labelled' (with eyebrow label, B2B Weekly).",
  fields: [
    { key: "variant", label: "Style", type: "select", options: ["simple", "labelled"], default: "simple" },
    { key: "label", label: "Eyebrow label (e.g. \"Heard this week\")", type: "text", optional: true, maxLength: 40 },
    { key: "quote", label: "Quote text", type: "longText", required: true, maxLength: 280 },
    { key: "attribution", label: "Attribution", type: "object", optional: true, schema: {
      name: { type: "text", maxLength: 60 },
      role: { type: "text", maxLength: 100 },
    }},
  ],
};

module.exports = { render, schema };
