// lib/email-sections/footer-meta.js
// Archetype D (Transactional): plain legal footer.
// Centred plain text only — no logo, no socials, no decorative elements.
// Carries ATOL/ABTA numbers, address, send reason, view-in-browser link.
//
// This is the boring-but-essential trust signal that closes a transactional
// email. Sits below the help-block.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.4.

const STATIC_BRAND = require("../email-brand");
const { escHtml, safeUrl, fallback } = require("./_helpers");

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const lines = Array.isArray(props.lines) ? props.lines : [];
  const reason = props.reason ? escHtml(props.reason) : "";
  const browserUrl = safeUrl(props.browser_url);

  const linesHtml = lines
    .map((line) => escHtml(String(line || "").trim()))
    .filter(Boolean)
    .map((line) => `<div style="margin:0;">${line}</div>`)
    .join("");

  // Footer is always small print: 11px tabular, tertiary colour, very tight
  // line-height. Browser link inline at the end of the reason line.
  const reasonAndBrowserHtml = (() => {
    if (!reason && !browserUrl) return "";
    if (reason && browserUrl) {
      return `<div style="margin:12px 0 0 0;">${reason} <a href="${browserUrl}" style="color:${DESIGN_TOKENS.textSecondary};text-decoration:underline;">View in browser</a></div>`;
    }
    if (reason) {
      return `<div style="margin:12px 0 0 0;">${reason}</div>`;
    }
    return `<div style="margin:12px 0 0 0;"><a href="${browserUrl}" style="color:${DESIGN_TOKENS.textSecondary};text-decoration:underline;">View in browser</a></div>`;
  })();

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" align="center" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:20px 32px;text-align:center;border-top:1px solid ${DESIGN_TOKENS.borderLight};">
  <div style="font-family:${FONTS.body};font-size:11px;color:${DESIGN_TOKENS.textTertiary};line-height:18px;">
    ${linesHtml}
    ${reasonAndBrowserHtml}
  </div>
</td></tr>`;
}

const schema = {
  type: "footer-meta",
  label: "Footer meta",
  description: "Plain legal footer for transactional emails. Use for ATOL/ABTA, postal address, send reason. No logo, no socials.",
  fields: [
    { key: "lines", label: "Footer lines (one per line of text, e.g. legal name + ATOL/ABTA, then address)", type: "array", required: true, itemSchema: {
      type: "text", maxLength: 200,
    }},
    { key: "reason", label: "Send reason (e.g. \"This email was sent because you made a booking.\")", type: "text", optional: true, maxLength: 200 },
    { key: "browser_url", label: "View in browser URL", type: "url", optional: true },
  ],
};

module.exports = { render, schema };
