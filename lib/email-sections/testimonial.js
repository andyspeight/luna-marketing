// lib/email-sections/testimonial.js
// Archetype C (Product Launch): single centred testimonial.
// Italic quote (22px) up top, then a centred avatar + name/role row
// underneath. Avatar is a circular tile with the author's initials on
// a navy bgcolor (no gradient — Outlook-safe).
//
// One quote per email — this is the social-proof beat just before the
// final CTA. Don't pluralise.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.3.
//
// Outlook patterns used:
//   - P6 (two-column) for the avatar + name/role row
//   - Avatar uses bgcolor (no gradient text fill on initials)
//   - Italic styling preserved across clients

const STATIC_BRAND = require("../email-brand");
const { escHtml, fallback, scaleFont } = require("./_helpers");

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const quote = props.quote ? escHtml(props.quote) : "";
  const quoteSize = scaleFont(22, props.quote_size);
  const author = props.author || {};
  const name = escHtml(fallback(author.name, "")).trim();
  const role = escHtml(fallback(author.role, "")).trim();
  const initials = (() => {
    if (author.initials) return escHtml(String(author.initials).slice(0, 2).toUpperCase());
    if (author.name) {
      const parts = String(author.name).trim().split(/\s+/).slice(0, 2);
      return escHtml(parts.map((p) => p[0] || "").join("").toUpperCase());
    }
    return "";
  })();

  if (!quote) return "";

  // Author block: avatar circle on the left, name+role on the right,
  // centred as a unit. Wrapped in a single-row table that's centred via
  // align="center" on its containing td.
  const authorBlock = (name || role || initials) ? `
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto;">
      <tr>
        ${initials ? `
        <td valign="middle" style="padding-right:12px;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="44">
            <tr>
              <td bgcolor="${DESIGN_TOKENS.primary}" align="center" valign="middle" width="44" height="44" style="background-color:${DESIGN_TOKENS.primary};border-radius:22px;font-family:${FONTS.body};font-size:15px;font-weight:700;color:#ffffff;line-height:44px;width:44px;height:44px;mso-line-height-rule:exactly;">${initials}</td>
            </tr>
          </table>
        </td>` : ""}
        <td valign="middle" align="left">
          ${name ? `<div style="font-family:${FONTS.body};font-size:14px;font-weight:600;color:${DESIGN_TOKENS.textPrimary};line-height:1.4;margin:0;">${name}</div>` : ""}
          ${role ? `<div style="font-family:${FONTS.body};font-size:12px;color:${DESIGN_TOKENS.textSecondary};line-height:1.4;margin:2px 0 0 0;">${role}</div>` : ""}
        </td>
      </tr>
    </table>` : "";

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" align="center" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:56px 40px;text-align:center;">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
    <tr>
      <td align="center" style="padding:0 0 24px 0;">
        <p style="font-family:${FONTS.heading};font-size:${quoteSize}px;line-height:1.4;letter-spacing:-0.02em;color:${DESIGN_TOKENS.textPrimary};font-weight:500;font-style:italic;margin:0 auto;max-width:480px;">&ldquo;${quote}&rdquo;</p>
      </td>
    </tr>
    ${authorBlock ? `
    <tr>
      <td align="center" style="padding:0;">${authorBlock}</td>
    </tr>` : ""}
  </table>
</td></tr>`;
}

const schema = {
  type: "testimonial",
  label: "Testimonial",
  description: "Single centred italic quote with avatar and author byline underneath. One per email — use sparingly. For product launch emails.",
  fields: [
    { key: "quote", label: "Quote text", type: "longText", required: true, maxLength: 400 },
    { key: "quote_size", label: "Quote text size", type: "fontSize", optional: true },
    { key: "author", label: "Author", type: "group", optional: true, fields: [
      { key: "initials", label: "Avatar initials (auto-derived from name if blank)", type: "text", maxLength: 2 },
      { key: "name", label: "Name", type: "text", maxLength: 60 },
      { key: "role", label: "Role / company", type: "text", maxLength: 100 },
    ]},
  ],
};

module.exports = { render, schema };
