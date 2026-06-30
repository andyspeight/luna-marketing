// lib/email-sections/headline-duotone.js
//
// A two-tone stacked serif headline — first line/word in an accent
// colour, second line/word in a base colour. Followed by an optional
// short subhead and a thick rule below. Classic newspaper feature treatment.
//
// What it accepts:
//   line_one         — first headline (rendered in accent colour)
//   line_two         — second headline (rendered in base colour)
//   subhead          — optional one-line italic subhead below the headlines
//   accent_colour    — colour of line_one (default Daily Beacon orange #E85D1A)
//   base_colour      — colour of line_two and rule (default black #000000)
//   show_rule        — boolean, render the thick underline rule (default true)
//   rule_thickness   — 'thin' (1px) | 'medium' (3px) | 'thick' (5px, default)
//
// Layout:
//   Line one (accent colour)
//   Line two (base colour)
//   Subhead (italic, with bold inline support)
//   ━━━━━━━━━━━━━━━━━━━━━━ (thick rule)

const STATIC_BRAND = require("../email-brand");
const { escHtml, fallback, scaleFont, safeHex } = require("./_helpers");

// Render the subhead with limited inline formatting support. We honour
// **bold** and *italic* markdown markers, plus escape everything else.
// This is a deliberate narrow shim — full markdown would expand the
// attack surface for HTML injection.
function renderSubhead(raw) {
  if (!raw) return "";
  const escaped = escHtml(raw);
  // Bold: **text** → <strong>text</strong>
  // Italic: *text* → <em>text</em>
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function render(props = {}, brand) {
  const { FONTS } = brand || STATIC_BRAND;

  // Daily Beacon defaults: orange accent + black base.
  const accent = safeHex(props.accent_colour) || "#E85D1A";
  const base = safeHex(props.base_colour) || "#000000";
  const showRule = props.show_rule !== false;
  const ruleThickness = (props.rule_thickness === "thin" || props.rule_thickness === "medium")
    ? (props.rule_thickness === "thin" ? "1px" : "3px")
    : "5px";  // default thick

  const lineOne = escHtml(fallback(props.line_one, "Upgrade"));
  const lineTwo = escHtml(fallback(props.line_two, "Your Subscription"));
  const subheadHtml = renderSubhead(props.subhead);

  // Per-text-area sizes — bases match the px values in the markup below.
  const lineOneSize = scaleFont(54, props.line_one_size);
  const lineTwoSize = scaleFont(54, props.line_two_size);
  const subheadSize = scaleFont(14, props.subhead_size);

  // Serif stack — same as masthead-bar for consistency across the
  // Daily-Beacon-style sections.
  const serifStack = "'Playfair Display', 'Georgia', 'Times New Roman', serif";

  // Subhead row — only renders if set.
  const subheadRowHtml = subheadHtml
    ? `<tr>
        <td style="padding:14px 0 0 0;">
          <p style="font-family:${FONTS.body};font-size:${subheadSize}px;color:${base};line-height:1.5;margin:0;">${subheadHtml}</p>
        </td>
      </tr>`
    : "";

  // Rule row — thick black underline below subhead.
  const ruleHtml = showRule
    ? `<tr>
        <td style="padding:20px 0 0 0;font-size:0;line-height:0;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
            <tr><td style="border-bottom:${ruleThickness} solid ${base};font-size:0;line-height:0;height:${ruleThickness};">&nbsp;</td></tr>
          </table>
        </td>
      </tr>`
    : "";

  return `
<tr><td class="tg-pad-mobile" style="padding:32px 36px 24px 36px;">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
    <tr>
      <td>
        <h1 style="font-family:${serifStack};font-size:${lineOneSize}px;font-weight:900;letter-spacing:-0.02em;line-height:1.0;color:${accent};margin:0;mso-line-height-rule:exactly;">${lineOne}</h1>
      </td>
    </tr>
    <tr>
      <td>
        <h1 style="font-family:${serifStack};font-size:${lineTwoSize}px;font-weight:900;letter-spacing:-0.02em;line-height:1.05;color:${base};margin:0;mso-line-height-rule:exactly;">${lineTwo}</h1>
      </td>
    </tr>
    ${subheadRowHtml}
    ${ruleHtml}
  </table>
</td></tr>`;
}

const schema = {
  type: "headline-duotone",
  label: "Headline (duotone)",
  description: "Two-stack serif headline with a coloured first line and a base-colour second line. Optional subhead with inline bold/italic. Defaults to Daily Beacon orange + black with a thick rule below.",
  fields: [
    { key: "line_one", label: "First line (accent colour)", type: "text", required: true, maxLength: 60 },
    { key: "line_one_size", label: "First line text size", type: "fontSize", optional: true },
    { key: "line_two", label: "Second line (base colour)", type: "text", required: true, maxLength: 80 },
    { key: "line_two_size", label: "Second line text size", type: "fontSize", optional: true },
    { key: "subhead", label: "Subhead (supports **bold** and *italic*)", type: "longText", optional: true, maxLength: 200 },
    { key: "subhead_size", label: "Subhead text size", type: "fontSize", optional: true },
    { key: "accent_colour", label: "First line colour", type: "colour", optional: true, defaultPreview: "#E85D1A", placeholder: "#E85D1A", help: "Daily Beacon orange. Try your brand accent for Travelgenix emails." },
    { key: "base_colour", label: "Second line + rule colour", type: "colour", optional: true, defaultPreview: "#000000", placeholder: "#000000", help: "Daily Beacon default is pure black." },
    { key: "show_rule", label: "Show thick rule below", type: "boolean", optional: true, checkboxLabel: "Show a thick rule under the headline" },
    { key: "rule_thickness", label: "Rule thickness", type: "select", optional: true, options: ["thin", "medium", "thick"] },
  ],
};

module.exports = { render, schema };
