// lib/email-sections/masthead-bar.js
//
// Daily-Beacon-style masthead. A full-width coloured bar (default black)
// with a centred italic serif wordmark, followed by a thin underline rule
// with a small gap between bar and rule.
//
// Used for Travelgenix marketing emails that want a "publication" feel.
// Sister sections: `masthead` (newspaper editorial, white background) and
// `hero-coloured` (marketing hero with eyebrow + headline + subhead).
//
// What it accepts:
//   wordmark          — the brand name (italic serif rendered)
//   wordmark_link_url — optional link wrapping the wordmark
//   background_colour — bar fill colour (default #000000)
//   text_colour       — wordmark colour (default #FFFFFF)
//   rule_colour       — colour of the thin underline (default #000000)
//   show_rule         — boolean, render the underline rule (default true)
//
// All colour props strictly hex-validated to prevent CSS injection.

const STATIC_BRAND = require("../email-brand");
const { escHtml, safeUrl, fallback } = require("./_helpers");

function safeHex(value) {
  if (typeof value !== "string") return null;
  return /^#[0-9A-Fa-f]{6}$/.test(value.trim()) ? value.trim() : null;
}

function render(props = {}, brand) {
  const { FONTS } = brand || STATIC_BRAND;

  // Daily Beacon defaults: black bar, white wordmark, black rule.
  const bg = safeHex(props.background_colour) || "#000000";
  const fg = safeHex(props.text_colour) || "#FFFFFF";
  const rule = safeHex(props.rule_colour) || "#000000";
  const showRule = props.show_rule !== false;  // default true

  const wordmark = escHtml(fallback(props.wordmark, "The Daily Beacon"));
  const linkUrl = safeUrl(props.wordmark_link_url);

  // Serif font stack. Use the brand heading font if it's a serif, else
  // fall back to a classic newspaper serif. We override the body/heading
  // font set in FONTS here because masthead-bar specifically wants a
  // serif italic for the Daily Beacon look.
  const serifStack = "'Playfair Display', 'Georgia', 'Times New Roman', serif";

  // Inner wordmark — wrap in <a> if a link URL is set.
  const wordmarkHtml = linkUrl
    ? `<a href="${linkUrl}" style="font-family:${serifStack};font-size:18px;font-style:italic;font-weight:700;color:${fg};text-decoration:none;letter-spacing:0.005em;line-height:1.2;">${wordmark}</a>`
    : `<span style="font-family:${serifStack};font-size:18px;font-style:italic;font-weight:700;color:${fg};letter-spacing:0.005em;line-height:1.2;">${wordmark}</span>`;

  // Rule row below the bar — thin 1px rule with white gap above (matches
  // the Daily Beacon style where the rule sits a small distance below the
  // black bar). Suppressed if show_rule is false.
  const ruleHtml = showRule
    ? `<tr>
        <td style="padding:14px 36px 0 36px;font-size:0;line-height:0;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
            <tr><td style="border-bottom:1px solid ${rule};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
          </table>
        </td>
      </tr>`
    : "";

  return `
<tr><td bgcolor="${bg}" align="center" class="tg-pad-mobile" style="background-color:${bg};padding:16px 36px;">
  ${wordmarkHtml}
</td></tr>
${ruleHtml}`;
}

const schema = {
  type: "masthead-bar",
  label: "Masthead (dark bar)",
  description: "Full-width coloured bar with centred italic serif wordmark and optional thin underline rule below. Defaults to black bar with white text — the Daily Beacon look. Override colours for Travelgenix navy + teal or any brand.",
  fields: [
    { key: "wordmark", label: "Wordmark text", type: "text", required: true, maxLength: 60 },
    { key: "wordmark_link_url", label: "Wordmark link URL (optional)", type: "url", optional: true },
    { key: "background_colour", label: "Bar background colour", type: "colour", optional: true, defaultPreview: "#000000", placeholder: "#000000", help: "Daily Beacon default is black." },
    { key: "text_colour", label: "Wordmark colour", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "#FFFFFF", help: "Pick a colour that contrasts strongly with the bar." },
    { key: "rule_colour", label: "Underline rule colour", type: "colour", optional: true, defaultPreview: "#000000", placeholder: "#000000", help: "Colour of the thin rule below the bar." },
    { key: "show_rule", label: "Show underline rule", type: "boolean", optional: true, checkboxLabel: "Show a thin rule below the bar" },
  ],
};

module.exports = { render, schema };
